import { expect, test } from "bun:test"
import { Exit, Schema } from "effect"
import { SelfImprovementEvaluation } from "../src/self-improvement-evaluation.js"
import { SelfImprovementLifecycle } from "../src/self-improvement-lifecycle.js"

const decode = (schema: Schema.Decoder<unknown>, input: unknown): unknown => {
  const result = Schema.decodeUnknownExit(schema, { errors: "all", onExcessProperty: "error" })(input)
  if (Exit.isFailure(result)) throw new Error("schema decode failed")
  return result.value
}

const digest = "a".repeat(64)
const locationID = "b".repeat(64)
const higher = { _tag: "higher-is-better", minimumDelta: 0 }
const thresholds = {
  taskQuality: higher,
  correctness: higher,
  repeatFixRate: { _tag: "lower-is-better", maximumDelta: 0 },
  precision: higher,
  latency: { _tag: "maximum-ratio", maximumRatio: 1.1 },
  tokensPerSuccess: { _tag: "maximum-ratio", maximumRatio: 1.1 },
  cacheHitRatio: higher,
  aggregateReward: { _tag: "positive-aggregate-reward", minimumExclusive: 0 },
}
const zeroMetrics = {
  taskQuality: { earnedAllowlistedPoints: 0, possibleAllowlistedPoints: 0 },
  correctness: { passedRequiredChecks: 0, requiredChecks: 0 },
  repeatFixRate: { repeatedTasks: 0, completedTasks: 0 },
  precision: { acceptedRelevantItems: 0, assessedItems: 0 },
  latencyMs: 0,
  tokensPerSuccess: { inputTokens: 0, outputTokens: 0, successfulTasks: 0 },
  cacheHitRatio: { cacheReadTokens: 0, cacheEligibleTokens: 0 },
}
const zeroTotals = {
  taskQualityEarnedAllowlistedPoints: 0,
  taskQualityPossibleAllowlistedPoints: 0,
  correctnessPassedRequiredChecks: 0,
  correctnessRequiredChecks: 0,
  repeatFixRepeatedTasks: 0,
  repeatFixCompletedTasks: 0,
  precisionAcceptedRelevantItems: 0,
  precisionAssessedItems: 0,
  acceptedLatencySampleCount: 0,
  latencySampleSetDigest: digest,
  inputTokens: 0,
  outputTokens: 0,
  successfulTasks: 0,
  cacheReadTokens: 0,
  cacheEligibleTokens: 0,
}
const zeroAggregates = {
  taskQuality: 0,
  correctness: 0,
  repeatFixRate: 0,
  precision: 0,
  latencyP95Ms: 0,
  tokensPerSuccess: 0,
  cacheHitRatio: 0,
}

test("pins all 23 gate IDs in stable order and three result values", () => {
  expect(SelfImprovementEvaluation.GateIDs).toEqual([
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
  ])
  for (const result of ["pass", "fail", "not-applicable"]) {
    expect(decode(SelfImprovementEvaluation.GateResult, result)).toBe(result)
  }
  expect(decode(SelfImprovementEvaluation.RequiredGateSequence, SelfImprovementEvaluation.GateIDs)).toEqual(
    SelfImprovementEvaluation.GateIDs,
  )
  const duplicate = SelfImprovementEvaluation.GateIDs.with(1, SelfImprovementEvaluation.GateIDs[0])
  const reordered = SelfImprovementEvaluation.GateIDs.with(0, SelfImprovementEvaluation.GateIDs[1]).with(
    1,
    SelfImprovementEvaluation.GateIDs[0],
  )
  for (const gates of [SelfImprovementEvaluation.GateIDs.slice(1), duplicate, reordered]) {
    expect(() => decode(SelfImprovementEvaluation.RequiredGateSequence, gates)).toThrow()
  }
})

test("requires seven explicit sample metric components", () => {
  const metrics = {
    taskQuality: { earnedAllowlistedPoints: 8, possibleAllowlistedPoints: 10 },
    correctness: { passedRequiredChecks: 4, requiredChecks: 4 },
    repeatFixRate: { repeatedTasks: 0, completedTasks: 1 },
    precision: { acceptedRelevantItems: 3, assessedItems: 3 },
    latencyMs: 120,
    tokensPerSuccess: { inputTokens: 300, outputTokens: 200, successfulTasks: 1 },
    cacheHitRatio: { cacheReadTokens: 50, cacheEligibleTokens: 100 },
  }
  expect(decode(SelfImprovementEvaluation.MetricComponents, metrics)).toEqual(metrics)
  expect(() => decode(SelfImprovementEvaluation.MetricComponents, { ...metrics, correctness: undefined })).toThrow()
})

test("metric components preserve valid zero denominators and reject invalid content", () => {
  expect(decode(SelfImprovementEvaluation.MetricComponents, zeroMetrics)).toEqual(zeroMetrics)
  expect(() => decode(SelfImprovementEvaluation.MetricComponents, { ...zeroMetrics, transcript: "raw" })).toThrow()
  expect(() =>
    decode(SelfImprovementEvaluation.MetricComponents, {
      ...zeroMetrics,
      correctness: { passedRequiredChecks: 1, requiredChecks: 0 },
    }),
  ).toThrow()
  expect(() => decode(SelfImprovementEvaluation.MetricComponents, { ...zeroMetrics, latencyMs: -1 })).toThrow()
  expect(() => decode(SelfImprovementEvaluation.TaskOutcome, "cancelled")).toThrow()
  for (const outcome of ["success", "failure"])
    expect(decode(SelfImprovementEvaluation.TaskOutcome, outcome)).toBe(outcome)
})

test("suite revision is Location-owned and cannot weaken required gates or thresholds", () => {
  const suite = {
    locationID,
    suiteID: SelfImprovementLifecycle.SuiteID.create(),
    revision: 1,
    workload: "typescript",
    workloadRevision: 1,
    artifactKinds: ["skill"],
    orderedGates: SelfImprovementEvaluation.GateIDs,
    thresholds,
    shadowMinimumSamples: 10,
    canaryMinimumSamples: 20,
    creatorID: "evaluator",
    createdAt: 1,
  }
  expect(decode(SelfImprovementEvaluation.SuiteRevision, suite)).toEqual(suite)
  for (const invalid of [
    { ...suite, locationID: undefined },
    { ...suite, orderedGates: suite.orderedGates.slice(1) },
    { ...suite, shadowMinimumSamples: 9 },
    { ...suite, canaryMinimumSamples: 21 },
    { ...suite, thresholds: { ...thresholds, taskQuality: { ...higher, minimumDelta: 0.1 } } },
    { ...suite, thresholds: { ...thresholds, latency: { _tag: "maximum-ratio", maximumRatio: 1 } } },
  ]) {
    expect(() => decode(SelfImprovementEvaluation.SuiteRevision, invalid)).toThrow()
  }
})

test("artifact overrides are required-only and threshold-tightening-only", () => {
  const override = {
    locationID,
    artifactID: SelfImprovementLifecycle.ArtifactID.create(),
    suiteID: SelfImprovementLifecycle.SuiteID.create(),
    suiteRevision: 1,
    gateID: "latency-budget-met",
    applicability: "required",
    thresholdTightening: { type: "maximum-ratio", maximumRatio: 1 },
  }
  expect(decode(SelfImprovementEvaluation.ArtifactGateOverride, override)).toEqual(override)
  for (const invalid of [
    { ...override, applicability: "not-applicable" },
    { ...override, thresholdTightening: { type: "maximum-ratio", maximumRatio: 1.11 } },
    { ...override, thresholdTightening: { type: "lower-is-better", maximumDelta: 0.1 } },
    { ...override, thresholdTightening: { type: "positive-aggregate-reward", minimumExclusive: 1 } },
  ]) {
    expect(() => decode(SelfImprovementEvaluation.ArtifactGateOverride, invalid)).toThrow()
  }
})

test("metric totals preserve Section 8 raw fields and reject impossible totals", () => {
  expect(decode(SelfImprovementEvaluation.MetricTotals, zeroTotals)).toEqual(zeroTotals)
  for (const field of Object.keys(zeroTotals)) {
    expect(() => decode(SelfImprovementEvaluation.MetricTotals, { ...zeroTotals, [field]: undefined })).toThrow()
  }
  expect(() =>
    decode(SelfImprovementEvaluation.MetricTotals, {
      ...zeroTotals,
      taskQualityEarnedAllowlistedPoints: 1,
    }),
  ).toThrow()
  expect(() => decode(SelfImprovementEvaluation.MetricTotals, { ...zeroTotals, rawLatencySamples: [1] })).toThrow()
})

test("aggregates enforce ratio bounds and finite non-negative budgets", () => {
  expect(decode(SelfImprovementEvaluation.MetricAggregates, zeroAggregates)).toEqual(zeroAggregates)
  expect(
    decode(SelfImprovementEvaluation.MetricAggregates, {
      ...zeroAggregates,
      taskQuality: 1,
      latencyP95Ms: 1,
      tokensPerSuccess: 1,
    }),
  ).toEqual({ ...zeroAggregates, taskQuality: 1, latencyP95Ms: 1, tokensPerSuccess: 1 })
  for (const aggregates of [
    { ...zeroAggregates, correctness: 1.01 },
    { ...zeroAggregates, repeatFixRate: -0.01 },
    { ...zeroAggregates, latencyP95Ms: Number.POSITIVE_INFINITY },
    { ...zeroAggregates, tokensPerSuccess: -1 },
  ]) {
    expect(() => decode(SelfImprovementEvaluation.MetricAggregates, aggregates)).toThrow()
  }
})

test("baseline requires an immutable 20-sample Location workload binding", () => {
  const baseline = {
    id: SelfImprovementLifecycle.BaselineID.create(),
    locationID,
    workload: "typescript",
    workloadRevision: 1,
    suiteID: SelfImprovementLifecycle.SuiteID.create(),
    suiteRevision: 1,
    producerAllowlistRevision: 1,
    controlSource: "active-version",
    acceptanceStart: 1,
    acceptanceEnd: 2,
    cutoffAt: 3,
    uniqueSampleCount: 20,
    orderedSampleIDDigest: digest,
    metricTotals: zeroTotals,
    aggregates: zeroAggregates,
    createdAt: 4,
    evaluatorSignatureDigest: digest,
    bootstrapAuthorityID: "approver",
  }
  expect(decode(SelfImprovementEvaluation.Baseline, baseline)).toEqual(baseline)
  expect(() => decode(SelfImprovementEvaluation.Baseline, { ...baseline, uniqueSampleCount: 19 })).toThrow()
  for (const field of ["locationID", "workloadRevision", "suiteID", "suiteRevision", "cutoffAt"] as const) {
    expect(() => decode(SelfImprovementEvaluation.Baseline, { ...baseline, [field]: undefined })).toThrow()
  }
})

test("evaluation runs bind creation inputs and omit absent decision fields when encoded", () => {
  const run = {
    id: SelfImprovementLifecycle.EvaluationRunID.create(),
    locationID,
    versionID: SelfImprovementLifecycle.ArtifactVersionID.create(),
    stage: "shadow",
    workload: "typescript",
    workloadRevision: 1,
    suiteID: SelfImprovementLifecycle.SuiteID.create(),
    suiteRevision: 1,
    baselineID: SelfImprovementLifecycle.BaselineID.create(),
    state: "open",
    trustedProducerIDs: ["evaluator"],
    acceptanceStart: 1,
    acceptanceEnd: 2,
    cutoffAt: 3,
    requestDigest: digest,
    createdAt: 1,
  } as const
  const decoded = decode(SelfImprovementEvaluation.EvaluationRun, run)
  expect(decoded).toEqual(run)
  expect(Schema.encodeUnknownSync(SelfImprovementEvaluation.EvaluationRun)(decoded)).toEqual(run)
  for (const field of [
    "locationID",
    "versionID",
    "stage",
    "workloadRevision",
    "suiteRevision",
    "baselineID",
    "trustedProducerIDs",
    "requestDigest",
    "createdAt",
  ] as const) {
    expect(() => decode(SelfImprovementEvaluation.EvaluationRun, { ...run, [field]: undefined })).toThrow()
  }
})

test("evaluation runs enforce ordered windows and state-specific decision fields", () => {
  const run = {
    id: SelfImprovementLifecycle.EvaluationRunID.create(),
    locationID,
    versionID: SelfImprovementLifecycle.ArtifactVersionID.create(),
    stage: "shadow",
    workload: "typescript",
    workloadRevision: 1,
    suiteID: SelfImprovementLifecycle.SuiteID.create(),
    suiteRevision: 1,
    baselineID: SelfImprovementLifecycle.BaselineID.create(),
    state: "open",
    trustedProducerIDs: ["evaluator"],
    acceptanceStart: 1,
    acceptanceEnd: 2,
    cutoffAt: 3,
    requestDigest: digest,
    createdAt: 1,
  } as const
  expect(decode(SelfImprovementEvaluation.EvaluationRun, run)).toEqual(run)
  expect(
    decode(SelfImprovementEvaluation.EvaluationRun, {
      ...run,
      state: "deciding",
      cutoffSampleSetDigest: digest,
    }),
  ).toEqual({ ...run, state: "deciding", cutoffSampleSetDigest: digest })
  expect(
    decode(SelfImprovementEvaluation.EvaluationRun, {
      ...run,
      state: "decided",
      cutoffSampleSetDigest: digest,
      decidedAt: 4,
    }),
  ).toEqual({ ...run, state: "decided", cutoffSampleSetDigest: digest, decidedAt: 4 })
  expect(decode(SelfImprovementEvaluation.EvaluationRun, { ...run, state: "cancelled" })).toEqual({
    ...run,
    state: "cancelled",
  })
  for (const invalid of [
    { ...run, acceptanceStart: 3, acceptanceEnd: 2 },
    { ...run, acceptanceEnd: 4, cutoffAt: 3 },
    { ...run, cutoffSampleSetDigest: digest },
    { ...run, decidedAt: 4 },
    { ...run, state: "deciding" },
    { ...run, state: "deciding", cutoffSampleSetDigest: digest, decidedAt: 4 },
    { ...run, state: "decided", decidedAt: 4 },
    { ...run, state: "decided", cutoffSampleSetDigest: digest },
    { ...run, state: "cancelled", cutoffSampleSetDigest: digest },
    { ...run, state: "cancelled", decidedAt: 4 },
  ]) {
    expect(() => decode(SelfImprovementEvaluation.EvaluationRun, invalid)).toThrow()
  }
})

test("evaluation records remain constructable checked classes", () => {
  const run = {
    id: SelfImprovementLifecycle.EvaluationRunID.create(),
    locationID,
    versionID: SelfImprovementLifecycle.ArtifactVersionID.create(),
    stage: "shadow",
    workload: "typescript",
    workloadRevision: 1,
    suiteID: SelfImprovementLifecycle.SuiteID.create(),
    suiteRevision: 1,
    baselineID: SelfImprovementLifecycle.BaselineID.create(),
    state: "open" as const,
    trustedProducerIDs: ["evaluator"],
    acceptanceStart: 1,
    acceptanceEnd: 2,
    cutoffAt: 3,
    requestDigest: digest,
    createdAt: 1,
  }
  const sample = {
    id: SelfImprovementLifecycle.MetricSampleID.create(),
    runID: run.id,
    sampleIDDigest: digest,
    taskIDDigest: digest,
    producerID: "evaluator",
    requestDigest: digest,
    metrics: zeroMetrics,
    outcome: "success" as const,
    startedAt: 1,
    terminalAt: 2,
  }
  const decodedRun = Schema.decodeUnknownSync(SelfImprovementEvaluation.EvaluationRun)(run)
  const decodedSample = Schema.decodeUnknownSync(SelfImprovementEvaluation.MetricSample)(sample)
  expect(new SelfImprovementEvaluation.EvaluationRun(decodedRun)).toBeInstanceOf(
    SelfImprovementEvaluation.EvaluationRun,
  )
  expect(new SelfImprovementEvaluation.MetricSample(decodedSample)).toBeInstanceOf(
    SelfImprovementEvaluation.MetricSample,
  )
  expect(decodedRun).toBeInstanceOf(SelfImprovementEvaluation.EvaluationRun)
  expect(decodedSample).toBeInstanceOf(SelfImprovementEvaluation.MetricSample)
})

test("samples and findings bind exact outcomes, IDs, and gate order", () => {
  const runID = SelfImprovementLifecycle.EvaluationRunID.create()
  const sample = {
    id: SelfImprovementLifecycle.MetricSampleID.create(),
    runID,
    sampleIDDigest: digest,
    taskIDDigest: digest,
    producerID: "evaluator",
    requestDigest: digest,
    metrics: zeroMetrics,
    outcome: "success",
    startedAt: 1,
    terminalAt: 2,
  }
  expect(decode(SelfImprovementEvaluation.MetricSample, sample)).toEqual(sample)
  expect(() => decode(SelfImprovementEvaluation.MetricSample, { ...sample, startedAt: 3, terminalAt: 2 })).toThrow()
  const finding = {
    id: SelfImprovementLifecycle.GateFindingID.create(),
    evaluationRunID: runID,
    order: 1,
    gateID: "candidate-name-available",
    result: "pass",
    code: "ok",
  } as const
  const decoded = decode(SelfImprovementEvaluation.GateFinding, finding)
  expect(decoded).toEqual(finding)
  expect(Schema.encodeUnknownSync(SelfImprovementEvaluation.GateFinding)(decoded)).toEqual(finding)
  expect(() => decode(SelfImprovementEvaluation.GateFinding, { ...finding, order: 2 })).toThrow()
  expect(() => decode(SelfImprovementEvaluation.GateFinding, { ...finding, result: undefined })).toThrow()
})

test("evaluation decisions constrain reward and retain an optional exact approval binding", () => {
  const runID = SelfImprovementLifecycle.EvaluationRunID.create()
  const findings = SelfImprovementEvaluation.GateIDs.map((gateID, index) => ({
    id: SelfImprovementLifecycle.GateFindingID.create(),
    evaluationRunID: runID,
    order: index + 1,
    gateID,
    result: "pass" as const,
    code: "ok",
  }))
  const decision = {
    runID,
    cutoffSampleSetDigest: digest,
    findings,
    metricTotals: zeroTotals,
    aggregates: zeroAggregates,
    aggregateReward: 0,
    decision: "failed",
    decidedAt: 4,
  } as const
  const decoded = decode(SelfImprovementEvaluation.EvaluationDecision, decision)
  expect(decoded).toEqual(decision)
  expect(Schema.encodeUnknownSync(SelfImprovementEvaluation.EvaluationDecision)(decoded)).toEqual(decision)
  for (const invalidFindings of [
    findings.slice(1),
    findings.with(0, findings[1]).with(1, findings[0]),
    findings.with(1, findings[0]),
    findings.with(1, { ...findings[1], id: findings[0].id }),
    findings.with(0, {
      ...findings[0],
      evaluationRunID: SelfImprovementLifecycle.EvaluationRunID.create(),
    }),
  ]) {
    expect(() =>
      decode(SelfImprovementEvaluation.EvaluationDecision, { ...decision, findings: invalidFindings }),
    ).toThrow()
  }
  for (const aggregateReward of [-1, 1]) {
    expect(decode(SelfImprovementEvaluation.EvaluationDecision, { ...decision, aggregateReward })).toEqual({
      ...decision,
      aggregateReward,
    })
  }
  for (const aggregateReward of [-1.01, 1.01, Number.NaN]) {
    expect(() => decode(SelfImprovementEvaluation.EvaluationDecision, { ...decision, aggregateReward })).toThrow()
  }
  const approvalBinding = {
    versionID: SelfImprovementLifecycle.ArtifactVersionID.create(),
    versionDigest: digest,
    suiteID: SelfImprovementLifecycle.SuiteID.create(),
    suiteRevision: 1,
    evaluationRunID: runID,
    shadowEvidenceDigest: digest,
  }
  expect(decode(SelfImprovementEvaluation.EvaluationDecision, { ...decision, approvalBinding })).toEqual({
    ...decision,
    approvalBinding,
  })
  expect(() =>
    decode(SelfImprovementEvaluation.EvaluationDecision, {
      ...decision,
      approvalBinding: { ...approvalBinding, evaluationRunID: undefined },
    }),
  ).toThrow()
  expect(() =>
    decode(SelfImprovementEvaluation.EvaluationDecision, {
      ...decision,
      approvalBinding: {
        ...approvalBinding,
        evaluationRunID: SelfImprovementLifecycle.EvaluationRunID.create(),
      },
    }),
  ).toThrow()
})

test("every exported evaluation schema has a stable unique identifier", () => {
  const schemas = [
    SelfImprovementEvaluation.Workload,
    SelfImprovementEvaluation.RunState,
    SelfImprovementEvaluation.TaskOutcome,
    SelfImprovementEvaluation.GateID,
    SelfImprovementEvaluation.RequiredGateSequence,
    SelfImprovementEvaluation.GateResult,
    SelfImprovementEvaluation.HigherIsBetterNonRegression,
    SelfImprovementEvaluation.LowerIsBetterNonRegression,
    SelfImprovementEvaluation.MaximumRatioThreshold,
    SelfImprovementEvaluation.PositiveAggregateRewardThreshold,
    SelfImprovementEvaluation.MetricThresholds,
    SelfImprovementEvaluation.GateThresholdTightening,
    SelfImprovementEvaluation.ArtifactGateOverride,
    SelfImprovementEvaluation.TaskQualityMetric,
    SelfImprovementEvaluation.CorrectnessMetric,
    SelfImprovementEvaluation.RepeatFixRateMetric,
    SelfImprovementEvaluation.PrecisionMetric,
    SelfImprovementEvaluation.LatencyMetric,
    SelfImprovementEvaluation.TokensPerSuccessMetric,
    SelfImprovementEvaluation.CacheHitRatioMetric,
    SelfImprovementEvaluation.MetricComponents,
    SelfImprovementEvaluation.MetricTotals,
    SelfImprovementEvaluation.MetricAggregates,
    SelfImprovementEvaluation.SuiteRevision,
    SelfImprovementEvaluation.Baseline,
    SelfImprovementEvaluation.EvaluationRun,
    SelfImprovementEvaluation.MetricSample,
    SelfImprovementEvaluation.GateFinding,
    SelfImprovementEvaluation.EvaluationDecision,
  ]
  const expected = schemas.map(
    (_, index) =>
      [
        "SelfImprovementEvaluation.Workload",
        "SelfImprovementEvaluation.RunState",
        "SelfImprovementEvaluation.TaskOutcome",
        "SelfImprovementEvaluation.GateID",
        "SelfImprovementEvaluation.RequiredGateSequence",
        "SelfImprovementEvaluation.GateResult",
        "SelfImprovementEvaluation.HigherIsBetterNonRegression",
        "SelfImprovementEvaluation.LowerIsBetterNonRegression",
        "SelfImprovementEvaluation.MaximumRatioThreshold",
        "SelfImprovementEvaluation.PositiveAggregateRewardThreshold",
        "SelfImprovementEvaluation.MetricThresholds",
        "SelfImprovementEvaluation.GateThresholdTightening",
        "SelfImprovementEvaluation.ArtifactGateOverride",
        "SelfImprovementEvaluation.TaskQualityMetric",
        "SelfImprovementEvaluation.CorrectnessMetric",
        "SelfImprovementEvaluation.RepeatFixRateMetric",
        "SelfImprovementEvaluation.PrecisionMetric",
        "SelfImprovementEvaluation.LatencyMetric",
        "SelfImprovementEvaluation.TokensPerSuccessMetric",
        "SelfImprovementEvaluation.CacheHitRatioMetric",
        "SelfImprovementEvaluation.MetricComponents",
        "SelfImprovementEvaluation.MetricTotals",
        "SelfImprovementEvaluation.MetricAggregates",
        "SelfImprovementEvaluation.SuiteRevision",
        "SelfImprovementEvaluation.Baseline",
        "SelfImprovementEvaluation.EvaluationRun",
        "SelfImprovementEvaluation.MetricSample",
        "SelfImprovementEvaluation.GateFinding",
        "SelfImprovementEvaluation.EvaluationDecision",
      ][index],
  )
  const identifiers = schemas.map((schema) => schema.ast.annotations?.identifier)
  expect(identifiers).toEqual(expected)
  expect(new Set(identifiers).size).toBe(expected.length)
})
