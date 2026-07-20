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
import { SelfImprovementPrivateQuery } from "@opencode-ai/core/self-improvement/private-query"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProjectV2 } from "@opencode-ai/core/project"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { SessionV2 } from "@opencode-ai/core/session"
import { SelfImprovementCapability } from "@opencode-ai/core/self-improvement/capability"
import { SelfImprovementContracts } from "@opencode-ai/core/self-improvement/contracts"
import { SelfImprovementEvaluationStore } from "@opencode-ai/core/self-improvement/evaluation-store"
import { SelfImprovementGeneration } from "@opencode-ai/core/self-improvement/generation"
import { SelfImprovementLearningStore } from "@opencode-ai/core/self-improvement/learning-store"
import { SelfImprovementLifecycleWorkflow } from "@opencode-ai/core/self-improvement/lifecycle-workflow"
import { SelfImprovementMetrics } from "@opencode-ai/core/self-improvement/metrics"
import { SelfImprovementPrivateEvidenceCommand } from "@opencode-ai/core/self-improvement/private-evidence-command"
import { Routing } from "@opencode-ai/core/self-improvement/routing"
import { Hash } from "@opencode-ai/core/util/hash"
import { selfImprovementFixture } from "../fixture/self-improvement"

type Fixture = Awaited<ReturnType<typeof selfImprovementFixture>>

const digest = (value: string) => SelfImprovement.Digest.make(Hash.sha256(value))
const revision = SelfImprovementLifecycle.Revision.make(1)
const workload = SelfImprovementEvaluation.Workload.make("typescript")
const route = (id: string): Model.Ref => ({
  providerID: ProviderV2.ID.make("provider"),
  id: ModelV2.ID.make(id),
  variant: ModelV2.VariantID.make("configured"),
})
const session = (location: SessionV2.Info["location"], modelRoute?: Model.Ref) =>
  SessionV2.Info.make({
    id: SessionV2.ID.make("ses_e2e_learning"),
    projectID: ProjectV2.ID.global,
    title: "learning",
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: DateTime.makeUnsafe(0), updated: DateTime.makeUnsafe(0) },
    location,
    ...(modelRoute ? { model: modelRoute } : {}),
  })
const manifest = (overrides: Partial<SelfImprovementLifecycle.CapabilityManifest> = {}) =>
  new SelfImprovementLifecycle.CapabilityManifest({
    toolIDs: ["read"],
    filesystemScopeIDs: [],
    networkOriginIDs: [],
    modelRoutes: [],
    childAgentTargets: [],
    artifactReferences: [],
    denies: [],
    ...overrides,
  })

const metrics = new SelfImprovementEvaluation.MetricComponents({
  taskQuality: { earnedAllowlistedPoints: 1, possibleAllowlistedPoints: 1 },
  correctness: { passedRequiredChecks: 1, requiredChecks: 1 },
  repeatFixRate: { repeatedTasks: 0, completedTasks: 1 },
  precision: { acceptedRelevantItems: 1, assessedItems: 1 },
  latencyMs: 1,
  tokensPerSuccess: new SelfImprovementEvaluation.TokensPerSuccessMetric({
    inputTokens: 1,
    outputTokens: 1,
    successfulTasks: 1,
  }),
  cacheHitRatio: { cacheReadTokens: 1, cacheEligibleTokens: 1 },
})

const principal = (fixture: Fixture, kind: SelfImprovementLifecycle.PrincipalKind, id: string) =>
  new SelfImprovementLifecycle.Principal({
    id: SelfImprovementLifecycle.PrincipalID.make(id),
    kind,
    locationID: fixture.locationID,
  })

async function generateRoutingSkill(fixture: Fixture, pattern: string) {
  const now = SelfImprovementLifecycle.TimestampMillis.make(await fixture.run(Clock.currentTimeMillis))
  await fixture.run(
    SelfImprovementLearningStore.Service.use((learning) =>
      learning.putGenerationArm(
        new SelfImprovementLearning.GenerationStrategyArm({
          id: SelfImprovementLifecycle.GenerationStrategyArmID.make(`si_gsa_${pattern}`),
          locationID: fixture.locationID,
          strategyID: "json-skill",
          allowlistRevision: revision,
          active: true,
        }),
      ),
    ),
  )
  const observer = principal(fixture, "runtime-evidence-service", `${pattern}-observer`)
  let patternDigest: SelfImprovement.Digest | undefined
  for (let index = 0; index < 3; index++) {
    const observation = await fixture.run(
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
            orderedToolSymbolIDs: ["routing-generation-tool"],
            outcomeClass: "failure",
            taskIDDigest: digest(`${pattern}/task/${index}`),
          }),
        ),
      ),
    )
    patternDigest = observation.observation.patternDigest
    if (index === 2) {
      expect(observation.matchingCount).toBe(3)
      expect(observation.generationEligible).toBe(true)
    }
  }
  if (patternDigest === undefined) throw new Error("Expected a generated routing pattern")
  const lease = await fixture.run(
    SelfImprovementGeneration.Service.use((generation) =>
      generation.generate({
        principal: principal(fixture, "coordinator", `${pattern}-generator`),
        patternDigest,
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
        namePrefix: SelfImprovement.CandidateName.make("generated"),
        limit: 100,
      }),
    ),
  )
  const artifact = artifacts.items.find((item) => item.key.name === "generated")
  if (artifact === undefined) throw new Error("Expected generated routing skill")
  const versions = await fixture.run(
    SelfImprovementPrivateQuery.Service.use((query) =>
      query.listVersions({ locationID: fixture.locationID, artifactID: artifact.id, limit: 100 }),
    ),
  )
  const version = versions.items[0]
  if (version === undefined) throw new Error("Expected generated routing version")
  return { artifact, version, lease }
}

async function seedRecommendedRoute(fixture: Fixture, minimal = false) {
  if (minimal) {
    const created = await generateRoutingSkill(fixture, "routing-minimal")
    await fixture.run(
      SelfImprovementLearningStore.Service.use((learning) =>
        learning.putModelRouteArm(
          new SelfImprovementLearning.ModelRouteArm({
            id: SelfImprovementLifecycle.ModelRouteArmID.make("si_arm_e2e"),
            locationID: fixture.locationID,
            route: route("recommended"),
            allowlistRevision: revision,
            active: true,
          }),
        ),
      ),
    )
    const evaluated = await fixture.run(
      Routing.Service.use((router) =>
        router.evaluate({
          session: session(fixture.location),
          versionID: created.version.id,
          binding: { workload, workloadRevision: revision, roleDigest: digest("routing-role") },
        }),
      ),
    )
    expect(evaluated.decision).toMatchObject({ pullEventID: expect.anything(), reasonCode: "eligible-evaluation" })
    return
  }
  const now = SelfImprovementLifecycle.TimestampMillis.make(await fixture.run(Clock.currentTimeMillis))
  const suiteID = SelfImprovementLifecycle.SuiteID.make("si_sui_routing")
  const baselineID = SelfImprovementLifecycle.BaselineID.make("si_bas_routing")
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
            controlSource: "routing-control",
            acceptanceStart: now,
            acceptanceEnd: now,
            cutoffAt: now,
            uniqueSampleCount: 20,
            orderedSampleIDDigest: digest("routing/baseline-samples"),
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
              latencySampleSetDigest: digest("routing/baseline-latency"),
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
            evaluatorSignatureDigest: digest("routing/baseline-signature"),
            bootstrapAuthorityID: fixture.principal.id,
          }),
        )
      }),
    ),
  )
  const created = await generateRoutingSkill(fixture, "routing-lifecycle")
  await fixture.run(
    SelfImprovementLifecycleWorkflow.Service.use((workflow) =>
      workflow.prepareShadow({
        locationID: fixture.locationID,
        principal: principal(fixture, "coordinator", "routing-coordinator"),
        artifactID: created.artifact.id,
        versionID: created.version.id,
        now,
        idempotencyKey: SelfImprovementLearning.IdempotencyKey.make("routing-prepare-shadow"),
      }),
    ),
  )
  for (const stage of ["shadow", "canary"] as const) {
    const run = await fixture.run(
      SelfImprovementPrivateEvidenceCommand.Service.use((command) =>
        command.createMetricRun(
          {
            principal: principal(fixture, "runtime-evidence-service", `routing-${stage}-evidence`),
            locationID: fixture.locationID,
            now,
            idempotencyKey: SelfImprovementLearning.IdempotencyKey.make(`routing-${stage}-run`),
          },
          new SelfImprovementApi.CreateMetricRunRequest({
            versionID: created.version.id,
            stage,
            suiteID,
            suiteRevision: revision,
            workload,
            workloadRevision: revision,
            baselineID,
            acceptanceStart: now,
            acceptanceEnd: now,
            cutoffAt: now,
            requestDigest: digest(`routing/${stage}/run`),
          }),
        ),
      ),
    )
    await fixture.run(
      SelfImprovementPrivateEvidenceCommand.Service.use((command) =>
        Effect.forEach(
          Array.from({ length: stage === "shadow" ? 10 : 20 }, (_, index) => index),
          (index) =>
            command.addMetricSample(
              {
                principal: principal(fixture, "runtime-evidence-service", `routing-${stage}-evidence`),
                locationID: fixture.locationID,
                now,
                idempotencyKey: SelfImprovementLearning.IdempotencyKey.make(`routing-${stage}-sample-${index}`),
              },
              new SelfImprovementApi.AddMetricSampleRequest({
                runID: run.id,
                sampleIDDigest: digest(`routing/${stage}/sample/${index}`),
                taskIDDigest: digest(`routing/${stage}/task/${index}`),
                metrics,
                outcome: "success",
                startedAt: now,
                terminalAt: now,
                requestDigest: digest(`routing/${stage}/request/${index}`),
              }),
            ),
        ),
      ),
    )
    const samples = await fixture.run(
      SelfImprovementPrivateQuery.Service.use((query) =>
        query.listMetricRuns({
          locationID: fixture.locationID,
          versionID: created.version.id,
          stage,
          includeSamples: true,
          limit: 1,
        }),
      ),
    )
    const accepted = samples.items[0]?.samples
    if (accepted === undefined) throw new Error("Expected accepted samples")
    await fixture.run(
      SelfImprovementPrivateEvidenceCommand.Service.use((command) =>
        command.decideMetricRun(
          {
            principal: principal(fixture, "evaluator", `routing-${stage}-evaluator`),
            locationID: fixture.locationID,
            now,
            idempotencyKey: SelfImprovementLearning.IdempotencyKey.make(`routing-${stage}-decision`),
          },
          new SelfImprovementApi.DecideMetricRunRequest({
            runID: run.id,
            cutoffSampleSetDigest: SelfImprovementMetrics.aggregate(accepted).orderedSampleIDDigest,
          }),
        ),
      ),
    )
    if (stage === "shadow") {
      const arm = new SelfImprovementLearning.ModelRouteArm({
        id: SelfImprovementLifecycle.ModelRouteArmID.make("si_arm_e2e"),
        locationID: fixture.locationID,
        route: route("recommended"),
        allowlistRevision: revision,
        active: true,
      })
      await fixture.run(SelfImprovementLearningStore.Service.use((learning) => learning.putModelRouteArm(arm)))
      const evaluated = await fixture.run(
        Routing.Service.use((router) =>
          router.evaluate({
            session: session(fixture.location),
            versionID: created.version.id,
            binding: { workload, workloadRevision: revision, roleDigest: digest("routing-role") },
          }),
        ),
      )
      expect(evaluated.decision).toMatchObject({ pullEventID: expect.anything(), reasonCode: "eligible-evaluation" })
    }
  }
  await fixture.restart()
  await fixture.recoverPendingContext()
}

test("persists routing precedence evidence after policy catalog variant and credential materialization", async () => {
  await using fixture = await selfImprovementFixture({
    workloadBinding: {
      workload: SelfImprovementEvaluation.Workload.make("typescript"),
      workloadRevision: revision,
      roleDigest: digest("a"),
    },
  })
  const resolve = (input: { readonly session: SessionV2.Info; readonly roleRoute?: Model.Ref }) =>
    fixture.run(
      Effect.gen(function* () {
        const router = yield* Routing.Service
        return yield* router.resolve(input)
      }),
    )

  const cases = [
    {
      input: { session: session(fixture.location, route("session")), roleRoute: route("role") },
      id: "session",
      source: "session-user",
    },
    { input: { session: session(fixture.location), roleRoute: route("role") }, id: "role", source: "role" },
  ] as const
  const defaultResult = await resolve({ session: session(fixture.location) })
  expect(defaultResult.decision).toMatchObject({ precedenceSource: "catalog-default" })
  expect(String(defaultResult.route.id)).toBe("default")
  for (const item of cases) {
    const result = await resolve(item.input)
    expect(String(result.route.id)).toBe(item.id)
    expect(result.decision).toMatchObject({ precedenceSource: item.source, reasonCode: `eligible-${item.source}` })
  }

  const evidence = await fixture.run(
    SelfImprovementPrivateQuery.Service.use((query) =>
      query.listRoutingDecisions({ locationID: fixture.locationID, limit: 10 }),
    ),
  )
  expect(evidence.items.map((decision) => decision.precedenceSource).sort()).toEqual([
    "catalog-default",
    "role",
    "session-user",
  ])
  expect(Routing.inCanaryCohort("0".repeat(64), `${"0".repeat(63)}9`)).toBe(true)
  expect(Routing.inCanaryCohort("0".repeat(64), "0".repeat(64))).toBe(false)
})

test("evaluates the exact candidate route and records linked decision and pull evidence", async () => {
  await using fixture = await selfImprovementFixture({
    workloadBinding: { workload, workloadRevision: revision, roleDigest: digest("a") },
  })
  await seedRecommendedRoute(fixture, true)
  const evidence = await fixture.run(
    SelfImprovementPrivateQuery.Service.use((query) =>
      query.listRoutingDecisions({ locationID: fixture.locationID, limit: 10 }),
    ),
  )
  expect(evidence.items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ reasonCode: "eligible-evaluation", pullEventID: expect.anything() }),
    ]),
  )
})

test("persists catalog fallback routing evidence", async () => {
  await using fixture = await selfImprovementFixture({
    workloadBinding: { workload, workloadRevision: revision, roleDigest: digest("a") },
    routingDefault: "missing",
  })
  const result = await fixture.run(
    Routing.Service.use((router) => router.resolve({ session: session(fixture.location) })),
  )
  expect(result.decision).toMatchObject({ precedenceSource: "catalog-fallback" })
  expect(String(result.route.id)).toBe("fallback")
  const evidence = await fixture.run(
    SelfImprovementPrivateQuery.Service.use((query) =>
      query.listRoutingDecisions({ locationID: fixture.locationID, limit: 10 }),
    ),
  )
  expect(evidence.items.map((decision) => decision.precedenceSource)).toEqual(["catalog-fallback"])
})

test("fails closed for untyped multiple typed cross-location cyclic dynamic and envelope-excess capabilities", async () => {
  await using fixture = await selfImprovementFixture()
  const reference = new SelfImprovementLifecycle.TypedArtifactReference({
    kind: "workflow",
    name: SelfImprovement.CandidateName.make("shared"),
  })
  const cyclic = new SelfImprovementLifecycle.TypedArtifactReference({
    kind: "workflow",
    name: SelfImprovement.CandidateName.make("cycle"),
  })
  const findings = await fixture.run(
    Effect.forEach(
      [
        { name: "zero", manifest: manifest({ artifactReferences: [reference] }), resolve: () => [] },
        {
          name: "multiple",
          manifest: manifest({ artifactReferences: [reference] }),
          resolve: () => [
            { locationID: fixture.locationID, manifest: manifest() },
            { locationID: fixture.locationID, manifest: manifest() },
          ],
        },
        {
          name: "cross-location",
          manifest: manifest({ artifactReferences: [reference] }),
          resolve: () => [
            { locationID: SelfImprovementLifecycle.LocationID.make("b".repeat(64)), manifest: manifest() },
          ],
        },
        {
          name: "cycle",
          manifest: manifest({ artifactReferences: [cyclic] }),
          resolve: () => [{ locationID: fixture.locationID, manifest: manifest({ artifactReferences: [cyclic] }) }],
        },
        { name: "dynamic", manifest: manifest({ toolIDs: ["${write}"] }), resolve: () => [] },
      ],
      (item) =>
        SelfImprovementCapability.validateCapabilities({
          runID: SelfImprovementLifecycle.EvaluationRunID.make(`si_run_e2e_${item.name}`),
          manifest: item.manifest,
          locationID: fixture.locationID,
          known: { tools: ["read"], filesystemScopes: [], networkOrigins: [], childAgents: [], modelRoutes: [] },
          grant: manifest(),
          baseline: manifest(),
          taskEnvelope: manifest(),
          generated: true,
          adhoc: true,
          resolve: item.resolve,
        }).pipe(Effect.map((value) => [item.name, value] as const)),
    ),
  )
  for (const [, value] of findings)
    expect(value.find((finding) => finding.gateID === "capabilities-static-known")?.result).toBe("fail")
  const envelope = await fixture.run(
    SelfImprovementCapability.validateCapabilities({
      runID: SelfImprovementLifecycle.EvaluationRunID.make("si_run_e2e_envelope"),
      manifest: manifest({ toolIDs: ["read", "write"] }),
      locationID: fixture.locationID,
      known: { tools: ["read", "write"], filesystemScopes: [], networkOrigins: [], childAgents: [], modelRoutes: [] },
      grant: manifest({ toolIDs: ["read", "write"] }),
      baseline: manifest(),
      taskEnvelope: manifest(),
      generated: true,
      adhoc: true,
      resolve: () => [],
    }),
  )
  expect(envelope.filter((finding) => finding.result === "fail").map((finding) => finding.gateID)).toEqual([
    "generated-capabilities-within-baseline",
    "adhoc-capabilities-within-task-envelope",
  ])
})
