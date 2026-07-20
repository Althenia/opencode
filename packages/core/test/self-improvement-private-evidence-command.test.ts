import { expect, test } from "bun:test"
import {
  SelfImprovement,
  SelfImprovementApi,
  SelfImprovementEvaluation,
  SelfImprovementLifecycle,
} from "@opencode-ai/schema"
import { Database } from "@opencode-ai/core/database/database"
import { Effect } from "effect"
import { SelfImprovementPrivateEvidenceCommand } from "@opencode-ai/core/self-improvement/private-evidence-command"
import { SelfImprovementArtifactStore } from "@opencode-ai/core/self-improvement/artifact-store"
import { SelfImprovementApprovalStore } from "@opencode-ai/core/self-improvement/approval-store"
import { SelfImprovementAuditStore } from "@opencode-ai/core/self-improvement/audit-store"
import { SelfImprovementEvaluationStore } from "@opencode-ai/core/self-improvement/evaluation-store"
import { SelfImprovementIngressStore } from "@opencode-ai/core/self-improvement/ingress-store"
import { SelfImprovementKeyring } from "@opencode-ai/core/self-improvement/keyring"
import { SelfImprovementIdempotencyStore } from "@opencode-ai/core/self-improvement/idempotency-store"
import { SelfImprovementLifecycleWorkflow } from "@opencode-ai/core/self-improvement/lifecycle-workflow"
import { SelfImprovementMetrics } from "@opencode-ai/core/self-improvement/metrics"
import { SelfImprovementTransitionStore } from "@opencode-ai/core/self-improvement/transition-store"

const locationID = SelfImprovementLifecycle.LocationID.make("a".repeat(64))
const evidencePrincipal = new SelfImprovementLifecycle.Principal({
  id: SelfImprovementLifecycle.PrincipalID.make("runtime-evidence"),
  kind: "runtime-evidence-service",
  locationID,
})
const evaluatorPrincipal = new SelfImprovementLifecycle.Principal({
  id: SelfImprovementLifecycle.PrincipalID.make("evaluator"),
  kind: "evaluator",
  locationID,
})
const observation = {
  workload: SelfImprovementEvaluation.Workload.make("typescript"),
  workloadRevision: SelfImprovementLifecycle.Revision.make(1),
  errorClass: "type-error",
  orderedToolSymbolIDs: ["tool-a", "symbol-b"],
  outcomeClass: "failure" as const,
  taskIDDigest: SelfImprovement.Digest.make("a".repeat(64)),
}
const sample = new SelfImprovementEvaluation.MetricSample({
  id: SelfImprovementLifecycle.MetricSampleID.make("si_sam_1"),
  runID: SelfImprovementLifecycle.EvaluationRunID.make("si_run_1"),
  sampleIDDigest: SelfImprovement.Digest.make("b".repeat(64)),
  taskIDDigest: SelfImprovement.Digest.make("c".repeat(64)),
  producerID: evidencePrincipal.id,
  requestDigest: SelfImprovement.Digest.make("d".repeat(64)),
  metrics: new SelfImprovementEvaluation.MetricComponents({
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
  }),
  outcome: "success",
  startedAt: SelfImprovementLifecycle.TimestampMillis.make(1),
  terminalAt: SelfImprovementLifecycle.TimestampMillis.make(1),
})

test("exposes the private evidence command service", () => {
  expect(SelfImprovementPrivateEvidenceCommand.Service).toBeDefined()
  expect(SelfImprovementPrivateEvidenceCommand.layer).toBeDefined()
  expect(SelfImprovementPrivateEvidenceCommand.node).toBeDefined()
  expect(
    SelfImprovementPrivateEvidenceCommand.node.dependencies.some(
      (node) => node.service === SelfImprovementIngressStore.Service,
    ),
  ).toBe(true)
})

test("records observations and maps evaluation conflicts at the command boundary", async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const command = yield* SelfImprovementPrivateEvidenceCommand.Service
      const created = yield* command.createObservation(
        { principal: evidencePrincipal, locationID, now: SelfImprovementLifecycle.TimestampMillis.make(1) },
        observation,
      )
      const conflict = yield* command
        .decideMetricRun(
          { principal: evaluatorPrincipal, locationID, now: SelfImprovementLifecycle.TimestampMillis.make(2) },
          new SelfImprovementApi.DecideMetricRunRequest({
            runID: sample.runID,
            cutoffSampleSetDigest: SelfImprovementMetrics.aggregate([sample]).orderedSampleIDDigest,
          }),
        )
        .pipe(Effect.flip)
      return { created, conflict }
    }).pipe(
      Effect.provide(SelfImprovementPrivateEvidenceCommand.layer),
      Effect.provide(SelfImprovementIngressStore.layer),
      Effect.provideService(SelfImprovementIngressStore.EvaluationEvidence, {
        createRun: () => Effect.die("unused"),
        appendSample: () => Effect.die("unused"),
      }),
      Effect.provideService(SelfImprovementKeyring.Service, SelfImprovementKeyring.make("test-key")),
      Effect.provide(Database.layerFromPath(":memory:")),
      Effect.provideService(
        SelfImprovementApprovalStore.Service,
        SelfImprovementApprovalStore.Service.of({
          request: () => Effect.die("unused"),
          decide: () => Effect.die("unused"),
          get: () => Effect.die("unused"),
          requestForBinding: () => Effect.die("unused"),
          consumable: () => Effect.die("unused"),
          approved: () => Effect.die("unused"),
          approvedForBinding: () => Effect.succeed(undefined),
          consume: () => Effect.die("unused"),
          appendRollback: () => Effect.die("unused"),
        }),
      ),
      Effect.provideService(
        SelfImprovementEvaluationStore.Service,
        SelfImprovementEvaluationStore.Service.of({
          putSuiteRevision: () => Effect.die("unused"),
          bootstrapBaseline: () => Effect.die("unused"),
          getBaseline: () => Effect.die("unused"),
          getRun: () => Effect.die("unused"),
          getDecision: () => Effect.die("unused"),
          createRun: () => Effect.die("unused"),
          appendSample: () => Effect.die("unused"),
          beginDecision: () => Effect.fail(new SelfImprovementEvaluationStore.Conflict({ message: "run changed" })),
          finishDecision: () => Effect.die("unused"),
          cancelRun: () => Effect.die("unused"),
          listAcceptedSamples: () => Effect.succeed([sample]),
        }),
      ),
      Effect.provideService(
        SelfImprovementLifecycleWorkflow.Service,
        SelfImprovementLifecycleWorkflow.Service.of({
          prepareShadow: () => Effect.die("unused"),
          applyDecision: () => Effect.die("unused"),
          consumeApproval: () => Effect.die("unused"),
          rejectApproval: () => Effect.die("unused"),
        }),
      ),
      Effect.provideService(
        SelfImprovementArtifactStore.Service,
        SelfImprovementArtifactStore.Service.of({
          create: () => Effect.die("unused"),
          getArtifact: () => Effect.die("unused"),
          getArtifactByKey: () => Effect.die("unused"),
          getActiveArtifactVersionByKey: () => Effect.die("unused"),
          getVersion: () => Effect.die("unused"),
          appendVersion: () => Effect.die("unused"),
          listVersions: () => Effect.die("unused"),
        }),
      ),
      Effect.provideService(
        SelfImprovementTransitionStore.Service,
        SelfImprovementTransitionStore.Service.of({
          append: () => Effect.die("unused"),
          listByVersion: () => Effect.die("unused"),
          currentStage: () => Effect.die("unused"),
        }),
      ),
      Effect.provideService(
        SelfImprovementAuditStore.Service,
        SelfImprovementAuditStore.Service.of({
          append: () => Effect.die("unused"),
          list: () => Effect.die("unused"),
        }),
      ),
      Effect.provideService(
        SelfImprovementIdempotencyStore.Service,
        SelfImprovementIdempotencyStore.Service.of({
          get: () => Effect.succeed(undefined),
          put: () => Effect.void,
          valid: () => Effect.succeed(true),
          listExpired: () => Effect.succeed([]),
        }),
      ),
    ),
  )

  expect(result.created.matchingCount).toBe(1)
  expect(result.conflict).toMatchObject({
    _tag: "SelfImprovementPrivateEvidenceCommand.Conflict",
    code: "already-decided",
    message: "run changed",
  })
})
