import { expect, test } from "bun:test"
import { Deferred, Effect, Fiber, Schema } from "effect"
import { SelfImprovement, SelfImprovementEvaluation, SelfImprovementLifecycle } from "@opencode-ai/schema"
import { ConfigExperimental } from "@opencode-ai/core/config/experimental"
import { SelfImprovementAutomation } from "@opencode-ai/core/self-improvement/automation"

const locationID = SelfImprovementLifecycle.LocationID.make("a".repeat(64))
const now = SelfImprovementLifecycle.TimestampMillis.make(1_000)
const revision = SelfImprovementLifecycle.Revision.make(1)
const workload = SelfImprovementEvaluation.Workload.make("backend-fix")
const patternDigest = SelfImprovement.Digest.make("b".repeat(64))
const orderedToolSymbolDigest = SelfImprovement.Digest.make("e".repeat(64))
const pattern = (
  digest = patternDigest,
  outcomeClass: "success" | "failure" | "cancelled" = "failure",
) => ({
  patternDigest: digest,
  workload,
  workloadRevision: revision,
  errorClass: outcomeClass === "failure" ? "tool.bash.failed" : "none",
  orderedToolSymbolDigest,
  outcomeClass,
})
const artifactID = SelfImprovementLifecycle.ArtifactID.make("si_art_generated")
const versionID = SelfImprovementLifecycle.ArtifactVersionID.make("si_ver_generated")
const baseline = {
  id: SelfImprovementLifecycle.BaselineID.make("si_bas_automation"),
  workload,
  workloadRevision: revision,
  suiteID: SelfImprovementLifecycle.SuiteID.make("si_sui_automation"),
  suiteRevision: revision,
}
const settings = {
  enabled: true,
  autoApprove: true,
  intervalSeconds: 60,
  evaluationWindowMillis: 60_000,
}
const approvalBinding = new SelfImprovementLifecycle.ApprovalBinding({
  versionID,
  versionDigest: SelfImprovement.Digest.make("f".repeat(64)),
  suiteID: baseline.suiteID,
  suiteRevision: revision,
  evaluationRunID: SelfImprovementLifecycle.EvaluationRunID.make("si_run_approval"),
  shadowEvidenceDigest: SelfImprovement.Digest.make("9".repeat(64)),
})
const pendingApproval = new SelfImprovementLifecycle.ApprovalRequest({
  id: SelfImprovementLifecycle.ApprovalRequestID.make("si_apr_automation"),
  locationID,
  binding: approvalBinding,
  creatorID: SelfImprovementLifecycle.PrincipalID.make("creator"),
  requestedAt: now,
})

const work = (stage: SelfImprovementLifecycle.ArtifactStage = "draft") => ({
  artifactID,
  versionID,
  stage,
  workload,
  workloadRevision: revision,
})

const dependencies = (overrides: Partial<SelfImprovementAutomation.Dependencies> = {}) =>
  SelfImprovementAutomation.dependencies({
    now: Effect.succeed(now),
    seedGenerationStrategy: Effect.void,
    listEligiblePatterns: () => Effect.succeed([pattern()]),
    generate: () => Effect.succeed("admitted" as const),
    listGeneratedWork: () => Effect.succeed([work()]),
    listBaselines: () => Effect.succeed([baseline]),
    prepareShadow: () => Effect.void,
    listRuns: () => Effect.succeed([]),
    createRun: () => Effect.void,
    decideRun: () => Effect.void,
    listPendingApprovals: () => Effect.succeed([]),
    approve: () => Effect.void,
    reconcile: Effect.succeed(0),
    ...overrides,
  })

test("reports settings and completed automation tick state", async () => {
  const service = SelfImprovementAutomation.make({ locationID, settings, dependencies: dependencies() })

  expect(await Effect.runPromise(service.status)).toEqual({ settings, running: false })
  const result = await Effect.runPromise(service.tick)
  expect(await Effect.runPromise(service.status)).toEqual({
    settings,
    running: false,
    lastStartedAt: now,
    lastCompletedAt: now,
    lastResult: result,
  })
})

test("refreshes effective settings before reporting status and running a tick", async () => {
  let current = { ...settings, enabled: false }
  let called = false
  const service = SelfImprovementAutomation.make({
    locationID,
    settings: current,
    loadSettings: Effect.sync(() => current),
    dependencies: dependencies({
      listEligiblePatterns: () => Effect.sync(() => (called = true)).pipe(Effect.as([])),
      listGeneratedWork: () => Effect.succeed([]),
    }),
  })

  expect((await Effect.runPromise(service.status)).settings.enabled).toBe(false)
  expect(await Effect.runPromise(service.tick)).toEqual(SelfImprovementAutomation.emptyResult)
  expect(called).toBe(false)

  current = { ...settings, enabled: true, intervalSeconds: 30 }
  expect((await Effect.runPromise(service.status)).settings).toEqual(current)
  await Effect.runPromise(service.tick)
  expect(called).toBe(true)
})

test("reports a running tick before it settles", async () => {
  const started = Deferred.makeUnsafe<void>()
  const release = Deferred.makeUnsafe<void>()
  const service = SelfImprovementAutomation.make({
    locationID,
    settings,
    dependencies: dependencies({
      listEligiblePatterns: () =>
        Deferred.succeed(started, undefined).pipe(Effect.andThen(Deferred.await(release)), Effect.as([])),
      listGeneratedWork: () => Effect.succeed([]),
    }),
  })

  const fiber = Effect.runFork(service.tick)
  await Effect.runPromise(Deferred.await(started))
  expect(await Effect.runPromise(service.status)).toMatchObject({ settings, running: true, lastStartedAt: now })
  await Effect.runPromise(Deferred.succeed(release, undefined))
  await Effect.runPromise(Fiber.join(fiber))
  expect((await Effect.runPromise(service.status)).running).toBe(false)
})

test("automatically generates eligible evidence, prepares shadow, and opens its first run", async () => {
  const calls: string[] = []
  const service = SelfImprovementAutomation.make({
    locationID,
    settings,
    dependencies: dependencies({
      generate: () => Effect.sync(() => calls.push("generate")).pipe(Effect.as("admitted" as const)),
      prepareShadow: () => Effect.sync(() => calls.push("prepare-shadow")),
      createRun: (input) =>
        Effect.sync(() => {
          calls.push(`create-${input.stage}`)
          expect(Number(input.cutoffAt)).toBe(Number(now) + settings.evaluationWindowMillis)
          expect(input.baseline.id).toBe(baseline.id)
        }),
      reconcile: Effect.sync(() => calls.push("reconcile")).pipe(Effect.as(1)),
    }),
  })

  const result = await Effect.runPromise(service.tick)

  expect(result).toEqual({
    eligiblePatterns: 1,
    generated: 1,
    prepared: 1,
    runsCreated: 1,
    runsDecided: 0,
    reconciled: 1,
    failures: 0,
  })
  expect(calls).toEqual(["generate", "prepare-shadow", "create-shadow", "reconcile"])
})

test("decides only expired runs backed by real accepted samples", async () => {
  const decided: SelfImprovementLifecycle.EvaluationRunID[] = []
  const expired = {
    id: SelfImprovementLifecycle.EvaluationRunID.make("si_run_expired"),
    versionID,
    stage: "shadow" as const,
    state: "open" as const,
    cutoffAt: now,
    cutoffSampleSetDigest: SelfImprovement.Digest.make("c".repeat(64)),
  }
  const future = {
    ...expired,
    id: SelfImprovementLifecycle.EvaluationRunID.make("si_run_future"),
    cutoffAt: SelfImprovementLifecycle.TimestampMillis.make(now + 1),
  }
  const empty = {
    ...expired,
    id: SelfImprovementLifecycle.EvaluationRunID.make("si_run_empty"),
    cutoffSampleSetDigest: undefined,
  }
  const service = SelfImprovementAutomation.make({
    locationID,
    settings,
    dependencies: dependencies({
      listEligiblePatterns: () => Effect.succeed([]),
      listGeneratedWork: () => Effect.succeed([]),
      listRuns: (input) => Effect.succeed(input.state === "open" ? [expired, future, empty] : []),
      decideRun: (input) => Effect.sync(() => decided.push(input.run.id)),
    }),
  })

  const result = await Effect.runPromise(service.tick)

  expect(decided).toEqual([expired.id])
  expect(result.runsDecided).toBe(1)
  expect(result.failures).toBe(0)
})

test("does not duplicate an existing stage run and isolates one failed pattern", async () => {
  const secondPattern = SelfImprovement.Digest.make("d".repeat(64))
  let created = 0
  const existing = {
    id: SelfImprovementLifecycle.EvaluationRunID.make("si_run_existing"),
    versionID,
    stage: "shadow" as const,
    state: "open" as const,
    cutoffAt: SelfImprovementLifecycle.TimestampMillis.make(now + 10_000),
  }
  const service = SelfImprovementAutomation.make({
    locationID,
    settings,
    dependencies: dependencies({
      listEligiblePatterns: () => Effect.succeed([pattern(), pattern(secondPattern)]),
      generate: (input) =>
        input.pattern.patternDigest === patternDigest
          ? Effect.fail(new Error("model unavailable"))
          : Effect.succeed("admitted"),
      listGeneratedWork: () => Effect.succeed([work("shadow")]),
      listRuns: (input) => Effect.succeed(input.versionID ? [existing] : []),
      createRun: () => Effect.sync(() => created++),
    }),
  })

  const result = await Effect.runPromise(service.tick)

  expect(created).toBe(0)
  expect(result.generated).toBe(1)
  expect(result.failures).toBe(1)
})

test("seeds one default generation strategy before processing patterns", async () => {
  const calls: string[] = []
  const service = SelfImprovementAutomation.make({
    locationID,
    settings,
    dependencies: dependencies({
      seedGenerationStrategy: Effect.sync(() => calls.push("seed")),
      listEligiblePatterns: () => Effect.sync(() => calls.push("patterns")).pipe(Effect.as([])),
      listGeneratedWork: () => Effect.succeed([]),
    }),
  })

  await Effect.runPromise(service.tick)

  expect(calls).toEqual(["seed", "patterns"])
})

test("ignores successful observation patterns", async () => {
  let generated = 0
  const service = SelfImprovementAutomation.make({
    locationID,
    settings,
    dependencies: dependencies({
      listEligiblePatterns: () => Effect.succeed([pattern(patternDigest, "success")]),
      generate: () => Effect.sync(() => generated++).pipe(Effect.as("admitted" as const)),
      listGeneratedWork: () => Effect.succeed([]),
    }),
  })

  const result = await Effect.runPromise(service.tick)

  expect(generated).toBe(0)
  expect(result.eligiblePatterns).toBe(0)
})

test("passes privacy-safe pattern metadata to generation", async () => {
  const expected = pattern()
  let received: unknown
  const service = SelfImprovementAutomation.make({
    locationID,
    settings,
    dependencies: dependencies({
      listEligiblePatterns: () => Effect.succeed([expected]),
      generate: (input) => Effect.sync(() => (received = input)).pipe(Effect.as("admitted" as const)),
      listGeneratedWork: () => Effect.succeed([]),
    }),
  })

  await Effect.runPromise(service.tick)

  expect(received).toEqual({ pattern: expected, now })
  expect(JSON.stringify(received)).not.toContain("prompt")
})

test("automatically approves pending governed requests", async () => {
  const calls: string[] = []
  const service = SelfImprovementAutomation.make({
    locationID,
    settings,
    dependencies: dependencies({
      listEligiblePatterns: () => Effect.succeed([]),
      listGeneratedWork: () => Effect.succeed([]),
      listPendingApprovals: () => Effect.succeed([pendingApproval]),
      approve: (input) =>
        Effect.sync(() => {
          expect(input.request.id).toBe(pendingApproval.id)
          expect(input.request.binding).toEqual(approvalBinding)
          calls.push("approve")
        }),
      reconcile: Effect.sync(() => calls.push("reconcile")).pipe(Effect.as(0)),
    }),
  })

  const result = await Effect.runPromise(service.tick)

  expect(calls).toEqual(["approve", "reconcile"])
  expect(result.failures).toBe(0)
})

test("does not approve when automatic approval is disabled", async () => {
  let listed = 0
  const service = SelfImprovementAutomation.make({
    locationID,
    settings: { ...settings, autoApprove: false },
    dependencies: dependencies({
      listEligiblePatterns: () => Effect.succeed([]),
      listGeneratedWork: () => Effect.succeed([]),
      listPendingApprovals: () => Effect.sync(() => listed++).pipe(Effect.as([pendingApproval])),
    }),
  })

  await Effect.runPromise(service.tick)

  expect(listed).toBe(0)
})

test("isolates automatic approval failure and continues reconciliation", async () => {
  let reconciled = 0
  const service = SelfImprovementAutomation.make({
    locationID,
    settings,
    dependencies: dependencies({
      listEligiblePatterns: () => Effect.succeed([]),
      listGeneratedWork: () => Effect.succeed([]),
      listPendingApprovals: () => Effect.succeed([pendingApproval]),
      approve: () => Effect.fail(new Error("approval failed")),
      reconcile: Effect.sync(() => reconciled++).pipe(Effect.as(0)),
    }),
  })

  const result = await Effect.runPromise(service.tick)

  expect(reconciled).toBe(1)
  expect(result.failures).toBe(1)
})

test("accepts bounded opt-in automation config", () => {
  const decoded = Schema.decodeUnknownSync(ConfigExperimental.Experimental)({
    self_improvement: {
      automatic: true,
      auto_approve: true,
      interval_seconds: 30,
      evaluation_window_minutes: 120,
      evidence_principal_id: "runtime-evidence",
    },
  })

  expect(decoded.self_improvement?.automatic).toBe(true)
  expect(decoded.self_improvement?.auto_approve).toBe(true)
  expect(decoded.self_improvement?.interval_seconds).toBe(30)
  expect(decoded.self_improvement?.evaluation_window_minutes).toBe(120)
  expect(String(decoded.self_improvement?.evidence_principal_id)).toBe("runtime-evidence")
  expect(() =>
    Schema.decodeUnknownSync(ConfigExperimental.Experimental)({
      self_improvement: { automatic: true, interval_seconds: 1 },
    }),
  ).toThrow()
})

test("disabled automation is side-effect free", async () => {
  let called = false
  const service = SelfImprovementAutomation.make({
    locationID,
    settings: { ...settings, enabled: false },
    dependencies: dependencies({
      listEligiblePatterns: () => Effect.sync(() => (called = true)).pipe(Effect.as([])),
    }),
  })

  expect(await Effect.runPromise(service.tick)).toEqual(SelfImprovementAutomation.emptyResult)
  expect(called).toBe(false)
})
