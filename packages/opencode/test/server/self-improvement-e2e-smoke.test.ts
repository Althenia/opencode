import { expect, test } from "bun:test"
import { Clock, Effect } from "effect"
import { SelfImprovementEvaluationStore } from "@opencode-ai/core/self-improvement/evaluation-store"
import { SelfImprovementIngressStore } from "@opencode-ai/core/self-improvement/ingress-store"
import { SelfImprovementLifecycleCoordinator } from "@opencode-ai/core/self-improvement/lifecycle-coordinator"
import { SelfImprovementPrivateEvidenceCommand } from "@opencode-ai/core/self-improvement/private-evidence-command"
import { SelfImprovementRetention } from "@opencode-ai/core/self-improvement/retention"
import { SelfImprovementContextReconciler } from "@opencode-ai/core/self-improvement/context-reconciler"
import { SelfImprovementAdmission } from "@opencode-ai/core/self-improvement/admission"
import { SelfImprovement } from "@opencode-ai/schema"
import { SelfImprovementLearning, SelfImprovementLifecycle } from "@opencode-ai/schema"
import { selfImprovementFixture } from "../fixture/self-improvement"

test("admits a generated behavior-changing candidate through the fixture runtime", async () => {
  const proposalBytes = new TextEncoder().encode(
    JSON.stringify({
      kind: "skill",
      name: "generated-behavior",
      definition: { description: "Generated behavior", content: "Use generated instructions." },
      references: [],
    }),
  )
  await using fixture = await selfImprovementFixture({ generatedModelBytes: proposalBytes })
  const admitted = await fixture.run(
    SelfImprovementAdmission.Service.use((admission) =>
      admission.admit({
        locationID: fixture.locationID,
        proposalBytes,
        principal: fixture.principal,
        source: "generated",
        behaviorClass: "behavior-changing",
        capabilityManifest: new SelfImprovementLifecycle.CapabilityManifest({
          toolIDs: [],
          filesystemScopeIDs: [],
          networkOriginIDs: [],
          modelRoutes: [],
          childAgentTargets: [],
          artifactReferences: [],
          denies: [],
        }),
        generated: new SelfImprovementLifecycle.GeneratedContentMetadata({
          generationLeaseID: SelfImprovementLifecycle.GenerationLeaseID.make("si_les_fixture"),
          strategyPullID: SelfImprovementLifecycle.PullEventID.make("si_pul_fixture"),
          originatingTaskIDDigest: SelfImprovement.Digest.make("1".repeat(64)),
          modelRequestDigest: SelfImprovement.Digest.make("2".repeat(64)),
          modelOutputDigest: SelfImprovement.Digest.make("3".repeat(64)),
          retentionDeadline: SelfImprovementLifecycle.TimestampMillis.make(86_400_000),
        }),
        idempotencyKey: SelfImprovementLearning.IdempotencyKey.make("generated-behavior"),
        operation: "artifact.create",
        policy: {
          known: { tools: [], filesystemScopes: [], networkOrigins: [], childAgents: [], modelRoutes: [] },
          grant: new SelfImprovementLifecycle.CapabilityManifest({
            toolIDs: [],
            filesystemScopeIDs: [],
            networkOriginIDs: [],
            modelRoutes: [],
            childAgentTargets: [],
            artifactReferences: [],
            denies: [],
          }),
          baseline: new SelfImprovementLifecycle.CapabilityManifest({
            toolIDs: [],
            filesystemScopeIDs: [],
            networkOriginIDs: [],
            modelRoutes: [],
            childAgentTargets: [],
            artifactReferences: [],
            denies: [],
          }),
          taskEnvelope: new SelfImprovementLifecycle.CapabilityManifest({
            toolIDs: [],
            filesystemScopeIDs: [],
            networkOriginIDs: [],
            modelRoutes: [],
            childAgentTargets: [],
            artifactReferences: [],
            denies: [],
          }),
          references: { common: "pass", typed: "pass", cycle: "pass", models: "pass" },
          resolve: () => [],
        },
        now: SelfImprovementLifecycle.TimestampMillis.make(0),
      }),
    ),
  )
  expect(admitted.replayed).toBe(false)
  expect(admitted.version.behaviorClass).toBe("behavior-changing")
  expect(admitted.version.generated?.modelOutputDigest).toBe(SelfImprovement.Digest.make("3".repeat(64)))
})

test("persists an admitted skill through a private API runtime restart", async () => {
  await using fixture = await selfImprovementFixture()
  expect(await fixture.run(Effect.succeed("fixture runtime"))).toBe("fixture runtime")
  expect(await fixture.run(Clock.currentTimeMillis)).toBe(0)
  const services = await fixture.run(
    Effect.all({
      evaluation: SelfImprovementEvaluationStore.Service,
      evidence: SelfImprovementPrivateEvidenceCommand.Service,
      ingress: SelfImprovementIngressStore.Service,
      retention: SelfImprovementRetention.Service,
      lifecycle: SelfImprovementLifecycleCoordinator.Service,
      materializer: SelfImprovementContextReconciler.Materializer,
    }),
  )
  expect(services.evaluation.createRun).toBeFunction()
  expect(services.evidence.createObservation).toBeFunction()
  expect(services.ingress.recordObservation).toBeFunction()
  expect(services.retention.purgeExpired).toBeFunction()
  expect(services.lifecycle.transition).toBeFunction()
  expect(services.materializer.materialize).toBeFunction()
  await fixture.advance("1 second")
  expect(await fixture.run(Clock.currentTimeMillis)).toBe(1_000)
  const created = await fixture.createSkill({ name: "durable-skill", content: "Use durable instructions." })
  const artifactID = created.artifact.id

  expect((await fixture.getArtifact(artifactID)).artifact.key.name).toBe(
    SelfImprovement.CandidateName.make("durable-skill"),
  )

  await fixture.restart()

  expect((await fixture.getArtifact(artifactID)).artifact.id).toBe(artifactID)
  expect(await fixture.recoverPendingContext()).toBeGreaterThanOrEqual(0)
})
