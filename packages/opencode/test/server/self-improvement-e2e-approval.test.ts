import { expect, test } from "bun:test"
import { Clock, Duration, Effect } from "effect"
import {
  SelfImprovement,
  SelfImprovementApi,
  SelfImprovementEvaluation,
  SelfImprovementLearning,
  SelfImprovementLifecycle,
} from "@opencode-ai/schema"
import { SelfImprovementAdmission } from "@opencode-ai/core/self-improvement/admission"
import { SelfImprovementApprovalStore } from "@opencode-ai/core/self-improvement/approval-store"
import { SelfImprovementContextStore } from "@opencode-ai/core/self-improvement/context-store"
import { SelfImprovementEvaluationStore } from "@opencode-ai/core/self-improvement/evaluation-store"
import { SelfImprovementLifecycleWorkflow } from "@opencode-ai/core/self-improvement/lifecycle-workflow"
import { SelfImprovementMetrics } from "@opencode-ai/core/self-improvement/metrics"
import { SelfImprovementPrivateArtifactCommand } from "@opencode-ai/core/self-improvement/private-artifact-command"
import { SelfImprovementPrivateEvidenceCommand } from "@opencode-ai/core/self-improvement/private-evidence-command"
import { SelfImprovementPrivateQuery } from "@opencode-ai/core/self-improvement/private-query"
import { Hash } from "@opencode-ai/core/util/hash"
import { selfImprovementFixture } from "../fixture/self-improvement"

const digest = (value: string) => SelfImprovement.Digest.make(Hash.sha256(value))
const revision = SelfImprovementLifecycle.Revision.make(1)
const workload = SelfImprovementEvaluation.Workload.make("approval-e2e")
const manifest = new SelfImprovementLifecycle.CapabilityManifest({
  toolIDs: [],
  filesystemScopeIDs: [],
  networkOriginIDs: [],
  modelRoutes: [],
  childAgentTargets: [],
  artifactReferences: [],
  denies: [],
})

type Fixture = Awaited<ReturnType<typeof selfImprovementFixture>>

const evidencePrincipal = (fixture: Fixture) =>
  new SelfImprovementLifecycle.Principal({
    id: SelfImprovementLifecycle.PrincipalID.make("approval-e2e-evidence"),
    kind: "runtime-evidence-service",
    locationID: fixture.locationID,
  })

const evaluatorPrincipal = (fixture: Fixture) =>
  new SelfImprovementLifecycle.Principal({
    id: SelfImprovementLifecycle.PrincipalID.make("approval-e2e-evaluator"),
    kind: "evaluator",
    locationID: fixture.locationID,
  })

const coordinatorPrincipal = (fixture: Fixture) =>
  new SelfImprovementLifecycle.Principal({
    id: SelfImprovementLifecycle.PrincipalID.make("approval-e2e-coordinator"),
    kind: "coordinator",
    locationID: fixture.locationID,
  })

const approverPrincipal = (fixture: Fixture) =>
  new SelfImprovementLifecycle.Principal({
    id: SelfImprovementLifecycle.PrincipalID.make("approval-e2e-approver"),
    kind: "location-approver",
    locationID: fixture.locationID,
  })

const metrics = () =>
  new SelfImprovementEvaluation.MetricComponents({
    taskQuality: { earnedAllowlistedPoints: 1, possibleAllowlistedPoints: 1 },
    correctness: { passedRequiredChecks: 1, requiredChecks: 1 },
    repeatFixRate: { repeatedTasks: 0, completedTasks: 1 },
    precision: { acceptedRelevantItems: 1, assessedItems: 1 },
    latencyMs: 1,
    tokensPerSuccess: new SelfImprovementEvaluation.TokensPerSuccessMetric({
      inputTokens: 0,
      outputTokens: 1,
      successfulTasks: 1,
    }),
    cacheHitRatio: { cacheReadTokens: 1, cacheEligibleTokens: 1 },
  })

async function seedSuiteAndBaseline(fixture: Fixture, name: string) {
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
    latencySampleSetDigest: digest(`${name}-baseline-latency`),
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
    latencyP95Ms: 100,
    tokensPerSuccess: 2,
    cacheHitRatio: 1,
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
            controlSource: "approval-e2e",
            acceptanceStart: now,
            acceptanceEnd: now,
            cutoffAt: now,
            uniqueSampleCount: 20,
            orderedSampleIDDigest: digest(`${name}-baseline-samples`),
            metricTotals: totals,
            aggregates,
            createdAt: now,
            evaluatorSignatureDigest: digest(`${name}-baseline-signature`),
            bootstrapAuthorityID: fixture.principal.id,
          }),
        )
      }),
    ),
  )
  return { baselineID, now, suiteID }
}

async function admitAndPrepare(
  fixture: Fixture,
  name: string,
  source: "generated" | "human",
  behaviorClass: "behavior-changing" | "instruction-only" = "behavior-changing",
) {
  const now = SelfImprovementLifecycle.TimestampMillis.make(await fixture.run(Clock.currentTimeMillis))
  const proposalBytes = new TextEncoder().encode(
    JSON.stringify({
      kind: "skill",
      name,
      definition: { description: name, content: `Use ${name} instructions.` },
      references: [],
    }),
  )
  const admitted =
    source === "generated"
      ? await fixture.run(
          SelfImprovementAdmission.Service.use((admission) =>
            admission.admit({
              locationID: fixture.locationID,
              proposalBytes,
              principal: coordinatorPrincipal(fixture),
              source,
              behaviorClass,
              capabilityManifest: manifest,
              generated: new SelfImprovementLifecycle.GeneratedContentMetadata({
                generationLeaseID: SelfImprovementLifecycle.GenerationLeaseID.make(`si_les_${name}`),
                strategyPullID: SelfImprovementLifecycle.PullEventID.make(`si_pul_${name}`),
                originatingTaskIDDigest: digest(`${name}-task`),
                modelRequestDigest: digest(`${name}-request`),
                modelOutputDigest: digest(`${name}-output`),
                retentionDeadline: SelfImprovementLifecycle.TimestampMillis.make(Number(now) + 86_400_000),
              }),
              idempotencyKey: SelfImprovementLearning.IdempotencyKey.make(`${name}-admit`),
              operation: "artifact.create",
              policy: {
                known: { tools: [], filesystemScopes: [], networkOrigins: [], childAgents: [], modelRoutes: [] },
                grant: manifest,
                baseline: manifest,
                taskEnvelope: manifest,
                references: { common: "pass", typed: "pass", cycle: "pass", models: "pass" },
                resolve: () => [],
              },
              now,
            }),
          ),
        )
      : await fixture.run(
          SelfImprovementPrivateArtifactCommand.Service.use((command) =>
            command.createArtifact({
              locationID: fixture.locationID,
              principal: fixture.principal,
              request: new SelfImprovementApi.CreateArtifactRequest({
                proposalBytes,
                behaviorClass,
                capabilityManifest: manifest,
              }),
              idempotencyKey: SelfImprovementLearning.IdempotencyKey.make(`${name}-admit`),
              now,
            }),
          ),
        )
  const artifact =
    "response" in admitted
      ? admitted.response.body
      : new SelfImprovementApi.CreateArtifactResponse({
          artifact: admitted.artifact,
          version: admitted.version,
          revision: admitted.artifact.revision,
        })
  if (artifact instanceof SelfImprovementApi.CreateArtifactResponse === false)
    throw new Error("Expected an admitted artifact")
  await fixture.run(
    SelfImprovementLifecycleWorkflow.Service.use((workflow) =>
      workflow.prepareShadow({
        locationID: fixture.locationID,
        principal: coordinatorPrincipal(fixture),
        artifactID: artifact.artifact.id,
        versionID: artifact.version.id,
        now,
        idempotencyKey: SelfImprovementLearning.IdempotencyKey.make(`${name}-prepare-shadow`),
      }),
    ),
  )
  return artifact
}

async function decide(
  fixture: Fixture,
  input: {
    readonly name: string
    readonly versionID: SelfImprovementLifecycle.ArtifactVersionID
    readonly stage: "shadow" | "canary"
    readonly samples: number
    readonly baselineID: SelfImprovementLifecycle.BaselineID
    readonly suiteID: SelfImprovementLifecycle.SuiteID
  },
) {
  const now = SelfImprovementLifecycle.TimestampMillis.make(await fixture.run(Clock.currentTimeMillis))
  const evidence = evidencePrincipal(fixture)
  const run = await fixture.run(
    SelfImprovementPrivateEvidenceCommand.Service.use((command) =>
      command.createMetricRun(
        {
          principal: evidence,
          locationID: fixture.locationID,
          now,
          idempotencyKey: SelfImprovementLearning.IdempotencyKey.make(`${input.name}-${input.stage}-run`),
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
          cutoffAt: SelfImprovementLifecycle.TimestampMillis.make(Number(now) + 1),
          requestDigest: digest(`${input.name}-${input.stage}-run`),
        }),
      ),
    ),
  )
  for (const index of Array.from({ length: input.samples }, (_, index) => index))
    await fixture.run(
      SelfImprovementPrivateEvidenceCommand.Service.use((command) =>
        command.addMetricSample(
          {
            principal: evidence,
            locationID: fixture.locationID,
            now,
            idempotencyKey: SelfImprovementLearning.IdempotencyKey.make(`${input.name}-${input.stage}-sample-${index}`),
          },
          new SelfImprovementApi.AddMetricSampleRequest({
            runID: run.id,
            sampleIDDigest: digest(`${input.name}-${input.stage}-sample-${index}`),
            taskIDDigest: digest(`${input.name}-${input.stage}-task-${index}`),
            metrics: metrics(),
            outcome: "success",
            startedAt: now,
            terminalAt: now,
            requestDigest: digest(`${input.name}-${input.stage}-sample-request-${index}`),
          }),
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
  if (accepted === undefined) throw new Error("Expected accepted metric samples")
  return fixture.run(
    SelfImprovementPrivateEvidenceCommand.Service.use((command) =>
      command.decideMetricRun(
        {
          principal: evaluatorPrincipal(fixture),
          locationID: fixture.locationID,
          now,
          idempotencyKey: SelfImprovementLearning.IdempotencyKey.make(`${input.name}-${input.stage}-decision`),
        },
        new SelfImprovementApi.DecideMetricRunRequest({
          runID: run.id,
          cutoffSampleSetDigest: SelfImprovementMetrics.aggregate(accepted).orderedSampleIDDigest,
        }),
      ),
    ),
  )
}

async function stage(
  fixture: Fixture,
  artifactID: SelfImprovementLifecycle.ArtifactID,
  versionID: SelfImprovementLifecycle.ArtifactVersionID,
) {
  const version = await fixture.run(
    SelfImprovementPrivateQuery.Service.use((query) =>
      query.getVersion({
        locationID: fixture.locationID,
        artifactID,
        versionID,
      }),
    ),
  )
  if (version === undefined) throw new Error("Expected artifact version")
  return version.stage
}

test("approves generated shadow evidence into a recovered canary context exactly once", async () => {
  await using fixture = await selfImprovementFixture()
  const admitted = await admitAndPrepare(fixture, "generated-approval", "generated")
  const setup = await seedSuiteAndBaseline(fixture, "generated-approval")
  const result = await decide(fixture, {
    name: "generated-approval",
    versionID: admitted.version.id,
    stage: "shadow",
    samples: 10,
    baselineID: setup.baselineID,
    suiteID: setup.suiteID,
  })

  expect(result.decision.decision).toBe("passed")
  expect(await stage(fixture, admitted.artifact.id, admitted.version.id)).toBe("shadow")
  const binding = new SelfImprovementLifecycle.ApprovalBinding({
    versionID: admitted.version.id,
    versionDigest: admitted.version.versionDigest,
    suiteID: setup.suiteID,
    suiteRevision: revision,
    evaluationRunID: result.decision.runID,
    shadowEvidenceDigest: result.decision.cutoffSampleSetDigest,
  })
  const request = await fixture.run(
    SelfImprovementApprovalStore.Service.use((store) =>
      store.requestForBinding({ locationID: fixture.locationID, binding }),
    ),
  )
  if (request === undefined) throw new Error("Expected generated approval request")
  const now = SelfImprovementLifecycle.TimestampMillis.make(await fixture.run(Clock.currentTimeMillis))
  const beforeApproval = await fixture.run(
    SelfImprovementContextStore.Service.use((store) =>
      store.desired({ locationID: fixture.locationID, artifactID: admitted.artifact.id, rolloutSlot: "canary" }),
    ),
  )
  expect(beforeApproval).toBeUndefined()
  const approval = await fixture.run(
    SelfImprovementPrivateArtifactCommand.Service.use((command) =>
      command.approve({
        locationID: fixture.locationID,
        principal: approverPrincipal(fixture),
        request: new SelfImprovementApi.ApproveRequest({ approvalRequestID: request.id, binding }),
        idempotencyKey: SelfImprovementLearning.IdempotencyKey.make("generated-approval-approve"),
        now,
      }),
    ),
  )
  expect(approval.replayed).toBe(false)
  const afterApproval = await fixture.run(
    Effect.all({
      context: SelfImprovementContextStore.Service,
      query: SelfImprovementPrivateQuery.Service,
    }).pipe(
      Effect.flatMap(({ context, query }) =>
        Effect.all({
          desired: context.desired({
            locationID: fixture.locationID,
            artifactID: admitted.artifact.id,
            rolloutSlot: "canary",
          }),
          outboxes: context.recoverable(SelfImprovementLifecycle.TimestampMillis.make(Number.MAX_SAFE_INTEGER)),
          approvals: query.listApprovals({ locationID: fixture.locationID, versionID: admitted.version.id, limit: 1 }),
          artifact: query.getArtifact({ locationID: fixture.locationID, artifactID: admitted.artifact.id }),
        }),
      ),
    ),
  )
  expect(afterApproval.desired).toMatchObject({
    desired: { state: "present", versionID: admitted.version.id, versionDigest: admitted.version.versionDigest },
  })
  expect(afterApproval.outboxes).toEqual([
    expect.objectContaining({ status: "pending", intent: expect.objectContaining({ approvalID: expect.any(String) }) }),
  ])
  const pendingOutbox = afterApproval.outboxes[0]
  if (pendingOutbox === undefined || afterApproval.desired === undefined || afterApproval.artifact === undefined)
    throw new Error("Expected approval context state")
  expect(pendingOutbox.desiredStateRevision).toBe(afterApproval.desired.desiredRevision)
  expect(pendingOutbox.intent.approvalBinding).toEqual(binding)
  expect(pendingOutbox.expectedArtifactRevision).toBe(afterApproval.artifact.artifact.revision)
  expect(afterApproval.approvals.items).toHaveLength(1)
  expect(afterApproval.approvals.items[0]?.binding).toEqual(binding)
  expect(afterApproval.approvals.items[0]?.decision._tag).toBe("approved")
  const approvalID = afterApproval.approvals.items[0]?.id
  if (approvalID === undefined) throw new Error("Expected approval ID")
  expect(
    await fixture.run(
      SelfImprovementApprovalStore.Service.use((store) =>
        store.approved({ locationID: fixture.locationID, approvalID, binding, at: now }),
      ),
    ),
  ).toMatchObject({ id: approvalID, binding })
  const beforeRestart = await fixture.run(
    SelfImprovementContextStore.Service.use((store) =>
      store.desired({ locationID: fixture.locationID, artifactID: admitted.artifact.id, rolloutSlot: "canary" }),
    ),
  )
  expect(beforeRestart).toMatchObject({ desired: { state: "present", versionID: admitted.version.id } })
  await fixture.restart()
  await fixture.recoverPendingContext()
  const recoveryNow = SelfImprovementLifecycle.TimestampMillis.make(await fixture.run(Clock.currentTimeMillis))
  expect(recoveryNow).toBe(now)
  const afterRecovery = await fixture.run(
    Effect.all({
      approvals: SelfImprovementApprovalStore.Service,
      context: SelfImprovementContextStore.Service,
      query: SelfImprovementPrivateQuery.Service,
    }).pipe(
      Effect.flatMap(({ approvals, context, query }) =>
        Effect.all({
          desired: context.desired({
            locationID: fixture.locationID,
            artifactID: admitted.artifact.id,
            rolloutSlot: "canary",
          }),
          outboxes: context.recoverable(SelfImprovementLifecycle.TimestampMillis.make(Number.MAX_SAFE_INTEGER)),
          approval: approvals.get({ locationID: fixture.locationID, approvalID }),
          transitions: query.listTransitions({
            locationID: fixture.locationID,
            versionID: admitted.version.id,
            limit: 100,
          }),
          audit: query.listAudit({ locationID: fixture.locationID, artifactID: admitted.artifact.id, limit: 100 }),
          version: query.getVersion({
            locationID: fixture.locationID,
            artifactID: admitted.artifact.id,
            versionID: admitted.version.id,
          }),
        }),
      ),
    ),
  )
  expect(afterRecovery.desired).toMatchObject({ desired: { state: "present", versionID: admitted.version.id } })
  expect(afterRecovery.outboxes).toHaveLength(0)
  expect(afterRecovery.approval?.binding).toEqual(binding)
  expect(afterRecovery.approval?.decision).toMatchObject({ _tag: "approved", consumedAt: recoveryNow })
  expect(afterRecovery.version?.stage).toBe("canary")
  expect(afterRecovery.audit.items.map((entry) => entry.eventType)).toContain("context-change-applied")
  expect(afterRecovery.transitions.items.filter((item) => item.event === "approval-consumed")).toHaveLength(1)
  expect(await stage(fixture, admitted.artifact.id, admitted.version.id)).toBe("canary")
  expect((await fixture.getArtifact(admitted.artifact.id)).canaryProjection?.versionID).toBe(admitted.version.id)
  const replay = await fixture.run(
    SelfImprovementPrivateArtifactCommand.Service.use((command) =>
      command.approve({
        locationID: fixture.locationID,
        principal: approverPrincipal(fixture),
        request: new SelfImprovementApi.ApproveRequest({ approvalRequestID: request.id, binding }),
        idempotencyKey: SelfImprovementLearning.IdempotencyKey.make("generated-approval-approve"),
        now,
      }),
    ),
  )
  expect(replay.replayed).toBe(true)
})

test("rejects nine shadow samples without advancing the lifecycle", async () => {
  await using fixture = await selfImprovementFixture()
  const shadow = await admitAndPrepare(fixture, "insufficient-shadow", "human")
  const setup = await seedSuiteAndBaseline(fixture, "insufficient-shadow")
  const shadowDecision = await decide(fixture, {
    name: "insufficient-shadow",
    versionID: shadow.version.id,
    stage: "shadow",
    samples: 9,
    baselineID: setup.baselineID,
    suiteID: setup.suiteID,
  })
  expect(shadowDecision.decision.decision).toBe("failed")
  expect(await stage(fixture, shadow.artifact.id, shadow.version.id)).toBe("shadow")
})

test("rejects nineteen canary samples without advancing the lifecycle", async () => {
  await using fixture = await selfImprovementFixture()
  const setup = await seedSuiteAndBaseline(fixture, "insufficient-canary")
  const canary = await admitAndPrepare(fixture, "insufficient-canary", "human")
  await decide(fixture, {
    name: "insufficient-canary-shadow",
    versionID: canary.version.id,
    stage: "shadow",
    samples: 10,
    baselineID: setup.baselineID,
    suiteID: setup.suiteID,
  })
  expect(await stage(fixture, canary.artifact.id, canary.version.id)).toBe("canary")
  const canaryDecision = await decide(fixture, {
    name: "insufficient-canary",
    versionID: canary.version.id,
    stage: "canary",
    samples: 19,
    baselineID: setup.baselineID,
    suiteID: setup.suiteID,
  })
  expect(canaryDecision.decision.decision).toBe("failed")
  expect(await stage(fixture, canary.artifact.id, canary.version.id)).toBe("canary")
})

test("rejects a generated behavior-changing shadow exactly", async () => {
  await using fixture = await selfImprovementFixture()
  const admitted = await admitAndPrepare(fixture, "generated-rejection", "generated")
  const setup = await seedSuiteAndBaseline(fixture, "generated-rejection")
  const result = await decide(fixture, {
    name: "generated-rejection",
    versionID: admitted.version.id,
    stage: "shadow",
    samples: 10,
    baselineID: setup.baselineID,
    suiteID: setup.suiteID,
  })
  const binding = new SelfImprovementLifecycle.ApprovalBinding({
    versionID: admitted.version.id,
    versionDigest: admitted.version.versionDigest,
    suiteID: setup.suiteID,
    suiteRevision: revision,
    evaluationRunID: result.decision.runID,
    shadowEvidenceDigest: result.decision.cutoffSampleSetDigest,
  })
  const request = await fixture.run(
    SelfImprovementApprovalStore.Service.use((store) =>
      store.requestForBinding({ locationID: fixture.locationID, binding }),
    ),
  )
  if (request === undefined) throw new Error("Expected generated approval request")
  const now = SelfImprovementLifecycle.TimestampMillis.make(await fixture.run(Clock.currentTimeMillis))
  const rejected = await fixture.run(
    SelfImprovementPrivateArtifactCommand.Service.use((command) =>
      command.reject({
        locationID: fixture.locationID,
        principal: approverPrincipal(fixture),
        request: new SelfImprovementApi.RejectRequest({
          approvalRequestID: request.id,
          binding,
          reason: "approval-rejected",
        }),
        idempotencyKey: SelfImprovementLearning.IdempotencyKey.make("generated-rejection-reject"),
        now,
      }),
    ),
  )
  expect(rejected.replayed).toBe(false)
  expect(await stage(fixture, admitted.artifact.id, admitted.version.id)).toBe("deprecated")
})

test("archives an ad-hoc generated instruction-only rejection", async () => {
  await using fixture = await selfImprovementFixture()
  const admitted = await admitAndPrepare(fixture, "generated-instruction-rejection", "generated", "instruction-only")
  const now = SelfImprovementLifecycle.TimestampMillis.make(await fixture.run(Clock.currentTimeMillis))
  const binding = new SelfImprovementLifecycle.ApprovalBinding({
    versionID: admitted.version.id,
    versionDigest: admitted.version.versionDigest,
    suiteID: SelfImprovementLifecycle.SuiteID.make("si_sui_generated_instruction_rejection"),
    suiteRevision: revision,
    evaluationRunID: SelfImprovementLifecycle.EvaluationRunID.make("si_run_generated_instruction_rejection"),
    shadowEvidenceDigest: digest("generated-instruction-rejection-shadow"),
  })
  const request = new SelfImprovementLifecycle.ApprovalRequest({
    id: SelfImprovementLifecycle.ApprovalRequestID.make("si_apr_generated_instruction_rejection"),
    locationID: fixture.locationID,
    binding,
    creatorID: coordinatorPrincipal(fixture).id,
    requestedAt: now,
  })
  await fixture.run(SelfImprovementApprovalStore.Service.use((store) => store.request(request)))
  const rejected = await fixture.run(
    SelfImprovementPrivateArtifactCommand.Service.use((command) =>
      command.reject({
        locationID: fixture.locationID,
        principal: approverPrincipal(fixture),
        request: new SelfImprovementApi.RejectRequest({
          approvalRequestID: request.id,
          binding,
          reason: "approval-rejected",
        }),
        idempotencyKey: SelfImprovementLearning.IdempotencyKey.make("generated-instruction-rejection-reject"),
        now,
      }),
    ),
  )
  expect(rejected.replayed).toBe(false)
  expect(await stage(fixture, admitted.artifact.id, admitted.version.id)).toBe("archived")
})

test("does not consume an expired granted approval", async () => {
  await using fixture = await selfImprovementFixture()
  const admitted = await admitAndPrepare(fixture, "expired-approval", "generated")
  const setup = await seedSuiteAndBaseline(fixture, "expired-approval")
  const result = await decide(fixture, {
    name: "expired-approval",
    versionID: admitted.version.id,
    stage: "shadow",
    samples: 10,
    baselineID: setup.baselineID,
    suiteID: setup.suiteID,
  })
  const binding = new SelfImprovementLifecycle.ApprovalBinding({
    versionID: admitted.version.id,
    versionDigest: admitted.version.versionDigest,
    suiteID: setup.suiteID,
    suiteRevision: revision,
    evaluationRunID: result.decision.runID,
    shadowEvidenceDigest: result.decision.cutoffSampleSetDigest,
  })
  const request = await fixture.run(
    SelfImprovementApprovalStore.Service.use((store) =>
      store.requestForBinding({ locationID: fixture.locationID, binding }),
    ),
  )
  if (request === undefined) throw new Error("Expected generated approval request")
  const now = SelfImprovementLifecycle.TimestampMillis.make(await fixture.run(Clock.currentTimeMillis))
  const approval = new SelfImprovementLifecycle.Approval({
    id: SelfImprovementLifecycle.ApprovalID.make("si_app_expired_approval"),
    requestID: request.id,
    locationID: fixture.locationID,
    binding,
    decision: new SelfImprovementLifecycle.ApprovalGranted({
      approverID: approverPrincipal(fixture).id,
      decidedAt: now,
      expiresAt: SelfImprovementLifecycle.TimestampMillis.make(Number(now) + 86_400_000),
    }),
  })
  await fixture.run(SelfImprovementApprovalStore.Service.use((store) => store.decide(approval)))
  await fixture.advance(Duration.millis(86_400_001))
  await fixture.restart()
  expect(await fixture.run(Clock.currentTimeMillis)).toBe(Number(now) + 86_400_001)
  await fixture.recoverPendingContext()
  const afterExpiry = await fixture.run(
    Effect.all({
      context: SelfImprovementContextStore.Service,
      query: SelfImprovementPrivateQuery.Service,
    }).pipe(
      Effect.flatMap(({ context, query }) =>
        Effect.all({
          desired: context.desired({
            locationID: fixture.locationID,
            artifactID: admitted.artifact.id,
            rolloutSlot: "canary",
          }),
          transitions: query.listTransitions({
            locationID: fixture.locationID,
            versionID: admitted.version.id,
            limit: 100,
          }),
        }),
      ),
    ),
  )
  expect(await stage(fixture, admitted.artifact.id, admitted.version.id)).toBe("shadow")
  expect((await fixture.getArtifact(admitted.artifact.id)).canaryProjection).toBeUndefined()
  expect(afterExpiry.desired).toBeUndefined()
  expect(afterExpiry.transitions.items.map((transition) => transition.event)).not.toContain("approval-consumed")
  const expiredNow = SelfImprovementLifecycle.TimestampMillis.make(await fixture.run(Clock.currentTimeMillis))
  await expect(
    fixture.run(
      SelfImprovementLifecycleWorkflow.Service.use((workflow) =>
        workflow.consumeApproval({
          locationID: fixture.locationID,
          principal: approverPrincipal(fixture),
          approvalID: approval.id,
          now: expiredNow,
          idempotencyKey: SelfImprovementLearning.IdempotencyKey.make("expired-approval-consume"),
        }),
      ),
    ),
  ).rejects.toThrow("Approval expired; new shadow evidence and approval request are required")
})
