export * as SelfImprovementLearning from "./self-improvement-learning"

import { Schema } from "effect"
import { Model } from "./model"
import { optional } from "./schema"
import { SelfImprovement } from "./self-improvement"
import { SelfImprovementEvaluation } from "./self-improvement-evaluation"
import { SelfImprovementLifecycle } from "./self-improvement-lifecycle"

export const IdempotencyKey = Schema.String.pipe(Schema.brand("SelfImprovementLearning.IdempotencyKey"))
  .annotate({ identifier: "SelfImprovementLearning.IdempotencyKey" })
  .check(Schema.isNonEmpty())
export type IdempotencyKey = typeof IdempotencyKey.Type
export const ActionDomain = Schema.Literals(["generation-strategy", "model-route"]).annotate({
  identifier: "SelfImprovementLearning.ActionDomain",
})
export type ActionDomain = typeof ActionDomain.Type
export const ObservationOutcomeClass = Schema.Literals(["success", "failure", "cancelled"]).annotate({
  identifier: "SelfImprovementLearning.ObservationOutcomeClass",
})
export type ObservationOutcomeClass = typeof ObservationOutcomeClass.Type
export const GenerationOutcome = Schema.Literals([
  "pending",
  "model-failed",
  "output-rejected",
  "hard-rejected",
  "admitted",
]).annotate({ identifier: "SelfImprovementLearning.GenerationOutcome" })
export type GenerationOutcome = typeof GenerationOutcome.Type
export const RewardOutcomeClass = Schema.Literals([
  "no-reward-model-failure",
  "invalid-model-output",
  "no-reward-hard-rejection",
  "no-reward-insufficient-evidence",
  "shadow-failure",
  "canary-regression",
  "no-reward-approval",
  "passing-evidence",
]).annotate({ identifier: "SelfImprovementLearning.RewardOutcomeClass" })
export type RewardOutcomeClass = typeof RewardOutcomeClass.Type
export const RoutingPrecedence = [
  "session-user",
  "role",
  "active-recommendation",
  "catalog-default",
  "catalog-fallback",
] as const
export const RoutingPrecedenceSource = Schema.Literals(RoutingPrecedence).annotate({
  identifier: "SelfImprovementLearning.RoutingPrecedenceSource",
})
export type RoutingPrecedenceSource = typeof RoutingPrecedenceSource.Type
export const ContextOutboxStatus = Schema.Literals([
  "pending",
  "applying",
  "applied",
  "superseded",
  "blocked",
]).annotate({ identifier: "SelfImprovementLearning.ContextOutboxStatus" })
export type ContextOutboxStatus = typeof ContextOutboxStatus.Type
export const ContextCohortResult = Schema.Literals(["shadow-isolated", "canary-in", "canary-out", "active"]).annotate({
  identifier: "SelfImprovementLearning.ContextCohortResult",
})
export type ContextCohortResult = typeof ContextCohortResult.Type

export class Observation extends Schema.Class<Observation>("SelfImprovementLearning.Observation")(
  Schema.Struct({
    id: SelfImprovementLifecycle.ObservationID,
    locationID: SelfImprovementLifecycle.LocationID,
    patternDigest: SelfImprovement.Digest,
    identityDigest: SelfImprovement.Digest,
    workload: SelfImprovementEvaluation.Workload,
    workloadRevision: SelfImprovementLifecycle.Revision,
    errorClass: Schema.NonEmptyString,
    orderedToolSymbolDigest: SelfImprovement.Digest,
    outcomeClass: ObservationOutcomeClass,
    taskIDDigest: SelfImprovement.Digest,
    producerID: SelfImprovementLifecycle.PrincipalID,
    occurredAt: SelfImprovementLifecycle.TimestampMillis,
    expiresAt: SelfImprovementLifecycle.TimestampMillis,
  }).check(Schema.makeFilter((value) => value.expiresAt === value.occurredAt + 30 * 86_400_000)),
) {}
export class GenerationLease extends Schema.Class<GenerationLease>("SelfImprovementLearning.GenerationLease")({
  id: SelfImprovementLifecycle.GenerationLeaseID,
  locationID: SelfImprovementLifecycle.LocationID,
  patternDigest: SelfImprovement.Digest,
  ownerID: SelfImprovementLifecycle.PrincipalID,
  leaseTokenDigest: SelfImprovement.Digest,
  attemptNumber: Schema.Int.check(Schema.isGreaterThan(0)),
  acquiredAt: SelfImprovementLifecycle.TimestampMillis,
  expiresAt: SelfImprovementLifecycle.TimestampMillis,
  completedAt: SelfImprovementLifecycle.TimestampMillis.pipe(optional),
  modelRequestDigest: SelfImprovement.Digest,
  modelOutputDigest: SelfImprovement.Digest.pipe(optional),
  outcome: GenerationOutcome,
}) {}
export class GenerationStrategyArm extends Schema.Class<GenerationStrategyArm>(
  "SelfImprovementLearning.GenerationStrategyArm",
)({
  id: SelfImprovementLifecycle.GenerationStrategyArmID,
  locationID: SelfImprovementLifecycle.LocationID,
  strategyID: Schema.NonEmptyString,
  allowlistRevision: SelfImprovementLifecycle.Revision,
  active: Schema.Boolean,
}) {}
export class ModelRouteArm extends Schema.Class<ModelRouteArm>("SelfImprovementLearning.ModelRouteArm")({
  id: SelfImprovementLifecycle.ModelRouteArmID,
  locationID: SelfImprovementLifecycle.LocationID,
  route: Model.Ref,
  allowlistRevision: SelfImprovementLifecycle.Revision,
  active: Schema.Boolean,
}) {}
export const BanditArmID = Schema.Union([
  SelfImprovementLifecycle.GenerationStrategyArmID,
  SelfImprovementLifecycle.ModelRouteArmID,
]).annotate({ identifier: "SelfImprovementLearning.BanditArmID" })
export type BanditArmID = typeof BanditArmID.Type
const armMatchesDomain = (actionDomain: ActionDomain, armID: BanditArmID) =>
  actionDomain === "generation-strategy" ? armID.startsWith("si_gsa_") : armID.startsWith("si_arm_")
export interface PullEvent extends Schema.Schema.Type<typeof PullEvent> {}
export const PullEvent = Schema.Struct({
  id: SelfImprovementLifecycle.PullEventID,
  locationID: SelfImprovementLifecycle.LocationID,
  actionDomain: ActionDomain,
  bucketDigest: SelfImprovement.Digest,
  derivationRevision: SelfImprovementLifecycle.Revision,
  allowlistRevision: SelfImprovementLifecycle.Revision,
  orderedEligibleArmIDs: Schema.Array(BanditArmID).check(Schema.isUnique()),
  selectedArmID: BanditArmID,
  proposalDigest: SelfImprovement.Digest.pipe(optional),
  sessionDigest: SelfImprovement.Digest.pipe(optional),
  versionID: SelfImprovementLifecycle.ArtifactVersionID.pipe(optional),
  timestamp: SelfImprovementLifecycle.TimestampMillis,
})
  .annotate({ identifier: "SelfImprovementLearning.PullEvent" })
  .check(
    Schema.makeFilter(
      (value) =>
        value.orderedEligibleArmIDs.includes(value.selectedArmID) &&
        value.orderedEligibleArmIDs.every((armID) => armMatchesDomain(value.actionDomain, armID)),
    ),
  )
export class RewardEvent extends Schema.Class<RewardEvent>("SelfImprovementLearning.RewardEvent")({
  id: SelfImprovementLifecycle.RewardEventID,
  locationID: SelfImprovementLifecycle.LocationID,
  pullEventID: SelfImprovementLifecycle.PullEventID,
  outcomeClass: RewardOutcomeClass,
  numericReward: Schema.Finite.check(Schema.isBetween({ minimum: -1, maximum: 1 })).pipe(optional),
  evidenceDigest: SelfImprovement.Digest,
  timestamp: SelfImprovementLifecycle.TimestampMillis,
}) {}
export interface BanditState extends Schema.Schema.Type<typeof BanditState> {}
export const BanditState = Schema.Struct({
  locationID: SelfImprovementLifecycle.LocationID,
  actionDomain: ActionDomain,
  bucketDigest: SelfImprovement.Digest,
  derivationRevision: SelfImprovementLifecycle.Revision,
  allowlistRevision: SelfImprovementLifecycle.Revision,
  armID: BanditArmID,
  pullTotal: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  rewardedPullTotal: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  cumulativeReward: Schema.Finite,
  meanReward: Schema.Finite,
  active: Schema.Boolean,
  latestPullEventID: SelfImprovementLifecycle.PullEventID.pipe(optional),
  latestRewardEventID: SelfImprovementLifecycle.RewardEventID.pipe(optional),
})
  .annotate({ identifier: "SelfImprovementLearning.BanditState" })
  .check(Schema.makeFilter((value) => armMatchesDomain(value.actionDomain, value.armID)))
export class RoutingDecision extends Schema.Class<RoutingDecision>("SelfImprovementLearning.RoutingDecision")({
  id: SelfImprovementLifecycle.RoutingDecisionID,
  locationID: SelfImprovementLifecycle.LocationID,
  sessionDigest: SelfImprovement.Digest,
  workload: SelfImprovementEvaluation.Workload,
  workloadRevision: SelfImprovementLifecycle.Revision,
  roleDigest: SelfImprovement.Digest,
  precedenceSource: RoutingPrecedenceSource,
  policySnapshotDigest: SelfImprovement.Digest,
  catalogSnapshotDigest: SelfImprovement.Digest,
  variantSnapshotDigest: SelfImprovement.Digest,
  orderedEligibleArms: Schema.Array(ModelRouteArm),
  selectedRoute: Model.Ref,
  reasonCode: Schema.NonEmptyString,
  pullEventID: SelfImprovementLifecycle.PullEventID.pipe(optional),
  timestamp: SelfImprovementLifecycle.TimestampMillis,
}) {}
const DesiredPresent = Schema.Struct({
  state: Schema.Literal("present"),
  versionID: SelfImprovementLifecycle.ArtifactVersionID,
  versionDigest: SelfImprovement.Digest,
  stage: SelfImprovementLifecycle.ArtifactStage,
})
const DesiredAbsent = Schema.Struct({ state: Schema.Literal("absent") })
export const ContextDesiredTarget = Schema.Union([DesiredPresent, DesiredAbsent])
  .pipe(Schema.toTaggedUnion("state"))
  .annotate({ identifier: "SelfImprovementLearning.ContextDesiredTarget" })
export type ContextDesiredTarget = typeof ContextDesiredTarget.Type
export class ContextDesiredState extends Schema.Class<ContextDesiredState>(
  "SelfImprovementLearning.ContextDesiredState",
)(
  Schema.Struct({
    locationID: SelfImprovementLifecycle.LocationID,
    artifactID: SelfImprovementLifecycle.ArtifactID,
    rolloutSlot: Schema.Literals(["shadow", "canary", "active"]),
    desired: ContextDesiredTarget,
    desiredRevision: SelfImprovementLifecycle.Revision,
  }).check(Schema.makeFilter((value) => value.desired.state === "absent" || value.desired.stage === value.rolloutSlot)),
) {}
const TerminalRemoval = Schema.Struct({
  outboxID: SelfImprovementLifecycle.ContextOutboxID,
  rolloutSlot: Schema.Literals(["shadow", "canary", "active"]).pipe(optional),
  versionDigest: SelfImprovement.Digest.pipe(optional),
  slotRevision: SelfImprovementLifecycle.Revision.pipe(optional),
}).check(
  Schema.makeFilter(
    (value) =>
      (value.rolloutSlot === undefined && value.versionDigest === undefined && value.slotRevision === undefined) ||
      (value.rolloutSlot !== undefined && value.versionDigest !== undefined && value.slotRevision !== undefined),
  ),
)

export const TerminalGroup = Schema.Struct({
  removalOutboxIDs: Schema.Array(SelfImprovementLifecycle.ContextOutboxID).check(Schema.isUnique()),
  archiveTransitions: Schema.Array(SelfImprovementLifecycle.StageTransition),
  removals: Schema.Array(TerminalRemoval).pipe(optional),
})
  .annotate({ identifier: "SelfImprovementLearning.TerminalGroup" })
  .check(
    Schema.makeFilter((value) => {
      const removalIDs = new Set(value.removalOutboxIDs)
      const removals = value.removals?.map((removal) => removal.outboxID)
      return (
        removalIDs.size > 0 &&
        value.archiveTransitions.length > 0 &&
        new Set(value.archiveTransitions.map((transition) => transition.id)).size === value.archiveTransitions.length &&
        value.archiveTransitions.every(
          (transition) =>
            transition.event === "version-archived" &&
            transition.nextStage === "archived" &&
            transition.contextOutboxID !== undefined &&
            removalIDs.has(transition.contextOutboxID),
        ) &&
        (removals === undefined ||
          (removals.length === removalIDs.size &&
            new Set(removals).size === removalIDs.size &&
            removals.every((id) => removalIDs.has(id))))
      )
    }),
  )
export type TerminalGroup = typeof TerminalGroup.Type

export class PendingTransitionIntent extends Schema.Class<PendingTransitionIntent>(
  "SelfImprovementLearning.PendingTransitionIntent",
)(
  Schema.Struct({
    versionID: SelfImprovementLifecycle.ArtifactVersionID,
    previousStage: SelfImprovementLifecycle.ArtifactStage,
    nextStage: SelfImprovementLifecycle.ArtifactStage,
    event: SelfImprovementLifecycle.LifecycleEvent,
    reason: SelfImprovementLifecycle.LifecycleReason,
    actorID: SelfImprovementLifecycle.PrincipalID,
    evaluationRunID: SelfImprovementLifecycle.EvaluationRunID.pipe(optional),
    approvalID: SelfImprovementLifecycle.ApprovalID.pipe(optional),
    approvalBinding: SelfImprovementLifecycle.ApprovalBinding.pipe(optional),
    rollbackID: SelfImprovementLifecycle.RollbackID.pipe(optional),
    rollback: SelfImprovementLifecycle.Rollback.pipe(optional),
    reward: RewardEvent.pipe(optional),
    supersededVersionID: SelfImprovementLifecycle.ArtifactVersionID.pipe(optional),
    terminalGroup: TerminalGroup.pipe(optional),
    idempotencyRecordID: SelfImprovementLifecycle.IdempotencyRecordID,
    idempotencyDigest: SelfImprovement.Digest,
  }).check(
    Schema.makeFilter((value) => {
      const approvalValid =
        (value.approvalID === undefined && value.approvalBinding === undefined) ||
        (value.approvalID !== undefined &&
          value.approvalBinding !== undefined &&
          value.approvalBinding.versionID === value.versionID)
      const rollbackValid =
        (value.rollbackID === undefined && value.rollback === undefined) ||
        (value.rollbackID !== undefined &&
          value.rollback !== undefined &&
          value.rollbackID === value.rollback.id &&
          value.rollback.candidateVersionID === value.versionID)
      const rewardValid =
        value.reward === undefined ||
        (value.rollback !== undefined &&
          value.rollback.rewardEventID === value.reward.id &&
          value.reward.outcomeClass === "canary-regression" &&
          value.reward.numericReward === -1) ||
        (value.event === "canary-passed" &&
          value.nextStage === "active" &&
          value.reward.outcomeClass === "passing-evidence" &&
          value.reward.numericReward === 1)
      const terminalValid =
        value.terminalGroup === undefined ||
        (value.event === "artifact-tombstoned" &&
          value.nextStage === "archived" &&
          value.terminalGroup.archiveTransitions.every(
            (transition) => transition.event === "version-archived" && transition.nextStage === "archived",
          ))
      const supersessionValid =
        value.supersededVersionID === undefined ||
        (value.event === "canary-passed" &&
          value.nextStage === "active" &&
          value.supersededVersionID !== value.versionID)
      return approvalValid && rollbackValid && rewardValid && terminalValid && supersessionValid
    }),
  ),
) {}
export class ContextOutbox extends Schema.Class<ContextOutbox>("SelfImprovementLearning.ContextOutbox")(
  Schema.Struct({
    id: SelfImprovementLifecycle.ContextOutboxID,
    locationID: SelfImprovementLifecycle.LocationID,
    artifactID: SelfImprovementLifecycle.ArtifactID,
    expectedArtifactRevision: SelfImprovementLifecycle.Revision,
    expectedStage: SelfImprovementLifecycle.ArtifactStage,
    desiredStateRevision: SelfImprovementLifecycle.Revision,
    intent: PendingTransitionIntent,
    status: ContextOutboxStatus,
    attempts: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    nextRetryAt: SelfImprovementLifecycle.TimestampMillis,
    casResultDigest: SelfImprovement.Digest.pipe(optional),
    createdAt: SelfImprovementLifecycle.TimestampMillis,
  }).check(Schema.makeFilter((value) => value.expectedStage === value.intent.previousStage)),
) {}
export class ContextSelectionEvidence extends Schema.Class<ContextSelectionEvidence>(
  "SelfImprovementLearning.ContextSelectionEvidence",
)(
  Schema.Struct({
    id: SelfImprovementLifecycle.ContextSelectionEvidenceID,
    artifactID: SelfImprovementLifecycle.ArtifactID,
    versionID: SelfImprovementLifecycle.ArtifactVersionID,
    versionDigest: SelfImprovement.Digest,
    locationID: SelfImprovementLifecycle.LocationID,
    stage: SelfImprovementLifecycle.ArtifactStage,
    contextEpoch: SelfImprovementLifecycle.Revision,
    sessionDigest: SelfImprovement.Digest,
    cohortResult: ContextCohortResult,
    outboxID: SelfImprovementLifecycle.ContextOutboxID,
  }).check(
    Schema.makeFilter(
      (value) =>
        value.stage ===
        (value.cohortResult === "shadow-isolated" ? "shadow" : value.cohortResult === "active" ? "active" : "canary"),
    ),
  ),
) {}
export const RetentionDeletionCount = Schema.Struct({
  category: Schema.NonEmptyString,
  count: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
})
export type RetentionDeletionCount = typeof RetentionDeletionCount.Type

export class AuditPayload extends Schema.Class<AuditPayload>("SelfImprovementLearning.AuditPayload")({
  artifactID: SelfImprovementLifecycle.ArtifactID.pipe(optional),
  versionID: SelfImprovementLifecycle.ArtifactVersionID.pipe(optional),
  evaluationRunID: SelfImprovementLifecycle.EvaluationRunID.pipe(optional),
  pullEventID: SelfImprovementLifecycle.PullEventID.pipe(optional),
  rewardEventID: SelfImprovementLifecycle.RewardEventID.pipe(optional),
  contextOutboxID: SelfImprovementLifecycle.ContextOutboxID.pipe(optional),
  linkedDigests: Schema.Array(SelfImprovement.Digest).check(Schema.isUnique()),
  rejectedFieldNames: Schema.Array(Schema.NonEmptyString).check(Schema.isUnique()),
  retentionDeletionCounts: Schema.Array(RetentionDeletionCount)
    .pipe(optional)
    .check(
      Schema.makeFilter(
        (value) => value === undefined || new Set(value.map((item) => item.category)).size === value.length,
      ),
    ),
}) {}
export class ObservationRetention extends Schema.TaggedClass<ObservationRetention>(
  "SelfImprovementLearning.ObservationRetention",
)("observation-30d", {
  createdAt: SelfImprovementLifecycle.TimestampMillis,
  expiresAt: SelfImprovementLifecycle.TimestampMillis,
}) {}
export class EvidenceRetention extends Schema.TaggedClass<EvidenceRetention>(
  "SelfImprovementLearning.EvidenceRetention",
)("evidence-180d", {
  createdAt: SelfImprovementLifecycle.TimestampMillis,
  expiresAt: SelfImprovementLifecycle.TimestampMillis,
}) {}
export class GovernedMetadataRetention extends Schema.TaggedClass<GovernedMetadataRetention>(
  "SelfImprovementLearning.GovernedMetadataRetention",
)("governed-metadata", { createdAt: SelfImprovementLifecycle.TimestampMillis }) {}
export const RetentionMetadata = Schema.Union([ObservationRetention, EvidenceRetention, GovernedMetadataRetention])
  .pipe(Schema.toTaggedUnion("_tag"))
  .annotate({ identifier: "SelfImprovementLearning.RetentionMetadata" })
  .check(
    Schema.makeFilter(
      (value) =>
        value._tag === "governed-metadata" ||
        value.expiresAt === value.createdAt + (value._tag === "observation-30d" ? 30 : 180) * 86_400_000,
    ),
  )
export type RetentionMetadata = typeof RetentionMetadata.Type
export class AuditEntry extends Schema.Class<AuditEntry>("SelfImprovementLearning.AuditEntry")({
  id: SelfImprovementLifecycle.AuditEntryID,
  locationID: SelfImprovementLifecycle.LocationID,
  eventType: Schema.NonEmptyString,
  actorID: SelfImprovementLifecycle.PrincipalID,
  payload: AuditPayload,
  timestamp: SelfImprovementLifecycle.TimestampMillis,
  retention: RetentionMetadata,
}) {}
export class IdempotencyIdentity extends Schema.Class<IdempotencyIdentity>(
  "SelfImprovementLearning.IdempotencyIdentity",
)({
  principalID: SelfImprovementLifecycle.PrincipalID,
  locationID: SelfImprovementLifecycle.LocationID,
  operation: SelfImprovementLifecycle.Operation,
  key: IdempotencyKey,
}) {}
