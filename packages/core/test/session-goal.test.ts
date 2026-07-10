import { describe, expect } from "bun:test"
import { DateTime, Deferred, Effect, Fiber, PubSub, Stream } from "effect"
import { EventV2 } from "@opencode-ai/core/event"
import { GoalSupervisor } from "@opencode-ai/core/session/goal"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { SessionInput } from "@opencode-ai/core/session/input"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { Prompt } from "@opencode-ai/core/session/prompt"
import { it } from "./lib/effect"

const sessionID = SessionV2.ID.make("ses_goal_test")
const unused = () => Effect.die("unused")

function assistant(text: string): SessionMessage.Assistant {
  return {
    id: SessionMessage.ID.create(),
    type: "assistant",
    agent: "build",
    model: { providerID: ProviderV2.ID.make("test"), id: ModelV2.ID.make("test") },
    content: [{ type: "text", id: "txt", text }],
    time: { created: DateTime.makeUnsafe(1) },
  }
}

const makeEvents = Effect.gen(function* () {
  const pubsub = yield* PubSub.unbounded<EventV2.Payload>()
  const publish: EventV2.Interface["publish"] = (definition, data) =>
    Effect.gen(function* () {
      const event = { id: EventV2.ID.create(), type: definition.type, data } as EventV2.Payload<typeof definition>
      yield* PubSub.publish(pubsub, event as EventV2.Payload)
      return event
    })
  const subscribe: EventV2.Interface["subscribe"] = (definition) =>
    Stream.fromPubSub(pubsub).pipe(
      Stream.filter((event): event is EventV2.Payload<typeof definition> => event.type === definition.type),
    )
  return EventV2.Service.of({
    publish,
    subscribe,
    all: () => Stream.fromPubSub(pubsub),
    durable: () => Stream.empty,
    listen: () => Effect.succeed(Effect.void),
    project: () => Effect.void,
    replay: () => Effect.void,
    replayAll: () => Effect.succeed(undefined),
    remove: () => Effect.void,
    claim: () => Effect.void,
  })
})

const makeTrackedEvents = Effect.gen(function* () {
  const events = yield* makeEvents
  const finalized = yield* Deferred.make<void>()
  return {
    finalized,
    service: EventV2.Service.of({
      ...events,
      all: () => events.all().pipe(Stream.ensuring(Deferred.succeed(finalized, undefined))),
    }),
  }
})

function makeSession(outputs: string[] = []) {
  const prompts: SessionV2.Interface["prompt"] extends (input: infer Input) => Effect.Effect<unknown, unknown, unknown>
    ? Input[]
    : never[] = []
  let messageReads = 0
  const service = SessionV2.Service.of({
    list: unused,
    create: unused,
    get: unused,
    messages: () =>
      Effect.sync(() => {
        const text = outputs[Math.min(messageReads, Math.max(outputs.length - 1, 0))] ?? ""
        messageReads++
        return [assistant(text)]
      }),
    message: unused,
    context: unused,
    events: () => Stream.empty,
    history: unused,
    switchAgent: unused,
    switchModel: unused,
    prompt: (input) =>
      Effect.sync(() => {
        prompts.push(input)
        return SessionInput.Admitted.make({
          admittedSeq: prompts.length - 1,
          id: input.id ?? SessionMessage.ID.create(),
          sessionID: input.sessionID,
          prompt: Prompt.make({ text: input.prompt.text }),
          delivery: input.delivery ?? "steer",
          timeCreated: DateTime.makeUnsafe(prompts.length),
        })
      }),
    shell: unused,
    skill: unused,
    compact: unused,
    wait: unused,
    active: Effect.succeed(new Set()),
    resume: unused,
    interrupt: () => Effect.void,
    revert: { stage: unused, clear: unused, commit: unused },
  })
  return { service, prompts }
}

function makeFailingPromptSession(error: SessionV2.NotFoundError | SessionV2.PromptConflictError) {
  const fake = makeSession()
  const service = SessionV2.Service.of({ ...fake.service, prompt: () => Effect.fail(error) })
  return { service, prompts: fake.prompts }
}

function makePublishingPromptSession(events: EventV2.Interface, outputs: string[] = []) {
  const fake = makeSession(outputs)
  const service = SessionV2.Service.of({
    ...fake.service,
    prompt: (input) =>
      Effect.gen(function* () {
        const admitted = yield* fake.service.prompt(input)
        yield* promptEvent(events, SessionEvent.PromptAdmitted, admitted.id, admitted.prompt.text)
        yield* turnEnded(events)
        return admitted
      }),
  })
  return { service, prompts: fake.prompts }
}

function makeBlockingPromptSession(started: Deferred.Deferred<void>, release: Deferred.Deferred<void>) {
  const fake = makeSession(["not done"])
  let blocked = false
  const service = SessionV2.Service.of({
    ...fake.service,
    prompt: (input) => {
      if (blocked) return fake.service.prompt(input)
      blocked = true
      return Deferred.succeed(started, undefined).pipe(
        Effect.andThen(Deferred.await(release)),
        Effect.andThen(fake.service.prompt(input)),
      )
    },
  })
  return { service, prompts: fake.prompts }
}

const turnEnded = (events: EventV2.Interface) =>
  events.publish(SessionEvent.Step.Ended, {
    sessionID,
    timestamp: DateTime.makeUnsafe(1),
    assistantMessageID: SessionMessage.ID.create(),
    finish: "stop",
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  })

const turnFailed = (events: EventV2.Interface) =>
  events.publish(SessionEvent.Step.Failed, {
    sessionID,
    timestamp: DateTime.makeUnsafe(1),
    assistantMessageID: SessionMessage.ID.create(),
    error: { type: "unknown", message: "failed" },
  })

const promptEvent = (
  events: EventV2.Interface,
  definition: typeof SessionEvent.PromptAdmitted | typeof SessionEvent.Prompted,
  messageID: SessionMessage.ID,
  text: string,
) =>
  events.publish(definition, {
    sessionID,
    timestamp: DateTime.makeUnsafe(1),
    messageID,
    prompt: Prompt.make({ text }),
    delivery: "steer",
  })

describe("GoalSupervisor", () => {
  it.effect("starts active state and emits the first steer prompt", () =>
    Effect.gen(function* () {
      const fake = makeSession()
      const events = yield* makeEvents
      const goals = yield* GoalSupervisor.make.pipe(
        Effect.provideService(SessionV2.Service, fake.service),
        Effect.provideService(EventV2.Service, events),
      )

      yield* goals.start({ sessionID, goal: "ship task 4" })
      yield* Effect.yieldNow

      expect(yield* goals.status(sessionID)).toMatchObject({ active: true, goal: "ship task 4", iteration: 1 })
      expect(fake.prompts).toHaveLength(1)
      expect(fake.prompts[0]).toMatchObject({ sessionID, delivery: "steer", resume: true })
      expect(fake.prompts[0]?.id).toBeDefined()
      expect(fake.prompts[0]?.prompt.text).toContain("ship task 4")
      expect(fake.prompts[0]?.prompt.text).not.toContain("Iteration")
    }),
  )

  it.effect("observes a turn that ends before prompt returns", () =>
    Effect.gen(function* () {
      const events = yield* makeEvents
      const fake = makePublishingPromptSession(events, ["GOAL COMPLETE", "YES"])
      const goals = yield* GoalSupervisor.make.pipe(
        Effect.provideService(SessionV2.Service, fake.service),
        Effect.provideService(EventV2.Service, events),
      )

      yield* goals.start({ sessionID, goal: "finish" })
      yield* Effect.yieldNow
      yield* Effect.yieldNow

      expect(fake.prompts).toHaveLength(2)
      expect(fake.prompts[1]?.prompt.text).toContain("Answer only YES or NO")
      expect(fake.prompts[1]?.prompt.text).toContain("latest user instruction")
      expect(yield* goals.status(sessionID)).toMatchObject({ active: false, goal: "finish", iteration: 1 })
    }),
  )

  it.effect("start surfaces first prompt failures and clears state", () =>
    Effect.gen(function* () {
      const events = yield* makeEvents
      const fake = makeFailingPromptSession(new SessionV2.NotFoundError({ sessionID }))
      const goals = yield* GoalSupervisor.make.pipe(
        Effect.provideService(SessionV2.Service, fake.service),
        Effect.provideService(EventV2.Service, events),
      )

      const result = yield* goals.start({ sessionID, goal: "finish" }).pipe(
        Effect.as("unexpected success"),
        Effect.catch((error) => Effect.succeed(error)),
      )

      expect(result).toBeInstanceOf(Error)
      expect(yield* goals.status(sessionID)).toBeUndefined()
    }),
  )

  it.effect("re-prompts after completed turns until the verified goal is done", () =>
    Effect.gen(function* () {
      const fake = makeSession(["not yet", "GOAL COMPLETE", "YES"])
      const tracked = yield* makeTrackedEvents
      const events = tracked.service
      const goals = yield* GoalSupervisor.make.pipe(
        Effect.provideService(SessionV2.Service, fake.service),
        Effect.provideService(EventV2.Service, events),
      )

      yield* goals.start({ sessionID, goal: "finish" })
      yield* Effect.yieldNow
      yield* turnEnded(events)
      yield* Effect.yieldNow
      yield* turnEnded(events)
      yield* Effect.yieldNow
      yield* turnEnded(events)
      yield* Effect.yieldNow

      expect(fake.prompts).toHaveLength(3)
      expect(fake.prompts[2]?.prompt.text).toContain("Answer only YES or NO")
      expect(yield* goals.status(sessionID)).toMatchObject({ active: false, goal: "finish", iteration: 2 })
      expect(yield* Deferred.isDone(tracked.finalized)).toBe(true)
    }),
  )

  it.effect("derives unresolved continuations from the latest assistant result and external steer", () =>
    Effect.gen(function* () {
      const fake = makeSession(["first unresolved result", "second unresolved result"])
      const events = yield* makeEvents
      const goals = yield* GoalSupervisor.make.pipe(
        Effect.provideService(SessionV2.Service, fake.service),
        Effect.provideService(EventV2.Service, events),
      )

      yield* goals.start({ sessionID, goal: "finish" })
      yield* Effect.yieldNow
      yield* turnEnded(events)
      yield* Effect.yieldNow
      const firstContinuation = fake.prompts[1]?.prompt.text

      const externalID = SessionMessage.ID.create()
      yield* promptEvent(events, SessionEvent.PromptAdmitted, externalID, "also update the changelog")
      yield* promptEvent(events, SessionEvent.Prompted, externalID, "also update the changelog")
      yield* turnEnded(events)
      yield* Effect.yieldNow
      const secondContinuation = fake.prompts[2]?.prompt.text

      expect(firstContinuation).toContain("first unresolved result")
      expect(secondContinuation).toContain("second unresolved result")
      expect(secondContinuation).toContain("also update the changelog")
      expect(secondContinuation).not.toBe(firstContinuation)
    }),
  )

  it.effect("includes failed verification and claimed completion in the next continuation", () =>
    Effect.gen(function* () {
      const fake = makeSession(["GOAL COMPLETE: tests pass but docs are missing", "NO"])
      const events = yield* makeEvents
      const goals = yield* GoalSupervisor.make.pipe(
        Effect.provideService(SessionV2.Service, fake.service),
        Effect.provideService(EventV2.Service, events),
      )

      yield* goals.start({ sessionID, goal: "finish" })
      yield* Effect.yieldNow
      yield* turnEnded(events)
      yield* Effect.yieldNow
      yield* turnEnded(events)
      yield* Effect.yieldNow

      expect(fake.prompts[2]?.prompt.text).toContain("GOAL COMPLETE: tests pass but docs are missing")
      expect(fake.prompts[2]?.prompt.text).toContain("Failed verification: NO")
    }),
  )

  it.effect("stop clears state and interrupts the loop", () =>
    Effect.gen(function* () {
      const fake = makeSession(["not done"])
      const events = yield* makeEvents
      const goals = yield* GoalSupervisor.make.pipe(
        Effect.provideService(SessionV2.Service, fake.service),
        Effect.provideService(EventV2.Service, events),
      )

      yield* goals.start({ sessionID, goal: "finish" })
      yield* Effect.yieldNow
      yield* goals.stop(sessionID)
      yield* turnEnded(events)
      yield* Effect.yieldNow

      expect(fake.prompts).toHaveLength(1)
      expect(yield* goals.status(sessionID)).toBeUndefined()
    }),
  )

  it.effect("prioritizes a newer external steer without replacing the original goal", () =>
    Effect.gen(function* () {
      const fake = makeSession(["old result", "new result"])
      const events = yield* makeEvents
      const goals = yield* GoalSupervisor.make.pipe(
        Effect.provideService(SessionV2.Service, fake.service),
        Effect.provideService(EventV2.Service, events),
      )

      yield* goals.start({ sessionID, goal: "old goal", cap: 2 })
      yield* Effect.yieldNow
      const externalID = SessionMessage.ID.create()
      yield* promptEvent(events, SessionEvent.PromptAdmitted, externalID, "new goal")
      yield* turnEnded(events)
      yield* Effect.yieldNow

      expect(fake.prompts).toHaveLength(1)

      yield* promptEvent(events, SessionEvent.Prompted, externalID, "new goal")
      yield* turnEnded(events)
      yield* Effect.yieldNow

      expect(fake.prompts).toHaveLength(2)
      expect(fake.prompts[1]?.prompt.text).toContain("old goal")
      expect(fake.prompts[1]?.prompt.text).toContain("latest user instruction")
      expect(fake.prompts[1]?.prompt.text).not.toContain("Iteration")
      expect(yield* goals.status(sessionID)).toMatchObject({ active: true, goal: "old goal", iteration: 1 })
    }),
  )

  it.effect("invalidates stale verification when a newer external steer is admitted", () =>
    Effect.gen(function* () {
      const fake = makeSession(["GOAL COMPLETE", "YES"])
      const events = yield* makeEvents
      const goals = yield* GoalSupervisor.make.pipe(
        Effect.provideService(SessionV2.Service, fake.service),
        Effect.provideService(EventV2.Service, events),
      )

      yield* goals.start({ sessionID, goal: "old goal" })
      yield* Effect.yieldNow
      yield* turnEnded(events)
      yield* Effect.yieldNow
      expect(fake.prompts).toHaveLength(2)

      const externalID = SessionMessage.ID.create()
      yield* promptEvent(events, SessionEvent.PromptAdmitted, externalID, "new goal")
      yield* turnEnded(events)
      yield* Effect.yieldNow
      yield* promptEvent(events, SessionEvent.Prompted, externalID, "new goal")
      yield* Effect.yieldNow
      yield* turnEnded(events)
      yield* Effect.yieldNow

      expect(yield* goals.status(sessionID)).toMatchObject({ active: true, goal: "old goal", iteration: 1 })
      expect(fake.prompts).toHaveLength(3)
      expect(fake.prompts[2]?.prompt.text).toContain("old goal")
      expect(fake.prompts[2]?.prompt.text).toContain("latest user instruction")
    }),
  )

  it.effect("stop owns a start suspended in its first prompt", () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const fake = makeBlockingPromptSession(started, release)
      const events = yield* makeEvents
      const goals = yield* GoalSupervisor.make.pipe(
        Effect.provideService(SessionV2.Service, fake.service),
        Effect.provideService(EventV2.Service, events),
      )

      const starting = yield* goals.start({ sessionID, goal: "finish" }).pipe(Effect.forkChild)
      yield* Deferred.await(started)
      yield* goals.stop(sessionID)
      yield* Deferred.succeed(release, undefined)
      const result = yield* Fiber.join(starting)
      yield* turnEnded(events)
      yield* Effect.yieldNow

      expect(result.active).toBe(false)
      expect(yield* goals.status(sessionID)).toBeUndefined()
      expect(fake.prompts).toHaveLength(1)
    }),
  )

  it.effect("stops automatic continuation when a step fails", () =>
    Effect.gen(function* () {
      const fake = makeSession(["not done"])
      const tracked = yield* makeTrackedEvents
      const events = tracked.service
      const goals = yield* GoalSupervisor.make.pipe(
        Effect.provideService(SessionV2.Service, fake.service),
        Effect.provideService(EventV2.Service, events),
      )

      yield* goals.start({ sessionID, goal: "finish" })
      yield* Effect.yieldNow
      yield* turnFailed(events)
      yield* Effect.yieldNow

      expect(fake.prompts).toHaveLength(1)
      expect(yield* goals.status(sessionID)).toBeUndefined()
      expect(yield* Deferred.isDone(tracked.finalized)).toBe(true)
    }),
  )

  it.effect("does not report final-attempt failure as cap exhaustion", () =>
    Effect.gen(function* () {
      const fake = makeSession(["not done"])
      const tracked = yield* makeTrackedEvents
      const events = tracked.service
      const goals = yield* GoalSupervisor.make.pipe(
        Effect.provideService(SessionV2.Service, fake.service),
        Effect.provideService(EventV2.Service, events),
      )

      yield* goals.start({ sessionID, goal: "finish", cap: 1 })
      yield* turnFailed(events)
      yield* Effect.yieldNow

      expect(fake.prompts).toHaveLength(1)
      expect(yield* goals.status(sessionID)).toBeUndefined()
      expect(yield* Deferred.isDone(tracked.finalized)).toBe(true)
    }),
  )

  it.effect("iteration cap stops runaway loops", () =>
    Effect.gen(function* () {
      const fake = makeSession(["nope", "still nope", "never"])
      const tracked = yield* makeTrackedEvents
      const events = tracked.service
      const goals = yield* GoalSupervisor.make.pipe(
        Effect.provideService(SessionV2.Service, fake.service),
        Effect.provideService(EventV2.Service, events),
      )

      yield* goals.start({ sessionID, goal: "finish", cap: 2 })
      yield* Effect.yieldNow
      yield* turnEnded(events)
      yield* Effect.yieldNow
      yield* turnEnded(events)
      yield* Effect.yieldNow

      expect(fake.prompts).toHaveLength(2)
      expect(yield* goals.status(sessionID)).toMatchObject({ active: false, iteration: 2, cap: 2 })
      expect(yield* Deferred.isDone(tracked.finalized)).toBe(true)
    }),
  )

  it.effect("zero cap finalizes the subscription while retaining inactive status", () =>
    Effect.gen(function* () {
      const fake = makeSession()
      const tracked = yield* makeTrackedEvents
      const goals = yield* GoalSupervisor.make.pipe(
        Effect.provideService(SessionV2.Service, fake.service),
        Effect.provideService(EventV2.Service, tracked.service),
      )

      expect(yield* goals.start({ sessionID, goal: "finish", cap: 0 })).toMatchObject({ active: false, iteration: 0 })
      expect(yield* goals.status(sessionID)).toMatchObject({ active: false, iteration: 0, cap: 0 })
      expect(fake.prompts).toHaveLength(0)
      expect(yield* Deferred.isDone(tracked.finalized)).toBe(true)
    }),
  )

  it.effect("verify gate requires YES as its own answer before stopping", () =>
    Effect.gen(function* () {
      const fake = makeSession(["GOAL COMPLETE", "NO", "GOAL COMPLETE", "YES"])
      const events = yield* makeEvents
      const goals = yield* GoalSupervisor.make.pipe(
        Effect.provideService(SessionV2.Service, fake.service),
        Effect.provideService(EventV2.Service, events),
      )

      yield* goals.start({ sessionID, goal: "finish" })
      yield* Effect.yieldNow
      yield* turnEnded(events)
      yield* Effect.yieldNow
      yield* turnEnded(events)
      yield* Effect.yieldNow
      expect(yield* goals.status(sessionID)).toMatchObject({ active: true, iteration: 2 })
      yield* turnEnded(events)
      yield* Effect.yieldNow
      yield* turnEnded(events)
      yield* Effect.yieldNow

      expect(yield* goals.status(sessionID)).toMatchObject({ active: false, iteration: 2 })
      expect(fake.prompts.map((prompt) => prompt.prompt.text.includes("Answer only YES or NO"))).toEqual([
        false,
        true,
        false,
        true,
      ])
    }),
  )
})
