export * as SelfImprovementIngressStore from "./ingress-store"

import { and, eq, gt, lte } from "drizzle-orm"
import { Context, Effect, Layer, Schema } from "effect"
import {
  SelfImprovement,
  SelfImprovementApi,
  SelfImprovementEvaluation,
  SelfImprovementLearning,
  SelfImprovementLifecycle,
} from "@opencode-ai/schema"
import { Database } from "../database/database"
import { SelfImprovementAuthorization } from "./authorization"
import { SelfImprovementEvaluationStore } from "./evaluation-store"
import { SelfImprovementObservationTable } from "./ingress.sql"
import { SelfImprovementKeyring } from "./keyring"
import type { Transaction } from "./idempotency-store"

export class InvalidInput extends Schema.TaggedErrorClass<InvalidInput>()("SelfImprovementIngressStore.InvalidInput", {
  message: Schema.String,
}) {}

export class Conflict extends Schema.TaggedErrorClass<Conflict>()("SelfImprovementIngressStore.Conflict", {
  message: Schema.String,
}) {}

export interface EvaluationEvidence {
  readonly createRun: (
    run: SelfImprovementEvaluation.EvaluationRun,
    tx?: Transaction,
  ) => Effect.Effect<SelfImprovementEvaluation.EvaluationRun, InvalidInput | Conflict>
  readonly appendSample: (
    locationID: SelfImprovementLifecycle.LocationID,
    sample: SelfImprovementEvaluation.MetricSample,
    tx?: Transaction,
  ) => Effect.Effect<
    { readonly sample: SelfImprovementEvaluation.MetricSample; readonly replayed: boolean },
    InvalidInput | Conflict
  >
}

export interface Interface {
  readonly recordObservation: (
    principal: SelfImprovementLifecycle.Principal,
    locationID: SelfImprovementLifecycle.LocationID,
    input: SelfImprovementApi.CreateObservationRequest,
    now: SelfImprovementLifecycle.TimestampMillis,
    tx?: Transaction,
  ) => Effect.Effect<
    SelfImprovementApi.CreateObservationResponse,
    InvalidInput | Conflict | SelfImprovementAuthorization.Forbidden
  >
  readonly createMetricRun: (
    principal: SelfImprovementLifecycle.Principal,
    locationID: SelfImprovementLifecycle.LocationID,
    input: SelfImprovementApi.CreateMetricRunRequest,
    now: SelfImprovementLifecycle.TimestampMillis,
    tx?: Transaction,
  ) => Effect.Effect<
    SelfImprovementEvaluation.EvaluationRun,
    InvalidInput | Conflict | SelfImprovementAuthorization.Forbidden
  >
  readonly appendMetricSample: (
    principal: SelfImprovementLifecycle.Principal,
    locationID: SelfImprovementLifecycle.LocationID,
    input: SelfImprovementApi.AddMetricSampleRequest,
    now: SelfImprovementLifecycle.TimestampMillis,
    tx?: Transaction,
  ) => Effect.Effect<
    SelfImprovementApi.AddMetricSampleResponse,
    InvalidInput | Conflict | SelfImprovementAuthorization.Forbidden
  >
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SelfImprovementIngressStore") {}
export const EvaluationEvidence = Context.Service<EvaluationEvidence>("@opencode/SelfImprovementEvaluationEvidence")

export const evaluationEvidenceLayer = Layer.effect(
  EvaluationEvidence,
  Effect.gen(function* () {
    const store = yield* SelfImprovementEvaluationStore.Service
    const mapError = (error: SelfImprovementEvaluationStore.InvalidInput | SelfImprovementEvaluationStore.Conflict) =>
      error._tag === "SelfImprovementEvaluationStore.InvalidInput"
        ? new InvalidInput({ message: error.message })
        : new Conflict({ message: error.message })
    return EvaluationEvidence.of({
      createRun: (run, tx) => store.createRun(run, tx).pipe(Effect.mapError(mapError)),
      appendSample: (locationID, sample, tx) =>
        store.appendSample(locationID, sample, tx).pipe(Effect.mapError(mapError)),
    })
  }),
)

const retention = 30 * 86_400_000
const encode = (values: ReadonlyArray<string>) => values.map((value) => `${value.length}:${value}`).join("")
const hex = (bytes: ArrayBuffer) =>
  Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("")
const orderedToolSymbolDigest = (ids: ReadonlyArray<string>) =>
  Effect.promise(async () =>
    SelfImprovement.Digest.make(hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(encode(ids))))),
  )

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const db = (yield* Database.Service).db
    const keyring = yield* SelfImprovementKeyring.Service
    const evidence = yield* EvaluationEvidence

    const recordObservation = Effect.fn("SelfImprovementIngressStore.recordObservation")(function* (
      principal: SelfImprovementLifecycle.Principal,
      locationID: SelfImprovementLifecycle.LocationID,
      input: SelfImprovementApi.CreateObservationRequest,
      now: SelfImprovementLifecycle.TimestampMillis,
      tx?: Transaction,
    ) {
      const client = tx ?? db
      yield* SelfImprovementAuthorization.authorize(principal, "evidence.ingest", locationID)
      const digests = yield* keyring.digestObservation(locationID, input)
      yield* client
        .delete(SelfImprovementObservationTable)
        .where(
          and(
            eq(SelfImprovementObservationTable.location_id, locationID),
            eq(SelfImprovementObservationTable.identity_digest, digests.identityDigest),
            lte(SelfImprovementObservationTable.expires_at, now),
          ),
        )
        .run()
        .pipe(Effect.orDie)
      const newObservation = {
        id: SelfImprovementLifecycle.ObservationID.create(),
        location_id: locationID,
        pattern_digest: digests.patternDigest,
        identity_digest: digests.identityDigest,
        workload: input.workload,
        workload_revision: input.workloadRevision,
        error_class: input.errorClass,
        ordered_tool_symbol_digest: yield* orderedToolSymbolDigest(input.orderedToolSymbolIDs),
        outcome_class: input.outcomeClass,
        task_id_digest: input.taskIDDigest,
        producer_id: principal.id,
        occurred_at: now,
        expires_at: SelfImprovementLifecycle.TimestampMillis.make(now + retention),
      }
      const inserted = yield* client
        .insert(SelfImprovementObservationTable)
        .values(newObservation)
        .onConflictDoNothing()
        .returning()
        .get()
        .pipe(Effect.orDie)
      const observation =
        inserted ??
        (yield* client
          .select()
          .from(SelfImprovementObservationTable)
          .where(
            and(
              eq(SelfImprovementObservationTable.location_id, locationID),
              eq(SelfImprovementObservationTable.identity_digest, digests.identityDigest),
              gt(SelfImprovementObservationTable.expires_at, now),
            ),
          )
          .get()
          .pipe(Effect.orDie))
      if (observation === undefined) return yield* new Conflict({ message: "Observation insert was not visible" })
      const matchingCount = yield* client
        .select({ count: SelfImprovementObservationTable.id })
        .from(SelfImprovementObservationTable)
        .where(
          and(
            eq(SelfImprovementObservationTable.location_id, locationID),
            eq(SelfImprovementObservationTable.pattern_digest, digests.patternDigest),
            gt(SelfImprovementObservationTable.expires_at, now),
          ),
        )
        .all()
        .pipe(Effect.orDie)
      const count = matchingCount.length
      return new SelfImprovementApi.CreateObservationResponse({
        observation: new SelfImprovementLearning.Observation({
          id: observation.id,
          locationID: observation.location_id,
          patternDigest: observation.pattern_digest,
          identityDigest: observation.identity_digest,
          workload: SelfImprovementEvaluation.Workload.make(observation.workload),
          workloadRevision: observation.workload_revision,
          errorClass: observation.error_class,
          orderedToolSymbolDigest: observation.ordered_tool_symbol_digest,
          outcomeClass: observation.outcome_class,
          taskIDDigest: observation.task_id_digest,
          producerID: observation.producer_id,
          occurredAt: observation.occurred_at,
          expiresAt: observation.expires_at,
        }),
        matchingCount: count,
        generationEligible: count >= 3,
      })
    })

    const createMetricRun = Effect.fn("SelfImprovementIngressStore.createMetricRun")(function* (
      principal: SelfImprovementLifecycle.Principal,
      locationID: SelfImprovementLifecycle.LocationID,
      input: SelfImprovementApi.CreateMetricRunRequest,
      now: SelfImprovementLifecycle.TimestampMillis,
      tx?: Transaction,
    ) {
      yield* SelfImprovementAuthorization.authorize(principal, "evidence.ingest", locationID)
      if (input.acceptanceStart > input.acceptanceEnd || input.acceptanceEnd > input.cutoffAt)
        return yield* new InvalidInput({ message: "Metric run window is invalid" })
      return yield* evidence.createRun(
        new SelfImprovementEvaluation.EvaluationRun({
          id: SelfImprovementLifecycle.EvaluationRunID.create(),
          locationID,
          versionID: input.versionID,
          stage: input.stage,
          workload: input.workload,
          workloadRevision: input.workloadRevision,
          suiteID: input.suiteID,
          suiteRevision: input.suiteRevision,
          baselineID: input.baselineID,
          state: "open",
          trustedProducerIDs: [principal.id],
          acceptanceStart: input.acceptanceStart,
          acceptanceEnd: input.acceptanceEnd,
          cutoffAt: input.cutoffAt,
          requestDigest: input.requestDigest,
          createdAt: now,
        }),
        tx,
      )
    })

    const appendMetricSample = Effect.fn("SelfImprovementIngressStore.appendMetricSample")(function* (
      principal: SelfImprovementLifecycle.Principal,
      locationID: SelfImprovementLifecycle.LocationID,
      input: SelfImprovementApi.AddMetricSampleRequest,
      now: SelfImprovementLifecycle.TimestampMillis,
      tx?: Transaction,
    ) {
      yield* SelfImprovementAuthorization.authorize(principal, "evidence.ingest", locationID)
      if (input.terminalAt > now) return yield* new InvalidInput({ message: "Sample terminal time is untrusted" })
      const result = yield* evidence.appendSample(
        locationID,
        new SelfImprovementEvaluation.MetricSample({
          id: SelfImprovementLifecycle.MetricSampleID.create(),
          runID: input.runID,
          sampleIDDigest: input.sampleIDDigest,
          taskIDDigest: input.taskIDDigest,
          producerID: principal.id,
          requestDigest: input.requestDigest,
          metrics: input.metrics,
          outcome: input.outcome,
          startedAt: input.startedAt,
          terminalAt: input.terminalAt,
        }),
        tx,
      )
      return new SelfImprovementApi.AddMetricSampleResponse(result)
    })

    return Service.of({ recordObservation, createMetricRun, appendMetricSample })
  }),
)
