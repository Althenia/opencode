export * as SelfImprovementPrivateEvidenceCommand from "./private-evidence-command"

import { Context, Effect, Layer, Schema } from "effect"
import {
  SelfImprovement,
  SelfImprovementApi,
  SelfImprovementEvaluation,
  SelfImprovementLearning,
  SelfImprovementLifecycle,
} from "@opencode-ai/schema"
import { makeLocationNode, tags } from "../effect/app-node"
import { Database } from "../database/database"
import { LayerNode } from "../effect/layer-node"
import { SelfImprovementArtifactStore } from "./artifact-store"
import { SelfImprovementApprovalStore } from "./approval-store"
import { SelfImprovementAuditStore } from "./audit-store"
import { SelfImprovementAuthorization } from "./authorization"
import { SelfImprovementEvaluationStore } from "./evaluation-store"
import { SelfImprovementIngressStore } from "./ingress-store"
import { SelfImprovementMetrics } from "./metrics"
import { SelfImprovementTransitionStore } from "./transition-store"
import { SelfImprovementEvaluator } from "./evaluator"
import { SelfImprovementIdempotencyStore } from "./idempotency-store"
import { SelfImprovementLifecycleWorkflow } from "./lifecycle-workflow"
import { Hash } from "../util/hash"

export class NotFound extends Schema.TaggedErrorClass<NotFound>()("SelfImprovementPrivateEvidenceCommand.NotFound", {
  message: Schema.String,
}) {}

export class Conflict extends Schema.TaggedErrorClass<Conflict>()("SelfImprovementPrivateEvidenceCommand.Conflict", {
  message: Schema.String,
  code: Schema.Literals(["duplicate-different", "late", "out-of-stage", "cutoff-mismatch", "already-decided"]),
}) {}

type CommandContext = {
  readonly principal: SelfImprovementLifecycle.Principal
  readonly locationID: SelfImprovementLifecycle.LocationID
  readonly now: SelfImprovementLifecycle.TimestampMillis
  readonly idempotencyKey?: SelfImprovementLearning.IdempotencyKey
}

export interface Interface {
  readonly createObservation: (
    context: CommandContext,
    input: SelfImprovementApi.CreateObservationRequest,
  ) => Effect.Effect<
    SelfImprovementApi.CreateObservationResponse,
    | Conflict
    | SelfImprovementAuthorization.Forbidden
    | SelfImprovementIngressStore.InvalidInput
    | SelfImprovementIngressStore.Conflict
  >
  readonly createMetricRun: (
    context: CommandContext,
    input: SelfImprovementApi.CreateMetricRunRequest,
  ) => Effect.Effect<
    SelfImprovementEvaluation.EvaluationRun,
    | NotFound
    | Conflict
    | SelfImprovementAuthorization.Forbidden
    | SelfImprovementIngressStore.InvalidInput
    | SelfImprovementIngressStore.Conflict
  >
  readonly addMetricSample: (
    context: CommandContext,
    input: SelfImprovementApi.AddMetricSampleRequest,
  ) => Effect.Effect<
    SelfImprovementApi.AddMetricSampleResponse,
    | NotFound
    | Conflict
    | SelfImprovementAuthorization.Forbidden
    | SelfImprovementIngressStore.InvalidInput
    | SelfImprovementIngressStore.Conflict
  >
  readonly decideMetricRun: (
    context: CommandContext,
    input: SelfImprovementApi.DecideMetricRunRequest,
  ) => Effect.Effect<
    SelfImprovementApi.DecideMetricRunResponse,
    NotFound | Conflict | SelfImprovementAuthorization.Forbidden | SelfImprovementEvaluator.InvalidEvidence
  >
  readonly auditReadAccess: (
    context: CommandContext,
    input: { readonly eventType?: string },
  ) => Effect.Effect<
    ReadonlyArray<SelfImprovementLearning.AuditEntry>,
    SelfImprovementAuthorization.Forbidden | SelfImprovementAuditStore.InvalidInput | SelfImprovementAuditStore.Conflict
  >
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SelfImprovementPrivateEvidenceCommand") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const ingress = yield* SelfImprovementIngressStore.Service
    const evaluation = yield* SelfImprovementEvaluationStore.Service
    const artifacts = yield* SelfImprovementArtifactStore.Service
    const approvals = yield* SelfImprovementApprovalStore.Service
    const transitions = yield* SelfImprovementTransitionStore.Service
    const audit = yield* SelfImprovementAuditStore.Service
    const db = (yield* Database.Service).db
    const idempotency = yield* SelfImprovementIdempotencyStore.Service
    const workflow = yield* SelfImprovementLifecycleWorkflow.Service

    const createObservation = Effect.fn("SelfImprovementPrivateEvidenceCommand.createObservation")(function* (
      context: CommandContext,
      input: SelfImprovementApi.CreateObservationRequest,
    ) {
      yield* SelfImprovementAuthorization.authorize(context.principal, "evidence.ingest", context.locationID)
      const identity = identityFor(context, "evidence.ingest")
      const digest = requestDigest("observation", input)
      const replay = yield* idempotency.get({ locationID: context.locationID, identity })
      if (replay) return yield* replayBody(replay, digest, isObservationResponse)
      return yield* db
        .transaction((tx) =>
          Effect.gen(function* () {
            const result = yield* ingress.recordObservation(
              context.principal,
              context.locationID,
              input,
              context.now,
              tx,
            )
            yield* idempotency
              .put(
                {
                  locationID: context.locationID,
                  record: recordFor(identity, digest, { status: 200, body: result }, context.now),
                },
                tx,
              )
              .pipe(
                Effect.mapError(
                  () =>
                    new Conflict({
                      code: "duplicate-different",
                      message: "Idempotency key was reused with a different request",
                    }),
                ),
              )
            return result
          }),
        )
        .pipe(Effect.catchTag("SqlError", Effect.die))
    })

    const createMetricRun = Effect.fn("SelfImprovementPrivateEvidenceCommand.createMetricRun")(function* (
      context: CommandContext,
      input: SelfImprovementApi.CreateMetricRunRequest,
    ) {
      yield* SelfImprovementAuthorization.authorize(context.principal, "evidence.ingest", context.locationID)
      const version = yield* artifacts.getVersion({ locationID: context.locationID, versionID: input.versionID })
      if (version === undefined) return yield* new NotFound({ message: "Version was not found in this Location" })
      const stage = yield* transitions.currentStage({ locationID: context.locationID, versionID: input.versionID })
      if (stage !== input.stage)
        return yield* new Conflict({ code: "out-of-stage", message: "Version is not in the requested stage" })
      const baseline = yield* evaluation.getBaseline(context.locationID, input.baselineID)
      if (baseline === undefined) return yield* new NotFound({ message: "Baseline was not found in this Location" })
      if (
        baseline.workload !== input.workload ||
        baseline.workloadRevision !== input.workloadRevision ||
        baseline.suiteID !== input.suiteID ||
        baseline.suiteRevision !== input.suiteRevision
      )
        return yield* new Conflict({ code: "out-of-stage", message: "Baseline does not bind the requested run" })
      const identity = identityFor(context, "evidence.ingest")
      const digest = requestDigest("metric-run", input)
      const replay = yield* idempotency.get({ locationID: context.locationID, identity })
      if (replay) return (yield* replayBody(replay, digest, isMetricRunResponse)).run
      return yield* db
        .transaction((tx) =>
          Effect.gen(function* () {
            const run = yield* ingress.createMetricRun(context.principal, context.locationID, input, context.now, tx)
            yield* idempotency
              .put(
                {
                  locationID: context.locationID,
                  record: recordFor(
                    identity,
                    digest,
                    { status: 201, body: new SelfImprovementApi.CreateMetricRunResponse({ run }) },
                    context.now,
                  ),
                },
                tx,
              )
              .pipe(
                Effect.mapError(
                  () =>
                    new Conflict({
                      code: "duplicate-different",
                      message: "Idempotency key was reused with a different request",
                    }),
                ),
              )
            return run
          }),
        )
        .pipe(Effect.catchTag("SqlError", Effect.die))
    })

    const addMetricSample = Effect.fn("SelfImprovementPrivateEvidenceCommand.addMetricSample")(function* (
      context: CommandContext,
      input: SelfImprovementApi.AddMetricSampleRequest,
    ) {
      yield* SelfImprovementAuthorization.authorize(context.principal, "evidence.ingest", context.locationID)
      if (input.terminalAt > context.now)
        return yield* new Conflict({ code: "late", message: "Sample terminal time is later than server time" })
      const identity = identityFor(context, "evidence.ingest")
      const digest = requestDigest("metric-sample", input)
      const replay = yield* idempotency.get({ locationID: context.locationID, identity })
      if (replay) return yield* replayBody(replay, digest, isMetricSampleResponse)
      return yield* db
        .transaction((tx) =>
          Effect.gen(function* () {
            const result = yield* ingress.appendMetricSample(
              context.principal,
              context.locationID,
              input,
              context.now,
              tx,
            )
            yield* idempotency
              .put(
                {
                  locationID: context.locationID,
                  record: recordFor(identity, digest, { status: 201, body: result }, context.now),
                },
                tx,
              )
              .pipe(
                Effect.mapError(
                  () =>
                    new Conflict({
                      code: "duplicate-different",
                      message: "Idempotency key was reused with a different request",
                    }),
                ),
              )
            return result
          }),
        )
        .pipe(Effect.catchTag("SqlError", Effect.die))
    })

    const decideMetricRun = Effect.fn("SelfImprovementPrivateEvidenceCommand.decideMetricRun")(function* (
      context: CommandContext,
      input: SelfImprovementApi.DecideMetricRunRequest,
    ) {
      yield* SelfImprovementAuthorization.authorize(context.principal, "evaluation.decide", context.locationID)
      const samples = yield* evaluation.listAcceptedSamples(context.locationID, input.runID)
      if (samples.length === 0) return yield* new NotFound({ message: "Run was not found or has no accepted samples" })
      const metrics = SelfImprovementMetrics.aggregate(samples)
      if (metrics.orderedSampleIDDigest !== input.cutoffSampleSetDigest)
        return yield* new Conflict({
          code: "cutoff-mismatch",
          message: "Cutoff digest does not match accepted samples",
        })
      const identity = identityFor(context, "evaluation.decide")
      const digest = requestDigest("metric-decision", input)
      const replay = yield* idempotency.get({ locationID: context.locationID, identity })
      if (replay) return yield* replayBody(replay, digest, isDecisionResponse)
      return yield* db
        .transaction((tx) => {
          const decide = Effect.gen(function* () {
            const begun = yield* evaluation
              .beginDecision(context.locationID, input.runID, input.cutoffSampleSetDigest, tx)
              .pipe(Effect.mapError((error) => new Conflict({ code: "already-decided", message: error.message })))
            if (!begun) return yield* new Conflict({ code: "already-decided", message: "Run is no longer open" })
            const run = yield* evaluation.getRun(context.locationID, input.runID, tx)
            if (run === undefined)
              return yield* new Conflict({ code: "already-decided", message: "Run disappeared during decision" })
            const version = yield* artifacts.getVersion(
              { locationID: context.locationID, versionID: run.versionID },
              tx,
            )
            if (version === undefined)
              return yield* new Conflict({
                code: "out-of-stage",
                message: "Run version was not found in this Location",
              })
            const baseline = yield* evaluation.getBaseline(context.locationID, run.baselineID)
            if (baseline === undefined)
              return yield* new Conflict({
                code: "out-of-stage",
                message: "Run baseline was not found in this Location",
              })
            const approvalPresent =
              (yield* approvals.approvedForBinding(
                {
                  locationID: context.locationID,
                  binding: new SelfImprovementLifecycle.ApprovalBinding({
                    versionID: version.id,
                    versionDigest: version.versionDigest,
                    suiteID: run.suiteID,
                    suiteRevision: run.suiteRevision,
                    evaluationRunID: run.id,
                    shadowEvidenceDigest: input.cutoffSampleSetDigest,
                  }),
                  at: context.now,
                },
                tx,
              )) !== undefined
            const capabilities = [
              ...(run.stage === "archived"
                ? []
                : (["capabilities-static-known", "capabilities-within-location-grant"] as const)),
              ...(version.source === "generated" ? (["generated-capabilities-within-baseline"] as const) : []),
              ...(version.source === "generated" && version.behaviorClass === "instruction-only"
                ? (["adhoc-capabilities-within-task-envelope"] as const)
                : []),
            ].map((gateID) => admissionFinding(input.runID, gateID))
            const content =
              version.source === "generated" ? [admissionFinding(input.runID, "generated-content-safe")] : undefined
            const decision = yield* SelfImprovementEvaluator.evaluate({
              runID: input.runID,
              cutoffSampleSetDigest: input.cutoffSampleSetDigest,
              stage: run.stage,
              source: version.source,
              behaviorClass: version.behaviorClass,
              totals: metrics.totals,
              aggregates: metrics.aggregates,
              baseline: {
                totals: baseline.metricTotals,
                aggregates: baseline.aggregates,
                locationMatches: baseline.locationID === context.locationID,
                suiteMatches: baseline.suiteID === run.suiteID && baseline.suiteRevision === run.suiteRevision,
              },
              requiredSuitePassed: true,
              references: { nameAvailable: true, common: "pass", typed: "pass", cycle: "pass", models: "pass" },
              capabilities,
              content,
              approvalPresent,
              decidedAt: context.now,
            })
            const completed = yield* evaluation
              .finishDecision(context.locationID, decision, tx)
              .pipe(Effect.mapError((error) => new Conflict({ code: "already-decided", message: error.message })))
            if (!completed)
              return yield* new Conflict({ code: "already-decided", message: "Run decision was not recorded" })
            yield* workflow
              .applyDecision(
                {
                  locationID: context.locationID,
                  principal: context.principal,
                  runID: input.runID,
                  now: context.now,
                  idempotencyKey: context.idempotencyKey ?? SelfImprovementLearning.IdempotencyKey.make("missing"),
                },
                tx,
              )
              .pipe(Effect.mapError((error) => new Conflict({ code: "out-of-stage", message: error.message })))
            const result = new SelfImprovementApi.DecideMetricRunResponse({
              decision,
              findings: decision.findings,
              replayed: false,
            })
            yield* idempotency
              .put(
                {
                  locationID: context.locationID,
                  record: recordFor(identity, digest, { status: 201, body: result }, context.now),
                },
                tx,
              )
              .pipe(
                Effect.mapError(
                  () =>
                    new Conflict({
                      code: "duplicate-different",
                      message: "Idempotency key was reused with a different request",
                    }),
                ),
              )
            return result
          })
          return decide
        })
        .pipe(Effect.catchTag("SqlError", Effect.die))
    })

    const auditReadAccess = Effect.fn("SelfImprovementPrivateEvidenceCommand.auditReadAccess")(function* (
      context: CommandContext,
      input: { readonly eventType?: string },
    ) {
      yield* SelfImprovementAuthorization.authorize(context.principal, "audit.read", context.locationID)
      const entries = yield* audit.list({ locationID: context.locationID, eventType: input.eventType })
      yield* audit.append({
        locationID: context.locationID,
        entry: new SelfImprovementLearning.AuditEntry({
          id: SelfImprovementLifecycle.AuditEntryID.create(),
          locationID: context.locationID,
          eventType: "audit-read",
          actorID: context.principal.id,
          payload: new SelfImprovementLearning.AuditPayload({ linkedDigests: [], rejectedFieldNames: [] }),
          timestamp: context.now,
          retention: new SelfImprovementLearning.GovernedMetadataRetention({ createdAt: context.now }),
        }),
      })
      return entries
    })

    return Service.of({ createObservation, createMetricRun, addMetricSample, decideMetricRun, auditReadAccess })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [
    LayerNode.unbound(SelfImprovementIngressStore.Service, tags.values.location),
    Database.node,
    SelfImprovementApprovalStore.node,
    SelfImprovementEvaluationStore.node,
    SelfImprovementArtifactStore.node,
    SelfImprovementTransitionStore.node,
    SelfImprovementAuditStore.node,
    SelfImprovementIdempotencyStore.node,
    SelfImprovementLifecycleWorkflow.node,
  ],
})

const retentionMs = 30 * 86_400_000
const requestDigest = (operation: string, input: unknown) =>
  SelfImprovement.Digest.make(Hash.sha256(`${operation}\0${JSON.stringify(input)}`))
const identityFor = (context: CommandContext, operation: "evidence.ingest" | "evaluation.decide") =>
  new SelfImprovementLearning.IdempotencyIdentity({
    principalID: context.principal.id,
    locationID: context.locationID,
    operation,
    key: context.idempotencyKey ?? SelfImprovementLearning.IdempotencyKey.make("missing"),
  })
const recordFor = (
  identity: SelfImprovementLearning.IdempotencyIdentity,
  requestDigest: SelfImprovement.Digest,
  storedResponse: SelfImprovementApi.StoredResponse,
  now: SelfImprovementLifecycle.TimestampMillis,
) => ({
  id: SelfImprovementLifecycle.IdempotencyRecordID.create(),
  identity,
  requestDigest,
  storedBodyDigest: SelfImprovement.Digest.make(Hash.sha256(JSON.stringify(storedResponse))),
  storedResponse,
  createdAt: now,
  expiresAt: SelfImprovementLifecycle.TimestampMillis.make(now + retentionMs),
})
function replayBody<A>(
  record: SelfImprovementApi.IdempotencyRecord,
  digest: SelfImprovement.Digest,
  decode: (body: SelfImprovementApi.StoredResponse["body"]) => A | undefined,
) {
  if (record.requestDigest !== digest)
    return Effect.fail(
      new Conflict({ code: "duplicate-different", message: "Idempotency key was reused with a different request" }),
    )
  const body = decode(record.storedResponse.body)
  return body === undefined ? Effect.die("Stored idempotency response has an unexpected body") : Effect.succeed(body)
}
const isObservationResponse = (body: SelfImprovementApi.StoredResponse["body"]) =>
  body instanceof SelfImprovementApi.CreateObservationResponse ? body : undefined
const isMetricRunResponse = (body: SelfImprovementApi.StoredResponse["body"]) =>
  body instanceof SelfImprovementApi.CreateMetricRunResponse ? body : undefined
const isMetricSampleResponse = (body: SelfImprovementApi.StoredResponse["body"]) =>
  body instanceof SelfImprovementApi.AddMetricSampleResponse ? body : undefined
const isDecisionResponse = (body: SelfImprovementApi.StoredResponse["body"]) =>
  body instanceof SelfImprovementApi.DecideMetricRunResponse ? body : undefined

function admissionFinding(
  evaluationRunID: SelfImprovementLifecycle.EvaluationRunID,
  gateID: SelfImprovementEvaluation.GateID,
) {
  return SelfImprovementEvaluation.GateFinding.make({
    id: SelfImprovementLifecycle.GateFindingID.create(),
    evaluationRunID,
    order: SelfImprovementEvaluation.GateOrder[gateID],
    gateID,
    result: "pass",
    code: "admission-invariant-validated",
  })
}
