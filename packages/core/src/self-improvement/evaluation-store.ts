export * as SelfImprovementEvaluationStore from "./evaluation-store"

import { and, eq, sql } from "drizzle-orm"
import { Context, Effect, Layer, Schema } from "effect"
import { SelfImprovement, SelfImprovementEvaluation, SelfImprovementLifecycle } from "@opencode-ai/schema"
import type { EffectDrizzleSqlite } from "@opencode-ai/effect-drizzle-sqlite"
import { Database } from "../database/database"
import { makeLocationNode } from "../effect/app-node"
import {
  SelfImprovementEvaluationBaselineTable,
  SelfImprovementEvaluationDecisionTable,
  SelfImprovementEvaluationFindingTable,
  SelfImprovementEvaluationRunTable,
  SelfImprovementEvaluationSampleTable,
  SelfImprovementEvaluationSuiteRevisionTable,
} from "./evaluation.sql"

type DatabaseClient = EffectDrizzleSqlite.EffectSQLiteDatabase
type Transaction = Parameters<Parameters<DatabaseClient["transaction"]>[0]>[0]
const retentionMs = 180 * 86_400_000

const SuiteJson = Schema.fromJsonString(SelfImprovementEvaluation.SuiteRevision)
const BaselineJson = Schema.fromJsonString(SelfImprovementEvaluation.Baseline)
const RunJson = Schema.fromJsonString(SelfImprovementEvaluation.EvaluationRun)
const SampleJson = Schema.fromJsonString(SelfImprovementEvaluation.MetricSample)
const DecisionJson = Schema.fromJsonString(SelfImprovementEvaluation.EvaluationDecision)
const FindingJson = Schema.fromJsonString(SelfImprovementEvaluation.GateFinding)

export class InvalidInput extends Schema.TaggedErrorClass<InvalidInput>()(
  "SelfImprovementEvaluationStore.InvalidInput",
  {
    message: Schema.String,
  },
) {}

export class Conflict extends Schema.TaggedErrorClass<Conflict>()("SelfImprovementEvaluationStore.Conflict", {
  message: Schema.String,
}) {}

export interface Interface {
  readonly putSuiteRevision: (suite: SelfImprovementEvaluation.SuiteRevision) => Effect.Effect<void, Conflict>
  readonly bootstrapBaseline: (
    baseline: SelfImprovementEvaluation.Baseline,
  ) => Effect.Effect<void, InvalidInput | Conflict>
  readonly getBaseline: (
    locationID: SelfImprovementLifecycle.LocationID,
    baselineID: SelfImprovementLifecycle.BaselineID,
  ) => Effect.Effect<SelfImprovementEvaluation.Baseline | undefined>
  readonly getRun: (
    locationID: SelfImprovementLifecycle.LocationID,
    runID: SelfImprovementLifecycle.EvaluationRunID,
    tx?: Transaction,
  ) => Effect.Effect<SelfImprovementEvaluation.EvaluationRun | undefined>
  readonly getDecision: (
    locationID: SelfImprovementLifecycle.LocationID,
    runID: SelfImprovementLifecycle.EvaluationRunID,
    tx?: Transaction,
  ) => Effect.Effect<SelfImprovementEvaluation.EvaluationDecision | undefined>
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
  readonly beginDecision: (
    locationID: SelfImprovementLifecycle.LocationID,
    runID: SelfImprovementLifecycle.EvaluationRunID,
    cutoffSampleSetDigest: SelfImprovement.Digest,
    tx?: Transaction,
  ) => Effect.Effect<boolean, Conflict>
  readonly finishDecision: (
    locationID: SelfImprovementLifecycle.LocationID,
    decision: SelfImprovementEvaluation.EvaluationDecision,
    tx?: Transaction,
  ) => Effect.Effect<boolean, Conflict>
  readonly cancelRun: (
    locationID: SelfImprovementLifecycle.LocationID,
    runID: SelfImprovementLifecycle.EvaluationRunID,
  ) => Effect.Effect<boolean, Conflict>
  readonly listAcceptedSamples: (
    locationID: SelfImprovementLifecycle.LocationID,
    runID: SelfImprovementLifecycle.EvaluationRunID,
  ) => Effect.Effect<ReadonlyArray<SelfImprovementEvaluation.MetricSample>>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SelfImprovementEvaluationStore") {}

const decodeBaseline = Schema.decodeUnknownSync(BaselineJson)
const decodeRun = Schema.decodeUnknownSync(RunJson)
const decodeDecision = Schema.decodeUnknownSync(DecisionJson)
const decodeSample = Schema.decodeUnknownSync(SampleJson)
const encodeSuite = Schema.encodeSync(SuiteJson)
const encodeBaseline = Schema.encodeSync(BaselineJson)
const encodeRun = Schema.encodeSync(RunJson)
const encodeSample = Schema.encodeSync(SampleJson)
const encodeDecision = Schema.encodeSync(DecisionJson)
const encodeFinding = Schema.encodeSync(FindingJson)

const invalidSample = (sample: SelfImprovementEvaluation.MetricSample) =>
  sample.metrics.taskQuality.possibleAllowlistedPoints === 0 ||
  sample.metrics.correctness.requiredChecks === 0 ||
  sample.metrics.repeatFixRate.completedTasks === 0 ||
  sample.metrics.precision.assessedItems === 0 ||
  sample.metrics.tokensPerSuccess.successfulTasks === 0

const transitionRun = (
  run: SelfImprovementEvaluation.EvaluationRun,
  state: SelfImprovementEvaluation.RunState,
  cutoffSampleSetDigest?: SelfImprovement.Digest,
  decidedAt?: SelfImprovementLifecycle.TimestampMillis,
) =>
  new SelfImprovementEvaluation.EvaluationRun({
    id: run.id,
    locationID: run.locationID,
    versionID: run.versionID,
    stage: run.stage,
    workload: run.workload,
    workloadRevision: run.workloadRevision,
    suiteID: run.suiteID,
    suiteRevision: run.suiteRevision,
    baselineID: run.baselineID,
    state,
    trustedProducerIDs: run.trustedProducerIDs,
    acceptanceStart: run.acceptanceStart,
    acceptanceEnd: run.acceptanceEnd,
    cutoffAt: run.cutoffAt,
    requestDigest: run.requestDigest,
    createdAt: run.createdAt,
    ...(cutoffSampleSetDigest === undefined ? {} : { cutoffSampleSetDigest }),
    ...(decidedAt === undefined ? {} : { decidedAt }),
  })

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const db = (yield* Database.Service).db

    const putSuiteRevision = Effect.fn("SelfImprovementEvaluationStore.putSuiteRevision")(function* (
      suite: SelfImprovementEvaluation.SuiteRevision,
    ) {
      const inserted = yield* db
        .insert(SelfImprovementEvaluationSuiteRevisionTable)
        .values({
          location_id: suite.locationID,
          suite_id: suite.suiteID,
          revision: suite.revision,
          suite_json: encodeSuite(suite),
        })
        .onConflictDoNothing()
        .returning({ locationID: SelfImprovementEvaluationSuiteRevisionTable.location_id })
        .get()
        .pipe(Effect.orDie)
      if (inserted === undefined) return yield* new Conflict({ message: "Suite revision already exists" })
      return undefined
    })

    const bootstrapBaseline = Effect.fn("SelfImprovementEvaluationStore.bootstrapBaseline")(function* (
      baseline: SelfImprovementEvaluation.Baseline,
    ) {
      if (baseline.uniqueSampleCount < 20)
        return yield* new InvalidInput({ message: "Baseline requires twenty unique trusted samples" })
      const inserted = yield* db
        .insert(SelfImprovementEvaluationBaselineTable)
        .values({
          id: baseline.id,
          location_id: baseline.locationID,
          workload: baseline.workload,
          workload_revision: baseline.workloadRevision,
          suite_id: baseline.suiteID,
          suite_revision: baseline.suiteRevision,
          baseline_json: encodeBaseline(baseline),
        })
        .onConflictDoNothing()
        .returning({ id: SelfImprovementEvaluationBaselineTable.id })
        .get()
        .pipe(Effect.orDie)
      if (inserted === undefined) return yield* new Conflict({ message: "Baseline already exists" })
      return undefined
    })

    const getBaseline = Effect.fn("SelfImprovementEvaluationStore.getBaseline")(function* (
      locationID: SelfImprovementLifecycle.LocationID,
      baselineID: SelfImprovementLifecycle.BaselineID,
    ) {
      const row = yield* db
        .select({ baseline: SelfImprovementEvaluationBaselineTable.baseline_json })
        .from(SelfImprovementEvaluationBaselineTable)
        .where(
          and(
            eq(SelfImprovementEvaluationBaselineTable.location_id, locationID),
            eq(SelfImprovementEvaluationBaselineTable.id, baselineID),
          ),
        )
        .get()
        .pipe(Effect.orDie)
      return row === undefined ? undefined : decodeBaseline(row.baseline)
    })

    const getRun = Effect.fn("SelfImprovementEvaluationStore.getRun")(function* (
      locationID: SelfImprovementLifecycle.LocationID,
      runID: SelfImprovementLifecycle.EvaluationRunID,
      tx?: Transaction,
    ) {
      const row = yield* (tx ?? db)
        .select({ run: SelfImprovementEvaluationRunTable.run_json })
        .from(SelfImprovementEvaluationRunTable)
        .where(
          and(
            eq(SelfImprovementEvaluationRunTable.location_id, locationID),
            eq(SelfImprovementEvaluationRunTable.id, runID),
          ),
        )
        .get()
        .pipe(Effect.orDie)
      return row === undefined ? undefined : decodeRun(row.run)
    })

    const getDecision = Effect.fn("SelfImprovementEvaluationStore.getDecision")(function* (
      locationID: SelfImprovementLifecycle.LocationID,
      runID: SelfImprovementLifecycle.EvaluationRunID,
      tx?: Transaction,
    ) {
      const row = yield* (tx ?? db)
        .select({ decision: SelfImprovementEvaluationDecisionTable.decision_json })
        .from(SelfImprovementEvaluationDecisionTable)
        .where(
          and(
            eq(SelfImprovementEvaluationDecisionTable.location_id, locationID),
            eq(SelfImprovementEvaluationDecisionTable.run_id, runID),
          ),
        )
        .get()
        .pipe(Effect.orDie)
      return row === undefined ? undefined : decodeDecision(row.decision)
    })

    const createRun = Effect.fn("SelfImprovementEvaluationStore.createRun")(function* (
      run: SelfImprovementEvaluation.EvaluationRun,
      tx?: Transaction,
    ) {
      const client = tx ?? db
      const inserted = yield* client
        .insert(SelfImprovementEvaluationRunTable)
        .values({
          id: run.id,
          location_id: run.locationID,
          request_digest: run.requestDigest,
          state: run.state,
          cutoff_sample_set_digest: run.cutoffSampleSetDigest ?? null,
          decided_at: run.decidedAt ?? null,
          run_json: encodeRun(run),
        })
        .onConflictDoNothing()
        .returning({ id: SelfImprovementEvaluationRunTable.id })
        .get()
        .pipe(Effect.orDie)
      if (inserted !== undefined) return run
      const existing = yield* client
        .select({
          requestDigest: SelfImprovementEvaluationRunTable.request_digest,
          run: SelfImprovementEvaluationRunTable.run_json,
        })
        .from(SelfImprovementEvaluationRunTable)
        .where(
          and(
            eq(SelfImprovementEvaluationRunTable.id, run.id),
            eq(SelfImprovementEvaluationRunTable.location_id, run.locationID),
          ),
        )
        .get()
        .pipe(Effect.orDie)
      if (existing?.requestDigest === run.requestDigest) return decodeRun(existing.run)
      return yield* new Conflict({ message: "Evaluation run idempotency mismatch" })
    })

    const appendSample = Effect.fn("SelfImprovementEvaluationStore.appendSample")(function* (
      locationID: SelfImprovementLifecycle.LocationID,
      sample: SelfImprovementEvaluation.MetricSample,
      tx?: Transaction,
    ) {
      if (invalidSample(sample))
        return yield* new InvalidInput({ message: "Metric sample has a zero required denominator" })
      const append = (tx: Transaction) =>
        Effect.gen(function* () {
          const existing = yield* tx
            .select({
              requestDigest: SelfImprovementEvaluationSampleTable.request_digest,
              sample: SelfImprovementEvaluationSampleTable.sample_json,
            })
            .from(SelfImprovementEvaluationSampleTable)
            .where(
              and(
                eq(SelfImprovementEvaluationSampleTable.location_id, locationID),
                eq(SelfImprovementEvaluationSampleTable.run_id, sample.runID),
                eq(SelfImprovementEvaluationSampleTable.sample_id_digest, sample.sampleIDDigest),
              ),
            )
            .get()
            .pipe(Effect.orDie)
          if (existing?.requestDigest === sample.requestDigest)
            return { sample: decodeSample(existing.sample), replayed: true }
          if (existing !== undefined) return yield* new Conflict({ message: "Metric sample idempotency mismatch" })

          const run = yield* tx
            .select()
            .from(SelfImprovementEvaluationRunTable)
            .where(
              and(
                eq(SelfImprovementEvaluationRunTable.id, sample.runID),
                eq(SelfImprovementEvaluationRunTable.location_id, locationID),
              ),
            )
            .get()
            .pipe(Effect.orDie)
          if (run === undefined) return yield* new InvalidInput({ message: "Evaluation run not found" })
          const accepted = decodeRun(run.run_json)
          if (run.state !== "open" || accepted.state !== "open")
            return yield* new Conflict({ message: "Evaluation run is not open" })
          if (!accepted.trustedProducerIDs.includes(sample.producerID))
            return yield* new InvalidInput({ message: "Metric sample producer is not trusted" })
          if (sample.startedAt < accepted.acceptanceStart || sample.terminalAt > accepted.acceptanceEnd)
            return yield* new InvalidInput({ message: "Metric sample is outside the acceptance window" })

          const inserted = yield* tx
            .get<{ id: SelfImprovementLifecycle.MetricSampleID }>(
              sql`
              INSERT INTO self_improvement_evaluation_sample (
                id,
                location_id,
                run_id,
                sample_id_digest,
                task_id_digest,
                request_digest,
                sample_json,
                expires_at
              )
              SELECT
                ${sample.id},
                ${locationID},
                ${sample.runID},
                ${sample.sampleIDDigest},
                ${sample.taskIDDigest},
                ${sample.requestDigest},
                ${encodeSample(sample)},
                ${SelfImprovementLifecycle.TimestampMillis.make(sample.terminalAt + retentionMs)}
              WHERE EXISTS (
                SELECT 1
                FROM self_improvement_evaluation_run
                WHERE id = ${sample.runID}
                  AND location_id = ${locationID}
                  AND state = 'open'
                  AND run_json = ${run.run_json}
              )
              ON CONFLICT DO NOTHING
              RETURNING id
            `,
            )
            .pipe(Effect.orDie)
          if (inserted !== undefined) return { sample, replayed: false }
          const replay = yield* tx
            .select({
              requestDigest: SelfImprovementEvaluationSampleTable.request_digest,
              sample: SelfImprovementEvaluationSampleTable.sample_json,
            })
            .from(SelfImprovementEvaluationSampleTable)
            .where(
              and(
                eq(SelfImprovementEvaluationSampleTable.location_id, locationID),
                eq(SelfImprovementEvaluationSampleTable.run_id, sample.runID),
                eq(SelfImprovementEvaluationSampleTable.sample_id_digest, sample.sampleIDDigest),
              ),
            )
            .get()
            .pipe(Effect.orDie)
          if (replay?.requestDigest === sample.requestDigest)
            return { sample: decodeSample(replay.sample), replayed: true }
          return yield* new Conflict({ message: "Metric sample already exists" })
        })
      if (tx) return yield* append(tx)
      return yield* db.transaction(append).pipe(Effect.catchTag("SqlError", Effect.die))
    })

    const beginDecision = Effect.fn("SelfImprovementEvaluationStore.beginDecision")(function* (
      locationID: SelfImprovementLifecycle.LocationID,
      runID: SelfImprovementLifecycle.EvaluationRunID,
      cutoffSampleSetDigest: SelfImprovement.Digest,
      tx?: Transaction,
    ) {
      const client = tx ?? db
      const current = yield* client
        .select({ run: SelfImprovementEvaluationRunTable.run_json })
        .from(SelfImprovementEvaluationRunTable)
        .where(
          and(
            eq(SelfImprovementEvaluationRunTable.id, runID),
            eq(SelfImprovementEvaluationRunTable.location_id, locationID),
            eq(SelfImprovementEvaluationRunTable.state, "open"),
          ),
        )
        .get()
        .pipe(Effect.orDie)
      if (current === undefined || decodeRun(current.run).state !== "open") return false
      const updated = yield* client
        .update(SelfImprovementEvaluationRunTable)
        .set({
          state: "deciding",
          cutoff_sample_set_digest: cutoffSampleSetDigest,
          run_json: encodeRun(transitionRun(decodeRun(current.run), "deciding", cutoffSampleSetDigest)),
        })
        .where(
          and(
            eq(SelfImprovementEvaluationRunTable.id, runID),
            eq(SelfImprovementEvaluationRunTable.location_id, locationID),
            eq(SelfImprovementEvaluationRunTable.state, "open"),
            eq(SelfImprovementEvaluationRunTable.run_json, current.run),
          ),
        )
        .returning({ id: SelfImprovementEvaluationRunTable.id })
        .get()
        .pipe(Effect.orDie)
      return updated !== undefined
    })

    const finishDecision = Effect.fn("SelfImprovementEvaluationStore.finishDecision")(function* (
      locationID: SelfImprovementLifecycle.LocationID,
      decision: SelfImprovementEvaluation.EvaluationDecision,
      tx?: Transaction,
    ) {
      const finish = (tx: Transaction) =>
        Effect.gen(function* () {
          const current = yield* tx
            .select({ run: SelfImprovementEvaluationRunTable.run_json })
            .from(SelfImprovementEvaluationRunTable)
            .where(
              and(
                eq(SelfImprovementEvaluationRunTable.id, decision.runID),
                eq(SelfImprovementEvaluationRunTable.location_id, locationID),
                eq(SelfImprovementEvaluationRunTable.state, "deciding"),
                eq(SelfImprovementEvaluationRunTable.cutoff_sample_set_digest, decision.cutoffSampleSetDigest),
              ),
            )
            .get()
            .pipe(Effect.orDie)
          if (current === undefined) return false
          const run = decodeRun(current.run)
          if (run.state !== "deciding" || run.cutoffSampleSetDigest !== decision.cutoffSampleSetDigest) return false
          const inserted = yield* tx
            .insert(SelfImprovementEvaluationDecisionTable)
            .values({
              run_id: decision.runID,
              location_id: locationID,
              decision_json: encodeDecision(decision),
              expires_at: SelfImprovementLifecycle.TimestampMillis.make(decision.decidedAt + retentionMs),
            })
            .onConflictDoNothing()
            .returning({ runID: SelfImprovementEvaluationDecisionTable.run_id })
            .get()
            .pipe(Effect.orDie)
          if (inserted === undefined) return false
          yield* tx
            .insert(SelfImprovementEvaluationFindingTable)
            .values(
              decision.findings.map((finding) => ({
                id: finding.id,
                location_id: locationID,
                run_id: decision.runID,
                finding_order: finding.order,
                finding_json: encodeFinding(finding),
                expires_at: SelfImprovementLifecycle.TimestampMillis.make(decision.decidedAt + retentionMs),
              })),
            )
            .pipe(Effect.orDie)
          const updated = yield* tx
            .update(SelfImprovementEvaluationRunTable)
            .set({
              state: "decided",
              decided_at: decision.decidedAt,
              run_json: encodeRun(transitionRun(run, "decided", decision.cutoffSampleSetDigest, decision.decidedAt)),
            })
            .where(
              and(
                eq(SelfImprovementEvaluationRunTable.id, decision.runID),
                eq(SelfImprovementEvaluationRunTable.location_id, locationID),
                eq(SelfImprovementEvaluationRunTable.state, "deciding"),
                eq(SelfImprovementEvaluationRunTable.run_json, current.run),
              ),
            )
            .returning({ id: SelfImprovementEvaluationRunTable.id })
            .get()
            .pipe(Effect.orDie)
          return updated !== undefined
        })
      if (tx) return yield* finish(tx)
      return yield* db.transaction(finish).pipe(Effect.catchTag("SqlError", Effect.die))
    })

    const cancelRun = Effect.fn("SelfImprovementEvaluationStore.cancelRun")(function* (
      locationID: SelfImprovementLifecycle.LocationID,
      runID: SelfImprovementLifecycle.EvaluationRunID,
    ) {
      const current = yield* db
        .select({ run: SelfImprovementEvaluationRunTable.run_json })
        .from(SelfImprovementEvaluationRunTable)
        .where(
          and(
            eq(SelfImprovementEvaluationRunTable.id, runID),
            eq(SelfImprovementEvaluationRunTable.location_id, locationID),
            eq(SelfImprovementEvaluationRunTable.state, "open"),
          ),
        )
        .get()
        .pipe(Effect.orDie)
      if (current === undefined || decodeRun(current.run).state !== "open") return false
      const updated = yield* db
        .update(SelfImprovementEvaluationRunTable)
        .set({ state: "cancelled", run_json: encodeRun(transitionRun(decodeRun(current.run), "cancelled")) })
        .where(
          and(
            eq(SelfImprovementEvaluationRunTable.id, runID),
            eq(SelfImprovementEvaluationRunTable.location_id, locationID),
            eq(SelfImprovementEvaluationRunTable.state, "open"),
            eq(SelfImprovementEvaluationRunTable.run_json, current.run),
          ),
        )
        .returning({ id: SelfImprovementEvaluationRunTable.id })
        .get()
        .pipe(Effect.orDie)
      return updated !== undefined
    })

    const listAcceptedSamples = Effect.fn("SelfImprovementEvaluationStore.listAcceptedSamples")(function* (
      locationID: SelfImprovementLifecycle.LocationID,
      runID: SelfImprovementLifecycle.EvaluationRunID,
    ) {
      const rows = yield* db
        .select({ sample: SelfImprovementEvaluationSampleTable.sample_json })
        .from(SelfImprovementEvaluationSampleTable)
        .where(
          and(
            eq(SelfImprovementEvaluationSampleTable.location_id, locationID),
            eq(SelfImprovementEvaluationSampleTable.run_id, runID),
          ),
        )
        .all()
        .pipe(Effect.orDie)
      return rows.map((row) => decodeSample(row.sample))
    })

    return Service.of({
      putSuiteRevision,
      bootstrapBaseline,
      getBaseline,
      getRun,
      getDecision,
      createRun,
      appendSample,
      beginDecision,
      finishDecision,
      cancelRun,
      listAcceptedSamples,
    })
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [Database.node] })
