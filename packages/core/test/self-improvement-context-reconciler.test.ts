import { expect, test } from "bun:test"
import { SelfImprovement, SelfImprovementLearning, SelfImprovementLifecycle } from "@opencode-ai/schema"
import { Cause, Context, Effect, Exit, Layer, Schema, Scope } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { SelfImprovementApprovalStore } from "@opencode-ai/core/self-improvement/approval-store"
import { SelfImprovementAuditStore } from "@opencode-ai/core/self-improvement/audit-store"
import { SelfImprovementContextStore } from "@opencode-ai/core/self-improvement/context-store"
import { SelfImprovementIdempotencyStore } from "@opencode-ai/core/self-improvement/idempotency-store"
import { SelfImprovementLearningStore } from "@opencode-ai/core/self-improvement/learning-store"
import { SelfImprovementLifecycleCoordinator } from "@opencode-ai/core/self-improvement/lifecycle-coordinator"
import { SelfImprovementMutationStore } from "@opencode-ai/core/self-improvement/mutation-store"
import { SelfImprovementTransitionStore } from "@opencode-ai/core/self-improvement/transition-store"
import { SystemContextRegistry } from "@opencode-ai/core/system-context/registry"
import { Hash } from "@opencode-ai/core/util/hash"
import * as TestClock from "effect/testing/TestClock"
import { SelfImprovementContextReconciler } from "@opencode-ai/core/self-improvement/context-reconciler"
import { SelfImprovementGeneratedSkill } from "@opencode-ai/core/self-improvement/generated-skill"
import type { Transaction } from "@opencode-ai/core/self-improvement/context-store"
import { SystemContext } from "@opencode-ai/core/system-context"
import { it } from "./lib/effect"

const locationID = SelfImprovementLifecycle.LocationID.make("a".repeat(64))
const artifactID = SelfImprovementLifecycle.ArtifactID.make("si_art_context")
const versionID = SelfImprovementLifecycle.ArtifactVersionID.make("si_ver_context")
const digest = SelfImprovement.Digest.make("b".repeat(64))
// Fakes do not access the transaction; it only verifies transaction-B boundaries.
// oxlint-disable-next-line typescript-eslint(no-unsafe-type-assertion)
const transaction = {} as unknown as Transaction

const artifact = (
  input: {
    readonly id?: SelfImprovementLifecycle.ArtifactID
    readonly locationID?: SelfImprovementLifecycle.LocationID
    readonly kind?: "agent" | "skill"
  } = {},
) =>
  new SelfImprovementLifecycle.Artifact({
    id: input.id ?? artifactID,
    key: new SelfImprovementLifecycle.ArtifactKey({
      locationID: input.locationID ?? locationID,
      kind: input.kind ?? "skill",
      name: SelfImprovement.CandidateName.make("context"),
    }),
    status: "live",
    createdBy: SelfImprovementLifecycle.PrincipalID.make("owner"),
    createdAt: SelfImprovementLifecycle.TimestampMillis.make(0),
    revision: SelfImprovementLifecycle.Revision.make(1),
  })

const version = (overrides: Partial<SelfImprovementLifecycle.ArtifactVersion> = {}) =>
  new SelfImprovementLifecycle.ArtifactVersion({
    id: versionID,
    artifactID,
    versionNumber: 1,
    source: "human",
    behaviorClass: "instruction-only",
    proposal: Schema.decodeUnknownSync(SelfImprovement.SkillProposal)({
      kind: "skill",
      name: "context",
      definition: { description: "Context", content: 'Use <untrusted> & "quoted" guidance' },
      references: [],
    }),
    canonicalJson: SelfImprovement.CanonicalJson.make("{}"),
    proposalDigest: digest,
    inputSnapshotDigest: digest,
    versionDigest: digest,
    capabilityManifest: new SelfImprovementLifecycle.CapabilityManifest({
      toolIDs: [],
      filesystemScopeIDs: [],
      networkOriginIDs: [],
      modelRoutes: [],
      childAgentTargets: [],
      artifactReferences: [],
      denies: [],
    }),
    capabilityManifestDigest: digest,
    creatorID: SelfImprovementLifecycle.PrincipalID.make("owner"),
    createdAt: SelfImprovementLifecycle.TimestampMillis.make(0),
    ...overrides,
  })

const present = (overrides: Partial<SelfImprovementLearning.ContextDesiredState["desired"]> = {}) =>
  new SelfImprovementLearning.ContextDesiredState({
    locationID,
    artifactID,
    rolloutSlot: "shadow",
    desired: { state: "present", versionID, versionDigest: digest, stage: "shadow", ...overrides },
    desiredRevision: SelfImprovementLifecycle.Revision.make(1),
  })

const materializer = (
  input: {
    readonly getArtifact?: () => Effect.Effect<SelfImprovementLifecycle.Artifact | undefined>
    readonly getVersion?: () => Effect.Effect<SelfImprovementLifecycle.ArtifactVersion | undefined>
  } = {},
) =>
  SelfImprovementContextReconciler.materializer({
    getArtifact: input.getArtifact ?? (() => Effect.succeed(artifact())),
    getVersion: input.getVersion ?? (() => Effect.succeed(version())),
  })

const reconcilerLayer = (
  recoverable: () => Effect.Effect<ReadonlyArray<SelfImprovementLearning.ContextOutbox>>,
  pending: () => Effect.Effect<ReadonlyArray<SelfImprovementLearning.ContextOutbox>> = () => Effect.succeed([]),
) =>
  SelfImprovementContextReconciler.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Database.layerFromPath(":memory:"),
        Layer.mock(SelfImprovementApprovalStore.Service, {
          approved: () => Effect.succeed(undefined),
          consume: () => Effect.succeed(true),
          appendRollback: () => Effect.void,
        }),
        Layer.mock(SelfImprovementAuditStore.Service, { append: () => Effect.void }),
        Layer.mock(SelfImprovementContextStore.Service, {
          pending,
          recoverable,
          desired: () => Effect.succeed(undefined),
          markApplying: () => Effect.succeed(true),
          markApplied: () => Effect.succeed(true),
          reschedule: () => Effect.succeed(true),
          supersede: () => Effect.succeed(true),
          supersedeForArtifact: () => Effect.void,
          terminalGroup: () => Effect.succeed(undefined),
          blockedForArtifact: () => Effect.void,
        }),
        Layer.mock(SelfImprovementIdempotencyStore.Service, { valid: () => Effect.succeed(true) }),
        Layer.mock(SelfImprovementLearningStore.Service, { canaryRegression: () => Effect.void }),
        Layer.mock(SelfImprovementContextReconciler.Materializer, materializer()),
        Layer.mock(SelfImprovementGeneratedSkill.Service, {
          directory: () => "/generated",
          reconcile: () => Effect.void,
        }),
        Layer.mock(SelfImprovementMutationStore.Service, {
          validateRevision: () => Effect.succeed(true),
          clearTombstonedSlots: () => Effect.succeed(true),
          upsertSlot: () => Effect.succeed(true),
          removeSlot: () => Effect.succeed(true),
        }),
        AppNodeBuilder.build(SystemContextRegistry.node),
        Layer.mock(SelfImprovementTransitionStore.Service, {
          currentStage: () => Effect.succeed(undefined),
          append: () => Effect.void,
        }),
      ),
    ),
  )

it.effect("materializes only the exact desired artifact version and digest", () =>
  Effect.gen(function* () {
    for (const candidate of [
      materializer({ getArtifact: () => Effect.succeed(undefined) }),
      materializer({ getVersion: () => Effect.succeed(undefined) }),
      materializer({
        getVersion: () =>
          Effect.succeed(version({ id: SelfImprovementLifecycle.ArtifactVersionID.make("si_ver_other") })),
      }),
      materializer({
        getArtifact: () => Effect.succeed(artifact({ id: SelfImprovementLifecycle.ArtifactID.make("si_art_other") })),
      }),
      materializer({
        getArtifact: () =>
          Effect.succeed(artifact({ locationID: SelfImprovementLifecycle.LocationID.make("c".repeat(64)) })),
      }),
      materializer({
        getArtifact: () => Effect.succeed(artifact({ kind: "agent" })),
      }),
      materializer({
        getVersion: () =>
          Effect.succeed(version({ artifactID: SelfImprovementLifecycle.ArtifactID.make("si_art_other") })),
      }),
      materializer({
        getVersion: () => Effect.succeed(version({ versionDigest: SelfImprovement.Digest.make("c".repeat(64)) })),
      }),
      materializer({
        getVersion: () =>
          Effect.succeed(
            version({
              proposal: Schema.decodeUnknownSync(SelfImprovement.AgentProposal)({
                kind: "agent",
                name: "context",
                definition: { description: "Agent", system: "No", mode: "subagent", steps: 1, permissions: [] },
                references: [],
              }),
            }),
          ),
      }),
      materializer({
        getVersion: () =>
          Effect.succeed(
            version({
              proposal: Schema.decodeUnknownSync(SelfImprovement.SkillProposal)({
                kind: "skill",
                name: "other",
                definition: { description: "Context", content: "No" },
                references: [],
              }),
            }),
          ),
      }),
    ]) {
      const exit = yield* candidate.materialize(present()).pipe(Effect.exit)
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit))
        expect(Cause.squash(exit.cause)).toBeInstanceOf(SelfImprovementContextReconciler.ContextUnavailable)
    }
  }),
)

it.effect("renders one escaped, inert, subordinate envelope with deterministic source precedence", () =>
  Effect.gen(function* () {
    const result = yield* materializer().materialize(present())
    expect(result.digest).toBe(digest)
    expect(result.key).toBe(
      SystemContext.Key.make(`self-improvement/${Hash.sha256(`${locationID}\0${artifactID}\0shadow`)}`),
    )
    expect((yield* SystemContext.initialize(result.context)).baseline).toContain(
      "&lt;untrusted&gt; &amp; &quot;quoted&quot;",
    )
    expect((yield* SystemContext.initialize(result.context)).baseline).toContain('untrusted="true"')
    expect((yield* SystemContext.initialize(result.context)).baseline).toContain('subordinate="true"')
    expect((yield* SystemContext.initialize(result.context)).baseline).toContain('inert="true"')
    expect(
      (yield* SystemContext.initialize(
        SystemContext.combine([
          result.context,
          SystemContext.make({
            key: SystemContext.Key.make("self-improvement/context/zzzz"),
            codec: Schema.toCodecJson(Schema.String),
            load: Effect.succeed("later"),
            baseline: String,
            update: (_previous, current) => current,
          }),
        ]),
      )).baseline,
    ).toEndWith("later")
  }),
)

it.effect("fails Location readiness when recovery fails", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.make()
    const exit = yield* Layer.buildWithScope(
      reconcilerLayer(() => Effect.die("recover failed")),
      scope,
    ).pipe(Effect.exit)
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) expect(Cause.pretty(exit.cause)).toContain("recover failed")
    yield* Scope.close(scope, Exit.void)
  }),
)

it.effect("does not expose lifecycle service when compiled Location recovery fails", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.make()
    const exit = yield* Layer.buildWithScope(
      AppNodeBuilder.build(SelfImprovementLifecycleCoordinator.node, [
        [Database.node, Database.layerFromPath(":memory:")],
        [
          SelfImprovementContextStore.node,
          Layer.mock(SelfImprovementContextStore.Service, {
            recoverable: () => Effect.die("recover failed"),
          }),
        ],
      ]),
      scope,
    ).pipe(Effect.exit)
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) expect(Cause.pretty(exit.cause)).toContain("recover failed")
    yield* Scope.close(scope, Exit.void)
  }),
)

it.effect("owns the scheduled drain in the reconciler scope", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.make()
    let drains = 0
    const context = yield* Layer.buildWithScope(
      reconcilerLayer(
        () => Effect.succeed([]),
        () =>
          Effect.sync(() => {
            drains++
            return []
          }),
      ),
      scope,
    )
    expect(Context.get(context, SelfImprovementContextReconciler.Service)).toBeDefined()
    yield* Effect.yieldNow
    expect(drains).toBe(1)
    yield* TestClock.adjust("1 minute")
    expect(drains).toBe(2)
    yield* Scope.close(scope, Exit.void)
    yield* TestClock.adjust("1 minute")
    expect(drains).toBe(2)
  }),
)

const outbox = (
  desired: SelfImprovementLearning.ContextDesiredState,
  status: "pending" | "applying" = "pending",
  attempts = 0,
) =>
  new SelfImprovementLearning.ContextOutbox({
    id: SelfImprovementLifecycle.ContextOutboxID.make("si_obx_context"),
    locationID,
    artifactID,
    expectedArtifactRevision: SelfImprovementLifecycle.Revision.make(1),
    expectedStage: "candidate",
    desiredStateRevision: desired.desiredRevision,
    intent: new SelfImprovementLearning.PendingTransitionIntent({
      versionID,
      previousStage: "candidate",
      nextStage: "shadow",
      event: "shadow-started",
      reason: "gates-passed",
      actorID: SelfImprovementLifecycle.PrincipalID.make("coordinator"),
      idempotencyRecordID: SelfImprovementLifecycle.IdempotencyRecordID.make("si_idm_context"),
      idempotencyDigest: digest,
    }),
    status,
    attempts,
    nextRetryAt: SelfImprovementLifecycle.TimestampMillis.make(0),
    createdAt: SelfImprovementLifecycle.TimestampMillis.make(0),
  })

test("reschedules active finalization when generated skill projection is unavailable", async () => {
  const desired = new SelfImprovementLearning.ContextDesiredState({
    locationID,
    artifactID,
    rolloutSlot: "active",
    desired: { state: "present", versionID, versionDigest: digest, stage: "active" },
    desiredRevision: SelfImprovementLifecycle.Revision.make(1),
  })
  const requested = new SelfImprovementLearning.ContextOutbox({
    id: SelfImprovementLifecycle.ContextOutboxID.make("si_obx_generated_retry"),
    locationID,
    artifactID,
    expectedArtifactRevision: SelfImprovementLifecycle.Revision.make(1),
    expectedStage: "canary",
    desiredStateRevision: desired.desiredRevision,
    intent: new SelfImprovementLearning.PendingTransitionIntent({
      versionID,
      previousStage: "canary",
      nextStage: "active",
      event: "canary-passed",
      reason: "gates-passed",
      actorID: SelfImprovementLifecycle.PrincipalID.make("coordinator"),
      idempotencyRecordID: SelfImprovementLifecycle.IdempotencyRecordID.make("si_idm_generated_retry"),
      idempotencyDigest: digest,
    }),
    status: "pending",
    attempts: 0,
    nextRetryAt: SelfImprovementLifecycle.TimestampMillis.make(0),
    createdAt: SelfImprovementLifecycle.TimestampMillis.make(0),
  })
  let rescheduled = 0
  let applied = 0
  let transactions = 0
  const service = SelfImprovementContextReconciler.make({
    transaction: (work) => {
      transactions++
      return work(transaction)
    },
    approvals: {
      approved: () => Effect.succeed(undefined),
      consume: () => Effect.succeed(true),
      appendRollback: () => Effect.void,
    },
    audit: { append: () => Effect.void },
    context: {
      pending: () => Effect.succeed([requested]),
      recoverable: () => Effect.succeed([]),
      desired: () => Effect.succeed(desired),
      markApplying: () => Effect.succeed(true),
      markApplied: () => Effect.sync(() => (applied++, true)),
      reschedule: () => Effect.sync(() => (rescheduled++, true)),
      supersede: () => Effect.succeed(true),
      supersedeForArtifact: () => Effect.void,
      terminalGroup: () => Effect.succeed(undefined),
      blockedForArtifact: () => Effect.void,
    },
    idempotency: { valid: () => Effect.succeed(true) },
    learning: { appendReward: () => Effect.void, canaryRegression: () => Effect.void },
    materializer: {
      materialize: () =>
        Effect.succeed({
          key: SystemContext.Key.make("self-improvement/context/generated-retry"),
          context: SystemContext.empty,
          digest,
        }),
    },
    generatedSkills: {
      reconcile: () => Effect.fail(new SelfImprovementGeneratedSkill.Unavailable({ message: "disk unavailable" })),
    },
    mutations: {
      validateRevision: () => Effect.succeed(true),
      clearTombstonedSlots: () => Effect.succeed(true),
      upsertSlot: () => Effect.succeed(true),
      removeSlot: () => Effect.succeed(true),
    },
    registry: { compareAndSet: (input) => Effect.succeed({ applied: true, current: input.next }) },
    transitions: { currentStage: () => Effect.succeed("canary"), append: () => Effect.void },
  })

  expect(await Effect.runPromise(service.drain)).toBe(0)
  expect(rescheduled).toBe(1)
  expect(applied).toBe(0)
  expect(transactions).toBe(0)
})

const terminalOutbox = (id: SelfImprovementLifecycle.ContextOutboxID, status: "pending" | "applying" = "pending") => {
  const transition = new SelfImprovementLifecycle.StageTransition({
    id: SelfImprovementLifecycle.StageTransitionID.make(`si_trn_${id.slice(7)}`),
    versionID,
    previousStage: "shadow",
    nextStage: "archived",
    event: "version-archived",
    reason: "artifact-tombstoned",
    actorID: SelfImprovementLifecycle.PrincipalID.make("coordinator"),
    timestamp: SelfImprovementLifecycle.TimestampMillis.make(0),
    contextOutboxID: id,
    idempotencyRecordID: SelfImprovementLifecycle.IdempotencyRecordID.make("si_idm_context"),
    idempotencyDigest: digest,
  })
  return new SelfImprovementLearning.ContextOutbox({
    id,
    locationID,
    artifactID,
    expectedArtifactRevision: SelfImprovementLifecycle.Revision.make(2),
    expectedStage: "shadow",
    desiredStateRevision: SelfImprovementLifecycle.Revision.make(1),
    intent: new SelfImprovementLearning.PendingTransitionIntent({
      versionID,
      previousStage: "shadow",
      nextStage: "archived",
      event: "artifact-tombstoned",
      reason: "artifact-tombstoned",
      actorID: SelfImprovementLifecycle.PrincipalID.make("coordinator"),
      idempotencyRecordID: SelfImprovementLifecycle.IdempotencyRecordID.make("si_idm_context"),
      idempotencyDigest: digest,
      terminalGroup: { removalOutboxIDs: [id], archiveTransitions: [transition] },
    }),
    status,
    attempts: 0,
    nextRetryAt: SelfImprovementLifecycle.TimestampMillis.make(0),
    createdAt: SelfImprovementLifecycle.TimestampMillis.make(0),
  })
}

test("persists a passed-canary reward only after its context outbox finalizes", async () => {
  const promotedArtifactID = SelfImprovementLifecycle.ArtifactID.make("si_art_context_reward")
  const staleReward = new SelfImprovementLearning.RewardEvent({
    id: SelfImprovementLifecycle.RewardEventID.make("si_rew_context_stale"),
    locationID,
    pullEventID: SelfImprovementLifecycle.PullEventID.make("si_pul_context_stale"),
    outcomeClass: "passing-evidence",
    numericReward: 1,
    evidenceDigest: digest,
    timestamp: SelfImprovementLifecycle.TimestampMillis.make(0),
  })
  const promotedReward = new SelfImprovementLearning.RewardEvent({
    id: SelfImprovementLifecycle.RewardEventID.make("si_rew_context_promoted"),
    locationID,
    pullEventID: SelfImprovementLifecycle.PullEventID.make("si_pul_context_promoted"),
    outcomeClass: "passing-evidence",
    numericReward: 1,
    evidenceDigest: digest,
    timestamp: SelfImprovementLifecycle.TimestampMillis.make(0),
  })
  const pending = (input: {
    readonly id: SelfImprovementLifecycle.ContextOutboxID
    readonly artifactID: SelfImprovementLifecycle.ArtifactID
    readonly reward: SelfImprovementLearning.RewardEvent
  }) =>
    new SelfImprovementLearning.ContextOutbox({
      id: input.id,
      locationID,
      artifactID: input.artifactID,
      expectedArtifactRevision: SelfImprovementLifecycle.Revision.make(1),
      expectedStage: "canary",
      desiredStateRevision: SelfImprovementLifecycle.Revision.make(2),
      intent: new SelfImprovementLearning.PendingTransitionIntent({
        versionID,
        previousStage: "canary",
        nextStage: "active",
        event: "canary-passed",
        reason: "gates-passed",
        actorID: SelfImprovementLifecycle.PrincipalID.make("coordinator"),
        evaluationRunID: SelfImprovementLifecycle.EvaluationRunID.make("si_run_context_reward"),
        reward: input.reward,
        idempotencyRecordID: SelfImprovementLifecycle.IdempotencyRecordID.make("si_idm_context_reward"),
        idempotencyDigest: digest,
      }),
      status: "pending",
      attempts: 0,
      nextRetryAt: SelfImprovementLifecycle.TimestampMillis.make(0),
      createdAt: SelfImprovementLifecycle.TimestampMillis.make(0),
    })
  const stale = pending({
    id: SelfImprovementLifecycle.ContextOutboxID.make("si_obx_context_stale"),
    artifactID,
    reward: staleReward,
  })
  const promoted = pending({
    id: SelfImprovementLifecycle.ContextOutboxID.make("si_obx_context_promoted"),
    artifactID: promotedArtifactID,
    reward: promotedReward,
  })
  const desired = new SelfImprovementLearning.ContextDesiredState({
    locationID,
    artifactID: promotedArtifactID,
    rolloutSlot: "active",
    desired: { state: "present", versionID, versionDigest: digest, stage: "active" },
    desiredRevision: promoted.desiredStateRevision,
  })
  const rewards: SelfImprovementLearning.RewardEvent[] = []
  const service = SelfImprovementContextReconciler.make({
    transaction: (work) => work(transaction),
    approvals: {
      approved: () => Effect.succeed(undefined),
      consume: () => Effect.succeed(true),
      appendRollback: () => Effect.void,
    },
    audit: { append: () => Effect.void },
    context: {
      pending: () => Effect.succeed([stale, promoted]),
      recoverable: () => Effect.succeed([]),
      desired: (input) => Effect.succeed(input.artifactID === artifactID ? undefined : desired),
      markApplying: () => Effect.succeed(true),
      markApplied: () => Effect.succeed(true),
      reschedule: () => Effect.succeed(true),
      supersede: () => Effect.succeed(true),
      supersedeForArtifact: () => Effect.void,
      terminalGroup: () => Effect.succeed(undefined),
      blockedForArtifact: () => Effect.void,
    },
    idempotency: { valid: () => Effect.succeed(true) },
    learning: {
      appendReward: (reward) => Effect.sync(() => void rewards.push(reward)),
      canaryRegression: () => Effect.void,
    },
    materializer: {
      materialize: () =>
        Effect.succeed({
          key: SystemContext.Key.make("self-improvement/context/reward"),
          context: SystemContext.empty,
          digest,
        }),
    },
    mutations: {
      validateRevision: () => Effect.succeed(true),
      clearTombstonedSlots: () => Effect.succeed(true),
      upsertSlot: () => Effect.succeed(true),
      removeSlot: () => Effect.succeed(true),
    },
    registry: { compareAndSet: (input) => Effect.succeed({ applied: true, current: input.next }) },
    transitions: { currentStage: () => Effect.succeed("canary"), append: () => Effect.void },
  })

  expect(await Effect.runPromise(service.drain)).toBe(1)
  expect(rewards).toEqual([promotedReward])
})

test("materializes an absent desired state as an inert context before finalization", async () => {
  const desired = new SelfImprovementLearning.ContextDesiredState({
    locationID,
    artifactID,
    rolloutSlot: "shadow",
    desired: { state: "absent" },
    desiredRevision: SelfImprovementLifecycle.Revision.make(1),
  })
  const requested = outbox(desired)
  let materialized = 0
  let cas: { readonly context: SystemContext.SystemContext; readonly digest: SelfImprovement.Digest } | undefined
  const service = SelfImprovementContextReconciler.make({
    transaction: (work) => work(transaction),
    approvals: {
      approved: () => Effect.succeed(undefined),
      consume: () => Effect.succeed(true),
      appendRollback: () => Effect.void,
    },
    audit: { append: () => Effect.void },
    context: {
      pending: () => Effect.succeed([requested]),
      recoverable: () => Effect.succeed([]),
      desired: () => Effect.succeed(desired),
      markApplying: () => Effect.succeed(true),
      markApplied: () => Effect.succeed(true),
      reschedule: () => Effect.succeed(true),
      supersede: () => Effect.succeed(true),
      supersedeForArtifact: () => Effect.void,
      terminalGroup: () => Effect.succeed(undefined),
      blockedForArtifact: () => Effect.void,
    },
    idempotency: { valid: () => Effect.succeed(true) },
    learning: { appendReward: () => Effect.void, canaryRegression: () => Effect.void },
    materializer: {
      materialize: () => {
        materialized++
        return Effect.die("absent state must not reach the materializer")
      },
    },
    mutations: {
      validateRevision: () => Effect.succeed(true),
      clearTombstonedSlots: () => Effect.succeed(true),
      upsertSlot: () => Effect.succeed(true),
      removeSlot: () => Effect.succeed(true),
    },
    registry: {
      compareAndSet: (input) => {
        cas = { context: input.next.context, digest: input.next.digest }
        return Effect.succeed({ applied: true, current: input.next })
      },
    },
    transitions: { currentStage: () => Effect.succeed("candidate"), append: () => Effect.void },
  })

  expect(await Effect.runPromise(service.drain)).toBe(1)
  expect(materialized).toBe(0)
  expect(cas).toBeDefined()
  expect(await Effect.runPromise(SystemContext.initialize(cas!.context))).toEqual({ baseline: "", snapshot: {} })
})

test("blocks the artifact in a separate transaction when post-CAS finalization fails", async () => {
  const desired = new SelfImprovementLearning.ContextDesiredState({
    locationID,
    artifactID,
    rolloutSlot: "shadow",
    desired: { state: "present", versionID, versionDigest: digest, stage: "shadow" },
    desiredRevision: SelfImprovementLifecycle.Revision.make(1),
  })
  const requested = outbox(desired)
  let transactions = 0
  let blocked = 0
  const audits: string[] = []
  const service = SelfImprovementContextReconciler.make({
    transaction: (work) => {
      transactions++
      if (transactions === 1) return Effect.die("transaction B failed")
      return work(transaction)
    },
    approvals: {
      approved: () => Effect.succeed(undefined),
      consume: () => Effect.succeed(true),
      appendRollback: () => Effect.void,
    },
    audit: {
      append: (input) => {
        audits.push(input.entry.eventType)
        return Effect.void
      },
    },
    context: {
      pending: () => Effect.succeed([requested]),
      recoverable: () => Effect.succeed([]),
      desired: () => Effect.succeed(desired),
      markApplying: () => Effect.succeed(true),
      markApplied: () => Effect.succeed(true),
      reschedule: () => Effect.succeed(true),
      supersede: () => Effect.succeed(true),
      supersedeForArtifact: () => Effect.void,
      terminalGroup: () => Effect.succeed(undefined),
      blockedForArtifact: () => {
        blocked++
        return Effect.void
      },
    },
    idempotency: { valid: () => Effect.succeed(true) },
    learning: { appendReward: () => Effect.void, canaryRegression: () => Effect.void },
    materializer: {
      materialize: () =>
        Effect.succeed({
          key: SystemContext.Key.make("self-improvement/context/test"),
          context: SystemContext.empty,
          digest,
        }),
    },
    mutations: {
      validateRevision: () => Effect.succeed(true),
      clearTombstonedSlots: () => Effect.succeed(true),
      upsertSlot: () => Effect.succeed(true),
      removeSlot: () => Effect.succeed(true),
    },
    registry: { compareAndSet: (input) => Effect.succeed({ applied: true, current: input.next }) },
    transitions: { currentStage: () => Effect.succeed("candidate"), append: () => Effect.void },
  })

  expect(await Effect.runPromise(service.drain)).toBe(0)
  expect(transactions).toBe(2)
  expect(blocked).toBe(1)
  expect(audits).toEqual(["context-finalization-blocked"])
})

test("finalizes an applying outbox when recovery finds the matching CAS state", async () => {
  const desired = new SelfImprovementLearning.ContextDesiredState({
    locationID,
    artifactID,
    rolloutSlot: "shadow",
    desired: { state: "present", versionID, versionDigest: digest, stage: "shadow" },
    desiredRevision: SelfImprovementLifecycle.Revision.make(1),
  })
  const requested = outbox(desired, "applying")
  let applied = 0
  let casCalls = 0
  const service = SelfImprovementContextReconciler.make({
    transaction: (work) => work(transaction),
    approvals: {
      approved: () => Effect.succeed(undefined),
      consume: () => Effect.succeed(true),
      appendRollback: () => Effect.void,
    },
    audit: { append: () => Effect.void },
    context: {
      pending: () => Effect.succeed([]),
      recoverable: () => Effect.succeed([requested]),
      desired: () => Effect.succeed(desired),
      markApplying: () => Effect.succeed(true),
      markApplied: () => {
        applied++
        return Effect.succeed(true)
      },
      reschedule: () => Effect.succeed(true),
      supersede: () => Effect.succeed(true),
      supersedeForArtifact: () => Effect.void,
      terminalGroup: () => Effect.succeed(undefined),
      blockedForArtifact: () => Effect.void,
    },
    idempotency: { valid: () => Effect.succeed(true) },
    learning: { appendReward: () => Effect.void, canaryRegression: () => Effect.void },
    materializer: {
      materialize: () =>
        Effect.succeed({
          key: SystemContext.Key.make("self-improvement/context/recover"),
          context: SystemContext.empty,
          digest,
        }),
    },
    mutations: {
      validateRevision: () => Effect.succeed(true),
      clearTombstonedSlots: () => Effect.succeed(true),
      upsertSlot: () => Effect.succeed(true),
      removeSlot: () => Effect.succeed(true),
    },
    registry: {
      compareAndSet: () => {
        casCalls++
        return Effect.succeed({
          applied: false,
          current: {
            revision: desired.desiredRevision,
            digest,
            context: SystemContext.empty,
          },
        })
      },
    },
    transitions: { currentStage: () => Effect.succeed("candidate"), append: () => Effect.void },
  })

  expect(await Effect.runPromise(service.recover)).toBe(1)
  expect(casCalls).toBe(1)
  expect(applied).toBe(1)
})

it.effect("uses the CAS-success time when rechecking and consuming approval", () =>
  Effect.gen(function* () {
    const desired = new SelfImprovementLearning.ContextDesiredState({
      locationID,
      artifactID,
      rolloutSlot: "shadow",
      desired: { state: "present", versionID, versionDigest: digest, stage: "shadow" },
      desiredRevision: SelfImprovementLifecycle.Revision.make(1),
    })
    const requested = new SelfImprovementLearning.ContextOutbox({
      id: SelfImprovementLifecycle.ContextOutboxID.make("si_obx_context"),
      locationID,
      artifactID,
      expectedArtifactRevision: SelfImprovementLifecycle.Revision.make(1),
      expectedStage: "candidate",
      desiredStateRevision: desired.desiredRevision,
      intent: new SelfImprovementLearning.PendingTransitionIntent({
        versionID,
        previousStage: "candidate",
        nextStage: "shadow",
        event: "shadow-started",
        reason: "gates-passed",
        actorID: SelfImprovementLifecycle.PrincipalID.make("coordinator"),
        idempotencyRecordID: SelfImprovementLifecycle.IdempotencyRecordID.make("si_idm_context"),
        idempotencyDigest: digest,
        approvalID: SelfImprovementLifecycle.ApprovalID.make("si_app_context"),
        approvalBinding: new SelfImprovementLifecycle.ApprovalBinding({
          versionID,
          versionDigest: digest,
          suiteID: SelfImprovementLifecycle.SuiteID.make("si_sui_context"),
          suiteRevision: SelfImprovementLifecycle.Revision.make(1),
          evaluationRunID: SelfImprovementLifecycle.EvaluationRunID.make("si_run_context"),
          shadowEvidenceDigest: digest,
        }),
      }),
      status: "pending",
      attempts: 0,
      nextRetryAt: SelfImprovementLifecycle.TimestampMillis.make(0),
      createdAt: SelfImprovementLifecycle.TimestampMillis.make(0),
    })
    const approvalTimes: SelfImprovementLifecycle.TimestampMillis[] = []
    const approvalIDs: SelfImprovementLifecycle.ApprovalID[] = []
    const consumed: SelfImprovementLifecycle.TimestampMillis[] = []
    let desiredReads = 0
    const service = SelfImprovementContextReconciler.make({
      transaction: (work) => work(transaction),
      approvals: {
        approved: (input) => {
          approvalTimes.push(input.at)
          approvalIDs.push(input.approvalID)
          return Effect.succeed(
            new SelfImprovementLifecycle.Approval({
              id: SelfImprovementLifecycle.ApprovalID.make("si_app_context"),
              requestID: SelfImprovementLifecycle.ApprovalRequestID.make("si_apr_context"),
              locationID,
              binding: input.binding,
              decision: new SelfImprovementLifecycle.ApprovalGranted({
                approverID: SelfImprovementLifecycle.PrincipalID.make("approver"),
                decidedAt: SelfImprovementLifecycle.TimestampMillis.make(0),
                expiresAt: SelfImprovementLifecycle.TimestampMillis.make(86_400_000),
              }),
            }),
          )
        },
        consume: (_locationID, _approvalID, appliedAt) => {
          consumed.push(appliedAt)
          return Effect.succeed(true)
        },
        appendRollback: () => Effect.void,
      },
      audit: { append: () => Effect.void },
      context: {
        pending: () => Effect.succeed([requested]),
        recoverable: () => Effect.succeed([]),
        desired: () => {
          desiredReads++
          return desiredReads === 1 ? Effect.succeed(desired) : TestClock.adjust(1).pipe(Effect.as(desired))
        },
        markApplying: () => Effect.succeed(true),
        markApplied: () => Effect.succeed(true),
        reschedule: () => Effect.succeed(true),
        supersede: () => Effect.succeed(true),
        supersedeForArtifact: () => Effect.void,
        terminalGroup: () => Effect.succeed(undefined),
        blockedForArtifact: () => Effect.void,
      },
      idempotency: { valid: () => Effect.succeed(true) },
      learning: { appendReward: () => Effect.void, canaryRegression: () => Effect.void },
      materializer: {
        materialize: () =>
          Effect.succeed({
            key: SystemContext.Key.make("self-improvement/context/approval"),
            context: SystemContext.empty,
            digest,
          }),
      },
      mutations: {
        validateRevision: () => Effect.succeed(true),
        clearTombstonedSlots: () => Effect.succeed(true),
        upsertSlot: () => Effect.succeed(true),
        removeSlot: () => Effect.succeed(true),
      },
      registry: { compareAndSet: (input) => Effect.succeed({ applied: true, current: input.next }) },
      transitions: { currentStage: () => Effect.succeed("candidate"), append: () => Effect.void },
    })

    yield* TestClock.setTime(100)
    expect(yield* service.drain).toBe(1)
    expect(approvalTimes).toEqual([
      SelfImprovementLifecycle.TimestampMillis.make(100),
      SelfImprovementLifecycle.TimestampMillis.make(100),
    ])
    expect(approvalIDs).toEqual([
      SelfImprovementLifecycle.ApprovalID.make("si_app_context"),
      SelfImprovementLifecycle.ApprovalID.make("si_app_context"),
    ])
    expect(consumed).toEqual([SelfImprovementLifecycle.TimestampMillis.make(100)])
  }),
)

test("appends a redacted retry audit before rescheduling unavailable materialization", async () => {
  const desired = new SelfImprovementLearning.ContextDesiredState({
    locationID,
    artifactID,
    rolloutSlot: "shadow",
    desired: { state: "present", versionID, versionDigest: digest, stage: "shadow" },
    desiredRevision: SelfImprovementLifecycle.Revision.make(1),
  })
  const requested = outbox(desired)
  const events: string[] = []
  const service = SelfImprovementContextReconciler.make({
    transaction: (work) => work(transaction),
    approvals: {
      approved: () => Effect.succeed(undefined),
      consume: () => Effect.succeed(true),
      appendRollback: () => Effect.void,
    },
    audit: { append: (input) => Effect.sync(() => events.push(input.entry.eventType)) },
    context: {
      pending: () => Effect.succeed([requested]),
      recoverable: () => Effect.succeed([]),
      desired: () => Effect.succeed(desired),
      markApplying: () => Effect.succeed(true),
      markApplied: () => Effect.succeed(true),
      reschedule: () =>
        Effect.sync(() => {
          events.push("rescheduled")
          return true
        }),
      supersede: () => Effect.succeed(true),
      supersedeForArtifact: () => Effect.void,
      terminalGroup: () => Effect.succeed(undefined),
      blockedForArtifact: () => Effect.void,
    },
    idempotency: { valid: () => Effect.succeed(true) },
    learning: { appendReward: () => Effect.void, canaryRegression: () => Effect.void },
    materializer: {
      materialize: () => Effect.fail(new SelfImprovementContextReconciler.ContextUnavailable({ message: "offline" })),
    },
    mutations: {
      validateRevision: () => Effect.succeed(true),
      clearTombstonedSlots: () => Effect.succeed(true),
      upsertSlot: () => Effect.succeed(true),
      removeSlot: () => Effect.succeed(true),
    },
    registry: { compareAndSet: (input) => Effect.succeed({ applied: true, current: input.next }) },
    transitions: { currentStage: () => Effect.succeed("candidate"), append: () => Effect.void },
  })

  await Effect.runPromise(Effect.exit(service.drain))
  expect(events).toEqual(["context-change-retry", "rescheduled"])
})

it.effect("caps retry delay including deterministic jitter at five minutes", () =>
  Effect.gen(function* () {
    const desired = new SelfImprovementLearning.ContextDesiredState({
      locationID,
      artifactID,
      rolloutSlot: "shadow",
      desired: { state: "present", versionID, versionDigest: digest, stage: "shadow" },
      desiredRevision: SelfImprovementLifecycle.Revision.make(1),
    })
    const requested = outbox(desired, "pending", 20)
    let scheduledAt: SelfImprovementLifecycle.TimestampMillis | undefined
    const service = SelfImprovementContextReconciler.make({
      transaction: (work) => work(transaction),
      approvals: {
        approved: () => Effect.succeed(undefined),
        consume: () => Effect.succeed(true),
        appendRollback: () => Effect.void,
      },
      audit: { append: () => Effect.void },
      context: {
        pending: () => Effect.succeed([requested]),
        recoverable: () => Effect.succeed([]),
        desired: () => Effect.succeed(desired),
        markApplying: () => Effect.succeed(true),
        markApplied: () => Effect.succeed(true),
        reschedule: (_id, nextRetryAt) =>
          Effect.sync(() => {
            scheduledAt = nextRetryAt
            return true
          }),
        supersede: () => Effect.succeed(true),
        supersedeForArtifact: () => Effect.void,
        terminalGroup: () => Effect.succeed(undefined),
        blockedForArtifact: () => Effect.void,
      },
      idempotency: { valid: () => Effect.succeed(true) },
      learning: { appendReward: () => Effect.void, canaryRegression: () => Effect.void },
      materializer: {
        materialize: () => Effect.fail(new SelfImprovementContextReconciler.ContextUnavailable({ message: "offline" })),
      },
      mutations: {
        validateRevision: () => Effect.succeed(true),
        clearTombstonedSlots: () => Effect.succeed(true),
        upsertSlot: () => Effect.succeed(true),
        removeSlot: () => Effect.succeed(true),
      },
      registry: { compareAndSet: (input) => Effect.succeed({ applied: true, current: input.next }) },
      transitions: { currentStage: () => Effect.succeed("candidate"), append: () => Effect.void },
    })

    yield* TestClock.setTime(100)
    yield* Effect.exit(service.drain)
    expect(scheduledAt).toBe(SelfImprovementLifecycle.TimestampMillis.make(300_100))
  }),
)

test("marks a non-final terminal peer applied without archiving or clearing slots", async () => {
  const requested = terminalOutbox(SelfImprovementLifecycle.ContextOutboxID.make("si_obx_terminal_partial"))
  const desired = new SelfImprovementLearning.ContextDesiredState({
    locationID,
    artifactID,
    rolloutSlot: "shadow",
    desired: { state: "absent" },
    desiredRevision: requested.desiredStateRevision,
  })
  let applied = 0
  let removed = 0
  let cleared = 0
  const transitions: string[] = []
  const service = SelfImprovementContextReconciler.make({
    transaction: (work) => work(transaction),
    approvals: {
      approved: () => Effect.succeed(undefined),
      consume: () => Effect.succeed(true),
      appendRollback: () => Effect.void,
    },
    audit: { append: () => Effect.void },
    context: {
      pending: () => Effect.succeed([requested]),
      recoverable: () => Effect.succeed([]),
      desired: () => Effect.succeed(desired),
      markApplying: () => Effect.succeed(true),
      markApplied: () => Effect.sync(() => ++applied > 0),
      reschedule: () => Effect.succeed(true),
      supersede: () => Effect.succeed(true),
      supersedeForArtifact: () => Effect.void,
      terminalGroup: () => Effect.succeed(undefined),
      blockedForArtifact: () => Effect.void,
    },
    idempotency: { valid: () => Effect.succeed(true) },
    learning: { appendReward: () => Effect.void, canaryRegression: () => Effect.void },
    materializer: { materialize: () => Effect.die("absent") },
    mutations: {
      validateRevision: () => Effect.succeed(true),
      clearTombstonedSlots: () => Effect.sync(() => ++cleared > 0),
      upsertSlot: () => Effect.succeed(true),
      removeSlot: () => Effect.sync(() => ++removed > 0),
    },
    registry: { compareAndSet: (input) => Effect.succeed({ applied: true, current: input.next }) },
    transitions: {
      currentStage: () => Effect.succeed("shadow"),
      append: (input) => Effect.sync(() => transitions.push(input.transition.id)),
    },
  })

  expect(await Effect.runPromise(service.drain)).toBe(1)
  expect({ applied, removed, cleared, transitions }).toEqual({ applied: 1, removed: 0, cleared: 0, transitions: [] })
})

test("archives and clears exactly once when terminal recovery reaches the final peer", async () => {
  const requested = terminalOutbox(SelfImprovementLifecycle.ContextOutboxID.make("si_obx_terminal_final"), "applying")
  const desired = new SelfImprovementLearning.ContextDesiredState({
    locationID,
    artifactID,
    rolloutSlot: "shadow",
    desired: { state: "absent" },
    desiredRevision: requested.desiredStateRevision,
  })
  const archived: string[] = []
  let cleared = 0
  let applied = 0
  const service = SelfImprovementContextReconciler.make({
    transaction: (work) => work(transaction),
    approvals: {
      approved: () => Effect.succeed(undefined),
      consume: () => Effect.succeed(true),
      appendRollback: () => Effect.void,
    },
    audit: { append: () => Effect.void },
    context: {
      pending: () => Effect.succeed([]),
      recoverable: () => Effect.succeed([requested]),
      desired: () => Effect.succeed(desired),
      markApplying: () => Effect.succeed(true),
      markApplied: () => Effect.sync(() => ++applied > 0),
      reschedule: () => Effect.succeed(true),
      supersede: () => Effect.succeed(true),
      supersedeForArtifact: () => Effect.void,
      terminalGroup: () => Effect.succeed([requested]),
      blockedForArtifact: () => Effect.void,
    },
    idempotency: { valid: () => Effect.succeed(true) },
    learning: { appendReward: () => Effect.void, canaryRegression: () => Effect.void },
    materializer: { materialize: () => Effect.die("absent") },
    mutations: {
      validateRevision: (input) => Effect.succeed(input.status === "tombstoned"),
      clearTombstonedSlots: () => Effect.sync(() => ++cleared > 0),
      upsertSlot: () => Effect.succeed(true),
      removeSlot: () => Effect.die("terminal peer must not remove a singular slot"),
    },
    registry: { compareAndSet: (input) => Effect.succeed({ applied: false, current: input.next }) },
    transitions: {
      currentStage: () => Effect.succeed("shadow"),
      append: (input) => Effect.sync(() => archived.push(input.transition.id)),
    },
  })

  expect(await Effect.runPromise(service.recover)).toBe(1)
  expect(archived).toEqual(requested.intent.terminalGroup!.archiveTransitions.map((transition) => transition.id))
  expect({ cleared, applied }).toEqual({ cleared: 1, applied: 1 })
})
