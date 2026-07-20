import { expect, test } from "bun:test"
import { Clock, DateTime, Duration, Effect, Schema } from "effect"
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
import { SelfImprovementContextStore } from "@opencode-ai/core/self-improvement/context-store"
import { SelfImprovementEvaluationStore } from "@opencode-ai/core/self-improvement/evaluation-store"
import { SelfImprovementLearningStore } from "@opencode-ai/core/self-improvement/learning-store"
import { SelfImprovementLifecycleWorkflow } from "@opencode-ai/core/self-improvement/lifecycle-workflow"
import { SelfImprovementMetrics } from "@opencode-ai/core/self-improvement/metrics"
import { SelfImprovementPrivateArtifactCommand } from "@opencode-ai/core/self-improvement/private-artifact-command"
import { SelfImprovementPrivateEvidenceCommand } from "@opencode-ai/core/self-improvement/private-evidence-command"
import { SelfImprovementPrivateQuery } from "@opencode-ai/core/self-improvement/private-query"
import { SelfImprovementTransitionStore } from "@opencode-ai/core/self-improvement/transition-store"
import { Routing } from "@opencode-ai/core/self-improvement/routing"
import { SystemContext } from "@opencode-ai/core/system-context"
import { SystemContextRegistry } from "@opencode-ai/core/system-context/registry"
import { Hash } from "@opencode-ai/core/util/hash"
import { selfImprovementFixture } from "../fixture/self-improvement"

const digest = (value: string) => SelfImprovement.Digest.make(Hash.sha256(value))
const revision = SelfImprovementLifecycle.Revision.make(1)
const workload = SelfImprovementEvaluation.Workload.make("recovery")
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

const metrics = () =>
  new SelfImprovementEvaluation.MetricComponents({
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
  latencySampleSetDigest: digest("l"),
  inputTokens: 20,
  outputTokens: 20,
  successfulTasks: 20,
  cacheReadTokens: 20,
  cacheEligibleTokens: 20,
}

const aggregates = new SelfImprovementEvaluation.MetricAggregates({
  taskQuality: 0.9,
  correctness: 0.9,
  repeatFixRate: 0.1,
  precision: 0.9,
  latencyP95Ms: 2,
  tokensPerSuccess: 2,
  cacheHitRatio: 0.9,
})

const principal = (
  fixture: Awaited<ReturnType<typeof selfImprovementFixture>>,
  kind: SelfImprovementLifecycle.Principal["kind"],
) =>
  new SelfImprovementLifecycle.Principal({
    id: SelfImprovementLifecycle.PrincipalID.make(`recovery-${kind}`),
    kind,
    locationID: fixture.locationID,
  })

async function setupCanary(fixture: Awaited<ReturnType<typeof selfImprovementFixture>>, name: string) {
  const created = await fixture.createSkill({ name, content: "Use recovery-safe instructions." })
  const now = SelfImprovementLifecycle.TimestampMillis.make(await fixture.run(Clock.currentTimeMillis))
  const coordinator = principal(fixture, "coordinator")
  await fixture.run(
    SelfImprovementLifecycleWorkflow.Service.use((workflow) =>
      workflow.prepareShadow({
        locationID: fixture.locationID,
        principal: coordinator,
        artifactID: created.artifact.id,
        versionID: created.version.id,
        now,
        idempotencyKey: SelfImprovementLearning.IdempotencyKey.make(`${name}-prepare-shadow`),
      }),
    ),
  )
  const suiteID = SelfImprovementLifecycle.SuiteID.make(`si_sui_${name}`)
  const baselineID = SelfImprovementLifecycle.BaselineID.make(`si_bas_${name}`)
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
            controlSource: "recovery-e2e",
            acceptanceStart: now,
            acceptanceEnd: now,
            cutoffAt: now,
            uniqueSampleCount: 20,
            orderedSampleIDDigest: digest("b"),
            metricTotals: totals,
            aggregates,
            createdAt: now,
            evaluatorSignatureDigest: digest("s"),
            bootstrapAuthorityID: fixture.principal.id,
          }),
        )
      }),
    ),
  )
  return { created, now, suiteID, baselineID }
}

async function decidePassedRun(
  fixture: Awaited<ReturnType<typeof selfImprovementFixture>>,
  input: Awaited<ReturnType<typeof setupCanary>>,
  stage: "shadow" | "canary",
  key: string,
) {
  const evidence = principal(fixture, "runtime-evidence-service")
  const evaluator = principal(fixture, "evaluator")
  const run = await fixture.run(
    SelfImprovementPrivateEvidenceCommand.Service.use((command) =>
      command.createMetricRun(
        {
          principal: evidence,
          locationID: fixture.locationID,
          now: input.now,
          idempotencyKey: SelfImprovementLearning.IdempotencyKey.make(`${key}-run`),
        },
        new SelfImprovementApi.CreateMetricRunRequest({
          versionID: input.created.version.id,
          stage,
          suiteID: input.suiteID,
          suiteRevision: revision,
          workload,
          workloadRevision: revision,
          baselineID: input.baselineID,
          acceptanceStart: input.now,
          acceptanceEnd: input.now,
          cutoffAt: input.now,
          requestDigest: digest(`${key}r`),
        }),
      ),
    ),
  )
  const samples = await Promise.all(
    Array.from({ length: 20 }, (_, index) =>
      fixture.run(
        SelfImprovementPrivateEvidenceCommand.Service.use((command) =>
          command.addMetricSample(
            {
              principal: evidence,
              locationID: fixture.locationID,
              now: input.now,
              idempotencyKey: SelfImprovementLearning.IdempotencyKey.make(`${key}-sample-${index}`),
            },
            new SelfImprovementApi.AddMetricSampleRequest({
              runID: run.id,
              sampleIDDigest: digest(`${key}${index}`),
              taskIDDigest: digest(`task${key}${index}`),
              metrics: metrics(),
              outcome: "success",
              startedAt: input.now,
              terminalAt: input.now,
              requestDigest: digest(`request${key}${index}`),
            }),
          ),
        ),
      ),
    ),
  )
  const cutoffSampleSetDigest = SelfImprovementMetrics.aggregate(
    samples.map((sample) => sample.sample),
  ).orderedSampleIDDigest
  return fixture.run(
    SelfImprovementPrivateEvidenceCommand.Service.use((command) =>
      command.decideMetricRun(
        {
          principal: evaluator,
          locationID: fixture.locationID,
          now: input.now,
          idempotencyKey: SelfImprovementLearning.IdempotencyKey.make(`${key}-decision`),
        },
        new SelfImprovementApi.DecideMetricRunRequest({ runID: run.id, cutoffSampleSetDigest }),
      ),
    ),
  )
}

async function evaluateRoute(
  fixture: Awaited<ReturnType<typeof selfImprovementFixture>>,
  input: Awaited<ReturnType<typeof setupCanary>>,
  name: string,
) {
  const arm = new SelfImprovementLearning.ModelRouteArm({
    id: SelfImprovementLifecycle.ModelRouteArmID.make(`si_arm_${name}`),
    locationID: fixture.locationID,
    route: route("recommended"),
    allowlistRevision: revision,
    active: true,
  })
  await fixture.run(SelfImprovementLearningStore.Service.use((learning) => learning.putModelRouteArm(arm)))
  const evaluated = await fixture.run(
    Routing.Service.use((routing) =>
      routing.evaluate({
        session: session(fixture.location, name),
        versionID: input.created.version.id,
        binding: { workload, workloadRevision: revision, roleDigest: digest(`${name}/role`) },
      }),
    ),
  )
  expect(evaluated.decision).toMatchObject({ pullEventID: expect.anything(), reasonCode: "eligible-evaluation" })
  return arm
}

test("recovers a real registry CAS conflict after restart and finalizes its transition and reward exactly once", async () => {
  await using fixture = await selfImprovementFixture()
  const setup = await setupCanary(fixture, "restart-context")
  await decidePassedRun(fixture, setup, "shadow", "restart-shadow")
  const arm = await evaluateRoute(fixture, setup, "restart-context")
  await decidePassedRun(fixture, setup, "canary", "restart-canary")

  const before = await fixture.run(
    Effect.all({
      context: SelfImprovementContextStore.Service,
      transitions: SelfImprovementTransitionStore.Service,
    }).pipe(
      Effect.flatMap(({ context, transitions }) =>
        Effect.all({
          outboxes: context.recoverable(setup.now),
          stage: transitions.currentStage({ locationID: fixture.locationID, versionID: setup.created.version.id }),
          active: context.desired({
            locationID: fixture.locationID,
            artifactID: setup.created.artifact.id,
            rolloutSlot: "active",
          }),
        }),
      ),
    ),
  )
  expect(before.stage).toBe("canary")
  expect(before.outboxes).toEqual([expect.objectContaining({ status: "pending", expectedStage: "canary" })])
  expect(before.active).toMatchObject({ desired: { state: "present", versionID: setup.created.version.id } })

  const conflict = await fixture.run(
    Effect.gen(function* () {
      const registry = yield* SystemContextRegistry.Service
      const contributionKey = SystemContext.Key.make(
        `self-improvement/${Hash.sha256(`${fixture.locationID}\0${setup.created.artifact.id}\0active`)}`,
      )
      const priorContext = SystemContext.make({
        key: SystemContext.Key.make("fixture/recovery-prior"),
        codec: Schema.toCodecJson(Schema.String),
        load: Effect.succeed("prior active context"),
        baseline: (value) => value,
        update: (_previous, current) => current,
      })
      const applied = yield* registry.compareAndSet({
        key: contributionKey,
        expectedRevision: SelfImprovementLifecycle.Revision.make(0),
        next: {
          revision: SelfImprovementLifecycle.Revision.make(1),
          digest: digest("registry-conflict"),
          context: priorContext,
        },
      })
      const loaded = yield* registry.load().pipe(Effect.flatMap(SystemContext.initialize))
      return { applied, loaded }
    }),
  )
  expect(conflict.applied.applied).toBe(true)
  expect(conflict.loaded.baseline).toContain("prior active context")
  expect(await fixture.recoverPendingContext()).toBe(0)

  const stalled = await fixture.run(
    Effect.gen(function* () {
      const context = yield* SelfImprovementContextStore.Service
      const transitions = yield* SelfImprovementTransitionStore.Service
      const learning = yield* SelfImprovementLearningStore.Service
      const registry = yield* SystemContextRegistry.Service
      return {
        stage: yield* transitions.currentStage({
          locationID: fixture.locationID,
          versionID: setup.created.version.id,
        }),
        outboxes: yield* context.recoverable(SelfImprovementLifecycle.TimestampMillis.make(Number.MAX_SAFE_INTEGER)),
        projection: yield* learning.rebuild(fixture.locationID),
        loaded: yield* registry.load().pipe(Effect.flatMap(SystemContext.initialize)),
      }
    }),
  )
  expect(stalled.stage).toBe("canary")
  expect(stalled.outboxes).toEqual([expect.objectContaining({ expectedStage: "canary" })])
  expect(stalled.loaded.baseline).toContain("prior active context")
  expect(stalled.projection).toEqual(
    expect.arrayContaining([expect.objectContaining({ armID: arm.id, rewardedPullTotal: 0, cumulativeReward: 0 })]),
  )

  await fixture.restart()
  expect(await fixture.recoverPendingContext()).toBe(0)
  await fixture.advance(Duration.minutes(6))
  expect(await fixture.recoverPendingContext()).toBe(1)
  expect(await fixture.recoverPendingContext()).toBe(0)
  const after = await fixture.run(
    Effect.gen(function* () {
      const query = yield* SelfImprovementPrivateQuery.Service
      const learning = yield* SelfImprovementLearningStore.Service
      return {
        artifact: yield* query.getArtifact({ locationID: fixture.locationID, artifactID: setup.created.artifact.id }),
        transitions: yield* query.listTransitions({
          locationID: fixture.locationID,
          versionID: setup.created.version.id,
          limit: 100,
        }),
        projection: yield* learning.rebuild(fixture.locationID),
      }
    }),
  )
  expect(after.artifact?.activeProjection?.versionID).toBe(setup.created.version.id)
  expect(after.transitions.items.filter((item) => item.event === "canary-passed")).toHaveLength(1)
  expect(after.projection).toEqual(
    expect.arrayContaining([expect.objectContaining({ armID: arm.id, rewardedPullTotal: 1, cumulativeReward: 1 })]),
  )
})

test("tombstone wins over concurrent canary promotion finalization", async () => {
  await using fixture = await selfImprovementFixture()
  const setup = await setupCanary(fixture, "tombstone-wins")
  await decidePassedRun(fixture, setup, "shadow", "tombstone-shadow")
  await fixture.recoverPendingContext()
  await evaluateRoute(fixture, setup, "tombstone-wins")
  const expectedRevision = (await fixture.getArtifact(setup.created.artifact.id)).artifact.revision
  const tombstone = (expectedRevision: SelfImprovementLifecycle.Revision) =>
    fixture.run(
      SelfImprovementPrivateArtifactCommand.Service.use((command) =>
        command.tombstoneArtifact({
          locationID: fixture.locationID,
          principal: fixture.principal,
          request: new SelfImprovementApi.TombstoneArtifactRequest({
            artifactID: setup.created.artifact.id,
            reason: "retention",
            expectedRevision,
          }),
          idempotencyKey: SelfImprovementLearning.IdempotencyKey.make("tombstone-wins"),
          now: setup.now,
        }),
      ),
    )
  await Promise.allSettled([decidePassedRun(fixture, setup, "canary", "tombstone-canary"), tombstone(expectedRevision)])
  const raced = await fixture.getArtifact(setup.created.artifact.id)
  if (raced.artifact.status !== "tombstoned") {
    const retried = await tombstone(raced.artifact.revision).catch((error) => error)
    if (retried instanceof SelfImprovementPrivateArtifactCommand.Failure)
      throw new Error(
        retried.response.body instanceof SelfImprovementApi.ApiError
          ? retried.response.body.message
          : "Tombstone failed",
      )
  }
  await fixture.recoverPendingContext()
  const artifact = await fixture.getArtifact(setup.created.artifact.id)
  expect(artifact.artifact.status).toBe("tombstoned")
  expect(artifact.activeProjection).toBeUndefined()
  expect(artifact.shadowProjection).toBeUndefined()
  expect(artifact.canaryProjection).toBeUndefined()
  const context = await fixture.run(
    SelfImprovementContextStore.Service.use((store) =>
      Effect.all({
        outboxes: store.recoverable(SelfImprovementLifecycle.TimestampMillis.make(Number.MAX_SAFE_INTEGER)),
        active: store.desired({
          locationID: fixture.locationID,
          artifactID: setup.created.artifact.id,
          rolloutSlot: "active",
        }),
        shadow: store.desired({
          locationID: fixture.locationID,
          artifactID: setup.created.artifact.id,
          rolloutSlot: "shadow",
        }),
        canary: store.desired({
          locationID: fixture.locationID,
          artifactID: setup.created.artifact.id,
          rolloutSlot: "canary",
        }),
      }),
    ),
  )
  expect(context.outboxes.filter((outbox) => outbox.artifactID === setup.created.artifact.id)).toHaveLength(0)
  expect(
    [context.active, context.shadow, context.canary].every(
      (item) => item === undefined || item.desired.state === "absent",
    ),
  ).toBe(true)
})
