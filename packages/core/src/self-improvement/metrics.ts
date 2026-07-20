export * as SelfImprovementMetrics from "./metrics"

import { SelfImprovement, SelfImprovementEvaluation } from "@opencode-ai/schema"
import { Hash } from "../util/hash"

export const aggregate = (samples: ReadonlyArray<SelfImprovementEvaluation.MetricSample>) => {
  const totals = samples.reduce(
    (totals, sample) => ({
      taskQualityEarnedAllowlistedPoints:
        totals.taskQualityEarnedAllowlistedPoints + sample.metrics.taskQuality.earnedAllowlistedPoints,
      taskQualityPossibleAllowlistedPoints:
        totals.taskQualityPossibleAllowlistedPoints + sample.metrics.taskQuality.possibleAllowlistedPoints,
      correctnessPassedRequiredChecks:
        totals.correctnessPassedRequiredChecks + sample.metrics.correctness.passedRequiredChecks,
      correctnessRequiredChecks: totals.correctnessRequiredChecks + sample.metrics.correctness.requiredChecks,
      repeatFixRepeatedTasks: totals.repeatFixRepeatedTasks + sample.metrics.repeatFixRate.repeatedTasks,
      repeatFixCompletedTasks: totals.repeatFixCompletedTasks + sample.metrics.repeatFixRate.completedTasks,
      precisionAcceptedRelevantItems:
        totals.precisionAcceptedRelevantItems + sample.metrics.precision.acceptedRelevantItems,
      precisionAssessedItems: totals.precisionAssessedItems + sample.metrics.precision.assessedItems,
      acceptedLatencySampleCount: totals.acceptedLatencySampleCount + 1,
      inputTokens: totals.inputTokens + sample.metrics.tokensPerSuccess.inputTokens,
      outputTokens: totals.outputTokens + sample.metrics.tokensPerSuccess.outputTokens,
      successfulTasks: totals.successfulTasks + sample.metrics.tokensPerSuccess.successfulTasks,
      cacheReadTokens: totals.cacheReadTokens + sample.metrics.cacheHitRatio.cacheReadTokens,
      cacheEligibleTokens: totals.cacheEligibleTokens + sample.metrics.cacheHitRatio.cacheEligibleTokens,
    }),
    {
      taskQualityEarnedAllowlistedPoints: 0,
      taskQualityPossibleAllowlistedPoints: 0,
      correctnessPassedRequiredChecks: 0,
      correctnessRequiredChecks: 0,
      repeatFixRepeatedTasks: 0,
      repeatFixCompletedTasks: 0,
      precisionAcceptedRelevantItems: 0,
      precisionAssessedItems: 0,
      acceptedLatencySampleCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      successfulTasks: 0,
      cacheReadTokens: 0,
      cacheEligibleTokens: 0,
    },
  )
  const orderedSampleIDDigest = SelfImprovement.Digest.make(
    Hash.sha256(
      samples
        .map((sample) => sample.id)
        .sort()
        .join("\0"),
    ),
  )
  const latencySampleSetDigest = SelfImprovement.Digest.make(
    Hash.sha256(
      samples
        .map((sample) => String(sample.metrics.latencyMs))
        .sort((left, right) => Number(left) - Number(right))
        .join("\0"),
    ),
  )
  const latencies = samples.map((sample) => sample.metrics.latencyMs).sort((left, right) => left - right)
  const divide = (numerator: number, denominator: number) => (denominator === 0 ? 0 : numerator / denominator)
  const totalsWithDigest = { ...totals, latencySampleSetDigest }

  return {
    orderedSampleIDDigest,
    totals: totalsWithDigest,
    aggregates: new SelfImprovementEvaluation.MetricAggregates({
      taskQuality: divide(totals.taskQualityEarnedAllowlistedPoints, totals.taskQualityPossibleAllowlistedPoints),
      correctness: divide(totals.correctnessPassedRequiredChecks, totals.correctnessRequiredChecks),
      repeatFixRate: divide(totals.repeatFixRepeatedTasks, totals.repeatFixCompletedTasks),
      precision: divide(totals.precisionAcceptedRelevantItems, totals.precisionAssessedItems),
      latencyP95Ms: latencies[Math.ceil(0.95 * latencies.length) - 1] ?? 0,
      tokensPerSuccess: divide(totals.inputTokens + totals.outputTokens, totals.successfulTasks),
      cacheHitRatio: divide(totals.cacheReadTokens, totals.cacheEligibleTokens),
    }),
  }
}
