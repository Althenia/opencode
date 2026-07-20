import { expect, test } from "bun:test"
import { Clock, DateTime, Effect } from "effect"
import {
  Model,
  SelfImprovement,
  SelfImprovementApi,
  SelfImprovementEvaluation,
  SelfImprovementLearning,
  SelfImprovementLifecycle,
} from "@opencode-ai/schema"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProjectV2 } from "@opencode-ai/core/project"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { SessionV2 } from "@opencode-ai/core/session"
import { SelfImprovementEvaluationStore } from "@opencode-ai/core/self-improvement/evaluation-store"
import { SelfImprovementGeneration } from "@opencode-ai/core/self-improvement/generation"
import { SelfImprovementLearningStore } from "@opencode-ai/core/self-improvement/learning-store"
import { SelfImprovementLifecycleWorkflow } from "@opencode-ai/core/self-improvement/lifecycle-workflow"
import { SelfImprovementMetrics } from "@opencode-ai/core/self-improvement/metrics"
import { SelfImprovementPrivateArtifactCommand } from "@opencode-ai/core/self-improvement/private-artifact-command"
import { SelfImprovementPrivateEvidenceCommand } from "@opencode-ai/core/self-improvement/private-evidence-command"
import { SelfImprovementPrivateQuery } from "@opencode-ai/core/self-improvement/private-query"
import { Routing } from "@opencode-ai/core/self-improvement/routing"
import { Hash } from "@opencode-ai/core/util/hash"
import { selfImprovementFixture } from "../fixture/self-improvement"

type Fixture = Awaited<ReturnType<typeof selfImprovementFixture>>

const revision = SelfImprovementLifecycle.Revision.make(1)
const workload = SelfImprovementEvaluation.Workload.make("e2e-promotion")
const digest = (value: string) => SelfImprovement.Digest.make(Hash.sha256(value))
const proposal = (name: string, content: string) =>
  new TextEncoder().encode(
    JSON.stringify({ kind: "skill", name, definition: { description: name, content }, references: [] }),
  )
const manifest = new SelfImprovementLifecycle.CapabilityManifest({
  toolIDs: [],
  filesystemScopeIDs: [],
  networkOriginIDs: [],
  modelRoutes: [],
  childAgentTargets: [],
  artifactReferences: [],
  denies: [],
})
const route = (id: string): Model.Ref => ({
  providerID: ProviderV2.ID.make("provider"),
  id: ModelV2.ID.make(id),
  variant: ModelV2.VariantID.make("configured"),
})
const session = (location: SessionV2.Info["location"], id: string) =>
  SessionV2.Info.make({
    id: SessionV2.ID.make(`ses_${id}`),
    projectID: ProjectV2.ID.global,
    title: id,
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: DateTime.makeUnsafe(0), updated: DateTime.makeUnsafe(0) },
    location,
  })
const metrics = (passing: boolean) =>
  new SelfImprovementEvaluation.MetricComponents({
    taskQuality: { earnedAllowlistedPoints: passing ? 1 : 0, possibleAllowlistedPoints: 1 },
    correctness: { passedRequiredChecks: passing ? 1 : 0, requiredChecks: 1 },
    repeatFixRate: { repeatedTasks: passing ? 0 : 1, completedTasks: 1 },
    precision: { acceptedRelevantItems: passing ? 1 : 0, assessedItems: 1 },
    latencyMs: passing ? 1 : 2,
    tokensPerSuccess: new SelfImprovementEvaluation.TokensPerSuccessMetric({
      inputTokens: 1,
      outputTokens: 1,
      successfulTasks: 1,
    }),
    cacheHitRatio: { cacheReadTokens: passing ? 1 : 0, cacheEligibleTokens: 1 },
  })

const principal = (fixture: Fixture, kind: SelfImprovementLifecycle.PrincipalKind, id: string) =>
  new SelfImprovementLifecycle.Principal({
    id: SelfImprovementLifecycle.PrincipalID.make(id),
    kind,
    locationID: fixture.locationID,
  })

async function generateSkill(fixture: Fixture, name: string, pattern: string) {
  const now = SelfImprovementLifecycle.TimestampMillis.make(await fixture.run(Clock.currentTimeMillis))
  const observer = principal(fixture, "runtime-evidence-service", `${pattern}-observer`)
  const observations: SelfImprovementApi.CreateObservationResponse[] = []
  for (let index = 0; index < 3; index++) {
    observations.push(
      await fixture.run(
        SelfImprovementPrivateEvidenceCommand.Service.use((command) =>
          command.createObservation(
            {
              principal: observer,
              locationID: fixture.locationID,
              now,
              idempotencyKey: SelfImprovementLearning.IdempotencyKey.make(`${pattern}-observation-${index}`),
            },
            new SelfImprovementApi.CreateObservationRequest({
              workload,
              workloadRevision: revision,
              errorClass: pattern,
              orderedToolSymbolIDs: ["generation-tool"],
              outcomeClass: "failure",
              taskIDDigest: digest(`${pattern}/task/${index}`),
            }),
          ),
        ),
      ),
    )
  }
  const latest = observations.at(-1)
  if (latest === undefined) throw new Error("Expected generation observations")
  expect(latest.matchingCount).toBe(3)
  expect(latest.generationEligible).toBe(true)

  const lease = await fixture.run(
    SelfImprovementGeneration.Service.use((generation) =>
      generation.generate({
        principal: principal(fixture, "coordinator", `${pattern}-generator`),
        pattern: {
          patternDigest: latest.observation.patternDigest,
          workload: latest.observation.workload,
          workloadRevision: latest.observation.workloadRevision,
          errorClass: latest.observation.errorClass,
          orderedToolSymbolDigest: latest.observation.orderedToolSymbolDigest,
          outcomeClass: latest.observation.outcomeClass,
        },
        now,
      }),
    ),
  )
  expect(lease.outcome).toBe("admitted")

  const artifacts = await fixture.run(
    SelfImprovementPrivateQuery.Service.use((query) =>
      query.listArtifacts({
        locationID: fixture.locationID,
        kind: "skill",
        namePrefix: SelfImprovement.CandidateName.make(name),
        limit: 100,
      }),
    ),
  )
  const artifact = artifacts.items.find((item) => item.key.name === name)
  if (artifact === undefined) throw new Error(`Expected generated artifact ${name}`)
  const versions = await fixture.run(
    SelfImprovementPrivateQuery.Service.use((query) =>
      query.listVersions({ locationID: fixture.locationID, artifactID: artifact.id, limit: 100 }),
    ),
  )
  const version = versions.items[0]
  if (version === undefined) throw new Error(`Expected generated version for ${name}`)
  return { artifact, version, lease }
}

async function setupBaseline(fixture: Fixture, name: string) {
  const now = SelfImprovementLifecycle.TimestampMillis.make(await fixture.run(Clock.currentTimeMillis))
  const suiteID = SelfImprovementLifecycle.SuiteID.make(`si_sui_${name}`)
  const baselineID = SelfImprovementLifecycle.BaselineID.make(`si_bas_${name}`)
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
            controlSource: "e2e-control",
            acceptanceStart: now,
            acceptanceEnd: now,
            cutoffAt: now,
            uniqueSampleCount: 20,
            orderedSampleIDDigest: digest(`${name}/baseline-samples`),
            metricTotals: {
              taskQualityEarnedAllowlistedPoints: 19,
              taskQualityPossibleAllowlistedPoints: 20,
              correctnessPassedRequiredChecks: 19,
              correctnessRequiredChecks: 20,
              repeatFixRepeatedTasks: 1,
              repeatFixCompletedTasks: 20,
              precisionAcceptedRelevantItems: 19,
              precisionAssessedItems: 20,
              acceptedLatencySampleCount: 20,
              latencySampleSetDigest: digest(`${name}/baseline-latency`),
              inputTokens: 20,
              outputTokens: 40,
              successfulTasks: 20,
              cacheReadTokens: 10,
              cacheEligibleTokens: 20,
            },
            aggregates: new SelfImprovementEvaluation.MetricAggregates({
              taskQuality: 0.95,
              correctness: 0.95,
              repeatFixRate: 0.05,
              precision: 0.95,
              latencyP95Ms: 2,
              tokensPerSuccess: 3,
              cacheHitRatio: 0.5,
            }),
            createdAt: now,
            evaluatorSignatureDigest: digest(`${name}/baseline-signature`),
            bootstrapAuthorityID: fixture.principal.id,
          }),
        )
      }),
    ),
  )
  return { baselineID, now, suiteID }
}

async function createCandidate(
  fixture: Fixture,
  artifactID: SelfImprovementLifecycle.ArtifactID,
  name: string,
  content: string,
) {
  const artifact = await fixture.getArtifact(artifactID)
  const now = SelfImprovementLifecycle.TimestampMillis.make(await fixture.run(Clock.currentTimeMillis))
  const created = await fixture.run(
    SelfImprovementPrivateArtifactCommand.Service.use((command) =>
      command.createVersion({
        locationID: fixture.locationID,
        principal: fixture.principal,
        request: new SelfImprovementApi.CreateVersionRequest({
          artifactID,
          proposalBytes: proposal(name, content),
          behaviorClass: "instruction-only",
          capabilityManifest: manifest,
          expectedRevision: artifact.artifact.revision,
        }),
        idempotencyKey: SelfImprovementLearning.IdempotencyKey.make(`create-version-${name}`),
        now,
      }),
    ),
  )
  if (!(created.response.body instanceof SelfImprovementApi.CreateVersionResponse))
    throw new Error("Expected created version")
  return created.response.body.version
}

async function prepareShadow(
  fixture: Fixture,
  artifactID: SelfImprovementLifecycle.ArtifactID,
  versionID: SelfImprovementLifecycle.ArtifactVersionID,
  name: string,
) {
  const now = SelfImprovementLifecycle.TimestampMillis.make(await fixture.run(Clock.currentTimeMillis))
  await fixture.run(
    SelfImprovementLifecycleWorkflow.Service.use((workflow) =>
      workflow.prepareShadow({
        locationID: fixture.locationID,
        principal: principal(fixture, "coordinator", `${name}-coordinator`),
        artifactID,
        versionID,
        now,
        idempotencyKey: SelfImprovementLearning.IdempotencyKey.make(`${name}-prepare-shadow`),
      }),
    ),
  )
}

async function decide(
  fixture: Fixture,
  input: {
    readonly baselineID: SelfImprovementLifecycle.BaselineID
    readonly suiteID: SelfImprovementLifecycle.SuiteID
    readonly versionID: SelfImprovementLifecycle.ArtifactVersionID
    readonly stage: "shadow" | "canary"
    readonly name: string
    readonly passing: boolean
  },
) {
  const now = SelfImprovementLifecycle.TimestampMillis.make(await fixture.run(Clock.currentTimeMillis))
  const runKey = `${input.name}-${input.stage}`
  const evidence = principal(fixture, "runtime-evidence-service", `${input.name}-evidence`)
  const run = await fixture.run(
    SelfImprovementPrivateEvidenceCommand.Service.use((command) =>
      command.createMetricRun(
        {
          principal: evidence,
          locationID: fixture.locationID,
          now,
          idempotencyKey: SelfImprovementLearning.IdempotencyKey.make(`${runKey}-run`),
        },
        new SelfImprovementApi.CreateMetricRunRequest({
          versionID: input.versionID,
          stage: input.stage,
          suiteID: input.suiteID,
          suiteRevision: revision,
          workload,
          workloadRevision: revision,
          baselineID: input.baselineID,
          acceptanceStart: now,
          acceptanceEnd: now,
          cutoffAt: now,
          requestDigest: digest(`${input.name}/run`),
        }),
      ),
    ),
  )
  const count = input.stage === "shadow" ? 10 : 20
  await fixture.run(
    SelfImprovementPrivateEvidenceCommand.Service.use((command) =>
      Effect.forEach(
        Array.from({ length: count }, (_, index) => index),
        (index) =>
          command.addMetricSample(
            {
              principal: evidence,
              locationID: fixture.locationID,
              now,
              idempotencyKey: SelfImprovementLearning.IdempotencyKey.make(`${runKey}-sample-${index}`),
            },
            new SelfImprovementApi.AddMetricSampleRequest({
              runID: run.id,
              sampleIDDigest: digest(`${input.name}/sample/${index}`),
              taskIDDigest: digest(`${input.name}/task/${index}`),
              metrics: metrics(input.passing),
              outcome: input.passing ? "success" : "failure",
              startedAt: now,
              terminalAt: now,
              requestDigest: digest(`${input.name}/request/${index}`),
            }),
          ),
      ),
    ),
  )
  const samples = await fixture.run(
    SelfImprovementPrivateQuery.Service.use((query) =>
      query.listMetricRuns({
        locationID: fixture.locationID,
        versionID: input.versionID,
        stage: input.stage,
        includeSamples: true,
        limit: 1,
      }),
    ),
  )
  const accepted = samples.items[0]?.samples
  if (accepted === undefined) throw new Error("Expected accepted samples")
  return fixture.run(
    SelfImprovementPrivateEvidenceCommand.Service.use((command) =>
      command.decideMetricRun(
        {
          principal: principal(fixture, "evaluator", `${input.name}-evaluator`),
          locationID: fixture.locationID,
          now,
          idempotencyKey: SelfImprovementLearning.IdempotencyKey.make(`${runKey}-decision`),
        },
        new SelfImprovementApi.DecideMetricRunRequest({
          runID: run.id,
          cutoffSampleSetDigest: SelfImprovementMetrics.aggregate(accepted).orderedSampleIDDigest,
        }),
      ),
    ),
  )
}

async function bindRoutePull(fixture: Fixture, versionID: SelfImprovementLifecycle.ArtifactVersionID, name: string) {
  const arm = new SelfImprovementLearning.ModelRouteArm({
    id: SelfImprovementLifecycle.ModelRouteArmID.make(`si_arm_${name}`),
    locationID: fixture.locationID,
    route: route(name.includes("candidate") ? "role" : "recommended"),
    allowlistRevision: revision,
    active: true,
  })
  await fixture.run(SelfImprovementLearningStore.Service.use((learning) => learning.putModelRouteArm(arm)))
  const evaluated = await fixture.run(
    Routing.Service.use((routing) =>
      routing.evaluate({
        session: session(fixture.location, name),
        versionID,
        binding: { workload, workloadRevision: revision, roleDigest: digest(`${name}/role`) },
      }),
    ),
  )
  expect(evaluated.decision).toMatchObject({ pullEventID: expect.anything(), reasonCode: "eligible-evaluation" })
  return arm
}

async function promote(
  fixture: Fixture,
  input: {
    readonly artifactID: SelfImprovementLifecycle.ArtifactID
    readonly versionID: SelfImprovementLifecycle.ArtifactVersionID
    readonly baselineID: SelfImprovementLifecycle.BaselineID
    readonly suiteID: SelfImprovementLifecycle.SuiteID
    readonly name: string
  },
) {
  await prepareShadow(fixture, input.artifactID, input.versionID, input.name)
  expect((await decide(fixture, { ...input, stage: "shadow", passing: true })).decision.decision).toBe("passed")
  const arm = await bindRoutePull(fixture, input.versionID, input.name)
  expect((await decide(fixture, { ...input, stage: "canary", passing: true })).decision.decision).toBe("passed")
  await fixture.restart()
  await fixture.recoverPendingContext()
  return arm
}

test("promotes a generated candidate with a retained generated active predecessor through the real learning flow", async () => {
  await using fixture = await selfImprovementFixture({
    generatedModelBytes: new TextEncoder().encode(
      JSON.stringify({
        kind: "skill",
        name: "promotion-skill",
        definition: { description: "Promotion skill", content: "Use generated promotion instructions." },
        references: [],
      }),
    ),
  })
  const baseline = await setupBaseline(fixture, "promotion")
  await fixture.run(
    SelfImprovementLearningStore.Service.use((learning) =>
      learning.putGenerationArm(
        new SelfImprovementLearning.GenerationStrategyArm({
          id: SelfImprovementLifecycle.GenerationStrategyArmID.make("si_gsa_promotion"),
          locationID: fixture.locationID,
          strategyID: "json-skill",
          allowlistRevision: revision,
          active: true,
        }),
      ),
    ),
  )

  const previousGenerated = await generateSkill(fixture, "promotion-skill", "promotion-previous-pattern")
  const previousArm = await promote(fixture, {
    ...baseline,
    artifactID: previousGenerated.artifact.id,
    versionID: previousGenerated.version.id,
    name: "promotion-previous",
  })
  const candidateGenerated = await generateSkill(fixture, "promotion-skill", "promotion-candidate-pattern")
  expect(candidateGenerated.artifact.id).toBe(previousGenerated.artifact.id)
  expect(candidateGenerated.version.versionNumber).toBe(2)
  const candidateArm = await promote(fixture, {
    ...baseline,
    artifactID: candidateGenerated.artifact.id,
    versionID: candidateGenerated.version.id,
    name: "promotion-candidate",
  })

  const result = await fixture.getArtifact(previousGenerated.artifact.id)
  const previous = await fixture.run(
    SelfImprovementPrivateQuery.Service.use((query) =>
      query.getVersion({
        locationID: fixture.locationID,
        artifactID: previousGenerated.artifact.id,
        versionID: previousGenerated.version.id,
      }),
    ),
  )
  const candidateState = await fixture.run(
    SelfImprovementPrivateQuery.Service.use((query) =>
      query.getVersion({
        locationID: fixture.locationID,
        artifactID: candidateGenerated.artifact.id,
        versionID: candidateGenerated.version.id,
      }),
    ),
  )
  const learning = await fixture.run(
    SelfImprovementLearningStore.Service.use((store) => store.rebuild(fixture.locationID)),
  )
  const audit = await fixture.run(
    SelfImprovementPrivateQuery.Service.use((query) =>
      query.listAudit({ locationID: fixture.locationID, artifactID: previousGenerated.artifact.id, limit: 100 }),
    ),
  )

  expect(previous?.version.source).toBe("generated")
  expect(previous?.version.generated?.generationLeaseID).toBe(previousGenerated.lease.id)
  expect(candidateState?.version.source).toBe("generated")
  expect(candidateState?.version.generated?.generationLeaseID).toBe(candidateGenerated.lease.id)
  expect(result.activeProjection?.versionID).toBe(candidateGenerated.version.id)
  expect(candidateState?.stage).toBe("active")
  expect(previous?.stage).toBe("deprecated")
  expect(learning).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ armID: previousArm.id, cumulativeReward: 1 }),
      expect.objectContaining({ armID: candidateArm.id, cumulativeReward: 1 }),
    ]),
  )
  expect(audit.items.map((entry) => entry.eventType)).toEqual(
    expect.arrayContaining([
      "lifecycle.static-passed",
      "lifecycle.offline-passed",
      "lifecycle.shadow-started",
      "lifecycle.canary-passed",
      "context-change-applied",
    ]),
  )
})

test("rolls back a regressed canary after eligible shadow evidence while retaining active context and deactivating its arm", async () => {
  await using fixture = await selfImprovementFixture()
  const baseline = await setupBaseline(fixture, "rollback")
  const created = await fixture.createSkill({ name: "rollback-skill", content: "Previous active instructions." })
  await promote(fixture, {
    ...baseline,
    artifactID: created.artifact.id,
    versionID: created.version.id,
    name: "rollback-previous",
  })
  const candidate = await createCandidate(
    fixture,
    created.artifact.id,
    "rollback-skill",
    "Regressed candidate instructions.",
  )
  await prepareShadow(fixture, created.artifact.id, candidate.id, "rollback-candidate")
  expect(
    (
      await decide(fixture, {
        ...baseline,
        versionID: candidate.id,
        stage: "shadow",
        name: "rollback-shadow",
        passing: true,
      })
    ).decision.decision,
  ).toBe("passed")
  const arm = await bindRoutePull(fixture, candidate.id, "rollback-candidate")
  expect(
    (
      await decide(fixture, {
        ...baseline,
        versionID: candidate.id,
        stage: "canary",
        name: "rollback-canary",
        passing: false,
      })
    ).decision.decision,
  ).toBe("failed")
  await fixture.restart()
  await fixture.recoverPendingContext()

  const artifact = await fixture.getArtifact(created.artifact.id)
  const candidateState = await fixture.run(
    SelfImprovementPrivateQuery.Service.use((query) =>
      query.getVersion({ locationID: fixture.locationID, artifactID: created.artifact.id, versionID: candidate.id }),
    ),
  )
  const learning = await fixture.run(
    SelfImprovementLearningStore.Service.use((store) => store.rebuild(fixture.locationID)),
  )
  const audit = await fixture.run(
    SelfImprovementPrivateQuery.Service.use((query) =>
      query.listAudit({ locationID: fixture.locationID, artifactID: created.artifact.id, limit: 100 }),
    ),
  )

  expect(audit.items.map((entry) => entry.eventType)).not.toContain("context-finalization-blocked")
  expect(candidateState?.stage).toBe("deprecated")
  expect(artifact.activeProjection?.versionID).toBe(created.version.id)
  expect(artifact.canaryProjection).toBeUndefined()
  expect(learning).toEqual(
    expect.arrayContaining([expect.objectContaining({ armID: arm.id, cumulativeReward: -1, active: false })]),
  )
})
