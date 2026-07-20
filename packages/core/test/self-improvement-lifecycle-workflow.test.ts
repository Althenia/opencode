import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Effect, Layer, ManagedRuntime } from "effect"
import {
  SelfImprovement,
  SelfImprovementEvaluation,
  SelfImprovementLearning,
  SelfImprovementLifecycle,
} from "@opencode-ai/schema"
import { Database } from "@opencode-ai/core/database/database"
import { SelfImprovementArtifactStore } from "@opencode-ai/core/self-improvement/artifact-store"
import { SelfImprovementApprovalStore } from "@opencode-ai/core/self-improvement/approval-store"
import { SelfImprovementAuditStore } from "@opencode-ai/core/self-improvement/audit-store"
import { SelfImprovementContextStore } from "@opencode-ai/core/self-improvement/context-store"
import { SelfImprovementEvaluationStore } from "@opencode-ai/core/self-improvement/evaluation-store"
import { SelfImprovementIdempotencyStore } from "@opencode-ai/core/self-improvement/idempotency-store"
import { SelfImprovementLifecycleCoordinator } from "@opencode-ai/core/self-improvement/lifecycle-coordinator"
import { SelfImprovementLifecycleWorkflow } from "@opencode-ai/core/self-improvement/lifecycle-workflow"
import { SelfImprovementLearningStore } from "@opencode-ai/core/self-improvement/learning-store"
import { SelfImprovementMutationStore } from "@opencode-ai/core/self-improvement/mutation-store"
import { SelfImprovementTransitionStore } from "@opencode-ai/core/self-improvement/transition-store"
import { SelfImprovementApprovalRequestTable } from "@opencode-ai/core/self-improvement/approval-rollback.sql"
import { evaluate } from "@opencode-ai/core/self-improvement/evaluator"

const locationID = SelfImprovementLifecycle.LocationID.make("a".repeat(64))
const artifactID = SelfImprovementLifecycle.ArtifactID.make("si_art_workflow")
const versionID = SelfImprovementLifecycle.ArtifactVersionID.make("si_ver_workflow")
const now = SelfImprovementLifecycle.TimestampMillis.make(1)
const principal = new SelfImprovementLifecycle.Principal({
  id: SelfImprovementLifecycle.PrincipalID.make("lifecycle-coordinator"),
  kind: "coordinator",
  locationID,
})
const evaluator = new SelfImprovementLifecycle.Principal({
  id: SelfImprovementLifecycle.PrincipalID.make("workflow-evaluator"),
  kind: "evaluator",
  locationID,
})

const artifact = new SelfImprovementLifecycle.Artifact({
  id: artifactID,
  key: new SelfImprovementLifecycle.ArtifactKey({
    locationID,
    kind: "skill",
    name: SelfImprovement.CandidateName.make("workflow-skill"),
  }),
  status: "live",
  createdBy: principal.id,
  createdAt: now,
  revision: SelfImprovementLifecycle.Revision.make(0),
})

const version = new SelfImprovementLifecycle.ArtifactVersion({
  id: versionID,
  artifactID,
  versionNumber: 1,
  source: "human",
  behaviorClass: "instruction-only",
  proposal: new SelfImprovement.SkillProposal({
    kind: "skill",
    name: SelfImprovement.CandidateName.make("workflow-skill"),
    definition: { description: "workflow test", content: "Use workflow test instructions." },
    references: [],
  }),
  canonicalJson: SelfImprovement.CanonicalJson.make(
    '{"definition":{"content":"Use workflow test instructions.","description":"workflow test"},"kind":"skill","name":"workflow-skill","references":[]}',
  ),
  proposalDigest: SelfImprovement.Digest.make("1".repeat(64)),
  inputSnapshotDigest: SelfImprovement.Digest.make("2".repeat(64)),
  versionDigest: SelfImprovement.Digest.make("3".repeat(64)),
  capabilityManifest: new SelfImprovementLifecycle.CapabilityManifest({
    toolIDs: [],
    filesystemScopeIDs: [],
    networkOriginIDs: [],
    modelRoutes: [],
    childAgentTargets: [],
    artifactReferences: [],
    denies: [],
  }),
  capabilityManifestDigest: SelfImprovement.Digest.make("4".repeat(64)),
  creatorID: principal.id,
  createdAt: now,
})

const layer = (database: string) => {
  const stores = Layer.mergeAll(
    SelfImprovementArtifactStore.layer,
    SelfImprovementApprovalStore.layer,
    SelfImprovementAuditStore.layer,
    SelfImprovementContextStore.layer,
    SelfImprovementEvaluationStore.layer,
    SelfImprovementIdempotencyStore.layer,
    SelfImprovementLearningStore.layer,
    SelfImprovementMutationStore.layer,
    SelfImprovementTransitionStore.layer,
  ).pipe(Layer.provideMerge(Database.layerFromPath(database)))
  const coordinator = SelfImprovementLifecycleCoordinator.layer.pipe(Layer.provide(stores))
  const workflow = SelfImprovementLifecycleWorkflow.layer.pipe(Layer.provide(coordinator), Layer.provide(stores))
  return Layer.mergeAll(stores, coordinator, workflow)
}

test("prepares a draft version for shadow exactly once and resumes after restart", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "opencode-lifecycle-workflow-"))
  const database = path.join(directory, "opencode.db")
  let runtime = ManagedRuntime.make(layer(database))
  try {
    await runtime.runPromise(
      Effect.gen(function* () {
        const artifacts = yield* SelfImprovementArtifactStore.Service
        const transitions = yield* SelfImprovementTransitionStore.Service
        const workflow = yield* SelfImprovementLifecycleWorkflow.Service
        yield* artifacts.create({ locationID, artifact, version })
        yield* transitions.append({
          locationID,
          transition: new SelfImprovementLifecycle.StageTransition({
            id: SelfImprovementLifecycle.StageTransitionID.create(),
            versionID,
            previousStage: null,
            nextStage: "draft",
            event: "version-admitted",
            reason: "admission-accepted",
            actorID: principal.id,
            timestamp: now,
            idempotencyRecordID: SelfImprovementLifecycle.IdempotencyRecordID.create(),
            idempotencyDigest: SelfImprovement.Digest.make("5".repeat(64)),
          }),
        })

        const input = {
          locationID,
          principal,
          artifactID,
          versionID,
          now,
          idempotencyKey: SelfImprovementLearning.IdempotencyKey.make("prepare-shadow"),
        }
        expect(yield* workflow.prepareShadow(input)).toEqual({ stage: "shadow", replayed: false })
        expect((yield* transitions.listByVersion({ locationID, versionID })).map((item) => item.event)).toEqual([
          "version-admitted",
          "static-passed",
          "offline-passed",
          "shadow-started",
        ])
        expect((yield* artifacts.getArtifact({ locationID, artifactID }))?.revision).toBe(
          SelfImprovementLifecycle.Revision.make(3),
        )
      }),
    )
    await runtime.dispose()
    runtime = ManagedRuntime.make(layer(database))
    await runtime.runPromise(
      SelfImprovementLifecycleWorkflow.Service.use((workflow) =>
        workflow.prepareShadow({
          locationID,
          principal,
          artifactID,
          versionID,
          now,
          idempotencyKey: SelfImprovementLearning.IdempotencyKey.make("prepare-shadow"),
        }),
      ).pipe(Effect.tap((result) => Effect.sync(() => expect(result).toEqual({ stage: "shadow", replayed: true })))),
    )
  } finally {
    await runtime.dispose()
    await rm(directory, { recursive: true, force: true })
  }
})

test("resumes only unfinished shadow preparation transitions", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "opencode-lifecycle-workflow-"))
  const database = path.join(directory, "opencode.db")
  const runtime = ManagedRuntime.make(layer(database))
  try {
    await runtime.runPromise(
      Effect.gen(function* () {
        const artifacts = yield* SelfImprovementArtifactStore.Service
        const transitions = yield* SelfImprovementTransitionStore.Service
        const workflow = yield* SelfImprovementLifecycleWorkflow.Service
        yield* artifacts.create({ locationID, artifact, version })
        yield* transitions.append({
          locationID,
          transition: new SelfImprovementLifecycle.StageTransition({
            id: SelfImprovementLifecycle.StageTransitionID.create(),
            versionID,
            previousStage: null,
            nextStage: "draft",
            event: "version-admitted",
            reason: "admission-accepted",
            actorID: principal.id,
            timestamp: now,
            idempotencyRecordID: SelfImprovementLifecycle.IdempotencyRecordID.create(),
            idempotencyDigest: SelfImprovement.Digest.make("5".repeat(64)),
          }),
        })
        yield* transitions.append({
          locationID,
          transition: new SelfImprovementLifecycle.StageTransition({
            id: SelfImprovementLifecycle.StageTransitionID.create(),
            versionID,
            previousStage: "draft",
            nextStage: "experimental",
            event: "static-passed",
            reason: "gates-passed",
            actorID: principal.id,
            timestamp: now,
            idempotencyRecordID: SelfImprovementLifecycle.IdempotencyRecordID.create(),
            idempotencyDigest: SelfImprovement.Digest.make("6".repeat(64)),
          }),
        })

        expect(
          yield* workflow.prepareShadow({
            locationID,
            principal,
            artifactID,
            versionID,
            now,
            idempotencyKey: SelfImprovementLearning.IdempotencyKey.make("resume-prepare-shadow"),
          }),
        ).toEqual({ stage: "shadow", replayed: false })
        expect((yield* transitions.listByVersion({ locationID, versionID })).map((item) => item.event)).toEqual([
          "version-admitted",
          "static-passed",
          "offline-passed",
          "shadow-started",
        ])
      }),
    )
  } finally {
    await runtime.dispose()
    await rm(directory, { recursive: true, force: true })
  }
})

test("consumes one exact granted approval through a canary context outbox", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "opencode-lifecycle-workflow-"))
  const database = path.join(directory, "opencode.db")
  const runtime = ManagedRuntime.make(layer(database))
  const approver = new SelfImprovementLifecycle.Principal({
    id: SelfImprovementLifecycle.PrincipalID.make("approver"),
    kind: "location-approver",
    locationID,
  })
  const generated = new SelfImprovementLifecycle.ArtifactVersion({
    ...version,
    source: "generated",
    behaviorClass: "behavior-changing",
    generated: new SelfImprovementLifecycle.GeneratedContentMetadata({
      generationLeaseID: SelfImprovementLifecycle.GenerationLeaseID.make("si_les_workflow"),
      strategyPullID: SelfImprovementLifecycle.PullEventID.make("si_pul_workflow"),
      originatingTaskIDDigest: SelfImprovement.Digest.make("5".repeat(64)),
      modelRequestDigest: SelfImprovement.Digest.make("6".repeat(64)),
      modelOutputDigest: SelfImprovement.Digest.make("7".repeat(64)),
      retentionDeadline: SelfImprovementLifecycle.TimestampMillis.make(86_400_000),
    }),
  })
  const binding = new SelfImprovementLifecycle.ApprovalBinding({
    versionID,
    versionDigest: generated.versionDigest,
    suiteID: SelfImprovementLifecycle.SuiteID.make("si_sui_workflow"),
    suiteRevision: SelfImprovementLifecycle.Revision.make(1),
    evaluationRunID: SelfImprovementLifecycle.EvaluationRunID.make("si_run_workflow"),
    shadowEvidenceDigest: SelfImprovement.Digest.make("8".repeat(64)),
  })
  try {
    await runtime.runPromise(
      Effect.gen(function* () {
        const approvals = yield* SelfImprovementApprovalStore.Service
        const artifacts = yield* SelfImprovementArtifactStore.Service
        const context = yield* SelfImprovementContextStore.Service
        const evaluation = yield* SelfImprovementEvaluationStore.Service
        const transitions = yield* SelfImprovementTransitionStore.Service
        const workflow = yield* SelfImprovementLifecycleWorkflow.Service
        yield* artifacts.create({ locationID, artifact, version: generated })
        for (const [previousStage, nextStage, event] of [
          [null, "draft", "version-admitted"],
          ["draft", "experimental", "static-passed"],
          ["experimental", "candidate", "offline-passed"],
          ["candidate", "shadow", "shadow-started"],
        ] as const)
          yield* transitions.append({
            locationID,
            transition: new SelfImprovementLifecycle.StageTransition({
              id: SelfImprovementLifecycle.StageTransitionID.create(),
              versionID,
              previousStage,
              nextStage,
              event,
              reason: event === "version-admitted" ? "admission-accepted" : "gates-passed",
              actorID: principal.id,
              timestamp: now,
              idempotencyRecordID: SelfImprovementLifecycle.IdempotencyRecordID.create(),
              idempotencyDigest: SelfImprovement.Digest.make("9".repeat(64)),
            }),
          })
        const run = new SelfImprovementEvaluation.EvaluationRun({
          id: binding.evaluationRunID,
          locationID,
          versionID,
          stage: "shadow",
          workload: SelfImprovementEvaluation.Workload.make("workflow"),
          workloadRevision: SelfImprovementLifecycle.Revision.make(1),
          suiteID: binding.suiteID,
          suiteRevision: binding.suiteRevision,
          baselineID: SelfImprovementLifecycle.BaselineID.make("si_bas_workflow"),
          state: "open",
          trustedProducerIDs: [principal.id],
          acceptanceStart: now,
          acceptanceEnd: now,
          cutoffAt: now,
          requestDigest: SelfImprovement.Digest.make("a".repeat(64)),
          createdAt: now,
        })
        yield* evaluation.createRun(run)
        yield* evaluation.beginDecision(locationID, run.id, binding.shadowEvidenceDigest)
        const totals = SelfImprovementEvaluation.MetricTotals.make({
          taskQualityEarnedAllowlistedPoints: 10,
          taskQualityPossibleAllowlistedPoints: 10,
          correctnessPassedRequiredChecks: 10,
          correctnessRequiredChecks: 10,
          repeatFixRepeatedTasks: 0,
          repeatFixCompletedTasks: 10,
          precisionAcceptedRelevantItems: 10,
          precisionAssessedItems: 10,
          acceptedLatencySampleCount: 10,
          latencySampleSetDigest: binding.shadowEvidenceDigest,
          inputTokens: 10,
          outputTokens: 10,
          successfulTasks: 10,
          cacheReadTokens: 10,
          cacheEligibleTokens: 10,
        })
        const aggregates = new SelfImprovementEvaluation.MetricAggregates({
          taskQuality: 1,
          correctness: 1,
          repeatFixRate: 0,
          precision: 1,
          latencyP95Ms: 10,
          tokensPerSuccess: 1,
          cacheHitRatio: 1,
        })
        const evaluated = yield* evaluate({
          runID: run.id,
          cutoffSampleSetDigest: binding.shadowEvidenceDigest,
          stage: "shadow",
          source: "generated",
          behaviorClass: "behavior-changing",
          totals,
          aggregates,
          baseline: {
            totals,
            aggregates: new SelfImprovementEvaluation.MetricAggregates({ ...aggregates, taskQuality: 0.9 }),
            locationMatches: true,
            suiteMatches: true,
          },
          requiredSuitePassed: true,
          references: { nameAvailable: true, common: "pass", typed: "pass", cycle: "pass", models: "pass" },
          capabilities: [
            "generated-content-safe",
            "capabilities-static-known",
            "capabilities-within-location-grant",
            "generated-capabilities-within-baseline",
          ].map((gateID) =>
            SelfImprovementEvaluation.GateFinding.make({
              id: SelfImprovementLifecycle.GateFindingID.create(),
              evaluationRunID: run.id,
              order: SelfImprovementEvaluation.GateOrder[gateID as "generated-content-safe"],
              gateID: gateID as "generated-content-safe",
              result: "pass",
              code: "passed",
            }),
          ),
          approvalPresent: false,
          decidedAt: now,
        })
        const decision = evaluated
        expect(yield* evaluation.finishDecision(locationID, decision)).toBe(true)
        expect(decision.findings.find((finding) => finding.gateID === "required-approval-present")?.result).toBe("fail")
        yield* workflow.applyDecision({
          locationID,
          principal: evaluator,
          runID: run.id,
          now,
          idempotencyKey: SelfImprovementLearning.IdempotencyKey.make("request-workflow"),
        })
        const db = (yield* Database.Service).db
        const request = yield* db.select().from(SelfImprovementApprovalRequestTable).get().pipe(Effect.orDie)
        if (request === undefined) throw new Error("Expected approval request")
        const approval = new SelfImprovementLifecycle.Approval({
          id: SelfImprovementLifecycle.ApprovalID.make("si_app_workflow"),
          requestID: SelfImprovementLifecycle.ApprovalRequestID.make(request.id),
          locationID,
          binding,
          decision: new SelfImprovementLifecycle.ApprovalGranted({
            approverID: approver.id,
            decidedAt: now,
            expiresAt: SelfImprovementLifecycle.TimestampMillis.make(now + 86_400_000),
          }),
        })
        yield* approvals.decide(approval)

        expect(
          yield* workflow.consumeApproval({
            locationID,
            principal: approver,
            approvalID: approval.id,
            now,
            idempotencyKey: SelfImprovementLearning.IdempotencyKey.make("consume-workflow"),
          }),
        ).toEqual({ replayed: false })
        expect(yield* context.pending(now)).toHaveLength(1)
        expect(yield* approvals.approved({ locationID, approvalID: approval.id, binding, at: now })).toBeDefined()
        expect(
          yield* workflow.consumeApproval({
            locationID,
            principal: approver,
            approvalID: approval.id,
            now,
            idempotencyKey: SelfImprovementLearning.IdempotencyKey.make("consume-workflow"),
          }),
        ).toEqual({ replayed: true })
      }),
    )
  } finally {
    await runtime.dispose()
    await rm(directory, { recursive: true, force: true })
  }
})
