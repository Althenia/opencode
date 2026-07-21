import { expect, test } from "bun:test"
import { Effect } from "effect"
import { SelfImprovement, SelfImprovementEvaluation, SelfImprovementLifecycle } from "@opencode-ai/schema"
import { evaluate } from "@opencode-ai/core/self-improvement/evaluator"

const digest = SelfImprovement.Digest.make("a".repeat(64))
const runID = SelfImprovementLifecycle.EvaluationRunID.make("si_run_1")
const totals = (overrides = {}) =>
  SelfImprovementEvaluation.MetricTotals.make({
    taskQualityEarnedAllowlistedPoints: 10,
    taskQualityPossibleAllowlistedPoints: 10,
    correctnessPassedRequiredChecks: 10,
    correctnessRequiredChecks: 10,
    repeatFixRepeatedTasks: 0,
    repeatFixCompletedTasks: 10,
    precisionAcceptedRelevantItems: 10,
    precisionAssessedItems: 10,
    acceptedLatencySampleCount: 10,
    latencySampleSetDigest: digest,
    inputTokens: 10,
    outputTokens: 10,
    successfulTasks: 10,
    cacheReadTokens: 10,
    cacheEligibleTokens: 10,
    ...overrides,
  })
const aggregates = (overrides = {}) =>
  new SelfImprovementEvaluation.MetricAggregates({
    taskQuality: 1,
    correctness: 1,
    repeatFixRate: 0,
    precision: 1,
    latencyP95Ms: 10,
    tokensPerSuccess: 2,
    cacheHitRatio: 1,
    ...overrides,
  })

test("emits all stable findings in catalog order with non-applicable cells", async () => {
  const decision = await Effect.runPromise(
    evaluate({
      runID,
      cutoffSampleSetDigest: digest,
      stage: "candidate",
      source: "human",
      behaviorClass: "instruction-only",
      totals: totals(),
      aggregates: aggregates(),
      baseline: { totals: totals(), aggregates: aggregates(), locationMatches: true, suiteMatches: true },
      requiredSuitePassed: true,
      references: { nameAvailable: true, common: "pass", typed: "pass", cycle: "pass", models: "pass" },
      capabilities: [],
      approvalPresent: false,
      decidedAt: SelfImprovementLifecycle.TimestampMillis.make(1),
    }),
  )

  expect(decision.findings.map((finding) => finding.gateID).join(",")).toBe(SelfImprovementEvaluation.GateIDs.join(","))
  expect(decision.findings.map((finding) => finding.order)).toEqual(
    SelfImprovementEvaluation.GateIDs.map((_, index) => index + 1),
  )
  expect(decision.findings.slice(13, 22).every((finding) => finding.result === "not-applicable")).toBe(true)
})

test("fails zero denominators and metric gates while clipping reward", async () => {
  const decision = await Effect.runPromise(
    evaluate({
      runID,
      cutoffSampleSetDigest: digest,
      stage: "shadow",
      source: "generated",
      behaviorClass: "behavior-changing",
      totals: totals({
        taskQualityEarnedAllowlistedPoints: 0,
        taskQualityPossibleAllowlistedPoints: 0,
        successfulTasks: 0,
      }),
      aggregates: aggregates({ taskQuality: 0, latencyP95Ms: 20, tokensPerSuccess: 20 }),
      baseline: { totals: totals(), aggregates: aggregates(), locationMatches: true, suiteMatches: true },
      requiredSuitePassed: true,
      references: { nameAvailable: true, common: "pass", typed: "pass", cycle: "pass", models: "pass" },
      capabilities: [],
      approvalPresent: false,
      decidedAt: SelfImprovementLifecycle.TimestampMillis.make(1),
    }),
  )

  expect(decision.findings.find((finding) => finding.gateID === "task-quality-non-regression")?.result).toBe("fail")
  expect(decision.findings.find((finding) => finding.gateID === "token-budget-met")?.result).toBe("fail")
  expect(decision.aggregateReward).toBeGreaterThanOrEqual(-1)
  expect(decision.aggregateReward).toBeLessThanOrEqual(1)
  expect(decision.decision).toBe("failed")
})

test("fails missing required evidence and rebinds supplied findings to the evaluation run", async () => {
  const foreignRunID = SelfImprovementLifecycle.EvaluationRunID.make("si_run_foreign")
  const externalFinding = SelfImprovementEvaluation.GateFinding.make({
    id: SelfImprovementLifecycle.GateFindingID.create(),
    evaluationRunID: foreignRunID,
    order: SelfImprovementEvaluation.GateOrder["capabilities-static-known"],
    gateID: "capabilities-static-known",
    result: "pass",
    code: "passed",
  })
  const decision = await Effect.runPromise(
    evaluate({
      runID,
      cutoffSampleSetDigest: digest,
      stage: "candidate",
      source: "human",
      behaviorClass: "instruction-only",
      totals: totals(),
      aggregates: aggregates(),
      baseline: { totals: totals(), aggregates: aggregates(), locationMatches: true, suiteMatches: true },
      requiredSuitePassed: true,
      references: { nameAvailable: true, common: "pass", typed: "pass", cycle: "pass", models: "pass" },
      capabilities: [externalFinding],
      approvalPresent: false,
      decidedAt: SelfImprovementLifecycle.TimestampMillis.make(1),
    }),
  )

  expect(decision.findings.every((finding) => finding.evaluationRunID === runID)).toBe(true)
  expect(decision.findings.find((finding) => finding.gateID === "capabilities-within-location-grant")?.result).toBe(
    "fail",
  )
})

test("passes eligible generated shadow evidence while approval remains pending", async () => {
  const decision = await Effect.runPromise(
    evaluate({
      runID,
      cutoffSampleSetDigest: digest,
      stage: "shadow",
      source: "generated",
      behaviorClass: "behavior-changing",
      totals: totals(),
      aggregates: aggregates(),
      baseline: {
        totals: totals(),
        aggregates: aggregates({ taskQuality: 0.9 }),
        locationMatches: true,
        suiteMatches: true,
      },
      requiredSuitePassed: true,
      references: { nameAvailable: true, common: "pass", typed: "pass", cycle: "pass", models: "pass" },
      capabilities: [
        "capabilities-static-known",
        "capabilities-within-location-grant",
        "generated-capabilities-within-baseline",
      ].map((gateID) =>
        SelfImprovementEvaluation.GateFinding.make({
          id: SelfImprovementLifecycle.GateFindingID.create(),
          evaluationRunID: runID,
          order: SelfImprovementEvaluation.GateOrder[gateID as "generated-content-safe"],
          gateID: gateID as "generated-content-safe",
          result: "pass",
          code: "admission-validated",
        }),
      ),
      content: [
        SelfImprovementEvaluation.GateFinding.make({
          id: SelfImprovementLifecycle.GateFindingID.create(),
          evaluationRunID: runID,
          order: SelfImprovementEvaluation.GateOrder["generated-content-safe"],
          gateID: "generated-content-safe",
          result: "pass",
          code: "admission-validated",
        }),
      ],
      approvalPresent: false,
      decidedAt: SelfImprovementLifecycle.TimestampMillis.make(1),
    }),
  )

  expect(decision.decision).toBe("passed")
  expect(decision.findings.find((finding) => finding.gateID === "required-approval-present")?.result).toBe("fail")
})
