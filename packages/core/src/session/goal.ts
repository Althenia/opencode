export * as GoalSupervisor from "./goal"

import { Context, Effect, Fiber, Layer, Scope, Stream } from "effect"
import { EventV2 } from "../event"
import { SessionV2 } from "../session"
import { SessionEvent } from "./event"
import { SessionMessage } from "./message"
import { SessionSchema } from "./schema"

export const GOAL_MAX_ITERATIONS = 10

export interface GoalState {
  readonly goal: string
  readonly active: boolean
  readonly iteration: number
  readonly cap: number
}

export interface StartInput {
  readonly sessionID: SessionSchema.ID
  readonly goal: string
  readonly cap?: number
}

type PromptError = SessionV2.NotFoundError | SessionV2.PromptConflictError

export interface Interface {
  readonly start: (input: StartInput) => Effect.Effect<GoalState, PromptError>
  readonly stop: (sessionID: SessionSchema.ID) => Effect.Effect<void>
  readonly status: (sessionID: SessionSchema.ID) => Effect.Effect<GoalState | undefined>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/GoalSupervisor") {}

type ActiveGoal = {
  readonly state: GoalState
  readonly fiber?: Fiber.Fiber<void, never>
}

export const make = Effect.gen(function* () {
  const sessions = yield* SessionV2.Service
  const events = yield* EventV2.Service
  const scope = yield* Scope.Scope
  const goals = new Map<SessionSchema.ID, ActiveGoal>()

  const snapshot = (state: GoalState): GoalState => ({ ...state })

  const status: Interface["status"] = Effect.fn("GoalSupervisor.status")((sessionID) =>
    Effect.sync(() => {
      const active = goals.get(sessionID)
      return active ? snapshot(active.state) : undefined
    }),
  )

  const setState = (sessionID: SessionSchema.ID, update: (state: GoalState) => GoalState) =>
    Effect.sync(() => {
      const active = goals.get(sessionID)
      if (!active) return undefined
      const next = update(active.state)
      goals.set(sessionID, { ...active, state: next })
      return next
    })

  const waitForTurn = (sessionID: SessionSchema.ID) =>
    events.subscribe(SessionEvent.Step.Ended).pipe(
      Stream.filter((event) => event.data.sessionID === sessionID),
      Stream.take(1),
      Stream.runDrain,
    )

  const latestAssistantText = (sessionID: SessionSchema.ID) =>
    sessions.messages({ sessionID, limit: 1, order: "desc" }).pipe(
      Effect.map((messages) =>
        messages
          .filter((message): message is SessionMessage.Assistant => message.type === "assistant")
          .flatMap((message) => message.content)
          .filter((content): content is SessionMessage.AssistantText | SessionMessage.AssistantReasoning =>
            content.type === "text" || content.type === "reasoning",
          )
          .map((content) => content.text)
          .join("\n"),
      ),
    )

  const verified = (text: string) => text.includes("GOAL COMPLETE") && /^\s*YES\s*$/im.test(text)

  const promptText = (state: GoalState) =>
    [
      `Goal: ${state.goal}`,
      `Iteration ${state.iteration} of ${state.cap}. Continue working toward the goal.`,
      "When the goal is complete, include GOAL COMPLETE and answer YES to verify completion.",
    ].join("\n")

  const beginTurn = Effect.fn("GoalSupervisor.beginTurn")(function* (sessionID: SessionSchema.ID) {
    const current = goals.get(sessionID)?.state
    if (!current?.active) return undefined
    if (current.iteration >= current.cap) {
      yield* setState(sessionID, (state) => ({ ...state, active: false }))
      return undefined
    }
    const state = yield* setState(sessionID, (state) => ({ ...state, iteration: state.iteration + 1 }))
    if (!state) return undefined
    const wait = yield* waitForTurn(sessionID).pipe(Effect.forkIn(scope))
    yield* Effect.yieldNow
    yield* sessions.prompt({ sessionID, prompt: { text: promptText(state) }, delivery: "steer", resume: true }).pipe(
      Effect.catch((error: PromptError) =>
        Effect.gen(function* () {
          yield* Fiber.interrupt(wait)
          return yield* Effect.fail(error)
        }),
      ),
    )
    return wait
  })

  const completeTurn = Effect.fn("GoalSupervisor.completeTurn")(function* (
    sessionID: SessionSchema.ID,
    wait: Fiber.Fiber<void, unknown>,
  ) {
    yield* Fiber.join(wait)
    if (verified(yield* latestAssistantText(sessionID))) {
      yield* setState(sessionID, (state) => ({ ...state, active: false }))
      return false
    }
    return true
  })

  const run = Effect.fn("GoalSupervisor.run")(function* (sessionID: SessionSchema.ID, firstWait: Fiber.Fiber<void, unknown>) {
    if (!(yield* completeTurn(sessionID, firstWait))) return
    while (true) {
      const current = goals.get(sessionID)?.state
      if (!current?.active) return
      const wait = yield* beginTurn(sessionID)
      if (!wait) return
      if (!(yield* completeTurn(sessionID, wait))) return
    }
  })

  const stop: Interface["stop"] = Effect.fn("GoalSupervisor.stop")((sessionID) =>
    Effect.gen(function* () {
      const active = goals.get(sessionID)
      goals.delete(sessionID)
      if (active?.fiber) yield* Fiber.interrupt(active.fiber)
    }),
  )

  const start: Interface["start"] = Effect.fn("GoalSupervisor.start")(function* (input) {
    yield* stop(input.sessionID)
    const state = { goal: input.goal, active: true, iteration: 0, cap: input.cap ?? GOAL_MAX_ITERATIONS }
    goals.set(input.sessionID, { state })
    const wait = yield* beginTurn(input.sessionID).pipe(
      Effect.catch((error: PromptError) =>
        Effect.gen(function* () {
          goals.delete(input.sessionID)
          return yield* Effect.fail(error)
        }),
      ),
    )
    if (wait) {
      const fiber = yield* run(input.sessionID, wait).pipe(
        Effect.catch(() =>
          Effect.sync(() => {
            goals.delete(input.sessionID)
          }),
        ),
        Effect.forkIn(scope),
      )
      const active = goals.get(input.sessionID)
      if (active) goals.set(input.sessionID, { ...active, fiber })
    }
    return snapshot(goals.get(input.sessionID)?.state ?? state)
  })

  yield* Effect.addFinalizer(() =>
    Effect.forEach(goals.values(), (goal) => (goal.fiber ? Fiber.interrupt(goal.fiber) : Effect.void), { discard: true }),
  )

  return Service.of({ start, stop, status })
})

export const layer = Layer.effect(Service, make)
