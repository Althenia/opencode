export * as SelfImprovementLifecycle from "./self-improvement-lifecycle"

import { Schema } from "effect"
import { ascending } from "./identifier"
import { Model } from "./model"
import { optional, statics } from "./schema"
import { SelfImprovement } from "./self-improvement"

const unique = <S extends Schema.Top>(schema: S) => Schema.Array(schema).check(Schema.isUnique())
const generatedID = <const Prefix extends string, const Brand extends string>(prefix: Prefix, brand: Brand) =>
  Schema.String.pipe(Schema.brand(brand))
    .annotate({ identifier: brand })
    .check(Schema.isStartsWith(prefix))
    .pipe(statics((schema) => ({ create: () => schema.make(prefix + ascending()) })))

export const LocationID = Schema.String.pipe(Schema.brand("SelfImprovementLifecycle.LocationID"))
  .annotate({ identifier: "SelfImprovementLifecycle.LocationID" })
  .check(Schema.isPattern(/^[0-9a-f]{64}$/))
export type LocationID = typeof LocationID.Type
export const PrincipalID = Schema.String.pipe(Schema.brand("SelfImprovementLifecycle.PrincipalID"))
  .annotate({ identifier: "SelfImprovementLifecycle.PrincipalID" })
  .check(Schema.isNonEmpty())
export type PrincipalID = typeof PrincipalID.Type
export const ArtifactID = generatedID("si_art_", "SelfImprovementLifecycle.ArtifactID")
export type ArtifactID = typeof ArtifactID.Type
export const ArtifactVersionID = generatedID("si_ver_", "SelfImprovementLifecycle.ArtifactVersionID")
export type ArtifactVersionID = typeof ArtifactVersionID.Type
export const StageTransitionID = generatedID("si_trn_", "SelfImprovementLifecycle.StageTransitionID")
export type StageTransitionID = typeof StageTransitionID.Type
export const ApprovalID = generatedID("si_app_", "SelfImprovementLifecycle.ApprovalID")
export type ApprovalID = typeof ApprovalID.Type
export const ApprovalRequestID = generatedID("si_apr_", "SelfImprovementLifecycle.ApprovalRequestID")
export type ApprovalRequestID = typeof ApprovalRequestID.Type
export const RollbackID = generatedID("si_rol_", "SelfImprovementLifecycle.RollbackID")
export type RollbackID = typeof RollbackID.Type
export const SuiteID = generatedID("si_sui_", "SelfImprovementLifecycle.SuiteID")
export type SuiteID = typeof SuiteID.Type
export const BaselineID = generatedID("si_bas_", "SelfImprovementLifecycle.BaselineID")
export type BaselineID = typeof BaselineID.Type
export const EvaluationRunID = generatedID("si_run_", "SelfImprovementLifecycle.EvaluationRunID")
export type EvaluationRunID = typeof EvaluationRunID.Type
export const MetricSampleID = generatedID("si_sam_", "SelfImprovementLifecycle.MetricSampleID")
export type MetricSampleID = typeof MetricSampleID.Type
export const GateFindingID = generatedID("si_gat_", "SelfImprovementLifecycle.GateFindingID")
export type GateFindingID = typeof GateFindingID.Type
export const ObservationID = generatedID("si_obs_", "SelfImprovementLifecycle.ObservationID")
export type ObservationID = typeof ObservationID.Type
export const GenerationLeaseID = generatedID("si_les_", "SelfImprovementLifecycle.GenerationLeaseID")
export type GenerationLeaseID = typeof GenerationLeaseID.Type
export const PullEventID = generatedID("si_pul_", "SelfImprovementLifecycle.PullEventID")
export type PullEventID = typeof PullEventID.Type
export const RewardEventID = generatedID("si_rew_", "SelfImprovementLifecycle.RewardEventID")
export type RewardEventID = typeof RewardEventID.Type
export const GenerationStrategyArmID = generatedID("si_gsa_", "SelfImprovementLifecycle.GenerationStrategyArmID")
export type GenerationStrategyArmID = typeof GenerationStrategyArmID.Type
export const ModelRouteArmID = generatedID("si_arm_", "SelfImprovementLifecycle.ModelRouteArmID")
export type ModelRouteArmID = typeof ModelRouteArmID.Type
export const RoutingDecisionID = generatedID("si_rte_", "SelfImprovementLifecycle.RoutingDecisionID")
export type RoutingDecisionID = typeof RoutingDecisionID.Type
export const ContextSelectionEvidenceID = generatedID("si_sel_", "SelfImprovementLifecycle.ContextSelectionEvidenceID")
export type ContextSelectionEvidenceID = typeof ContextSelectionEvidenceID.Type
export const ContextOutboxID = generatedID("si_obx_", "SelfImprovementLifecycle.ContextOutboxID")
export type ContextOutboxID = typeof ContextOutboxID.Type
export const AuditEntryID = generatedID("si_aud_", "SelfImprovementLifecycle.AuditEntryID")
export type AuditEntryID = typeof AuditEntryID.Type
export const IdempotencyRecordID = generatedID("si_idm_", "SelfImprovementLifecycle.IdempotencyRecordID")
export type IdempotencyRecordID = typeof IdempotencyRecordID.Type
export const Revision = Schema.Number.pipe(Schema.brand("SelfImprovementLifecycle.Revision"))
  .annotate({ identifier: "SelfImprovementLifecycle.Revision" })
  .check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))
export type Revision = typeof Revision.Type
export const TimestampMillis = Schema.Number.pipe(Schema.brand("SelfImprovementLifecycle.TimestampMillis"))
  .annotate({ identifier: "SelfImprovementLifecycle.TimestampMillis" })
  .check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))
export type TimestampMillis = typeof TimestampMillis.Type

export const GlossaryTerms = [
  "matching-observation",
  "eligible-arm",
  "positive-evidence",
  "improving-sample",
  "complete-audit-chain",
  "active-recommendation",
  "ephemeral",
  "baseline",
  "workload",
  "task",
  "success",
  "repeated-issue-fingerprint",
  "precision",
  "tombstone",
] as const
export const GlossaryTerm = Schema.Literals(GlossaryTerms).annotate({
  identifier: "SelfImprovementLifecycle.GlossaryTerm",
})
export type GlossaryTerm = typeof GlossaryTerm.Type
export const Glossary = {
  "matching-observation":
    "A trusted, redacted observation in the same Location whose HMAC identity has the same workload, error class, ordered tool/symbol digest, and outcome class within the rolling 30-day window",
  "eligible-arm":
    "An active allowlisted arm that passes all pre-selection policy, availability, capability, stage, and bucket checks",
  "positive-evidence": "Complete trusted evidence with all applicable gates passing and aggregate reward greater than zero",
  "improving-sample":
    "A valid candidate sample whose paired aggregate contribution improves at least one metric and violates no applicable non-regression or budget gate",
  "complete-audit-chain":
    "Admission/generation, evaluation, sample cutoff, approval when required, context outbox, transition, routing, reward, and terminal outcome records linked by immutable IDs and digests",
  "active-recommendation":
    "The highest-scoring eligible model-route arm activated after complete canary evidence; it is advisory and remains below explicit session/user and role routes",
  ephemeral:
    "An ad hoc version that auto-archives if not promoted by its retention deadline; it is never immediately deleted",
  baseline:
    "An immutable Location + workload + suite-revision control aggregate built from at least 20 unique trusted samples",
  workload:
    "A revisioned, allowlisted class that groups comparable tasks for baseline, suite, bucket, and routing decisions",
  task: "One immutable accepted runtime request bound to a Location, workload, suite revision, stage, version, and task ID digest",
  success: "A terminal accepted task outcome that passes the suite's required correctness condition",
  "repeated-issue-fingerprint":
    "A Location-keyed HMAC over the normalized issue class and affected stable identifiers, never raw content",
  precision: "Accepted relevant, non-extraneous assessed changes or claims divided by all assessed changes or claims",
  tombstone:
    "The terminal artifact operation that reserves its Location + kind + name, archives every version, removes rollout contributions, and forbids further normal mutation",
} as const satisfies Readonly<Record<GlossaryTerm, string>>

export const ArtifactSources = ["human", "generated"] as const
export const ArtifactSource = Schema.Literals(ArtifactSources).annotate({
  identifier: "SelfImprovementLifecycle.ArtifactSource",
})
export type ArtifactSource = typeof ArtifactSource.Type
export const BehaviorClasses = ["instruction-only", "executable", "behavior-changing"] as const
export const BehaviorClass = Schema.Literals(BehaviorClasses).annotate({
  identifier: "SelfImprovementLifecycle.BehaviorClass",
})
export type BehaviorClass = typeof BehaviorClass.Type
export const ArtifactStages = [
  "draft",
  "experimental",
  "candidate",
  "shadow",
  "canary",
  "active",
  "deprecated",
  "archived",
] as const
export const ArtifactStage = Schema.Literals(ArtifactStages).annotate({
  identifier: "SelfImprovementLifecycle.ArtifactStage",
})
export type ArtifactStage = typeof ArtifactStage.Type
export const ArtifactStatus = Schema.Literals(["live", "tombstoned"]).annotate({
  identifier: "SelfImprovementLifecycle.ArtifactStatus",
})
export type ArtifactStatus = typeof ArtifactStatus.Type
export const PrincipalKinds = [
  "first-party-user",
  "location-approver",
  "runtime-evidence-service",
  "evaluator",
  "coordinator",
  "audit-reader",
] as const
export const PrincipalKind = Schema.Literals(PrincipalKinds).annotate({
  identifier: "SelfImprovementLifecycle.PrincipalKind",
})
export type PrincipalKind = typeof PrincipalKind.Type
export const Operations = [
  "artifact.read",
  "artifact.create",
  "artifact.archive",
  "artifact.tombstone",
  "approval.decide",
  "evidence.ingest",
  "generation.execute",
  "evaluation.decide",
  "lifecycle.transition",
  "learning.update",
  "context.reconcile",
  "audit.read",
] as const
export const Operation = Schema.Literals(Operations).annotate({ identifier: "SelfImprovementLifecycle.Operation" })
export type Operation = typeof Operation.Type
export const LifecycleEvents = [
  "version-admitted",
  "static-passed",
  "offline-passed",
  "shadow-started",
  "shadow-evidence-passed",
  "approval-consumed",
  "canary-passed",
  "canary-regressed",
  "retention-archive",
  "ephemeral-expired",
  "artifact-tombstoned",
  "version-archived",
] as const
export const LifecycleEvent = Schema.Literals(LifecycleEvents).annotate({
  identifier: "SelfImprovementLifecycle.LifecycleEvent",
})
export type LifecycleEvent = typeof LifecycleEvent.Type
export const LifecycleReasons = [
  "admission-accepted",
  "gates-passed",
  "gates-failed",
  "approval-rejected",
  "approval-expired",
  "superseded",
  "canary-regression",
  "retention-expired",
  "ephemeral-expired",
  "user-archive",
  "policy-archive",
  "artifact-tombstoned",
] as const
export const LifecycleReason = Schema.Literals(LifecycleReasons).annotate({
  identifier: "SelfImprovementLifecycle.LifecycleReason",
})
export type LifecycleReason = typeof LifecycleReason.Type

export class ArtifactKey extends Schema.Class<ArtifactKey>("SelfImprovementLifecycle.ArtifactKey")({
  locationID: LocationID,
  kind: SelfImprovement.ArtifactKind,
  name: SelfImprovement.CandidateName,
}) {}
export class TypedArtifactReference extends Schema.Class<TypedArtifactReference>(
  "SelfImprovementLifecycle.TypedArtifactReference",
)({
  kind: SelfImprovement.ArtifactKind,
  name: SelfImprovement.CandidateName,
}) {}
export class Principal extends Schema.Class<Principal>("SelfImprovementLifecycle.Principal")({
  id: PrincipalID,
  kind: PrincipalKind,
  locationID: LocationID,
}) {}
export class CapabilityDeny extends Schema.Class<CapabilityDeny>("SelfImprovementLifecycle.CapabilityDeny")({
  capability: Schema.Literals([
    "tool",
    "filesystem",
    "network-origin",
    "model-route",
    "child-agent",
    "artifact-reference",
  ]),
  resourceID: Schema.NonEmptyString,
}) {}
export class CapabilityManifest extends Schema.Class<CapabilityManifest>(
  "SelfImprovementLifecycle.CapabilityManifest",
)({
  toolIDs: unique(Schema.NonEmptyString),
  filesystemScopeIDs: unique(Schema.NonEmptyString),
  networkOriginIDs: unique(Schema.NonEmptyString),
  modelRoutes: unique(Model.Ref),
  childAgentTargets: unique(SelfImprovement.CandidateName),
  artifactReferences: unique(TypedArtifactReference),
  denies: unique(CapabilityDeny),
}) {}
export class GeneratedContentMetadata extends Schema.Class<GeneratedContentMetadata>(
  "SelfImprovementLifecycle.GeneratedContentMetadata",
)({
  generationLeaseID: GenerationLeaseID,
  strategyPullID: PullEventID,
  originatingTaskIDDigest: SelfImprovement.Digest,
  modelRequestDigest: SelfImprovement.Digest,
  modelOutputDigest: SelfImprovement.Digest,
  retentionDeadline: TimestampMillis,
}) {}
export class Artifact extends Schema.Class<Artifact>("SelfImprovementLifecycle.Artifact")(
  Schema.Struct({
    id: ArtifactID,
    key: ArtifactKey,
    status: ArtifactStatus,
    createdBy: PrincipalID,
    createdAt: TimestampMillis,
    revision: Revision,
    tombstone: Schema.suspend(() => Tombstone).pipe(optional),
  }).check(Schema.makeFilter((artifact) => (artifact.status === "live") === (artifact.tombstone === undefined))),
) {}
export class ArtifactVersion extends Schema.Class<ArtifactVersion>("SelfImprovementLifecycle.ArtifactVersion")(
  Schema.Struct({
    id: ArtifactVersionID,
    artifactID: ArtifactID,
    versionNumber: Schema.Int.check(Schema.isGreaterThan(0)),
    source: ArtifactSource,
    behaviorClass: BehaviorClass,
    proposal: SelfImprovement.CandidateProposal,
    canonicalJson: SelfImprovement.CanonicalJson,
    proposalDigest: SelfImprovement.Digest,
    inputSnapshotDigest: SelfImprovement.Digest,
    versionDigest: SelfImprovement.Digest,
    capabilityManifest: CapabilityManifest,
    capabilityManifestDigest: SelfImprovement.Digest,
    creatorID: PrincipalID,
    createdAt: TimestampMillis,
    generated: GeneratedContentMetadata.pipe(optional),
  }).check(Schema.makeFilter((version) => (version.source === "generated") === (version.generated !== undefined))),
) {}
export class StageTransition extends Schema.Class<StageTransition>("SelfImprovementLifecycle.StageTransition")({
  id: StageTransitionID,
  versionID: ArtifactVersionID,
  previousStage: Schema.Union([Schema.Null, ArtifactStage]),
  nextStage: ArtifactStage,
  event: LifecycleEvent,
  reason: LifecycleReason,
  actorID: PrincipalID,
  timestamp: TimestampMillis,
  evaluationRunID: EvaluationRunID.pipe(optional),
  approvalID: ApprovalID.pipe(optional),
  rollbackID: RollbackID.pipe(optional),
  contextOutboxID: ContextOutboxID.pipe(optional),
  idempotencyRecordID: IdempotencyRecordID,
  idempotencyDigest: SelfImprovement.Digest,
}) {}
export class ApprovalBinding extends Schema.Class<ApprovalBinding>("SelfImprovementLifecycle.ApprovalBinding")({
  versionID: ArtifactVersionID,
  versionDigest: SelfImprovement.Digest,
  suiteID: SuiteID,
  suiteRevision: Revision,
  evaluationRunID: EvaluationRunID,
  shadowEvidenceDigest: SelfImprovement.Digest,
}) {}
export const ApprovalRejectionReason = Schema.Literal("approval-rejected").annotate({
  identifier: "SelfImprovementLifecycle.ApprovalRejectionReason",
})
export type ApprovalRejectionReason = typeof ApprovalRejectionReason.Type
export class ApprovalRequest extends Schema.Class<ApprovalRequest>("SelfImprovementLifecycle.ApprovalRequest")({
  id: ApprovalRequestID,
  locationID: LocationID,
  binding: ApprovalBinding,
  creatorID: PrincipalID,
  requestedAt: TimestampMillis,
}) {}
export class ApprovalGranted extends Schema.TaggedClass<ApprovalGranted>(
  "SelfImprovementLifecycle.ApprovalGranted",
)("approved", {
  approverID: PrincipalID,
  decidedAt: TimestampMillis,
  expiresAt: TimestampMillis,
  consumedAt: TimestampMillis.pipe(optional),
}) {}
export class ApprovalRejected extends Schema.TaggedClass<ApprovalRejected>(
  "SelfImprovementLifecycle.ApprovalRejected",
)("rejected", {
  approverID: PrincipalID,
  decidedAt: TimestampMillis,
  reason: ApprovalRejectionReason,
}) {}
export const ApprovalDecision = Schema.Union([ApprovalGranted, ApprovalRejected])
  .pipe(Schema.toTaggedUnion("_tag"))
  .annotate({ identifier: "SelfImprovementLifecycle.ApprovalDecision" })
export type ApprovalDecision = typeof ApprovalDecision.Type
export class Approval extends Schema.Class<Approval>("SelfImprovementLifecycle.Approval")({
  id: ApprovalID,
  requestID: ApprovalRequestID,
  locationID: LocationID,
  binding: ApprovalBinding,
  decision: ApprovalDecision,
}) {}
export class Rollback extends Schema.Class<Rollback>("SelfImprovementLifecycle.Rollback")({
  id: RollbackID,
  locationID: LocationID,
  artifactID: ArtifactID,
  candidateVersionID: ArtifactVersionID,
  retainedActiveVersionID: ArtifactVersionID,
  canaryRunID: EvaluationRunID,
  reason: Schema.Literal("canary-regression"),
  rewardEventID: RewardEventID,
  timestamp: TimestampMillis,
}) {}
export class Tombstone extends Schema.Class<Tombstone>("SelfImprovementLifecycle.Tombstone")({
  actorID: PrincipalID,
  reason: Schema.NonEmptyString,
  timestamp: TimestampMillis,
}) {}
