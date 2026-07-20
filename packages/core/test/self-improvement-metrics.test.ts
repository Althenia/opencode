import { expect, test } from "bun:test"
import { SelfImprovement, SelfImprovementEvaluation, SelfImprovementLifecycle } from "@opencode-ai/schema"
import { Hash } from "@opencode-ai/core/util/hash"
import { aggregate } from "@opencode-ai/core/self-improvement/metrics"

const runID = SelfImprovementLifecycle.EvaluationRunID.make("si_run_1")

const sample = (id: string, latencyMs: number, successfulTasks: 0 | 1) =>
  new SelfImprovementEvaluation.MetricSample({
    id: SelfImprovementLifecycle.MetricSampleID.make(id),
    runID,
    sampleIDDigest: SelfImprovement.Digest.make(Hash.sha256(id)),
    taskIDDigest: SelfImprovement.Digest.make(Hash.sha256(`task-${id}`)),
    producerID: SelfImprovementLifecycle.PrincipalID.make("producer"),
    requestDigest: SelfImprovement.Digest.make(Hash.sha256(`request-${id}`)),
    metrics: new SelfImprovementEvaluation.MetricComponents({
      taskQuality: { earnedAllowlistedPoints: 1, possibleAllowlistedPoints: 2 },
      correctness: { passedRequiredChecks: 2, requiredChecks: 2 },
      repeatFixRate: { repeatedTasks: 0, completedTasks: 1 },
      precision: { acceptedRelevantItems: 1, assessedItems: 1 },
      latencyMs,
      tokensPerSuccess: new SelfImprovementEvaluation.TokensPerSuccessMetric({
        inputTokens: 10,
        outputTokens: 5,
        successfulTasks,
      }),
      cacheHitRatio: { cacheReadTokens: 2, cacheEligibleTokens: 4 },
    }),
    outcome: successfulTasks === 1 ? "success" : "failure",
    startedAt: SelfImprovementLifecycle.TimestampMillis.make(1),
    terminalAt: SelfImprovementLifecycle.TimestampMillis.make(2),
  })

test("aggregates integer totals with lexical sample digest and nearest-rank P95", () => {
  const result = aggregate([sample("si_sam_b", 100, 0), sample("si_sam_a", 1, 1)])

  expect(result.orderedSampleIDDigest).toBe(SelfImprovement.Digest.make(Hash.sha256("si_sam_a\0si_sam_b")))
  expect(result.totals).toMatchObject({
    taskQualityEarnedAllowlistedPoints: 2,
    taskQualityPossibleAllowlistedPoints: 4,
    correctnessPassedRequiredChecks: 4,
    correctnessRequiredChecks: 4,
    repeatFixRepeatedTasks: 0,
    repeatFixCompletedTasks: 2,
    precisionAcceptedRelevantItems: 2,
    precisionAssessedItems: 2,
    acceptedLatencySampleCount: 2,
    inputTokens: 20,
    outputTokens: 10,
    successfulTasks: 1,
    cacheReadTokens: 4,
    cacheEligibleTokens: 8,
  })
  expect(result.aggregates).toEqual({
    taskQuality: 0.5,
    correctness: 1,
    repeatFixRate: 0,
    precision: 1,
    latencyP95Ms: 100,
    tokensPerSuccess: 30,
    cacheHitRatio: 0.5,
  })
})
