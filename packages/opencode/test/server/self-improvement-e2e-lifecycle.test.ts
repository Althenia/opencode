import { expect, test } from "bun:test"
import { Clock, Effect } from "effect"
import {
  SelfImprovement,
  SelfImprovementApi,
  SelfImprovementEvaluation,
  SelfImprovementLifecycle,
} from "@opencode-ai/schema"
import { SelfImprovementEvaluationStore } from "@opencode-ai/core/self-improvement/evaluation-store"
import { SelfImprovementPrivateEvidenceCommand } from "@opencode-ai/core/self-improvement/private-evidence-command"
import { Hash } from "@opencode-ai/core/util/hash"
import { selfImprovementFixture } from "../fixture/self-improvement"

const digest = (value: string) => SelfImprovement.Digest.make(Hash.sha256(value))
const workload = SelfImprovementEvaluation.Workload.make("e2e")
const suiteID = SelfImprovementLifecycle.SuiteID.make("si_sui_e2e")
const baselineID = SelfImprovementLifecycle.BaselineID.make("si_bas_e2e")
const revision = SelfImprovementLifecycle.Revision.make(1)

const thresholds = new SelfImprovementEvaluation.MetricThresholds({
  taskQuality: new SelfImprovementEvaluation.HigherIsBetterNonRegression({ minimumDelta: 0 }),
  correctness: new SelfImprovementEvaluation.HigherIsBetterNonRegression({ minimumDelta: 0 }),
  repeatFixRate: new SelfImprovementEvaluation.LowerIsBetterNonRegression({ maximumDelta: 0 }),
  precision: new SelfImprovementEvaluation.HigherIsBetterNonRegression({ minimumDelta: 0 }),
  latency: new SelfImprovementEvaluation.MaximumRatioThreshold({ maximumRatio: 1.1 }),
  tokensPerSuccess: new SelfImprovementEvaluation.MaximumRatioThreshold({ maximumRatio: 1.1 }),
  cacheHitRatio: new SelfImprovementEvaluation.HigherIsBetterNonRegression({ minimumDelta: 0 }),
  aggregateReward: new SelfImprovementEvaluation.PositiveAggregateRewardThreshold({ minimumExclusive: 0 }),
})

const totals = {
  taskQualityEarnedAllowlistedPoints: 20,
  taskQualityPossibleAllowlistedPoints: 20,
  correctnessPassedRequiredChecks: 20,
  correctnessRequiredChecks: 20,
  repeatFixRepeatedTasks: 0,
  repeatFixCompletedTasks: 20,
  precisionAcceptedRelevantItems: 20,
  precisionAssessedItems: 20,
  acceptedLatencySampleCount: 20,
  latencySampleSetDigest: digest("latency"),
  inputTokens: 20,
  outputTokens: 20,
  successfulTasks: 20,
  cacheReadTokens: 20,
  cacheEligibleTokens: 20,
}

const aggregates = new SelfImprovementEvaluation.MetricAggregates({
  taskQuality: 1,
  correctness: 1,
  repeatFixRate: 0,
  precision: 1,
  latencyP95Ms: 1,
  tokensPerSuccess: 2,
  cacheHitRatio: 1,
})

test("rejects a metric run without the required baseline through the real evidence command", async () => {
  await using fixture = await selfImprovementFixture()
  const created = await fixture.createSkill({ name: "missing-baseline", content: "No baseline." })
  const now = SelfImprovementLifecycle.TimestampMillis.make(await fixture.run(Clock.currentTimeMillis))
  const evidencePrincipal = new SelfImprovementLifecycle.Principal({
    id: SelfImprovementLifecycle.PrincipalID.make("e2e-evidence"),
    kind: "runtime-evidence-service",
    locationID: fixture.locationID,
  })

  const result = await fixture.run(
    SelfImprovementPrivateEvidenceCommand.Service.use((command) =>
      command
        .createMetricRun(
          { principal: evidencePrincipal, locationID: fixture.locationID, now },
          new SelfImprovementApi.CreateMetricRunRequest({
            versionID: created.version.id,
            stage: "draft",
            suiteID,
            suiteRevision: revision,
            workload,
            workloadRevision: revision,
            baselineID,
            acceptanceStart: now,
            acceptanceEnd: now,
            cutoffAt: now,
            requestDigest: digest("missing-baseline-run"),
          }),
        )
        .pipe(Effect.flip),
    ),
  )

  expect(result._tag).toBe("SelfImprovementPrivateEvidenceCommand.NotFound")
})

test("seeds a baseline through the evaluation service", async () => {
  await using fixture = await selfImprovementFixture()
  const now = SelfImprovementLifecycle.TimestampMillis.make(await fixture.run(Clock.currentTimeMillis))

  await fixture.run(
    SelfImprovementEvaluationStore.Service.use((evaluation) =>
      Effect.gen(function* () {
        yield* evaluation.putSuiteRevision(
          new SelfImprovementEvaluation.SuiteRevision({
            locationID: fixture.locationID,
            suiteID,
            revision,
            workload,
            workloadRevision: revision,
            artifactKinds: ["skill"],
            orderedGates: SelfImprovementEvaluation.GateIDs,
            thresholds,
            shadowMinimumSamples: 10,
            canaryMinimumSamples: 20,
            creatorID: fixture.principal.id,
            createdAt: now,
          }),
        )
        yield* evaluation.bootstrapBaseline(
          new SelfImprovementEvaluation.Baseline({
            id: baselineID,
            locationID: fixture.locationID,
            workload,
            workloadRevision: revision,
            suiteID,
            suiteRevision: revision,
            producerAllowlistRevision: revision,
            controlSource: "e2e",
            acceptanceStart: now,
            acceptanceEnd: now,
            cutoffAt: now,
            uniqueSampleCount: 20,
            orderedSampleIDDigest: digest("baseline-samples"),
            metricTotals: totals,
            aggregates,
            createdAt: now,
            evaluatorSignatureDigest: digest("baseline-signature"),
            bootstrapAuthorityID: fixture.principal.id,
          }),
        )
      }),
    ),
  )
})
