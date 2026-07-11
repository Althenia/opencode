import { describe, expect } from "bun:test"
import { DateTime, Deferred, Effect, Fiber, Layer, LayerMap, PubSub, Stream } from "effect"
import { EventV2 } from "@opencode-ai/core/event"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Location } from "@opencode-ai/core/location"
import { LocationServiceMap } from "@opencode-ai/core/location-service-map"
import type { LocationError, LocationServices } from "@opencode-ai/core/location-services"
import { QuestionV2 } from "@opencode-ai/core/question"
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
const otherSessionID = SessionV2.ID.make("ses_other_goal_test")
const location = Location.Ref.make({ directory: AbsolutePath.make("/tmp/opencode-goal-test") })
const unused = () => Effect.die("unused")

function assistant(text: string, reasoning?: string): SessionMessage.Assistant {
  return {
    id: SessionMessage.ID.create(),
    type: "assistant",
    agent: "build",
    model: { providerID: ProviderV2.ID.make("test"), id: ModelV2.ID.make("test") },
    content: [
      { type: "text", id: "txt", text },
      ...(reasoning ? [{ type: "reasoning" as const, id: "rsn", text: reasoning }] : []),
    ],
    time: { created: DateTime.makeUnsafe(1) },
  }
}

const makeEvents = Effect.gen(function* () {
  const pubsub = yield* PubSub.unbounded<EventV2.Payload>()
  const listeners = new Array<EventV2.Subscriber>()
  const publish: EventV2.Interface["publish"] = (definition, data, options) =>
    Effect.gen(function* () {
      const event = {
        id: EventV2.ID.create(),
        type: definition.type,
        ...(options?.location ? { location: options.location } : {}),
        data,
      } as EventV2.Payload<typeof definition>
      yield* Effect.forEach(listeners, (listener) => listener(event), { discard: true })
      yield* PubSub.publish(pubsub, event as EventV2.Payload)
      return event
    })
  const subscribe: EventV2.Interface["subscribe"] = (definition) =>
    Stream.fromPubSub(pubsub).pipe(
      Stream.filter((event): event is EventV2.Payload<typeof definition> => event.type === definition.type),
    )
  return Object.assign(EventV2.Service.of({
    publish,
    subscribe,
    all: () => Stream.fromPubSub(pubsub),
    durable: () => Stream.empty,
    listen: (listener) =>
      Effect.sync(() => {
        listeners.push(listener)
        return Effect.sync(() => {
          const index = listeners.indexOf(listener)
          if (index >= 0) listeners.splice(index, 1)
        })
      }),
    project: () => Effect.void,
    replay: () => Effect.void,
    replayAll: () => Effect.succeed(undefined),
    remove: () => Effect.void,
    claim: () => Effect.void,
  }), { listenerCount: () => listeners.length })
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

function makeSession(outputs: Array<string | { text: string; reasoning: string }> = []) {
  const prompts: SessionV2.Interface["prompt"] extends (input: infer Input) => Effect.Effect<unknown, unknown, unknown>
    ? Input[]
    : never[] = []
  const admitted = new Array<SessionInput.Admitted>()
  let messageReads = 0
  let promoted = 0
  const service = SessionV2.Service.of({
    list: unused,
    create: unused,
    get: unused,
    messages: () =>
      Effect.sync(() => {
        const output = outputs[Math.min(messageReads, Math.max(outputs.length - 1, 0))] ?? ""
        messageReads++
        return [
          assistant(
            typeof output === "string" ? output : output.text,
            typeof output === "string" ? undefined : output.reasoning,
          ),
        ]
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
        const result = SessionInput.Admitted.make({
          admittedSeq: prompts.length - 1,
          id: input.id ?? SessionMessage.ID.create(),
          sessionID: input.sessionID,
          prompt: Prompt.make({ text: input.prompt.text }),
          delivery: input.delivery ?? "steer",
          timeCreated: DateTime.makeUnsafe(prompts.length),
        })
        admitted.push(result)
        return result
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
  const promoteNext = (events: EventV2.Interface) =>
    Effect.suspend(() => {
      const input = admitted[promoted]
      if (!input) return Effect.void
      promoted++
      return promptEvent(events, SessionEvent.Prompted, input.id, input.prompt.text)
    })
  return { service, prompts, promoteNext }
}

function makeQuestions(events: EventV2.Interface) {
  const pending = new Map<QuestionV2.ID, Deferred.Deferred<ReadonlyArray<QuestionV2.Answer>, QuestionV2.RejectedError>>()
  const requests = new Map<QuestionV2.ID, QuestionV2.Request>()
  const replies: QuestionV2.ReplyInput[] = []
  const service = QuestionV2.Service.of({
    ask: (input) =>
      Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          const id = QuestionV2.ID.create()
          const deferred = yield* Deferred.make<ReadonlyArray<QuestionV2.Answer>, QuestionV2.RejectedError>()
          const request = { id, ...input }
          pending.set(id, deferred)
          requests.set(id, request)
          return yield* events.publish(QuestionV2.Event.Asked, request, { location }).pipe(
            Effect.andThen(restore(Deferred.await(deferred))),
            Effect.ensuring(
              Effect.sync(() => {
                pending.delete(id)
                requests.delete(id)
              }),
            ),
          )
        }),
      ),
    reply: (input) =>
      Effect.gen(function* () {
        const deferred = pending.get(input.requestID)
        if (!deferred) return yield* new QuestionV2.NotFoundError({ requestID: input.requestID })
        replies.push(input)
        yield* Deferred.succeed(deferred, input.answers)
      }),
    reject: unused,
    list: () => Effect.sync(() => Array.from(requests.values())),
  })
  return { service, pending, replies }
}

function makeQuestionLocationMap(
  questions: QuestionV2.Interface,
  layer: Layer.Layer<LocationServices, LocationError> = Layer.succeed(
    QuestionV2.Service,
    questions,
  ) as unknown as Layer.Layer<LocationServices, LocationError>,
) {
  return LayerMap.make<Location.Ref, Layer.Layer<LocationServices, LocationError>>(
    () => layer,
  ).pipe(
    Effect.map(LocationServiceMap.Service.of),
  )
}

function makeFailingPromptSession(error: SessionV2.NotFoundError | SessionV2.PromptConflictError) {
  const fake = makeSession()
  const service = SessionV2.Service.of({ ...fake.service, prompt: () => Effect.fail(error) })
  return { ...fake, service }
}

function makePublishingPromptSession(events: EventV2.Interface, outputs: string[] = []) {
  const fake = makeSession(outputs)
  const service = SessionV2.Service.of({
    ...fake.service,
    prompt: (input) =>
      Effect.gen(function* () {
        const admitted = yield* fake.service.prompt(input)
        yield* promptEvent(events, SessionEvent.PromptAdmitted, admitted.id, admitted.prompt.text)
        yield* turnEnded(events, fake)
        return admitted
      }),
  })
  return { ...fake, service }
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
  return { ...fake, service }
}

function makeQuestionAskingPromptSession(questions: QuestionV2.Interface, info: QuestionV2.Info) {
  const fake = makeSession(["not done"])
  let asked = false
  const service = SessionV2.Service.of({
    ...fake.service,
    prompt: (input) =>
      Effect.gen(function* () {
        const admitted = yield* fake.service.prompt(input)
        if (!asked) {
          asked = true
          yield* questions.ask({ sessionID, questions: [info] }).pipe(
            Effect.catchTag("QuestionV2.RejectedError", () => Effect.die("question rejected")),
          )
        }
        return admitted
      }),
  })
  return { ...fake, service }
}

const stepStarted = (events: EventV2.Interface, assistantMessageID = SessionMessage.ID.create()) =>
  events
    .publish(SessionEvent.Step.Started, {
      sessionID,
      timestamp: DateTime.makeUnsafe(1),
      assistantMessageID,
      agent: "build",
      model: { providerID: ProviderV2.ID.make("test"), id: ModelV2.ID.make("test") },
    })
    .pipe(Effect.as(assistantMessageID))

const stepEnded = (events: EventV2.Interface, assistantMessageID: SessionMessage.ID) =>
  events.publish(SessionEvent.Step.Ended, {
    sessionID,
    timestamp: DateTime.makeUnsafe(1),
    assistantMessageID,
    finish: "stop",
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  })

const turnEnded = (events: EventV2.Interface, fake: Pick<ReturnType<typeof makeSession>, "promoteNext">) =>
  fake.promoteNext(events).pipe(Effect.andThen(stepStarted(events)), Effect.flatMap((id) => stepEnded(events, id)))

const stepFailed = (events: EventV2.Interface, assistantMessageID: SessionMessage.ID) =>
  events.publish(SessionEvent.Step.Failed, {
    sessionID,
    timestamp: DateTime.makeUnsafe(1),
    assistantMessageID,
    error: { type: "unknown", message: "failed" },
  })

const turnFailed = (events: EventV2.Interface, fake: Pick<ReturnType<typeof makeSession>, "promoteNext">) =>
  fake.promoteNext(events).pipe(Effect.andThen(stepStarted(events)), Effect.flatMap((id) => stepFailed(events, id)))

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
  it.effect("leaves questions pending when location provisioning fails", () =>
    Effect.gen(function* () {
      const events = yield* makeEvents
      const questions = makeQuestions(events)
      const locations = yield* makeQuestionLocationMap(
        questions.service,
        Layer.effect(QuestionV2.Service, Effect.die("location unavailable")) as unknown as Layer.Layer<
          LocationServices,
          LocationError
        >,
      )
      const fake = makeSession()
      const goals = yield* GoalSupervisor.make.pipe(
        Effect.provideService(SessionV2.Service, fake.service),
        Effect.provideService(EventV2.Service, events),
        Effect.provideService(LocationServiceMap.Service, locations),
      )

      yield* goals.start({ sessionID, goal: "finish" })
      const asking = yield* questions.service
        .ask({ sessionID, questions: [{ question: "Continue?", header: "Next", options: [] }] })
        .pipe(Effect.forkScoped)
      yield* Effect.yieldNow

      expect(yield* questions.service.list()).toHaveLength(1)
      expect(questions.replies).toEqual([])
      yield* Fiber.interrupt(asking)
    }),
  )

  it.effect("does not reply after a delayed location service outlives its Goal", () =>
    Effect.gen(function* () {
      const events = yield* makeEvents
      const questions = makeQuestions(events)
      const started = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const locations = yield* makeQuestionLocationMap(
        questions.service,
        Layer.effect(
          QuestionV2.Service,
          Deferred.succeed(started, undefined).pipe(
            Effect.andThen(Deferred.await(release)),
            Effect.as(QuestionV2.Service.of(questions.service)),
          ),
        ) as unknown as Layer.Layer<LocationServices, LocationError>,
      )
      const fake = makeSession()
      const goals = yield* GoalSupervisor.make.pipe(
        Effect.provideService(SessionV2.Service, fake.service),
        Effect.provideService(EventV2.Service, events),
        Effect.provideService(LocationServiceMap.Service, locations),
      )

      yield* goals.start({ sessionID, goal: "first" })
      const asking = yield* questions.service
        .ask({ sessionID, questions: [{ question: "Continue?", header: "Next", options: [] }] })
        .pipe(Effect.forkScoped)
      yield* Deferred.await(started)
      yield* goals.start({ sessionID, goal: "replacement" })
      yield* Deferred.succeed(release, undefined)
      yield* Effect.yieldNow

      expect(yield* questions.service.list()).toHaveLength(1)
      expect(questions.replies).toEqual([])
      yield* Fiber.interrupt(asking)
    }),
  )

  it.effect("keeps every recommended option for multiple-selection questions", () =>
    Effect.gen(function* () {
      const events = yield* makeEvents
      const questions = makeQuestions(events)
      const locations = yield* makeQuestionLocationMap(questions.service)
      const fake = makeSession()
      const goals = yield* GoalSupervisor.make.pipe(
        Effect.provideService(SessionV2.Service, fake.service),
        Effect.provideService(EventV2.Service, events),
        Effect.provideService(LocationServiceMap.Service, locations),
      )

      yield* goals.start({ sessionID, goal: "finish" })
      expect(
        yield* questions.service.ask({
          sessionID,
          questions: [
            {
              question: "Which tasks?",
              header: "Tasks",
              multiple: true,
              options: [
                { label: "One", description: "First", recommended: true },
                { label: "Two", description: "Second", recommended: true },
                { label: "Three", description: "Third" },
              ],
            },
          ],
        }),
      ).toEqual([["One", "Two"]])
    }),
  )

  it.effect("settles a recommended V2 question during the first goal prompt", () =>
    Effect.gen(function* () {
      const events = yield* makeEvents
      const questions = makeQuestions(events)
      const locations = yield* makeQuestionLocationMap(questions.service)
      const fake = makeQuestionAskingPromptSession(questions.service, {
        question: "Which approach?",
        header: "Approach",
        options: [
          { label: "Recommended", description: "Use the recommended path", recommended: true },
          { label: "Alternative", description: "Use another path" },
        ],
      })
      const goals = yield* GoalSupervisor.make.pipe(
        Effect.provideService(SessionV2.Service, fake.service),
        Effect.provideService(EventV2.Service, events),
        Effect.provideService(LocationServiceMap.Service, locations),
      )

      yield* goals.start({ sessionID, goal: "finish" })

      expect(questions.pending.size).toBe(0)
      expect(questions.replies[0]?.answers).toEqual([["Recommended"]])
      expect(fake.prompts).toHaveLength(1)
    }),
  )

  it.effect("uses the fallback answer for an active V2 question without options", () =>
    Effect.gen(function* () {
      const events = yield* makeEvents
      const questions = makeQuestions(events)
      const locations = yield* makeQuestionLocationMap(questions.service)
      const fake = makeSession()
      const goals = yield* GoalSupervisor.make.pipe(
        Effect.provideService(SessionV2.Service, fake.service),
        Effect.provideService(EventV2.Service, events),
        Effect.provideService(LocationServiceMap.Service, locations),
      )

      yield* goals.start({ sessionID, goal: "finish" })
      expect(
        yield* questions.service.ask({
          sessionID,
          questions: [{ question: "What now?", header: "Next", options: [] }],
        }),
      ).toEqual([["Use your best judgment from the goal and current context, then continue."]])
    }),
  )

  it.effect("leaves inactive and other-session V2 questions pending", () =>
    Effect.gen(function* () {
      const events = yield* makeEvents
      const questions = makeQuestions(events)
      const locations = yield* makeQuestionLocationMap(questions.service)
      const fake = makeSession()
      const goals = yield* GoalSupervisor.make.pipe(
        Effect.provideService(SessionV2.Service, fake.service),
        Effect.provideService(EventV2.Service, events),
        Effect.provideService(LocationServiceMap.Service, locations),
      )

      yield* goals.start({ sessionID, goal: "finish" })
      yield* goals.stop(sessionID)
      const inactive = yield* questions.service
        .ask({ sessionID, questions: [{ question: "Inactive?", header: "State", options: [] }] })
        .pipe(Effect.forkScoped)
      const other = yield* questions.service
        .ask({ sessionID: otherSessionID, questions: [{ question: "Other?", header: "State", options: [] }] })
        .pipe(Effect.forkScoped)
      yield* Effect.yieldNow

      expect(yield* questions.service.list()).toHaveLength(2)
      yield* Fiber.interrupt(inactive)
      yield* Fiber.interrupt(other)
    }),
  )

  it.effect("starts active state and emits the raw goal as the first steer prompt", () =>
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
      expect(fake.prompts[0]?.prompt.text).toBe("ship task 4")
      expect(fake.prompts[0]?.prompt.text).not.toContain("Iteration")
    }),
  )

  it.effect("uses the supplied message ID only for the initial raw-goal prompt", () =>
    Effect.gen(function* () {
      const fake = makeSession(["not done"])
      const events = yield* makeEvents
      const goals = yield* GoalSupervisor.make.pipe(
        Effect.provideService(SessionV2.Service, fake.service),
        Effect.provideService(EventV2.Service, events),
      )
      const supplied = SessionMessage.ID.create()

      yield* goals.start({ sessionID, goal: "supplied", messageID: supplied })
      yield* Effect.yieldNow
      yield* turnEnded(events, fake)
      yield* Effect.yieldNow

      expect(fake.prompts[0]?.id).toBe(supplied)
      expect(fake.prompts[0]?.prompt.text).toBe("supplied")
      expect(fake.prompts[1]?.prompt.text).toContain("Continue working toward the goal.")
      expect(fake.prompts[1]?.id).toBeDefined()
      expect(fake.prompts[1]?.id).not.toBe(supplied)
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
      expect(events.listenerCount()).toBe(0)
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
      yield* turnEnded(events, fake)
      yield* Effect.yieldNow
      yield* turnEnded(events, fake)
      yield* Effect.yieldNow
      yield* turnEnded(events, fake)
      yield* Effect.yieldNow

      expect(fake.prompts).toHaveLength(3)
      expect(fake.prompts[2]?.prompt.text).toContain("Answer only YES or NO")
      expect(yield* goals.status(sessionID)).toMatchObject({ active: false, goal: "finish", iteration: 2 })
      expect(yield* Deferred.isDone(tracked.finalized)).toBe(true)
    }),
  )

  it.effect("continues after an assistant requests approval", () =>
    Effect.gen(function* () {
      const fake = makeSession(["I need your approval to continue."])
      const events = yield* makeEvents
      const goals = yield* GoalSupervisor.make.pipe(
        Effect.provideService(SessionV2.Service, fake.service),
        Effect.provideService(EventV2.Service, events),
      )

      yield* goals.start({ sessionID, goal: "finish" })
      yield* Effect.yieldNow
      yield* turnEnded(events, fake)
      yield* Effect.yieldNow

      expect(fake.prompts).toHaveLength(2)
      expect(fake.prompts[1]?.prompt.text).toContain("The prior assistant response requested user approval.")
      expect(yield* goals.status(sessionID)).toMatchObject({ active: true, iteration: 2 })
    }),
  )

  it.effect("verifies from visible YES even when hidden reasoning disagrees", () =>
    Effect.gen(function* () {
      const fake = makeSession(["GOAL COMPLETE", { text: "YES", reasoning: "NO" }])
      const events = yield* makeEvents
      const goals = yield* GoalSupervisor.make.pipe(
        Effect.provideService(SessionV2.Service, fake.service),
        Effect.provideService(EventV2.Service, events),
      )

      yield* goals.start({ sessionID, goal: "finish" })
      yield* Effect.yieldNow
      yield* turnEnded(events, fake)
      yield* Effect.yieldNow
      yield* turnEnded(events, fake)
      yield* Effect.yieldNow

      expect(yield* goals.status(sessionID)).toMatchObject({ active: false, goal: "finish" })
      expect(fake.prompts).toHaveLength(2)
    }),
  )

  it.effect("does not verify from hidden YES when visible text says NO", () =>
    Effect.gen(function* () {
      const fake = makeSession(["GOAL COMPLETE", { text: "NO", reasoning: "YES" }])
      const events = yield* makeEvents
      const goals = yield* GoalSupervisor.make.pipe(
        Effect.provideService(SessionV2.Service, fake.service),
        Effect.provideService(EventV2.Service, events),
      )

      yield* goals.start({ sessionID, goal: "finish" })
      yield* Effect.yieldNow
      yield* turnEnded(events, fake)
      yield* Effect.yieldNow
      yield* turnEnded(events, fake)
      yield* Effect.yieldNow

      expect(yield* goals.status(sessionID)).toMatchObject({ active: true, goal: "finish" })
      expect(fake.prompts).toHaveLength(3)
    }),
  )

  it.effect("ignores a completion marker that appears only in hidden reasoning", () =>
    Effect.gen(function* () {
      const fake = makeSession([{ text: "still working", reasoning: "GOAL COMPLETE" }])
      const events = yield* makeEvents
      const goals = yield* GoalSupervisor.make.pipe(
        Effect.provideService(SessionV2.Service, fake.service),
        Effect.provideService(EventV2.Service, events),
      )

      yield* goals.start({ sessionID, goal: "finish" })
      yield* Effect.yieldNow
      yield* turnEnded(events, fake)
      yield* Effect.yieldNow

      expect(fake.prompts[1]?.prompt.text).toContain("Continue working toward the goal.")
      expect(fake.prompts[1]?.prompt.text).not.toContain("Answer only YES or NO")
    }),
  )

  it.effect("detects a visible completion marker beyond bounded prompt evidence", () =>
    Effect.gen(function* () {
      const fake = makeSession([`${"x".repeat(1_001)}GOAL COMPLETE`])
      const events = yield* makeEvents
      const goals = yield* GoalSupervisor.make.pipe(
        Effect.provideService(SessionV2.Service, fake.service),
        Effect.provideService(EventV2.Service, events),
      )

      yield* goals.start({ sessionID, goal: "finish" })
      yield* Effect.yieldNow
      yield* turnEnded(events, fake)
      yield* Effect.yieldNow

      expect(fake.prompts[1]?.prompt.text).toContain("Answer only YES or NO")
    }),
  )

  it.effect("ignores a stale step settlement after a replacement start", () =>
    Effect.gen(function* () {
      const fake = makeSession(["GOAL COMPLETE"])
      const events = yield* makeEvents
      const goals = yield* GoalSupervisor.make.pipe(
        Effect.provideService(SessionV2.Service, fake.service),
        Effect.provideService(EventV2.Service, events),
      )

      yield* goals.start({ sessionID, goal: "first" })
      yield* Effect.yieldNow
      yield* fake.promoteNext(events)
      const stale = yield* stepStarted(events)
      yield* Effect.yieldNow
      yield* goals.start({ sessionID, goal: "replacement" })
      yield* Effect.yieldNow
      yield* stepEnded(events, stale)
      yield* Effect.yieldNow

      expect(fake.prompts).toHaveLength(2)
      expect(yield* goals.status(sessionID)).toMatchObject({ active: true, goal: "replacement", iteration: 1 })
    }),
  )

  it.effect("ignores a stale step that starts before the replacement prompt is promoted", () =>
    Effect.gen(function* () {
      const fake = makeSession(["GOAL COMPLETE"])
      const events = yield* makeEvents
      const goals = yield* GoalSupervisor.make.pipe(
        Effect.provideService(SessionV2.Service, fake.service),
        Effect.provideService(EventV2.Service, events),
      )

      yield* goals.start({ sessionID, goal: "first" })
      yield* Effect.yieldNow
      yield* fake.promoteNext(events)
      yield* goals.start({ sessionID, goal: "replacement" })
      yield* Effect.yieldNow
      const stale = yield* stepStarted(events)
      yield* stepEnded(events, stale)
      yield* Effect.yieldNow

      expect(fake.prompts).toHaveLength(2)
      expect(yield* goals.status(sessionID)).toMatchObject({ active: true, goal: "replacement", iteration: 1 })
    }),
  )

  it.effect("ignores a pre-steer settlement after the steer is promoted", () =>
    Effect.gen(function* () {
      const fake = makeSession(["GOAL COMPLETE"])
      const events = yield* makeEvents
      const goals = yield* GoalSupervisor.make.pipe(
        Effect.provideService(SessionV2.Service, fake.service),
        Effect.provideService(EventV2.Service, events),
      )

      yield* goals.start({ sessionID, goal: "finish" })
      yield* Effect.yieldNow
      yield* fake.promoteNext(events)
      const stale = yield* stepStarted(events)
      const externalID = SessionMessage.ID.create()
      yield* promptEvent(events, SessionEvent.PromptAdmitted, externalID, "also update docs")
      yield* promptEvent(events, SessionEvent.Prompted, externalID, "also update docs")
      yield* stepEnded(events, stale)
      yield* Effect.yieldNow

      expect(fake.prompts).toHaveLength(1)
      expect(yield* goals.status(sessionID)).toMatchObject({ active: true, goal: "finish", iteration: 0 })
    }),
  )

  it.effect("allows user escalation only for true blocker paths", () =>
    Effect.gen(function* () {
      const fake = makeSession(["not done"])
      const events = yield* makeEvents
      const goals = yield* GoalSupervisor.make.pipe(
        Effect.provideService(SessionV2.Service, fake.service),
        Effect.provideService(EventV2.Service, events),
      )

      yield* goals.start({ sessionID, goal: "finish" })
      yield* Effect.yieldNow
      yield* turnEnded(events, fake)
      yield* Effect.yieldNow

      expect(fake.prompts[1]?.prompt.text).toContain("configured permission")
      expect(fake.prompts[1]?.prompt.text).toContain("irrecoverable failure or blocker")
      expect(fake.prompts[1]?.prompt.text).not.toContain("Do not ask the user")
    }),
  )

  it.effect("ignores approval-like language in hidden reasoning", () =>
    Effect.gen(function* () {
      const fake = makeSession([{ text: "GOAL COMPLETE", reasoning: "Can I use this approach?" }])
      const events = yield* makeEvents
      const goals = yield* GoalSupervisor.make.pipe(
        Effect.provideService(SessionV2.Service, fake.service),
        Effect.provideService(EventV2.Service, events),
      )

      yield* goals.start({ sessionID, goal: "finish" })
      yield* Effect.yieldNow
      yield* turnEnded(events, fake)
      yield* Effect.yieldNow

      expect(fake.prompts).toHaveLength(2)
      expect(fake.prompts[1]?.prompt.text).toContain("Answer only YES or NO")
    }),
  )

  it.effect("does not reject a confirmation statement", () =>
    Effect.gen(function* () {
      const fake = makeSession(["GOAL COMPLETE. Confirmation: migrations applied."])
      const events = yield* makeEvents
      const goals = yield* GoalSupervisor.make.pipe(
        Effect.provideService(SessionV2.Service, fake.service),
        Effect.provideService(EventV2.Service, events),
      )

      yield* goals.start({ sessionID, goal: "finish" })
      yield* Effect.yieldNow
      yield* turnEnded(events, fake)
      yield* Effect.yieldNow

      expect(fake.prompts).toHaveLength(2)
      expect(fake.prompts[1]?.prompt.text).toContain("Answer only YES or NO")
    }),
  )

  it.effect("rejects approval prose before goal completion verification", () =>
    Effect.gen(function* () {
      const fake = makeSession(["GOAL COMPLETE. Can you approve this?"])
      const events = yield* makeEvents
      const goals = yield* GoalSupervisor.make.pipe(
        Effect.provideService(SessionV2.Service, fake.service),
        Effect.provideService(EventV2.Service, events),
      )

      yield* goals.start({ sessionID, goal: "finish" })
      yield* Effect.yieldNow
      yield* turnEnded(events, fake)
      yield* Effect.yieldNow

      expect(fake.prompts).toHaveLength(2)
      expect(fake.prompts[1]?.prompt.text).toContain("The prior assistant response requested user approval.")
      expect(fake.prompts[1]?.prompt.text).not.toContain("Answer only YES or NO")
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
      yield* turnEnded(events, fake)
      yield* Effect.yieldNow
      const firstContinuation = fake.prompts[1]?.prompt.text

      const externalID = SessionMessage.ID.create()
      yield* promptEvent(events, SessionEvent.PromptAdmitted, externalID, "also update the changelog")
      yield* promptEvent(events, SessionEvent.Prompted, externalID, "also update the changelog")
      yield* turnEnded(events, fake)
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
      yield* turnEnded(events, fake)
      yield* Effect.yieldNow
      yield* turnEnded(events, fake)
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
      yield* turnEnded(events, fake)
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
      yield* turnEnded(events, fake)
      yield* Effect.yieldNow

      expect(fake.prompts).toHaveLength(1)

      yield* promptEvent(events, SessionEvent.Prompted, externalID, "new goal")
      yield* turnEnded(events, fake)
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
      yield* turnEnded(events, fake)
      yield* Effect.yieldNow
      expect(fake.prompts).toHaveLength(2)

      const externalID = SessionMessage.ID.create()
      yield* promptEvent(events, SessionEvent.PromptAdmitted, externalID, "new goal")
      yield* turnEnded(events, fake)
      yield* Effect.yieldNow
      yield* promptEvent(events, SessionEvent.Prompted, externalID, "new goal")
      yield* Effect.yieldNow
      yield* turnEnded(events, fake)
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
      yield* turnEnded(events, fake)
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
      yield* turnFailed(events, fake)
      yield* Effect.yieldNow

      expect(fake.prompts).toHaveLength(1)
      expect(yield* goals.status(sessionID)).toBeUndefined()
      expect(yield* Deferred.isDone(tracked.finalized)).toBe(true)
    }),
  )

  it.effect("fails the active step when an external steer is admitted but not promoted", () =>
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
      yield* fake.promoteNext(events)
      const active = yield* stepStarted(events)
      yield* promptEvent(events, SessionEvent.PromptAdmitted, SessionMessage.ID.create(), "also update docs")
      yield* stepFailed(events, active)
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
      yield* turnFailed(events, fake)
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
      yield* turnEnded(events, fake)
      yield* Effect.yieldNow
      yield* turnEnded(events, fake)
      yield* Effect.yieldNow

      expect(fake.prompts).toHaveLength(2)
      expect(yield* goals.status(sessionID)).toMatchObject({ active: false, iteration: 2, cap: 2 })
      expect(yield* Deferred.isDone(tracked.finalized)).toBe(true)
    }),
  )

  it.effect("retires the question listener after cap exhaustion and registers one for a new goal", () =>
    Effect.gen(function* () {
      const events = yield* makeEvents
      const questions = makeQuestions(events)
      const locations = yield* makeQuestionLocationMap(questions.service)
      const fake = makeSession()
      const goals = yield* GoalSupervisor.make.pipe(
        Effect.provideService(SessionV2.Service, fake.service),
        Effect.provideService(EventV2.Service, events),
        Effect.provideService(LocationServiceMap.Service, locations),
      )

      yield* goals.start({ sessionID, goal: "finished", cap: 0 })
      yield* Effect.yieldNow
      expect(events.listenerCount()).toBe(0)
      const pending = yield* questions.service
        .ask({ sessionID, questions: [{ question: "Manual?", header: "State", options: [] }] })
        .pipe(Effect.forkScoped)
      yield* Effect.yieldNow

      expect(yield* questions.service.list()).toHaveLength(1)
      yield* goals.start({ sessionID, goal: "restart" })
      expect(events.listenerCount()).toBe(1)
      expect(
        yield* questions.service.ask({
          sessionID,
          questions: [
            {
              question: "Automatic?",
              header: "State",
              options: [{ label: "Yes", description: "Recommended", recommended: true }],
            },
          ],
        }),
      ).toEqual([["Yes"]])
      yield* Fiber.interrupt(pending)
    }),
  )

  it.effect("retires the question listener after a failed step", () =>
    Effect.gen(function* () {
      const events = yield* makeEvents
      const questions = makeQuestions(events)
      const locations = yield* makeQuestionLocationMap(questions.service)
      const fake = makeSession()
      const goals = yield* GoalSupervisor.make.pipe(
        Effect.provideService(SessionV2.Service, fake.service),
        Effect.provideService(EventV2.Service, events),
        Effect.provideService(LocationServiceMap.Service, locations),
      )

      yield* goals.start({ sessionID, goal: "failed" })
      yield* turnFailed(events, fake)
      yield* Effect.yieldNow
      expect(events.listenerCount()).toBe(0)
      const pending = yield* questions.service
        .ask({ sessionID, questions: [{ question: "Manual?", header: "State", options: [] }] })
        .pipe(Effect.forkScoped)
      yield* Effect.yieldNow

      expect(yield* questions.service.list()).toHaveLength(1)
      yield* Fiber.interrupt(pending)
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
      yield* turnEnded(events, fake)
      yield* Effect.yieldNow
      yield* turnEnded(events, fake)
      yield* Effect.yieldNow
      expect(yield* goals.status(sessionID)).toMatchObject({ active: true, iteration: 2 })
      yield* turnEnded(events, fake)
      yield* Effect.yieldNow
      yield* turnEnded(events, fake)
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
