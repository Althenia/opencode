export * as SelfImprovementEvaluation from "./self-improvement-evaluation"

import { Schema } from "effect"
import { optional } from "./schema"
import { SelfImprovement } from "./self-improvement"
import { SelfImprovementLifecycle } from "./self-improvement-lifecycle"

const nonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
const nonNegativeFinite = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))
const unitRatio = Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 }))
const gateTighteningRatio = Schema.Finite.check(Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(1.1))

export const Workload = Schema.String.pipe(Schema.brand("SelfImprovementEvaluation.Workload"))
  .annotate({ identifier: "SelfImprovementEvaluation.Workload" })
  .check(Schema.isNonEmpty())
export type Workload = typeof Workload.Type
export const RunState = Schema.Literals(["open", "deciding", "decided", "cancelled"]).annotate({
  identifier: "SelfImprovementEvaluation.RunState",
})
export type RunState = typeof RunState.Type
export const TaskOutcome = Schema.Literals(["success", "failure"]).annotate({
  identifier: "SelfImprovementEvaluation.TaskOutcome",
})
export type TaskOutcome = typeof TaskOutcome.Type
export const GateIDs = [
  "candidate-name-available",
  "common-references-resolve",
  "typed-references-resolve",
  "reference-cycle-absent",
  "model-references-resolve",
  "generated-governance-unchanged",
  "generated-content-safe",
  "capabilities-static-known",
  "capabilities-within-location-grant",
  "generated-capabilities-within-baseline",
  "adhoc-capabilities-within-task-envelope",
  "required-suite-passed",
  "baseline-compatible",
  "minimum-samples-present",
  "task-quality-non-regression",
  "correctness-non-regression",
  "repeat-fix-non-regression",
  "precision-non-regression",
  "latency-budget-met",
  "token-budget-met",
  "cache-hit-non-regression",
  "aggregate-reward-positive",
  "required-approval-present",
] as const
export const GateID = Schema.Literals(GateIDs).annotate({ identifier: "SelfImprovementEvaluation.GateID" })
export type GateID = typeof GateID.Type
export const GateOrder = {
  "candidate-name-available": 1,
  "common-references-resolve": 2,
  "typed-references-resolve": 3,
  "reference-cycle-absent": 4,
  "model-references-resolve": 5,
  "generated-governance-unchanged": 6,
  "generated-content-safe": 7,
  "capabilities-static-known": 8,
  "capabilities-within-location-grant": 9,
  "generated-capabilities-within-baseline": 10,
  "adhoc-capabilities-within-task-envelope": 11,
  "required-suite-passed": 12,
  "baseline-compatible": 13,
  "minimum-samples-present": 14,
  "task-quality-non-regression": 15,
  "correctness-non-regression": 16,
  "repeat-fix-non-regression": 17,
  "precision-non-regression": 18,
  "latency-budget-met": 19,
  "token-budget-met": 20,
  "cache-hit-non-regression": 21,
  "aggregate-reward-positive": 22,
  "required-approval-present": 23,
} as const satisfies Readonly<Record<GateID, number>>
export const RequiredGateSequence = Schema.Array(GateID)
  .annotate({ identifier: "SelfImprovementEvaluation.RequiredGateSequence" })
  .check(
    Schema.makeFilter(
      (value) => value.length === GateIDs.length && value.every((gateID, index) => gateID === GateIDs[index]),
    ),
  )
export type RequiredGateSequence = typeof RequiredGateSequence.Type
export const GateResult = Schema.Literals(["pass", "fail", "not-applicable"]).annotate({
  identifier: "SelfImprovementEvaluation.GateResult",
})
export type GateResult = typeof GateResult.Type

export class HigherIsBetterNonRegression extends Schema.TaggedClass<HigherIsBetterNonRegression>(
  "SelfImprovementEvaluation.HigherIsBetterNonRegression",
)("higher-is-better", { minimumDelta: Schema.Literal(0) }) {}
export class LowerIsBetterNonRegression extends Schema.TaggedClass<LowerIsBetterNonRegression>(
  "SelfImprovementEvaluation.LowerIsBetterNonRegression",
)("lower-is-better", { maximumDelta: Schema.Literal(0) }) {}
export class MaximumRatioThreshold extends Schema.TaggedClass<MaximumRatioThreshold>(
  "SelfImprovementEvaluation.MaximumRatioThreshold",
)("maximum-ratio", { maximumRatio: Schema.Literal(1.1) }) {}
export class PositiveAggregateRewardThreshold extends Schema.TaggedClass<PositiveAggregateRewardThreshold>(
  "SelfImprovementEvaluation.PositiveAggregateRewardThreshold",
)("positive-aggregate-reward", { minimumExclusive: Schema.Literal(0) }) {}
export class MetricThresholds extends Schema.Class<MetricThresholds>("SelfImprovementEvaluation.MetricThresholds")({
  taskQuality: HigherIsBetterNonRegression,
  correctness: HigherIsBetterNonRegression,
  repeatFixRate: LowerIsBetterNonRegression,
  precision: HigherIsBetterNonRegression,
  latency: MaximumRatioThreshold,
  tokensPerSuccess: MaximumRatioThreshold,
  cacheHitRatio: HigherIsBetterNonRegression,
  aggregateReward: PositiveAggregateRewardThreshold,
}) {}

const HigherIsBetterTightening = Schema.Struct({
  type: Schema.Literal("higher-is-better"),
  minimumDelta: nonNegativeFinite,
})
const LowerIsBetterTightening = Schema.Struct({
  type: Schema.Literal("lower-is-better"),
  maximumDelta: Schema.Finite.check(Schema.isLessThanOrEqualTo(0)),
})
const MaximumRatioTightening = Schema.Struct({
  type: Schema.Literal("maximum-ratio"),
  maximumRatio: gateTighteningRatio,
})
const PositiveRewardTightening = Schema.Struct({
  type: Schema.Literal("positive-aggregate-reward"),
  minimumExclusive: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThan(1)),
})
export const GateThresholdTightening = Schema.Union([
  HigherIsBetterTightening,
  LowerIsBetterTightening,
  MaximumRatioTightening,
  PositiveRewardTightening,
])
  .pipe(Schema.toTaggedUnion("type"))
  .annotate({ identifier: "SelfImprovementEvaluation.GateThresholdTightening" })
export type GateThresholdTightening = typeof GateThresholdTightening.Type
export class ArtifactGateOverride extends Schema.Class<ArtifactGateOverride>(
  "SelfImprovementEvaluation.ArtifactGateOverride",
)({
  locationID: SelfImprovementLifecycle.LocationID,
  artifactID: SelfImprovementLifecycle.ArtifactID,
  suiteID: SelfImprovementLifecycle.SuiteID,
  suiteRevision: SelfImprovementLifecycle.Revision,
  gateID: GateID,
  applicability: Schema.Literal("required"),
  thresholdTightening: GateThresholdTightening.pipe(optional),
}) {}

export interface TaskQualityMetric extends Schema.Schema.Type<typeof TaskQualityMetric> {}
export const TaskQualityMetric = Schema.Struct({
  earnedAllowlistedPoints: nonNegativeInt,
  possibleAllowlistedPoints: nonNegativeInt,
})
  .annotate({ identifier: "SelfImprovementEvaluation.TaskQualityMetric" })
  .check(Schema.makeFilter((value) => value.earnedAllowlistedPoints <= value.possibleAllowlistedPoints))
export interface CorrectnessMetric extends Schema.Schema.Type<typeof CorrectnessMetric> {}
export const CorrectnessMetric = Schema.Struct({
  passedRequiredChecks: nonNegativeInt,
  requiredChecks: nonNegativeInt,
})
  .annotate({ identifier: "SelfImprovementEvaluation.CorrectnessMetric" })
  .check(Schema.makeFilter((value) => value.passedRequiredChecks <= value.requiredChecks))
export interface RepeatFixRateMetric extends Schema.Schema.Type<typeof RepeatFixRateMetric> {}
export const RepeatFixRateMetric = Schema.Struct({
  repeatedTasks: nonNegativeInt,
  completedTasks: nonNegativeInt,
})
  .annotate({ identifier: "SelfImprovementEvaluation.RepeatFixRateMetric" })
  .check(Schema.makeFilter((value) => value.repeatedTasks <= value.completedTasks))
export interface PrecisionMetric extends Schema.Schema.Type<typeof PrecisionMetric> {}
export const PrecisionMetric = Schema.Struct({
  acceptedRelevantItems: nonNegativeInt,
  assessedItems: nonNegativeInt,
})
  .annotate({ identifier: "SelfImprovementEvaluation.PrecisionMetric" })
  .check(Schema.makeFilter((value) => value.acceptedRelevantItems <= value.assessedItems))
export const LatencyMetric = Schema.Number.annotate({ identifier: "SelfImprovementEvaluation.LatencyMetric" }).check(
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(0),
)
export type LatencyMetric = typeof LatencyMetric.Type
export class TokensPerSuccessMetric extends Schema.Class<TokensPerSuccessMetric>(
  "SelfImprovementEvaluation.TokensPerSuccessMetric",
)({
  inputTokens: nonNegativeInt,
  outputTokens: nonNegativeInt,
  successfulTasks: Schema.Literals([0, 1]),
}) {}
export interface CacheHitRatioMetric extends Schema.Schema.Type<typeof CacheHitRatioMetric> {}
export const CacheHitRatioMetric = Schema.Struct({
  cacheReadTokens: nonNegativeInt,
  cacheEligibleTokens: nonNegativeInt,
})
  .annotate({ identifier: "SelfImprovementEvaluation.CacheHitRatioMetric" })
  .check(Schema.makeFilter((value) => value.cacheReadTokens <= value.cacheEligibleTokens))
export class MetricComponents extends Schema.Class<MetricComponents>("SelfImprovementEvaluation.MetricComponents")({
  taskQuality: TaskQualityMetric,
  correctness: CorrectnessMetric,
  repeatFixRate: RepeatFixRateMetric,
  precision: PrecisionMetric,
  latencyMs: LatencyMetric,
  tokensPerSuccess: TokensPerSuccessMetric,
  cacheHitRatio: CacheHitRatioMetric,
}) {}
export interface MetricTotals extends Schema.Schema.Type<typeof MetricTotals> {}
export const MetricTotals = Schema.Struct({
  taskQualityEarnedAllowlistedPoints: nonNegativeInt,
  taskQualityPossibleAllowlistedPoints: nonNegativeInt,
  correctnessPassedRequiredChecks: nonNegativeInt,
  correctnessRequiredChecks: nonNegativeInt,
  repeatFixRepeatedTasks: nonNegativeInt,
  repeatFixCompletedTasks: nonNegativeInt,
  precisionAcceptedRelevantItems: nonNegativeInt,
  precisionAssessedItems: nonNegativeInt,
  acceptedLatencySampleCount: nonNegativeInt,
  latencySampleSetDigest: SelfImprovement.Digest,
  inputTokens: nonNegativeInt,
  outputTokens: nonNegativeInt,
  successfulTasks: nonNegativeInt,
  cacheReadTokens: nonNegativeInt,
  cacheEligibleTokens: nonNegativeInt,
})
  .annotate({ identifier: "SelfImprovementEvaluation.MetricTotals" })
  .check(
    Schema.makeFilter(
      (value) =>
        value.taskQualityEarnedAllowlistedPoints <= value.taskQualityPossibleAllowlistedPoints &&
        value.correctnessPassedRequiredChecks <= value.correctnessRequiredChecks &&
        value.repeatFixRepeatedTasks <= value.repeatFixCompletedTasks &&
        value.precisionAcceptedRelevantItems <= value.precisionAssessedItems &&
        value.cacheReadTokens <= value.cacheEligibleTokens,
    ),
  )
export class MetricAggregates extends Schema.Class<MetricAggregates>("SelfImprovementEvaluation.MetricAggregates")({
  taskQuality: unitRatio,
  correctness: unitRatio,
  repeatFixRate: unitRatio,
  precision: unitRatio,
  latencyP95Ms: nonNegativeFinite,
  tokensPerSuccess: nonNegativeFinite,
  cacheHitRatio: unitRatio,
}) {}

export class SuiteRevision extends Schema.Class<SuiteRevision>("SelfImprovementEvaluation.SuiteRevision")({
  locationID: SelfImprovementLifecycle.LocationID,
  suiteID: SelfImprovementLifecycle.SuiteID,
  revision: SelfImprovementLifecycle.Revision,
  workload: Workload,
  workloadRevision: SelfImprovementLifecycle.Revision,
  artifactKinds: Schema.Array(SelfImprovement.ArtifactKind).check(Schema.isUnique()),
  orderedGates: RequiredGateSequence,
  thresholds: MetricThresholds,
  shadowMinimumSamples: Schema.Literal(10),
  canaryMinimumSamples: Schema.Literal(20),
  creatorID: SelfImprovementLifecycle.PrincipalID,
  createdAt: SelfImprovementLifecycle.TimestampMillis,
}) {}
export class Baseline extends Schema.Class<Baseline>("SelfImprovementEvaluation.Baseline")({
  id: SelfImprovementLifecycle.BaselineID,
  locationID: SelfImprovementLifecycle.LocationID,
  workload: Workload,
  workloadRevision: SelfImprovementLifecycle.Revision,
  suiteID: SelfImprovementLifecycle.SuiteID,
  suiteRevision: SelfImprovementLifecycle.Revision,
  producerAllowlistRevision: SelfImprovementLifecycle.Revision,
  controlSource: Schema.NonEmptyString,
  acceptanceStart: SelfImprovementLifecycle.TimestampMillis,
  acceptanceEnd: SelfImprovementLifecycle.TimestampMillis,
  cutoffAt: SelfImprovementLifecycle.TimestampMillis,
  uniqueSampleCount: Schema.Int.check(Schema.isGreaterThanOrEqualTo(20)),
  orderedSampleIDDigest: SelfImprovement.Digest,
  metricTotals: MetricTotals,
  aggregates: MetricAggregates,
  createdAt: SelfImprovementLifecycle.TimestampMillis,
  evaluatorSignatureDigest: SelfImprovement.Digest,
  bootstrapAuthorityID: SelfImprovementLifecycle.PrincipalID,
}) {}
export class EvaluationRun extends Schema.Class<EvaluationRun>("SelfImprovementEvaluation.EvaluationRun")({
  id: SelfImprovementLifecycle.EvaluationRunID,
  locationID: SelfImprovementLifecycle.LocationID,
  versionID: SelfImprovementLifecycle.ArtifactVersionID,
  stage: SelfImprovementLifecycle.ArtifactStage,
  workload: Workload,
  workloadRevision: SelfImprovementLifecycle.Revision,
  suiteID: SelfImprovementLifecycle.SuiteID,
  suiteRevision: SelfImprovementLifecycle.Revision,
  baselineID: SelfImprovementLifecycle.BaselineID,
  state: RunState,
  trustedProducerIDs: Schema.Array(SelfImprovementLifecycle.PrincipalID).check(Schema.isUnique()),
  acceptanceStart: SelfImprovementLifecycle.TimestampMillis,
  acceptanceEnd: SelfImprovementLifecycle.TimestampMillis,
  cutoffAt: SelfImprovementLifecycle.TimestampMillis,
  requestDigest: SelfImprovement.Digest,
  createdAt: SelfImprovementLifecycle.TimestampMillis,
  cutoffSampleSetDigest: SelfImprovement.Digest.pipe(optional),
  decidedAt: SelfImprovementLifecycle.TimestampMillis.pipe(optional),
}) {}
export class MetricSample extends Schema.Class<MetricSample>("SelfImprovementEvaluation.MetricSample")({
  id: SelfImprovementLifecycle.MetricSampleID,
  runID: SelfImprovementLifecycle.EvaluationRunID,
  sampleIDDigest: SelfImprovement.Digest,
  taskIDDigest: SelfImprovement.Digest,
  producerID: SelfImprovementLifecycle.PrincipalID,
  requestDigest: SelfImprovement.Digest,
  metrics: MetricComponents,
  outcome: TaskOutcome,
  startedAt: SelfImprovementLifecycle.TimestampMillis,
  terminalAt: SelfImprovementLifecycle.TimestampMillis,
}) {}
export interface GateFinding extends Schema.Schema.Type<typeof GateFinding> {}
export const GateFinding = Schema.Struct({
  id: SelfImprovementLifecycle.GateFindingID,
  evaluationRunID: SelfImprovementLifecycle.EvaluationRunID,
  order: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 23 })),
  gateID: GateID,
  result: GateResult,
  code: Schema.NonEmptyString,
  pointer: SelfImprovement.JsonPointer.pipe(optional),
  expected: Schema.Finite.pipe(optional),
  actual: Schema.Finite.pipe(optional),
  evidenceDigest: SelfImprovement.Digest.pipe(optional),
})
  .annotate({ identifier: "SelfImprovementEvaluation.GateFinding" })
  .check(Schema.makeFilter((value) => value.order === GateOrder[value.gateID]))
export class EvaluationDecision extends Schema.Class<EvaluationDecision>(
  "SelfImprovementEvaluation.EvaluationDecision",
)({
  runID: SelfImprovementLifecycle.EvaluationRunID,
  cutoffSampleSetDigest: SelfImprovement.Digest,
  findings: Schema.Array(GateFinding).check(
    Schema.makeFilter(
      (value) =>
        value.length === GateIDs.length &&
        value.every((finding, index) => finding.gateID === GateIDs[index]) &&
        new Set(value.map((finding) => finding.id)).size === value.length,
    ),
  ),
  metricTotals: MetricTotals,
  aggregates: MetricAggregates,
  aggregateReward: Schema.Finite.check(Schema.isBetween({ minimum: -1, maximum: 1 })),
  decision: Schema.Literals(["passed", "failed"]),
  approvalBinding: SelfImprovementLifecycle.ApprovalBinding.pipe(optional),
  decidedAt: SelfImprovementLifecycle.TimestampMillis,
}) {}
