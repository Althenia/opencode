import { expect, test } from "bun:test"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { SelfImprovementSessionObserver } from "@opencode-ai/core/self-improvement/session-observer"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { SessionSchema } from "@opencode-ai/core/session/schema"
import { Agent, Money, SelfImprovement, SelfImprovementEvaluation, SelfImprovementLifecycle } from "@opencode-ai/schema"
import { Hash } from "@opencode-ai/core/util/hash"
import { DateTime, Effect, Exit } from "effect"

const locationID = SelfImprovementLifecycle.LocationID.make("a".repeat(64))
const sessionID = SessionSchema.ID.make("ses_observer")
const at = (millis: number) => DateTime.makeUnsafe(millis)
const messageID = (value: string) => SessionMessage.ID.make(`msg_${value}`)

const user = (id: string, created: number) =>
  SessionMessage.User.make({
    id: messageID(id),
    type: "user",
    text: "secret prompt that must never be retained",
    files: [],
    agents: [],
    time: { created: at(created) },
  })

const assistant = SessionMessage.Assistant.make({
  id: messageID("assistant"),
  type: "assistant",
  agent: Agent.ID.make("build"),
  model: { id: ModelV2.ID.make("model"), providerID: ProviderV2.ID.make("provider") },
  content: [
    SessionMessage.AssistantTool.make({
      type: "tool",
      id: "tool-1",
      name: "read",
      state: {
        status: "completed",
        input: { path: "/secret" },
        structured: {},
        content: [{ type: "text", text: "secret output" }],
      },
      time: { created: at(1_200), completed: at(1_500) },
    }),
  ],
  finish: "stop",
  cost: Money.USD.zero,
  tokens: { input: 10, output: 5, reasoning: 1, cache: { read: 2, write: 0 } },
  time: { created: at(1_100), completed: at(2_000) },
})

const failedAssistant = SessionMessage.Assistant.make({
  ...assistant,
  id: messageID("failed-assistant"),
  content: [
    SessionMessage.AssistantTool.make({
      type: "tool",
      id: "tool-failed",
      name: "bash",
      state: {
        status: "error",
        input: { command: "secret command" },
        structured: {},
        content: [{ type: "text", text: "secret failure output" }],
        error: { type: "unknown", message: "database password leaked" },
      },
      time: { created: at(1_200), completed: at(1_800) },
    }),
  ],
})

const providerFailedAssistant = SessionMessage.Assistant.make({
  ...assistant,
  id: messageID("provider-failed-assistant"),
  content: [],
  error: { type: "unknown", message: "secret provider response" },
})

const evidence = (index: number): SelfImprovementSessionObserver.Evidence => {
  const successful = index % 5 === 0 ? 0 : 1
  const taskIDDigest = SelfImprovement.Digest.make(Hash.sha256(`task-${index}`))
  const metrics = new SelfImprovementEvaluation.MetricComponents({
    taskQuality: { earnedAllowlistedPoints: successful, possibleAllowlistedPoints: 1 },
    correctness: { passedRequiredChecks: successful, requiredChecks: 1 },
    repeatFixRate: { repeatedTasks: 0, completedTasks: 1 },
    precision: { acceptedRelevantItems: successful, assessedItems: 1 },
    latencyMs: 100 + index,
    tokensPerSuccess: new SelfImprovementEvaluation.TokensPerSuccessMetric({
      inputTokens: 10,
      outputTokens: 5,
      successfulTasks: successful,
    }),
    cacheHitRatio: { cacheReadTokens: 2, cacheEligibleTokens: 12 },
  })
  const sampleIDDigest = SelfImprovement.Digest.make(Hash.sha256(`sample-${index}`))
  return {
    taskIDDigest,
    sampleIDDigest,
    requestDigest: SelfImprovement.Digest.make(Hash.sha256(`request-${index}`)),
    workload: SelfImprovementEvaluation.Workload.make("agent:build"),
    workloadRevision: SelfImprovementLifecycle.Revision.make(1),
    producerID: SelfImprovementLifecycle.PrincipalID.make("self-improvement-runtime-evidence"),
    outcomeClass: successful ? "success" : "failure",
    outcome: successful ? "success" : "failure",
    errorClass: successful ? "none" : "tool.bash.failed",
    orderedToolSymbolIDs: ["bash"],
    metrics,
    startedAt: SelfImprovementLifecycle.TimestampMillis.make(index * 1_000),
    terminalAt: SelfImprovementLifecycle.TimestampMillis.make(index * 1_000 + 100),
  }
}

test("isolates observer defects from the completed prompt", async () => {
  const service = SelfImprovementSessionObserver.make({
    locationID,
    settings: { enabled: true },
    dependencies: SelfImprovementSessionObserver.dependencies({
      loadMessages: () => Effect.die("database unavailable"),
      insertEvidence: () => Effect.die("unused"),
      listControlEvidence: () => Effect.die("unused"),
      listBaselines: () => Effect.die("unused"),
      putSuiteRevision: () => Effect.die("unused"),
      bootstrapBaseline: () => Effect.die("unused"),
      listOpenRuns: () => Effect.die("unused"),
      recordObservation: () => Effect.die("unused"),
      appendSample: () => Effect.die("unused"),
    }),
  })

  const result = await Effect.runPromiseExit(service.record({ sessionID, exit: Exit.succeed(undefined) }))

  expect(Exit.isSuccess(result)).toBe(true)
})

test("records one privacy-safe observation for a successful prompt cycle", async () => {
  const observations: SelfImprovementSessionObserver.Evidence[] = []
  const persisted: SelfImprovementSessionObserver.Evidence[] = []
  const service = SelfImprovementSessionObserver.make({
    locationID,
    settings: { enabled: true },
    dependencies: SelfImprovementSessionObserver.dependencies({
      loadMessages: () => Effect.succeed([user("user", 1_000), assistant]),
      insertEvidence: (evidence) => Effect.sync(() => persisted.push(evidence)).pipe(Effect.as(true)),
      listControlEvidence: () => Effect.succeed([]),
      listBaselines: () => Effect.succeed([]),
      putSuiteRevision: () => Effect.void,
      bootstrapBaseline: () => Effect.void,
      listOpenRuns: () => Effect.succeed([]),
      recordObservation: (evidence) => Effect.sync(() => observations.push(evidence)),
      appendSample: () => Effect.void,
    }),
  })

  await Effect.runPromise(service.record({ sessionID, exit: Exit.succeed(undefined) }))

  expect(persisted).toHaveLength(1)
  expect(observations).toHaveLength(1)
  expect(observations[0]).toMatchObject({
    workload: "agent:build",
    workloadRevision: 1,
    outcomeClass: "success",
    outcome: "success",
    errorClass: "none",
    orderedToolSymbolIDs: ["read"],
    startedAt: 1_000,
    terminalAt: 2_000,
  })
  expect(observations[0]?.metrics.tokensPerSuccess).toEqual({ inputTokens: 10, outputTokens: 5, successfulTasks: 1 })
  expect(JSON.stringify(observations[0])).not.toContain("secret prompt")
  expect(JSON.stringify(observations[0])).not.toContain("secret output")
  expect(JSON.stringify(observations[0])).not.toContain("/secret")
})

test("classifies a tool failure without retaining its raw error", async () => {
  const observations: SelfImprovementSessionObserver.Evidence[] = []
  const service = SelfImprovementSessionObserver.make({
    locationID,
    settings: { enabled: true },
    dependencies: SelfImprovementSessionObserver.dependencies({
      loadMessages: () => Effect.succeed([user("failed", 1_000), failedAssistant]),
      insertEvidence: () => Effect.succeed(true),
      listControlEvidence: () => Effect.succeed([]),
      listBaselines: () => Effect.succeed([]),
      putSuiteRevision: () => Effect.void,
      bootstrapBaseline: () => Effect.void,
      listOpenRuns: () => Effect.succeed([]),
      recordObservation: (value) => Effect.sync(() => observations.push(value)),
      appendSample: () => Effect.void,
    }),
  })

  await Effect.runPromise(service.record({ sessionID, exit: Exit.succeed(undefined) }))

  expect(observations[0]).toMatchObject({ outcomeClass: "failure", outcome: "failure", errorClass: "tool.bash.failed" })
  expect(JSON.stringify(observations[0])).not.toContain("database password")
  expect(JSON.stringify(observations[0])).not.toContain("secret command")
})

test("classifies a durable assistant error without retaining its message", async () => {
  const observations: SelfImprovementSessionObserver.Evidence[] = []
  const service = SelfImprovementSessionObserver.make({
    locationID,
    settings: { enabled: true },
    dependencies: SelfImprovementSessionObserver.dependencies({
      loadMessages: () => Effect.succeed([user("provider-failed", 1_000), providerFailedAssistant]),
      insertEvidence: () => Effect.succeed(true),
      listControlEvidence: () => Effect.succeed([]),
      listBaselines: () => Effect.succeed([]),
      putSuiteRevision: () => Effect.void,
      bootstrapBaseline: () => Effect.void,
      listOpenRuns: () => Effect.succeed([]),
      recordObservation: (value) => Effect.sync(() => observations.push(value)),
      appendSample: () => Effect.void,
    }),
  })

  await Effect.runPromise(service.record({ sessionID, exit: Exit.succeed(undefined) }))

  expect(observations[0]).toMatchObject({ outcomeClass: "failure", outcome: "failure", errorClass: "session.failed" })
  expect(JSON.stringify(observations[0])).not.toContain("secret provider response")
})

test("classifies a completed cycle without assistant output as a failure", async () => {
  const observations: SelfImprovementSessionObserver.Evidence[] = []
  const service = SelfImprovementSessionObserver.make({
    locationID,
    settings: { enabled: true },
    dependencies: SelfImprovementSessionObserver.dependencies({
      loadMessages: () => Effect.succeed([user("no-output", 1_000)]),
      insertEvidence: () => Effect.succeed(true),
      listControlEvidence: () => Effect.succeed([]),
      listBaselines: () => Effect.succeed([]),
      putSuiteRevision: () => Effect.void,
      bootstrapBaseline: () => Effect.void,
      listOpenRuns: () => Effect.succeed([]),
      recordObservation: (value) => Effect.sync(() => observations.push(value)),
      appendSample: () => Effect.void,
    }),
  })

  await Effect.runPromise(service.record({ sessionID, exit: Exit.succeed(undefined) }))

  expect(observations[0]).toMatchObject({ outcomeClass: "failure", outcome: "failure", errorClass: "session.no-output" })
})

test("records cancellation as observation only", async () => {
  let appended = 0
  let baselines = 0
  const observations: SelfImprovementSessionObserver.Evidence[] = []
  const service = SelfImprovementSessionObserver.make({
    locationID,
    settings: { enabled: true },
    dependencies: SelfImprovementSessionObserver.dependencies({
      loadMessages: () => Effect.succeed([user("cancelled", 1_000), assistant]),
      insertEvidence: () => Effect.succeed(true),
      listControlEvidence: () => Effect.sync(() => baselines++).pipe(Effect.as([])),
      listBaselines: () => Effect.succeed([]),
      putSuiteRevision: () => Effect.void,
      bootstrapBaseline: () => Effect.void,
      listOpenRuns: () => Effect.succeed([]),
      recordObservation: (value) => Effect.sync(() => observations.push(value)),
      appendSample: () => Effect.sync(() => appended++),
    }),
  })
  const interrupted = await Effect.runPromiseExit(Effect.interrupt)

  await Effect.runPromise(service.record({ sessionID, exit: interrupted }))

  expect(observations[0]).toMatchObject({ outcomeClass: "cancelled", errorClass: "session.interrupted" })
  expect(appended).toBe(0)
  expect(baselines).toBe(0)
})

test("replaying the same terminal cycle is idempotent", async () => {
  let inserted = false
  let observations = 0
  const service = SelfImprovementSessionObserver.make({
    locationID,
    settings: { enabled: true },
    dependencies: SelfImprovementSessionObserver.dependencies({
      loadMessages: () => Effect.succeed([user("replay", 1_000), assistant]),
      insertEvidence: () => Effect.sync(() => (inserted ? false : (inserted = true))),
      listControlEvidence: () => Effect.succeed([]),
      listBaselines: () => Effect.succeed([]),
      putSuiteRevision: () => Effect.void,
      bootstrapBaseline: () => Effect.void,
      listOpenRuns: () => Effect.succeed([]),
      recordObservation: () => Effect.sync(() => observations++),
      appendSample: () => Effect.void,
    }),
  })

  await Effect.runPromise(service.record({ sessionID, exit: Exit.succeed(undefined) }))
  await Effect.runPromise(service.record({ sessionID, exit: Exit.succeed(undefined) }))

  expect(observations).toBe(1)
})

test("bootstraps one frozen baseline from twenty unique control samples", async () => {
  const suites: SelfImprovementEvaluation.SuiteRevision[] = []
  const baselines: SelfImprovementEvaluation.Baseline[] = []
  const service = SelfImprovementSessionObserver.make({
    locationID,
    settings: { enabled: true },
    dependencies: SelfImprovementSessionObserver.dependencies({
      loadMessages: () => Effect.succeed([user("baseline", 1_000), assistant]),
      insertEvidence: () => Effect.succeed(true),
      listControlEvidence: () => Effect.succeed(Array.from({ length: 20 }, (_, index) => evidence(index + 1))),
      listBaselines: () => Effect.succeed([]),
      putSuiteRevision: (suite) => Effect.sync(() => suites.push(suite)),
      bootstrapBaseline: (baseline) => Effect.sync(() => baselines.push(baseline)),
      listOpenRuns: () => Effect.succeed([]),
      recordObservation: () => Effect.void,
      appendSample: () => Effect.void,
    }),
  })

  await Effect.runPromise(service.record({ sessionID, exit: Exit.succeed(undefined) }))

  expect(suites).toHaveLength(1)
  expect(baselines).toHaveLength(1)
  expect(baselines[0]).toMatchObject({
    workload: "agent:build",
    workloadRevision: 1,
    uniqueSampleCount: 20,
    controlSource: "automatic-session-control",
  })
})

test("does not create a baseline when suite persistence fails", async () => {
  let baselines = 0
  const service = SelfImprovementSessionObserver.make({
    locationID,
    settings: { enabled: true },
    dependencies: SelfImprovementSessionObserver.dependencies({
      loadMessages: () => Effect.succeed([user("baseline-failure", 1_000), assistant]),
      insertEvidence: () => Effect.succeed(true),
      listControlEvidence: () => Effect.succeed(Array.from({ length: 20 }, (_, index) => evidence(index + 1))),
      listBaselines: () => Effect.succeed([]),
      putSuiteRevision: () => Effect.fail(new Error("storage unavailable")),
      bootstrapBaseline: () => Effect.sync(() => baselines++),
      listOpenRuns: () => Effect.succeed([]),
      recordObservation: () => Effect.void,
      appendSample: () => Effect.void,
    }),
  })

  await Effect.runPromise(service.record({ sessionID, exit: Exit.succeed(undefined) }))

  expect(baselines).toBe(0)
})

test("adds one sample to every matching open evaluation run", async () => {
  const run = new SelfImprovementEvaluation.EvaluationRun({
    id: SelfImprovementLifecycle.EvaluationRunID.make("si_run_observer"),
    locationID,
    versionID: SelfImprovementLifecycle.ArtifactVersionID.make("si_ver_observer"),
    stage: "shadow",
    workload: SelfImprovementEvaluation.Workload.make("agent:build"),
    workloadRevision: SelfImprovementLifecycle.Revision.make(1),
    suiteID: SelfImprovementLifecycle.SuiteID.make("si_sui_observer"),
    suiteRevision: SelfImprovementLifecycle.Revision.make(1),
    baselineID: SelfImprovementLifecycle.BaselineID.make("si_bas_observer"),
    state: "open",
    trustedProducerIDs: [SelfImprovementLifecycle.PrincipalID.make("self-improvement-runtime-evidence")],
    acceptanceStart: SelfImprovementLifecycle.TimestampMillis.make(1_000),
    acceptanceEnd: SelfImprovementLifecycle.TimestampMillis.make(2_000),
    cutoffAt: SelfImprovementLifecycle.TimestampMillis.make(2_000),
    requestDigest: SelfImprovement.Digest.make(Hash.sha256("run")),
    createdAt: SelfImprovementLifecycle.TimestampMillis.make(1_000),
  })
  const samples: Array<{ run: SelfImprovementEvaluation.EvaluationRun; evidence: SelfImprovementSessionObserver.Evidence }> = []
  const service = SelfImprovementSessionObserver.make({
    locationID,
    settings: { enabled: true },
    dependencies: SelfImprovementSessionObserver.dependencies({
      loadMessages: () => Effect.succeed([user("sample", 1_000), assistant]),
      insertEvidence: () => Effect.succeed(true),
      listControlEvidence: () => Effect.succeed([]),
      listBaselines: () => Effect.succeed([{} as SelfImprovementEvaluation.Baseline]),
      putSuiteRevision: () => Effect.void,
      bootstrapBaseline: () => Effect.void,
      listOpenRuns: () => Effect.succeed([run]),
      recordObservation: () => Effect.void,
      appendSample: (value) => Effect.sync(() => samples.push(value)),
    }),
  })

  await Effect.runPromise(service.record({ sessionID, exit: Exit.succeed(undefined) }))

  expect(samples).toHaveLength(1)
  expect(samples[0]?.run.id).toBe(run.id)
  expect(samples[0]?.evidence.taskIDDigest).toBeDefined()
})
