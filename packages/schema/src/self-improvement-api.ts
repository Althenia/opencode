export * as SelfImprovementApi from "./self-improvement-api"

import { Effect, Schema, SchemaGetter } from "effect"
import { optional } from "./schema"
import { SelfImprovement } from "./self-improvement"
import { SelfImprovementEvaluation } from "./self-improvement-evaluation"
import { SelfImprovementLearning } from "./self-improvement-learning"
import { SelfImprovementLifecycle } from "./self-improvement-lifecycle"

const UnsignedDecimalFromString = Schema.String.check(Schema.isPattern(/^(0|[1-9]\d*)$/)).pipe(
  Schema.decodeTo(Schema.NumberFromString),
)
const PageLimitValue = Schema.Number.annotate({ identifier: "SelfImprovementApi.PageLimit" }).check(
  Schema.isInt(),
  Schema.isBetween({ minimum: 1, maximum: 100 }),
)
export const PageLimit = UnsignedDecimalFromString.pipe(
  Schema.decodeTo(PageLimitValue),
  Schema.withDecodingDefault(Effect.succeed("50")),
)
export type PageLimit = typeof PageLimit.Type
export const Cursor = Schema.String.annotate({ identifier: "SelfImprovementApi.Cursor" }).check(Schema.isNonEmpty()).pipe(
  Schema.brand("SelfImprovementApi.Cursor"),
)
export type Cursor = typeof Cursor.Type
const BooleanFromString = Schema.Literals(["true", "false"]).pipe(
  Schema.decodeTo(Schema.Boolean, {
    decode: SchemaGetter.transform((value) => value === "true"),
    encode: SchemaGetter.transform((value) => (value ? "true" : "false")),
  }),
)
const RevisionFromString = UnsignedDecimalFromString.pipe(Schema.decodeTo(SelfImprovementLifecycle.Revision))
const TimestampMillisFromString = UnsignedDecimalFromString.pipe(
  Schema.decodeTo(SelfImprovementLifecycle.TimestampMillis),
)
export class PageRequest extends Schema.Class<PageRequest>("SelfImprovementApi.PageRequest")({
  limit: PageLimit,
  cursor: Cursor.pipe(optional),
}) {}
export const IfMatchRevision = Schema.suspend(() =>
  UnsignedDecimalFromString.pipe(Schema.decodeTo(SelfImprovementLifecycle.Revision)),
).annotate({ identifier: "SelfImprovementApi.IfMatchRevision" })
export type IfMatchRevision = typeof IfMatchRevision.Type
export interface LocationHeaders extends Schema.Schema.Type<typeof LocationHeaders> {}
export const LocationHeaders = Schema.Struct({
  "X-OpenCode-Location-ID": SelfImprovementLifecycle.LocationID,
}).annotate({ identifier: "SelfImprovementApi.LocationHeaders" })
export interface MutationHeaders extends Schema.Schema.Type<typeof MutationHeaders> {}
export const MutationHeaders = Schema.Struct({
  "X-OpenCode-Location-ID": SelfImprovementLifecycle.LocationID,
  "Idempotency-Key": SelfImprovementLearning.IdempotencyKey,
}).annotate({ identifier: "SelfImprovementApi.MutationHeaders" })
export interface ArtifactMutationHeaders extends Schema.Schema.Type<typeof ArtifactMutationHeaders> {}
export const ArtifactMutationHeaders = Schema.Struct({
  "X-OpenCode-Location-ID": SelfImprovementLifecycle.LocationID,
  "Idempotency-Key": SelfImprovementLearning.IdempotencyKey,
  "If-Match": IfMatchRevision,
}).annotate({ identifier: "SelfImprovementApi.ArtifactMutationHeaders" })

const page = <S extends Schema.Top>(item: S) =>
  Schema.Struct({ items: Schema.Array(item), nextCursor: Cursor.pipe(optional) })

export const ApiErrorCode = Schema.Literals([
  "invalid-page",
  "admission-rejected",
  "redaction-rejected",
  "binding-invalid",
  "sample-invalid",
  "forbidden",
  "creator-self-approval",
  "artifact-not-found",
  "artifact-or-version-not-found",
  "approval-request-not-found",
  "version-or-baseline-not-found",
  "run-not-found",
  "name-reserved",
  "revision-conflict",
  "idempotency-mismatch",
  "tombstoned",
  "stage-illegal",
  "binding-mismatch",
  "expired",
  "already-decided",
  "run-conflict",
  "duplicate-different",
  "late",
  "out-of-stage",
  "cutoff-mismatch",
  "context-unavailable",
]).annotate({ identifier: "SelfImprovementApi.ApiErrorCode" })
export type ApiErrorCode = typeof ApiErrorCode.Type
export class ApiErrorDetails extends Schema.Class<ApiErrorDetails>("SelfImprovementApi.ApiErrorDetails")({
  artifactID: SelfImprovementLifecycle.ArtifactID.pipe(optional),
  versionID: SelfImprovementLifecycle.ArtifactVersionID.pipe(optional),
  runID: SelfImprovementLifecycle.EvaluationRunID.pipe(optional),
  digest: SelfImprovement.Digest.pipe(optional),
  conflictingFieldNames: Schema.Array(Schema.NonEmptyString).check(Schema.isUnique()).pipe(optional),
}) {}
export class ApiError extends Schema.Class<ApiError>("SelfImprovementApi.ApiError")({
  code: ApiErrorCode,
  message: Schema.NonEmptyString,
  requestID: Schema.NonEmptyString,
  details: ApiErrorDetails,
}) {}
export interface ApiErrorContract {
  readonly code: ApiErrorCode
  readonly status: 400 | 403 | 404 | 409 | 503
}
export const ApiErrors = {
  invalidPage: { code: "invalid-page", status: 400 },
  admissionRejected: { code: "admission-rejected", status: 400 },
  redactionRejected: { code: "redaction-rejected", status: 400 },
  bindingInvalid: { code: "binding-invalid", status: 400 },
  sampleInvalid: { code: "sample-invalid", status: 400 },
  forbidden: { code: "forbidden", status: 403 },
  creatorSelfApproval: { code: "creator-self-approval", status: 403 },
  artifactNotFound: { code: "artifact-not-found", status: 404 },
  artifactOrVersionNotFound: { code: "artifact-or-version-not-found", status: 404 },
  approvalRequestNotFound: { code: "approval-request-not-found", status: 404 },
  versionOrBaselineNotFound: { code: "version-or-baseline-not-found", status: 404 },
  runNotFound: { code: "run-not-found", status: 404 },
  nameReserved: { code: "name-reserved", status: 409 },
  revisionConflict: { code: "revision-conflict", status: 409 },
  idempotencyMismatch: { code: "idempotency-mismatch", status: 409 },
  tombstoned: { code: "tombstoned", status: 409 },
  stageIllegal: { code: "stage-illegal", status: 409 },
  bindingMismatch: { code: "binding-mismatch", status: 409 },
  expired: { code: "expired", status: 409 },
  alreadyDecided: { code: "already-decided", status: 409 },
  runConflict: { code: "run-conflict", status: 409 },
  duplicateDifferent: { code: "duplicate-different", status: 409 },
  late: { code: "late", status: 409 },
  outOfStage: { code: "out-of-stage", status: 409 },
  cutoffMismatch: { code: "cutoff-mismatch", status: 409 },
  contextUnavailable: { code: "context-unavailable", status: 503 },
} as const satisfies Record<string, ApiErrorContract>
export const ApiSideEffect = Schema.Literals([
  "none",
  "artifact-created",
  "draft-version-created",
  "transition-appended",
  "audit-appended",
  "context-removal-requested",
  "approval-recorded",
  "rejection-recorded",
  "terminal-intent-recorded",
  "observation-recorded",
  "generation-eligibility-updated",
  "run-opened",
  "sample-appended",
  "decision-recorded",
  "coordinator-event-emitted",
  "pending-work-cancelled",
  "versions-archived",
  "recommendations-removed",
  "access-audited",
]).annotate({ identifier: "SelfImprovementApi.ApiSideEffect" })
export type ApiSideEffect = typeof ApiSideEffect.Type
export const ResponseOrder = Schema.Literals([
  "kind-name-id-asc",
  "version-number-id-desc",
  "created-id-desc",
  "decided-id-desc",
  "timestamp-id-desc",
]).annotate({ identifier: "SelfImprovementApi.ResponseOrder" })
export type ResponseOrder = typeof ResponseOrder.Type
export interface CompletedCommandResult extends Schema.Schema.Type<typeof CompletedCommandResult> {}
export const CompletedCommandResult = Schema.Struct({
  status: Schema.Literal("completed"),
  artifactRevision: SelfImprovementLifecycle.Revision,
  transition: SelfImprovementLifecycle.StageTransition,
}).annotate({ identifier: "SelfImprovementApi.CompletedCommandResult" })
export interface ReconciliationPendingCommandResult
  extends Schema.Schema.Type<typeof ReconciliationPendingCommandResult> {}
export const ReconciliationPendingCommandResult = Schema.Struct({
  status: Schema.Literal("reconciliation-pending"),
  artifactRevision: SelfImprovementLifecycle.Revision,
  outbox: SelfImprovementLearning.ContextOutbox,
}).annotate({ identifier: "SelfImprovementApi.ReconciliationPendingCommandResult" })
export const CommandResult = Schema.Union([CompletedCommandResult, ReconciliationPendingCommandResult])
  .pipe(Schema.toTaggedUnion("status"))
  .annotate({ identifier: "SelfImprovementApi.CommandResult" })
export type CommandResult = typeof CommandResult.Type
export class ArtifactRolloutProjection extends Schema.Class<ArtifactRolloutProjection>(
  "SelfImprovementApi.ArtifactRolloutProjection",
)({
  versionID: SelfImprovementLifecycle.ArtifactVersionID,
  versionDigest: SelfImprovement.Digest,
  transitionID: SelfImprovementLifecycle.StageTransitionID,
}) {}

export class ListArtifactsRequest extends Schema.Class<ListArtifactsRequest>("SelfImprovementApi.ListArtifactsRequest")({
  kind: SelfImprovement.ArtifactKind.pipe(optional),
  status: SelfImprovementLifecycle.ArtifactStatus.pipe(optional),
  namePrefix: Schema.NonEmptyString.pipe(optional),
  limit: PageLimit,
  cursor: Cursor.pipe(optional),
}) {}
export interface ListArtifactsResponse extends Schema.Schema.Type<typeof ListArtifactsResponse> {}
export const ListArtifactsResponse = page(SelfImprovementLifecycle.Artifact).annotate({
  identifier: "SelfImprovementApi.ListArtifactsResponse",
})
export class CreateArtifactRequest extends Schema.Class<CreateArtifactRequest>(
  "SelfImprovementApi.CreateArtifactRequest",
)({
  proposalBytes: Schema.Uint8ArrayFromBase64,
  behaviorClass: SelfImprovementLifecycle.BehaviorClass,
  capabilityManifest: SelfImprovementLifecycle.CapabilityManifest,
}) {}
export class CreateArtifactResponse extends Schema.Class<CreateArtifactResponse>(
  "SelfImprovementApi.CreateArtifactResponse",
)({
  artifact: SelfImprovementLifecycle.Artifact,
  version: SelfImprovementLifecycle.ArtifactVersion,
  revision: SelfImprovementLifecycle.Revision,
}) {}
export class GetArtifactRequest extends Schema.Class<GetArtifactRequest>("SelfImprovementApi.GetArtifactRequest")({
  artifactID: SelfImprovementLifecycle.ArtifactID,
}) {}
export class GetArtifactResponse extends Schema.Class<GetArtifactResponse>("SelfImprovementApi.GetArtifactResponse")({
  artifact: SelfImprovementLifecycle.Artifact,
  activeProjection: ArtifactRolloutProjection.pipe(optional),
  shadowProjection: ArtifactRolloutProjection.pipe(optional),
  canaryProjection: ArtifactRolloutProjection.pipe(optional),
}) {}
export class ListVersionsRequest extends Schema.Class<ListVersionsRequest>("SelfImprovementApi.ListVersionsRequest")({
  artifactID: SelfImprovementLifecycle.ArtifactID,
  limit: PageLimit,
  cursor: Cursor.pipe(optional),
}) {}
export interface ListVersionsResponse extends Schema.Schema.Type<typeof ListVersionsResponse> {}
export const ListVersionsResponse = page(SelfImprovementLifecycle.ArtifactVersion).annotate({
  identifier: "SelfImprovementApi.ListVersionsResponse",
})
export class CreateVersionRequest extends Schema.Class<CreateVersionRequest>("SelfImprovementApi.CreateVersionRequest")({
  artifactID: SelfImprovementLifecycle.ArtifactID,
  proposalBytes: Schema.Uint8ArrayFromBase64,
  behaviorClass: SelfImprovementLifecycle.BehaviorClass,
  capabilityManifest: SelfImprovementLifecycle.CapabilityManifest,
  expectedRevision: SelfImprovementLifecycle.Revision,
}) {}
export class CreateVersionResponse extends Schema.Class<CreateVersionResponse>(
  "SelfImprovementApi.CreateVersionResponse",
)({
  version: SelfImprovementLifecycle.ArtifactVersion,
  revision: SelfImprovementLifecycle.Revision,
}) {}
export class GetVersionRequest extends Schema.Class<GetVersionRequest>("SelfImprovementApi.GetVersionRequest")({
  artifactID: SelfImprovementLifecycle.ArtifactID,
  versionID: SelfImprovementLifecycle.ArtifactVersionID,
}) {}
export class GetVersionResponse extends Schema.Class<GetVersionResponse>("SelfImprovementApi.GetVersionResponse")({
  version: SelfImprovementLifecycle.ArtifactVersion,
  stage: SelfImprovementLifecycle.ArtifactStage,
  capabilityManifest: SelfImprovementLifecycle.CapabilityManifest,
}) {}
export class ArchiveVersionRequest extends Schema.Class<ArchiveVersionRequest>(
  "SelfImprovementApi.ArchiveVersionRequest",
)({
  artifactID: SelfImprovementLifecycle.ArtifactID,
  versionID: SelfImprovementLifecycle.ArtifactVersionID,
  reason: SelfImprovementLifecycle.LifecycleReason,
  expectedRevision: SelfImprovementLifecycle.Revision,
}) {}
export const ArchiveVersionResponse = CommandResult.annotate({
  identifier: "SelfImprovementApi.ArchiveVersionResponse",
})
export type ArchiveVersionResponse = typeof ArchiveVersionResponse.Type
export class TombstoneArtifactRequest extends Schema.Class<TombstoneArtifactRequest>(
  "SelfImprovementApi.TombstoneArtifactRequest",
)({
  artifactID: SelfImprovementLifecycle.ArtifactID,
  reason: Schema.NonEmptyString,
  expectedRevision: SelfImprovementLifecycle.Revision,
}) {}
export const TombstoneArtifactResponse = CommandResult.annotate({
  identifier: "SelfImprovementApi.TombstoneArtifactResponse",
})
export type TombstoneArtifactResponse = typeof TombstoneArtifactResponse.Type
export class ApproveRequest extends Schema.Class<ApproveRequest>("SelfImprovementApi.ApproveRequest")({
  approvalRequestID: SelfImprovementLifecycle.ApprovalRequestID,
  binding: SelfImprovementLifecycle.ApprovalBinding,
}) {}
export class ApproveResponse extends Schema.Class<ApproveResponse>("SelfImprovementApi.ApproveResponse")({
  approval: SelfImprovementLifecycle.Approval,
}) {}
export class RejectRequest extends Schema.Class<RejectRequest>("SelfImprovementApi.RejectRequest")({
  approvalRequestID: SelfImprovementLifecycle.ApprovalRequestID,
  binding: SelfImprovementLifecycle.ApprovalBinding,
  reason: SelfImprovementLifecycle.ApprovalRejectionReason,
}) {}
export class RejectResponse extends Schema.Class<RejectResponse>("SelfImprovementApi.RejectResponse")({
  approval: SelfImprovementLifecycle.Approval,
}) {}
export class CreateObservationRequest extends Schema.Class<CreateObservationRequest>(
  "SelfImprovementApi.CreateObservationRequest",
)({
  workload: SelfImprovementEvaluation.Workload,
  workloadRevision: SelfImprovementLifecycle.Revision,
  errorClass: Schema.NonEmptyString,
  orderedToolSymbolDigest: SelfImprovement.Digest,
  outcomeClass: SelfImprovementLearning.ObservationOutcomeClass,
  taskIDDigest: SelfImprovement.Digest,
}) {}
export class CreateObservationResponse extends Schema.Class<CreateObservationResponse>(
  "SelfImprovementApi.CreateObservationResponse",
)({
  observation: SelfImprovementLearning.Observation,
  matchingCount: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  generationEligible: Schema.Boolean,
}) {}
export class CreateMetricRunRequest extends Schema.Class<CreateMetricRunRequest>(
  "SelfImprovementApi.CreateMetricRunRequest",
)({
  versionID: SelfImprovementLifecycle.ArtifactVersionID,
  stage: SelfImprovementLifecycle.ArtifactStage,
  suiteID: SelfImprovementLifecycle.SuiteID,
  suiteRevision: SelfImprovementLifecycle.Revision,
  workload: SelfImprovementEvaluation.Workload,
  workloadRevision: SelfImprovementLifecycle.Revision,
  baselineID: SelfImprovementLifecycle.BaselineID,
  acceptanceStart: SelfImprovementLifecycle.TimestampMillis,
  acceptanceEnd: SelfImprovementLifecycle.TimestampMillis,
  cutoffAt: SelfImprovementLifecycle.TimestampMillis,
  requestDigest: SelfImprovement.Digest,
}) {}
export class CreateMetricRunResponse extends Schema.Class<CreateMetricRunResponse>(
  "SelfImprovementApi.CreateMetricRunResponse",
)({
  run: SelfImprovementEvaluation.EvaluationRun,
}) {}
export class AddMetricSampleRequest extends Schema.Class<AddMetricSampleRequest>(
  "SelfImprovementApi.AddMetricSampleRequest",
)({
  runID: SelfImprovementLifecycle.EvaluationRunID,
  sampleIDDigest: SelfImprovement.Digest,
  taskIDDigest: SelfImprovement.Digest,
  metrics: SelfImprovementEvaluation.MetricComponents,
  outcome: SelfImprovementEvaluation.TaskOutcome,
  startedAt: SelfImprovementLifecycle.TimestampMillis,
  terminalAt: SelfImprovementLifecycle.TimestampMillis,
  requestDigest: SelfImprovement.Digest,
}) {}
export class AddMetricSampleResponse extends Schema.Class<AddMetricSampleResponse>(
  "SelfImprovementApi.AddMetricSampleResponse",
)({
  sample: SelfImprovementEvaluation.MetricSample,
  replayed: Schema.Boolean,
}) {}
export class DecideMetricRunRequest extends Schema.Class<DecideMetricRunRequest>(
  "SelfImprovementApi.DecideMetricRunRequest",
)({
  runID: SelfImprovementLifecycle.EvaluationRunID,
  cutoffSampleSetDigest: SelfImprovement.Digest,
}) {}
const sameFindingIDs = (
  left: ReadonlyArray<SelfImprovementEvaluation.GateFinding>,
  right: ReadonlyArray<SelfImprovementEvaluation.GateFinding>,
) => left.length === right.length && left.every((finding, index) => finding.id === right[index].id)

const DecideMetricRunResponseFields = Schema.Struct({
  decision: SelfImprovementEvaluation.EvaluationDecision,
  findings: Schema.Array(SelfImprovementEvaluation.GateFinding),
  replayed: Schema.Boolean,
}).check(
  Schema.makeFilter(
    (value) =>
      sameFindingIDs(value.findings, value.decision.findings) &&
      value.findings.every((finding) => finding.evaluationRunID === value.decision.runID),
  ),
)

export class DecideMetricRunResponse extends Schema.Class<DecideMetricRunResponse>(
  "SelfImprovementApi.DecideMetricRunResponse",
)(DecideMetricRunResponseFields) {}

export class ListBaselinesRequest extends Schema.Class<ListBaselinesRequest>("SelfImprovementApi.ListBaselinesRequest")({
  workload: SelfImprovementEvaluation.Workload.pipe(optional),
  suiteRevision: RevisionFromString.pipe(optional),
  limit: PageLimit,
  cursor: Cursor.pipe(optional),
}) {}
export interface ListBaselinesResponse extends Schema.Schema.Type<typeof ListBaselinesResponse> {}
export const ListBaselinesResponse = page(SelfImprovementEvaluation.Baseline).annotate({
  identifier: "SelfImprovementApi.ListBaselinesResponse",
})
export class ListMetricRunsRequest extends Schema.Class<ListMetricRunsRequest>(
  "SelfImprovementApi.ListMetricRunsRequest",
)({
  versionID: SelfImprovementLifecycle.ArtifactVersionID.pipe(optional),
  stage: SelfImprovementLifecycle.ArtifactStage.pipe(optional),
  state: SelfImprovementEvaluation.RunState.pipe(optional),
  includeSamples: BooleanFromString.pipe(Schema.withDecodingDefault(Effect.succeed("false"))),
  limit: PageLimit,
  cursor: Cursor.pipe(optional),
}) {}
export class MetricRunView extends Schema.Class<MetricRunView>("SelfImprovementApi.MetricRunView")({
  run: SelfImprovementEvaluation.EvaluationRun,
  aggregates: SelfImprovementEvaluation.MetricAggregates.pipe(optional),
  sampleCount: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  samples: Schema.Array(SelfImprovementEvaluation.MetricSample).pipe(optional),
}) {}
export interface ListMetricRunsResponse extends Schema.Schema.Type<typeof ListMetricRunsResponse> {}
export const ListMetricRunsResponse = page(MetricRunView).annotate({
  identifier: "SelfImprovementApi.ListMetricRunsResponse",
})
export class ListEvaluationsRequest extends Schema.Class<ListEvaluationsRequest>(
  "SelfImprovementApi.ListEvaluationsRequest",
)({
  artifactID: SelfImprovementLifecycle.ArtifactID.pipe(optional),
  versionID: SelfImprovementLifecycle.ArtifactVersionID.pipe(optional),
  stage: SelfImprovementLifecycle.ArtifactStage.pipe(optional),
  limit: PageLimit,
  cursor: Cursor.pipe(optional),
}) {}
const EvaluationViewFields = Schema.Struct({
  run: SelfImprovementEvaluation.EvaluationRun,
  decision: SelfImprovementEvaluation.EvaluationDecision,
  orderedFindings: Schema.Array(SelfImprovementEvaluation.GateFinding),
}).check(
  Schema.makeFilter(
    (value) =>
      value.run.id === value.decision.runID &&
      sameFindingIDs(value.orderedFindings, value.decision.findings) &&
      value.orderedFindings.every((finding) => finding.evaluationRunID === value.decision.runID),
  ),
)

export class EvaluationView extends Schema.Class<EvaluationView>("SelfImprovementApi.EvaluationView")(
  EvaluationViewFields,
) {}
export interface ListEvaluationsResponse extends Schema.Schema.Type<typeof ListEvaluationsResponse> {}
export const ListEvaluationsResponse = page(EvaluationView).annotate({
  identifier: "SelfImprovementApi.ListEvaluationsResponse",
})
export class ListTransitionsRequest extends Schema.Class<ListTransitionsRequest>(
  "SelfImprovementApi.ListTransitionsRequest",
)({
  artifactID: SelfImprovementLifecycle.ArtifactID.pipe(optional),
  versionID: SelfImprovementLifecycle.ArtifactVersionID.pipe(optional),
  event: SelfImprovementLifecycle.LifecycleEvent.pipe(optional),
  limit: PageLimit,
  cursor: Cursor.pipe(optional),
}) {}
export interface ListTransitionsResponse extends Schema.Schema.Type<typeof ListTransitionsResponse> {}
export const ListTransitionsResponse = page(SelfImprovementLifecycle.StageTransition).annotate({
  identifier: "SelfImprovementApi.ListTransitionsResponse",
})
export class ListApprovalsRequest extends Schema.Class<ListApprovalsRequest>(
  "SelfImprovementApi.ListApprovalsRequest",
)({
  artifactID: SelfImprovementLifecycle.ArtifactID.pipe(optional),
  versionID: SelfImprovementLifecycle.ArtifactVersionID.pipe(optional),
  approverID: SelfImprovementLifecycle.PrincipalID.pipe(optional),
  limit: PageLimit,
  cursor: Cursor.pipe(optional),
}) {}
export interface ListApprovalsResponse extends Schema.Schema.Type<typeof ListApprovalsResponse> {}
export const ListApprovalsResponse = page(SelfImprovementLifecycle.Approval).annotate({
  identifier: "SelfImprovementApi.ListApprovalsResponse",
})
export class ListContextEvidenceRequest extends Schema.Class<ListContextEvidenceRequest>(
  "SelfImprovementApi.ListContextEvidenceRequest",
)({
  artifactID: SelfImprovementLifecycle.ArtifactID.pipe(optional),
  versionID: SelfImprovementLifecycle.ArtifactVersionID.pipe(optional),
  status: SelfImprovementLearning.ContextOutboxStatus.pipe(optional),
  limit: PageLimit,
  cursor: Cursor.pipe(optional),
}) {}
const ContextEvidence = Schema.Union([
  Schema.Struct({ type: Schema.Literal("desired-state"), value: SelfImprovementLearning.ContextDesiredState }),
  Schema.Struct({ type: Schema.Literal("outbox"), value: SelfImprovementLearning.ContextOutbox }),
  Schema.Struct({ type: Schema.Literal("selection"), value: SelfImprovementLearning.ContextSelectionEvidence }),
]).pipe(Schema.toTaggedUnion("type"))
export class ContextEvidenceView extends Schema.Class<ContextEvidenceView>(
  "SelfImprovementApi.ContextEvidenceView",
)({
  cursorID: Schema.NonEmptyString,
  createdAt: SelfImprovementLifecycle.TimestampMillis,
  evidence: ContextEvidence,
}) {}
export interface ListContextEvidenceResponse extends Schema.Schema.Type<typeof ListContextEvidenceResponse> {}
export const ListContextEvidenceResponse = page(ContextEvidenceView).annotate({
  identifier: "SelfImprovementApi.ListContextEvidenceResponse",
})
export class ListRoutingDecisionsRequest extends Schema.Class<ListRoutingDecisionsRequest>(
  "SelfImprovementApi.ListRoutingDecisionsRequest",
)({
  sessionDigest: SelfImprovement.Digest.pipe(optional),
  workload: SelfImprovementEvaluation.Workload.pipe(optional),
  limit: PageLimit,
  cursor: Cursor.pipe(optional),
}) {}
export interface ListRoutingDecisionsResponse extends Schema.Schema.Type<typeof ListRoutingDecisionsResponse> {}
export const ListRoutingDecisionsResponse = page(SelfImprovementLearning.RoutingDecision).annotate({
  identifier: "SelfImprovementApi.ListRoutingDecisionsResponse",
})
export class ListAuditRequest extends Schema.Class<ListAuditRequest>("SelfImprovementApi.ListAuditRequest")({
  eventType: Schema.NonEmptyString.pipe(optional),
  artifactID: SelfImprovementLifecycle.ArtifactID.pipe(optional),
  from: TimestampMillisFromString.pipe(optional),
  to: TimestampMillisFromString.pipe(optional),
  limit: PageLimit,
  cursor: Cursor.pipe(optional),
}) {}
export interface ListAuditResponse extends Schema.Schema.Type<typeof ListAuditResponse> {}
export const ListAuditResponse = page(SelfImprovementLearning.AuditEntry).annotate({
  identifier: "SelfImprovementApi.ListAuditResponse",
})

const errorFor = (codes: ReadonlyArray<ApiErrorCode>) =>
  ApiError.check(Schema.makeFilter((value) => codes.includes(value.code)))
const Stored200 = Schema.Struct({
  status: Schema.Literal(200),
  body: Schema.Union([CompletedCommandResult, ApproveResponse, RejectResponse, CreateObservationResponse]),
})
const Stored201 = Schema.Struct({
  status: Schema.Literal(201),
  body: Schema.Union([
    CreateArtifactResponse,
    CreateVersionResponse,
    CreateObservationResponse,
    CreateMetricRunResponse,
    AddMetricSampleResponse,
    DecideMetricRunResponse,
  ]),
})
const Stored202 = Schema.Struct({ status: Schema.Literal(202), body: ReconciliationPendingCommandResult })
const Stored400 = Schema.Struct({
  status: Schema.Literal(400),
  body: errorFor(["invalid-page", "admission-rejected", "redaction-rejected", "binding-invalid", "sample-invalid"]),
})
const Stored403 = Schema.Struct({
  status: Schema.Literal(403),
  body: errorFor(["forbidden", "creator-self-approval"]),
})
const Stored404 = Schema.Struct({
  status: Schema.Literal(404),
  body: errorFor([
    "artifact-not-found",
    "artifact-or-version-not-found",
    "approval-request-not-found",
    "version-or-baseline-not-found",
    "run-not-found",
  ]),
})
const Stored409 = Schema.Struct({
  status: Schema.Literal(409),
  body: errorFor([
    "name-reserved",
    "revision-conflict",
    "idempotency-mismatch",
    "tombstoned",
    "stage-illegal",
    "binding-mismatch",
    "expired",
    "already-decided",
    "run-conflict",
    "duplicate-different",
    "late",
    "out-of-stage",
    "cutoff-mismatch",
  ]),
})
const Stored503 = Schema.Struct({
  status: Schema.Literal(503),
  body: errorFor(["context-unavailable"]),
})
export const StoredResponse = Schema.Union([
  Stored200,
  Stored201,
  Stored202,
  Stored400,
  Stored403,
  Stored404,
  Stored409,
  Stored503,
])
  .pipe(Schema.toTaggedUnion("status"))
  .annotate({ identifier: "SelfImprovementApi.StoredResponse" })
export type StoredResponse = typeof StoredResponse.Type
export interface IdempotencyRecord extends Schema.Schema.Type<typeof IdempotencyRecord> {}
export const IdempotencyRecord = Schema.Struct({
  id: SelfImprovementLifecycle.IdempotencyRecordID,
  identity: SelfImprovementLearning.IdempotencyIdentity,
  requestDigest: SelfImprovement.Digest,
  storedBodyDigest: SelfImprovement.Digest,
  storedResponse: StoredResponse,
  createdAt: SelfImprovementLifecycle.TimestampMillis,
  expiresAt: SelfImprovementLifecycle.TimestampMillis,
})
  .annotate({ identifier: "SelfImprovementApi.IdempotencyRecord" })
  .check(Schema.makeFilter((value) => value.expiresAt === value.createdAt + 30 * 86_400_000))

export const LocationSource = Schema.Literals([
  "header-grant",
  "artifact-header-grant",
  "run-header-grant",
  "approval-binding-header-grant",
]).annotate({ identifier: "SelfImprovementApi.LocationSource" })
export type LocationSource = typeof LocationSource.Type
const CoordinatorGeneratedOnly = Schema.Struct({
  type: Schema.Literal("coordinator-generated-only"),
  principal: Schema.Literal("coordinator"),
  condition: Schema.Literal("generated-output"),
})
const CoordinatorPolicyTerminalOnly = Schema.Struct({
  type: Schema.Literal("coordinator-policy-terminal-only"),
  principal: Schema.Literal("coordinator"),
  condition: Schema.Literal("policy-terminal-action"),
})
const DedicatedApproverNotCreator = Schema.Struct({
  type: Schema.Literal("dedicated-approver-not-creator"),
  principal: Schema.Literal("location-approver"),
})
const IncludeSamplesAuditReaderOnly = Schema.Struct({
  type: Schema.Literal("include-samples-audit-reader-only"),
  principal: Schema.Literal("audit-reader"),
  queryField: Schema.Literal("includeSamples"),
})
const ApproverOwnDecisionsOnly = Schema.Struct({
  type: Schema.Literal("approver-own-decisions-only"),
  principal: Schema.Literal("location-approver"),
})
const AuditReaderOnlyAudit = Schema.Struct({
  type: Schema.Literal("audit-reader-only-audit"),
  principal: Schema.Literal("audit-reader"),
})
export const ConditionalAuthorizationRule = Schema.Union([
  CoordinatorGeneratedOnly,
  CoordinatorPolicyTerminalOnly,
  DedicatedApproverNotCreator,
  IncludeSamplesAuditReaderOnly,
  ApproverOwnDecisionsOnly,
  AuditReaderOnlyAudit,
])
  .pipe(Schema.toTaggedUnion("type"))
  .annotate({ identifier: "SelfImprovementApi.ConditionalAuthorizationRule" })
export type ConditionalAuthorizationRule = typeof ConditionalAuthorizationRule.Type
export interface PrivateApiOperation {
  readonly method: "GET" | "POST"
  readonly path: `/private/self-improvement${string}`
  readonly operation: SelfImprovementLifecycle.Operation
  readonly locationSource: LocationSource
  readonly principals: ReadonlyArray<SelfImprovementLifecycle.PrincipalKind>
  readonly authorizationRules: ReadonlyArray<ConditionalAuthorizationRule>
  readonly headers: Schema.Top
  readonly request: Schema.Top
  readonly response: Schema.Top
  readonly errors: ReadonlyArray<ApiErrorContract>
  readonly successStatuses: ReadonlyArray<200 | 201 | 202>
  readonly ordering?: ResponseOrder
  readonly sideEffects: ReadonlyArray<ApiSideEffect>
  readonly mutation: boolean
}

export const PrivateApiOperations = {
  listArtifacts: {
    method: "GET",
    path: "/private/self-improvement/artifacts",
    operation: "artifact.read",
    locationSource: "header-grant",
    principals: ["first-party-user", "coordinator", "audit-reader"],
    authorizationRules: [],
    headers: LocationHeaders,
    request: ListArtifactsRequest,
    response: ListArtifactsResponse,
    errors: [ApiErrors.invalidPage, ApiErrors.forbidden],
    successStatuses: [200],
    ordering: "kind-name-id-asc",
    sideEffects: ["none"],
    mutation: false,
  },
  createArtifact: {
    method: "POST",
    path: "/private/self-improvement/artifacts",
    operation: "artifact.create",
    locationSource: "header-grant",
    principals: ["first-party-user", "coordinator"],
    authorizationRules: [
      { type: "coordinator-generated-only", principal: "coordinator", condition: "generated-output" },
    ],
    headers: MutationHeaders,
    request: CreateArtifactRequest,
    response: CreateArtifactResponse,
    errors: [
      ApiErrors.admissionRejected,
      ApiErrors.forbidden,
      ApiErrors.nameReserved,
      ApiErrors.idempotencyMismatch,
    ],
    successStatuses: [201],
    sideEffects: ["artifact-created", "draft-version-created", "transition-appended", "audit-appended"],
    mutation: true,
  },
  getArtifact: {
    method: "GET",
    path: "/private/self-improvement/artifacts/{artifactID}",
    operation: "artifact.read",
    locationSource: "artifact-header-grant",
    principals: ["first-party-user", "coordinator", "audit-reader"],
    authorizationRules: [],
    headers: LocationHeaders,
    request: GetArtifactRequest,
    response: GetArtifactResponse,
    errors: [ApiErrors.forbidden, ApiErrors.artifactNotFound],
    successStatuses: [200],
    sideEffects: ["none"],
    mutation: false,
  },
  listVersions: {
    method: "GET",
    path: "/private/self-improvement/artifacts/{artifactID}/versions",
    operation: "artifact.read",
    locationSource: "artifact-header-grant",
    principals: ["first-party-user", "coordinator", "audit-reader"],
    authorizationRules: [],
    headers: LocationHeaders,
    request: ListVersionsRequest,
    response: ListVersionsResponse,
    errors: [ApiErrors.invalidPage, ApiErrors.forbidden, ApiErrors.artifactNotFound],
    successStatuses: [200],
    ordering: "version-number-id-desc",
    sideEffects: ["none"],
    mutation: false,
  },
  createVersion: {
    method: "POST",
    path: "/private/self-improvement/artifacts/{artifactID}/versions",
    operation: "artifact.create",
    locationSource: "artifact-header-grant",
    principals: ["first-party-user", "coordinator"],
    authorizationRules: [
      { type: "coordinator-generated-only", principal: "coordinator", condition: "generated-output" },
    ],
    headers: ArtifactMutationHeaders,
    request: CreateVersionRequest,
    response: CreateVersionResponse,
    errors: [
      ApiErrors.admissionRejected,
      ApiErrors.forbidden,
      ApiErrors.artifactNotFound,
      ApiErrors.revisionConflict,
      ApiErrors.idempotencyMismatch,
      ApiErrors.tombstoned,
    ],
    successStatuses: [201],
    sideEffects: ["draft-version-created", "audit-appended"],
    mutation: true,
  },
  getVersion: {
    method: "GET",
    path: "/private/self-improvement/artifacts/{artifactID}/versions/{versionID}",
    operation: "artifact.read",
    locationSource: "artifact-header-grant",
    principals: ["first-party-user", "coordinator", "audit-reader"],
    authorizationRules: [],
    headers: LocationHeaders,
    request: GetVersionRequest,
    response: GetVersionResponse,
    errors: [ApiErrors.forbidden, ApiErrors.artifactOrVersionNotFound],
    successStatuses: [200],
    sideEffects: ["none"],
    mutation: false,
  },
  archiveVersion: {
    method: "POST",
    path: "/private/self-improvement/artifacts/{artifactID}/versions/{versionID}/archive",
    operation: "artifact.archive",
    locationSource: "artifact-header-grant",
    principals: ["first-party-user", "coordinator"],
    authorizationRules: [
      {
        type: "coordinator-policy-terminal-only",
        principal: "coordinator",
        condition: "policy-terminal-action",
      },
    ],
    headers: ArtifactMutationHeaders,
    request: ArchiveVersionRequest,
    response: ArchiveVersionResponse,
    errors: [
      ApiErrors.forbidden,
      ApiErrors.artifactOrVersionNotFound,
      ApiErrors.revisionConflict,
      ApiErrors.stageIllegal,
      ApiErrors.idempotencyMismatch,
      ApiErrors.contextUnavailable,
    ],
    successStatuses: [200, 202],
    sideEffects: [
      "terminal-intent-recorded",
      "context-removal-requested",
      "transition-appended",
      "audit-appended",
    ],
    mutation: true,
  },
  tombstoneArtifact: {
    method: "POST",
    path: "/private/self-improvement/artifacts/{artifactID}/tombstone",
    operation: "artifact.tombstone",
    locationSource: "artifact-header-grant",
    principals: ["first-party-user", "coordinator"],
    authorizationRules: [
      {
        type: "coordinator-policy-terminal-only",
        principal: "coordinator",
        condition: "policy-terminal-action",
      },
    ],
    headers: ArtifactMutationHeaders,
    request: TombstoneArtifactRequest,
    response: TombstoneArtifactResponse,
    errors: [
      ApiErrors.forbidden,
      ApiErrors.artifactNotFound,
      ApiErrors.revisionConflict,
      ApiErrors.idempotencyMismatch,
      ApiErrors.contextUnavailable,
    ],
    successStatuses: [200, 202],
    sideEffects: [
      "pending-work-cancelled",
      "terminal-intent-recorded",
      "context-removal-requested",
      "versions-archived",
      "recommendations-removed",
      "transition-appended",
      "audit-appended",
    ],
    mutation: true,
  },
  approve: {
    method: "POST",
    path: "/private/self-improvement/approvals/{approvalRequestID}/approve",
    operation: "approval.decide",
    locationSource: "approval-binding-header-grant",
    principals: ["location-approver"],
    authorizationRules: [{ type: "dedicated-approver-not-creator", principal: "location-approver" }],
    headers: MutationHeaders,
    request: ApproveRequest,
    response: ApproveResponse,
    errors: [
      ApiErrors.forbidden,
      ApiErrors.creatorSelfApproval,
      ApiErrors.approvalRequestNotFound,
      ApiErrors.bindingMismatch,
      ApiErrors.expired,
      ApiErrors.alreadyDecided,
      ApiErrors.idempotencyMismatch,
    ],
    successStatuses: [200],
    sideEffects: ["approval-recorded"],
    mutation: true,
  },
  reject: {
    method: "POST",
    path: "/private/self-improvement/approvals/{approvalRequestID}/reject",
    operation: "approval.decide",
    locationSource: "approval-binding-header-grant",
    principals: ["location-approver"],
    authorizationRules: [{ type: "dedicated-approver-not-creator", principal: "location-approver" }],
    headers: MutationHeaders,
    request: RejectRequest,
    response: RejectResponse,
    errors: [
      ApiErrors.forbidden,
      ApiErrors.creatorSelfApproval,
      ApiErrors.approvalRequestNotFound,
      ApiErrors.bindingMismatch,
      ApiErrors.expired,
      ApiErrors.alreadyDecided,
      ApiErrors.idempotencyMismatch,
    ],
    successStatuses: [200],
    sideEffects: ["rejection-recorded", "terminal-intent-recorded"],
    mutation: true,
  },
  createObservation: {
    method: "POST",
    path: "/private/self-improvement/observations",
    operation: "evidence.ingest",
    locationSource: "header-grant",
    principals: ["runtime-evidence-service"],
    authorizationRules: [],
    headers: MutationHeaders,
    request: CreateObservationRequest,
    response: CreateObservationResponse,
    errors: [ApiErrors.redactionRejected, ApiErrors.forbidden, ApiErrors.idempotencyMismatch],
    successStatuses: [200, 201],
    sideEffects: ["observation-recorded", "generation-eligibility-updated", "audit-appended"],
    mutation: true,
  },
  createMetricRun: {
    method: "POST",
    path: "/private/self-improvement/metric-runs",
    operation: "evidence.ingest",
    locationSource: "header-grant",
    principals: ["runtime-evidence-service"],
    authorizationRules: [],
    headers: MutationHeaders,
    request: CreateMetricRunRequest,
    response: CreateMetricRunResponse,
    errors: [
      ApiErrors.bindingInvalid,
      ApiErrors.forbidden,
      ApiErrors.versionOrBaselineNotFound,
      ApiErrors.idempotencyMismatch,
      ApiErrors.runConflict,
    ],
    successStatuses: [201],
    sideEffects: ["run-opened"],
    mutation: true,
  },
  addMetricSample: {
    method: "POST",
    path: "/private/self-improvement/metric-runs/{runID}/samples",
    operation: "evidence.ingest",
    locationSource: "run-header-grant",
    principals: ["runtime-evidence-service"],
    authorizationRules: [],
    headers: MutationHeaders,
    request: AddMetricSampleRequest,
    response: AddMetricSampleResponse,
    errors: [
      ApiErrors.sampleInvalid,
      ApiErrors.forbidden,
      ApiErrors.runNotFound,
      ApiErrors.duplicateDifferent,
      ApiErrors.late,
      ApiErrors.outOfStage,
      ApiErrors.idempotencyMismatch,
    ],
    successStatuses: [201],
    sideEffects: ["sample-appended"],
    mutation: true,
  },
  decideMetricRun: {
    method: "POST",
    path: "/private/self-improvement/metric-runs/{runID}/decisions",
    operation: "evaluation.decide",
    locationSource: "run-header-grant",
    principals: ["evaluator"],
    authorizationRules: [],
    headers: MutationHeaders,
    request: DecideMetricRunRequest,
    response: DecideMetricRunResponse,
    errors: [
      ApiErrors.forbidden,
      ApiErrors.runNotFound,
      ApiErrors.alreadyDecided,
      ApiErrors.cutoffMismatch,
      ApiErrors.idempotencyMismatch,
    ],
    successStatuses: [201],
    sideEffects: ["decision-recorded", "coordinator-event-emitted"],
    mutation: true,
  },
  listBaselines: {
    method: "GET",
    path: "/private/self-improvement/baselines",
    operation: "audit.read",
    locationSource: "header-grant",
    principals: ["audit-reader", "evaluator", "coordinator"],
    authorizationRules: [],
    headers: LocationHeaders,
    request: ListBaselinesRequest,
    response: ListBaselinesResponse,
    errors: [ApiErrors.invalidPage, ApiErrors.forbidden],
    successStatuses: [200],
    ordering: "created-id-desc",
    sideEffects: ["none"],
    mutation: false,
  },
  listMetricRuns: {
    method: "GET",
    path: "/private/self-improvement/metric-runs",
    operation: "audit.read",
    locationSource: "header-grant",
    principals: ["audit-reader", "evaluator", "coordinator"],
    authorizationRules: [
      { type: "include-samples-audit-reader-only", principal: "audit-reader", queryField: "includeSamples" },
    ],
    headers: LocationHeaders,
    request: ListMetricRunsRequest,
    response: ListMetricRunsResponse,
    errors: [ApiErrors.invalidPage, ApiErrors.forbidden],
    successStatuses: [200],
    ordering: "created-id-desc",
    sideEffects: ["none"],
    mutation: false,
  },
  listEvaluations: {
    method: "GET",
    path: "/private/self-improvement/evaluations",
    operation: "audit.read",
    locationSource: "header-grant",
    principals: ["audit-reader", "evaluator", "coordinator"],
    authorizationRules: [],
    headers: LocationHeaders,
    request: ListEvaluationsRequest,
    response: ListEvaluationsResponse,
    errors: [ApiErrors.invalidPage, ApiErrors.forbidden],
    successStatuses: [200],
    ordering: "decided-id-desc",
    sideEffects: ["none"],
    mutation: false,
  },
  listTransitions: {
    method: "GET",
    path: "/private/self-improvement/transitions",
    operation: "audit.read",
    locationSource: "header-grant",
    principals: ["audit-reader", "coordinator"],
    authorizationRules: [],
    headers: LocationHeaders,
    request: ListTransitionsRequest,
    response: ListTransitionsResponse,
    errors: [ApiErrors.invalidPage, ApiErrors.forbidden],
    successStatuses: [200],
    ordering: "timestamp-id-desc",
    sideEffects: ["none"],
    mutation: false,
  },
  listApprovals: {
    method: "GET",
    path: "/private/self-improvement/approvals",
    operation: "audit.read",
    locationSource: "header-grant",
    principals: ["audit-reader", "location-approver"],
    authorizationRules: [{ type: "approver-own-decisions-only", principal: "location-approver" }],
    headers: LocationHeaders,
    request: ListApprovalsRequest,
    response: ListApprovalsResponse,
    errors: [ApiErrors.invalidPage, ApiErrors.forbidden],
    successStatuses: [200],
    ordering: "decided-id-desc",
    sideEffects: ["none"],
    mutation: false,
  },
  listContextEvidence: {
    method: "GET",
    path: "/private/self-improvement/context-evidence",
    operation: "audit.read",
    locationSource: "header-grant",
    principals: ["audit-reader", "coordinator"],
    authorizationRules: [],
    headers: LocationHeaders,
    request: ListContextEvidenceRequest,
    response: ListContextEvidenceResponse,
    errors: [ApiErrors.invalidPage, ApiErrors.forbidden],
    successStatuses: [200],
    ordering: "created-id-desc",
    sideEffects: ["none"],
    mutation: false,
  },
  listRoutingDecisions: {
    method: "GET",
    path: "/private/self-improvement/routing-decisions",
    operation: "audit.read",
    locationSource: "header-grant",
    principals: ["audit-reader", "coordinator"],
    authorizationRules: [],
    headers: LocationHeaders,
    request: ListRoutingDecisionsRequest,
    response: ListRoutingDecisionsResponse,
    errors: [ApiErrors.invalidPage, ApiErrors.forbidden],
    successStatuses: [200],
    ordering: "timestamp-id-desc",
    sideEffects: ["none"],
    mutation: false,
  },
  listAudit: {
    method: "GET",
    path: "/private/self-improvement/audit",
    operation: "audit.read",
    locationSource: "header-grant",
    principals: ["audit-reader"],
    authorizationRules: [{ type: "audit-reader-only-audit", principal: "audit-reader" }],
    headers: LocationHeaders,
    request: ListAuditRequest,
    response: ListAuditResponse,
    errors: [ApiErrors.invalidPage, ApiErrors.forbidden],
    successStatuses: [200],
    ordering: "timestamp-id-desc",
    sideEffects: ["access-audited"],
    mutation: false,
  },
} as const satisfies Record<string, PrivateApiOperation>
