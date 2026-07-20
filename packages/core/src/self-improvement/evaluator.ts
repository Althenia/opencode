export * as SelfImprovementEvaluator from "./evaluator"

import { Effect, Schema } from "effect"
import { SelfImprovement, SelfImprovementEvaluation, SelfImprovementLifecycle } from "@opencode-ai/schema"

export class InvalidEvidence extends Schema.TaggedErrorClass<InvalidEvidence>()(
  "SelfImprovementEvaluator.InvalidEvidence",
  {
    message: Schema.String,
  },
) {}

type ReferenceResult = "pass" | "fail" | "not-applicable"

export interface EvaluationInput {
  readonly runID: SelfImprovementLifecycle.EvaluationRunID
  readonly cutoffSampleSetDigest: SelfImprovement.Digest
  readonly stage: SelfImprovementLifecycle.ArtifactStage
  readonly source: SelfImprovementLifecycle.ArtifactSource
  readonly behaviorClass: SelfImprovementLifecycle.BehaviorClass
  readonly totals: SelfImprovementEvaluation.MetricTotals
  readonly aggregates: SelfImprovementEvaluation.MetricAggregates
  readonly baseline: {
    readonly totals: SelfImprovementEvaluation.MetricTotals
    readonly aggregates: SelfImprovementEvaluation.MetricAggregates
    readonly locationMatches: boolean
    readonly suiteMatches: boolean
  }
  readonly requiredSuitePassed: boolean
  readonly references: {
    readonly nameAvailable: boolean
    readonly common: ReferenceResult
    readonly typed: ReferenceResult
    readonly cycle: ReferenceResult
    readonly models: ReferenceResult
  }
  readonly capabilities: ReadonlyArray<SelfImprovementEvaluation.GateFinding>
  readonly content?: ReadonlyArray<SelfImprovementEvaluation.GateFinding>
  readonly approvalPresent: boolean
  readonly decidedAt: SelfImprovementLifecycle.TimestampMillis
}

export const evaluate = (
  input: EvaluationInput,
): Effect.Effect<SelfImprovementEvaluation.EvaluationDecision, InvalidEvidence> =>
  Effect.sync(() => {
    const metricStage = input.stage === "shadow" || input.stage === "canary"
    const generated = input.source === "generated"
    const adhoc = generated && input.behaviorClass === "instruction-only"
    const metric = metricStage ? evaluateMetrics(input) : undefined
    const capability = new Map(input.capabilities.map((finding) => [finding.gateID, finding]))
    const content = new Map(input.content?.map((finding) => [finding.gateID, finding]))
    const staticRequired = input.stage !== "archived"
    const finding = (gateID: SelfImprovementEvaluation.GateID, result: ReferenceResult, code: string) =>
      SelfImprovementEvaluation.GateFinding.make({
        id: SelfImprovementLifecycle.GateFindingID.create(),
        evaluationRunID: input.runID,
        order: SelfImprovementEvaluation.GateOrder[gateID],
        gateID,
        result,
        code,
      })
    const result = (gateID: SelfImprovementEvaluation.GateID, value: boolean, code: string) =>
      finding(gateID, value ? "pass" : "fail", code)
    const external = (gateID: SelfImprovementEvaluation.GateID, required: boolean) => {
      const supplied = capability.get(gateID) ?? content.get(gateID)
      if (supplied)
        return SelfImprovementEvaluation.GateFinding.make({
          ...supplied,
          id: SelfImprovementLifecycle.GateFindingID.create(),
          evaluationRunID: input.runID,
        })
      return finding(
        gateID,
        required ? "fail" : "not-applicable",
        required ? "missing-required-external-gate-evidence" : "not-applicable",
      )
    }
    const findings = [
      result("candidate-name-available", !staticRequired || input.references.nameAvailable, "candidate-name-available"),
      finding(
        "common-references-resolve",
        staticRequired ? input.references.common : "not-applicable",
        "reference-result",
      ),
      finding(
        "typed-references-resolve",
        staticRequired ? input.references.typed : "not-applicable",
        "reference-result",
      ),
      finding("reference-cycle-absent", staticRequired ? input.references.cycle : "not-applicable", "reference-result"),
      finding(
        "model-references-resolve",
        staticRequired ? input.references.models : "not-applicable",
        "reference-result",
      ),
      finding(
        "generated-governance-unchanged",
        generated ? "pass" : "not-applicable",
        "generated-governance-unchanged",
      ),
      external("generated-content-safe", generated),
      external("capabilities-static-known", staticRequired),
      external("capabilities-within-location-grant", staticRequired),
      external("generated-capabilities-within-baseline", generated),
      external("adhoc-capabilities-within-task-envelope", adhoc),
      result(
        "required-suite-passed",
        input.stage === "draft" ? true : input.requiredSuitePassed,
        "required-suite-passed",
      ),
      result(
        "baseline-compatible",
        input.stage === "draft" || (input.baseline.locationMatches && input.baseline.suiteMatches),
        "baseline-compatible",
      ),
      finding("minimum-samples-present", metric?.minimumSamples ?? "not-applicable", "minimum-samples-present"),
      finding("task-quality-non-regression", metric?.taskQuality ?? "not-applicable", "task-quality-non-regression"),
      finding("correctness-non-regression", metric?.correctness ?? "not-applicable", "correctness-non-regression"),
      finding("repeat-fix-non-regression", metric?.repeatFixRate ?? "not-applicable", "repeat-fix-non-regression"),
      finding("precision-non-regression", metric?.precision ?? "not-applicable", "precision-non-regression"),
      finding("latency-budget-met", metric?.latency ?? "not-applicable", "latency-budget-met"),
      finding("token-budget-met", metric?.tokens ?? "not-applicable", "token-budget-met"),
      finding("cache-hit-non-regression", metric?.cache ?? "not-applicable", "cache-hit-non-regression"),
      finding("aggregate-reward-positive", metric?.reward ?? "not-applicable", "aggregate-reward-positive"),
      finding(
        "required-approval-present",
        generated && input.behaviorClass !== "instruction-only" && input.stage === "shadow"
          ? input.approvalPresent
            ? "pass"
            : "fail"
          : "not-applicable",
        "required-approval-present",
      ),
    ]
    const aggregateReward = metric?.aggregateReward ?? 0
    const approvalPending =
      generated && input.behaviorClass !== "instruction-only" && input.stage === "shadow" && !input.approvalPresent
    return new SelfImprovementEvaluation.EvaluationDecision({
      runID: input.runID,
      cutoffSampleSetDigest: input.cutoffSampleSetDigest,
      findings,
      metricTotals: input.totals,
      aggregates: input.aggregates,
      aggregateReward,
      decision:
        findings.every(
          (item) => item.result !== "fail" || (approvalPending && item.gateID === "required-approval-present"),
        ) &&
        (!metricStage || aggregateReward > 0)
          ? "passed"
          : "failed",
      decidedAt: input.decidedAt,
    })
  })

function evaluateMetrics(input: EvaluationInput) {
  const candidate = input.aggregates
  const baseline = input.baseline.aggregates
  const zeroRequired =
    input.totals.taskQualityPossibleAllowlistedPoints === 0 ||
    input.totals.correctnessRequiredChecks === 0 ||
    input.totals.repeatFixCompletedTasks === 0 ||
    input.totals.precisionAssessedItems === 0
  const zeroSuccesses = input.totals.successfulTasks === 0
  const sampleMinimum = input.stage === "shadow" ? 10 : 20
  const reward = clamp(
    0.25 * delta(candidate.taskQuality, baseline.taskQuality, true) +
      0.25 * delta(candidate.correctness, baseline.correctness, true) +
      0.15 * delta(candidate.repeatFixRate, baseline.repeatFixRate, false) +
      0.1 * delta(candidate.precision, baseline.precision, true) +
      0.1 * delta(candidate.latencyP95Ms, baseline.latencyP95Ms, false) +
      0.1 * delta(candidate.tokensPerSuccess, baseline.tokensPerSuccess, false) +
      0.05 * delta(candidate.cacheHitRatio, baseline.cacheHitRatio, true),
  )
  return {
    minimumSamples: input.totals.acceptedLatencySampleCount >= sampleMinimum ? "pass" : "fail",
    taskQuality: !zeroRequired && candidate.taskQuality >= baseline.taskQuality ? "pass" : "fail",
    correctness: !zeroRequired && candidate.correctness >= baseline.correctness ? "pass" : "fail",
    repeatFixRate: !zeroRequired && candidate.repeatFixRate <= baseline.repeatFixRate ? "pass" : "fail",
    precision: !zeroRequired && candidate.precision >= baseline.precision ? "pass" : "fail",
    latency: candidate.latencyP95Ms <= baseline.latencyP95Ms * 1.1 ? "pass" : "fail",
    tokens: !zeroSuccesses && candidate.tokensPerSuccess <= baseline.tokensPerSuccess * 1.1 ? "pass" : "fail",
    cache:
      input.totals.cacheEligibleTokens === 0 && input.baseline.totals.cacheEligibleTokens === 0
        ? "pass"
        : candidate.cacheHitRatio >= baseline.cacheHitRatio
          ? "pass"
          : "fail",
    reward: reward > 0 ? "pass" : "fail",
    aggregateReward: reward,
  } as const
}

function delta(candidate: number, baseline: number, higherIsBetter: boolean) {
  if (candidate === 0 && baseline === 0) return 0
  const raw = (higherIsBetter ? candidate - baseline : baseline - candidate) / Math.max(Math.abs(baseline), 1e-9)
  return clamp(raw)
}

function clamp(value: number) {
  return Math.max(-1, Math.min(1, value))
}
