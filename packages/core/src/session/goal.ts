export * as GoalSupervisor from "./goal"

import { Context, Effect, Exit, Fiber, Layer, Option, Queue, Scope, Stream } from "effect"
import { eq } from "drizzle-orm"
import { EventV2 } from "../event"
import { makeGlobalNode } from "../effect/app-node"
import { LocationServiceMap } from "../location-service-map"
import { QuestionV2 } from "../question"
import { SessionV2 } from "../session"
import { Database } from "../database/database"
import { SessionEvent } from "./event"
import { SessionMessage } from "./message"
import { SessionSchema } from "./schema"
import { GoalTable } from "./sql"

export const GOAL_MAX_ITERATIONS = 25
const EVIDENCE_LIMIT = 1_000

type DatabaseService = Database.Interface["db"]

export interface GoalState {
  readonly goal: string
  readonly active: boolean
  readonly iteration: number
  readonly cap: number
}

export interface StartInput {
  readonly sessionID: SessionSchema.ID
  readonly goal: string
  readonly messageID?: SessionMessage.ID
  readonly cap?: number
}

type PromptError = SessionV2.NotFoundError | SessionV2.PromptConflictError
type GoalEvent =
  | EventV2.Payload<typeof SessionEvent.PromptAdmitted>
  | EventV2.Payload<typeof SessionEvent.Prompted>
  | EventV2.Payload<typeof SessionEvent.Step.Started>
  | EventV2.Payload<typeof SessionEvent.Step.Ended>
  | EventV2.Payload<typeof SessionEvent.Step.Failed>

export interface Interface {
  readonly start: (input: StartInput) => Effect.Effect<GoalState, PromptError>
  readonly stop: (sessionID: SessionSchema.ID) => Effect.Effect<void>
  readonly status: (sessionID: SessionSchema.ID) => Effect.Effect<GoalState | undefined>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/GoalSupervisor") {}

type ActiveGoal = {
  state: GoalState
  failed: boolean
  latestAssistantResult?: string
  latestExternalSteer?: string
  claimedCompletion?: string
  failedVerification?: string
  readonly scope: Scope.Closeable
  readonly supervisorPrompts: Set<SessionMessage.ID>
}

export const make = Effect.gen(function* () {
  const sessions = yield* SessionV2.Service
  const events = yield* EventV2.Service
  const dbOption = yield* Effect.serviceOption(Database.Service)
  const db = Option.getOrUndefined(dbOption)?.db
  const locations = Option.getOrUndefined(yield* Effect.serviceOption(LocationServiceMap.Service))
  const scope = yield* Scope.Scope
  const goals = new Map<SessionSchema.ID, ActiveGoal>()

  const snapshot = (state: GoalState): GoalState => ({ ...state })

  const persistGoal = (sessionID: SessionSchema.ID, state: GoalState): Effect.Effect<void> =>
    db
      ? db
          .insert(GoalTable)
          .values({
            session_id: sessionID,
            goal: state.goal,
            active: state.active,
            iteration: state.iteration,
            cap: state.cap,
          })
          .onConflictDoUpdate({
            target: GoalTable.session_id,
            set: {
              goal: state.goal,
              active: state.active,
              iteration: state.iteration,
              cap: state.cap,
            },
          })
          .run()
          .pipe(Effect.orDie, Effect.asVoid)
      : Effect.void

  const persistActive = (sessionID: SessionSchema.ID, owner: ActiveGoal): Effect.Effect<void> =>
    persistGoal(sessionID, owner.state)

  const deleteGoal = (sessionID: SessionSchema.ID): Effect.Effect<void> =>
    db
      ? db.delete(GoalTable).where(eq(GoalTable.session_id, sessionID)).run().pipe(Effect.orDie, Effect.asVoid)
      : Effect.void

  const status: Interface["status"] = Effect.fn("GoalSupervisor.status")((sessionID) =>
    Effect.sync(() => {
      const active = goals.get(sessionID)
      return active && !active.failed ? snapshot(active.state) : undefined
    }),
  )

  const setState = (sessionID: SessionSchema.ID, owner: ActiveGoal, update: (state: GoalState) => GoalState) =>
    Effect.sync(() => {
      const active = goals.get(sessionID)
      if (active !== owner) return undefined
      const next = update(active.state)
      active.state = next
      return next
    })

  const latestAssistantResult = (sessionID: SessionSchema.ID) =>
    sessions.messages({ sessionID, limit: 1, order: "desc" }).pipe(
      Effect.map((messages) => {
        const content = messages
          .filter((message): message is SessionMessage.Assistant => message.type === "assistant")
          .flatMap((message) => message.content)
        return {
          text: content
            .filter((content): content is SessionMessage.AssistantText => content.type === "text")
            .map((content) => content.text)
            .join("\n"),
          all: content
            .filter((content): content is SessionMessage.AssistantText | SessionMessage.AssistantReasoning =>
              content.type === "text" || content.type === "reasoning",
            )
            .map((content) => content.text)
            .join("\n"),
        }
      }),
    )

  const isReadyForVerification = (text: string) => text.includes("GOAL COMPLETE")

  const verified = (text: string) => /^\s*YES\s*$/i.test(text)

  const bounded = (text: string) => text.slice(0, EVIDENCE_LIMIT)

  const promptText = (state: GoalState, active: ActiveGoal) =>
    [
      `Original goal: ${state.goal}`,
      "Reconcile the original goal with later user instructions in the current conversation.",
      "When instructions conflict, follow the latest user instruction.",
      active.latestExternalSteer && `Latest external steer: ${active.latestExternalSteer}`,
      active.latestAssistantResult && !active.claimedCompletion && `Latest assistant result: ${active.latestAssistantResult}`,
      active.claimedCompletion && `Captured claimed completion: ${active.claimedCompletion}`,
      active.failedVerification && `Failed verification: ${active.failedVerification}`,
      "Inspect the current tool and test evidence in the transcript before continuing.",
      "Use todowrite to maintain a goal-oriented task list: derive remaining work from the goal, latest user instructions, and current evidence; update statuses as work completes; execute the highest-priority unblocked item.",
      "Handle ordinary approval and clarification autonomously using best judgment. Ask the user only for a configured permission request, explicit consent before a destructive operation, or an irrecoverable failure or blocker that cannot be resolved from the current context.",
      "Continue working toward the goal.",
      "When the goal is complete, include GOAL COMPLETE.",
    ]
      .filter(Boolean)
      .join("\n")

  const verificationPromptText = (state: GoalState) =>
    [
      `Original goal: ${state.goal}`,
      "Reconcile the original goal with later user instructions in the current conversation.",
      "When instructions conflict, follow the latest user instruction.",
      "Re-read the goal and the latest assistant response.",
      "Is the goal fully complete? Answer only YES or NO.",
    ].join("\n")

  const isGoalEvent = (event: EventV2.Payload): event is GoalEvent =>
    event.type === SessionEvent.PromptAdmitted.type ||
    event.type === SessionEvent.Prompted.type ||
    event.type === SessionEvent.Step.Started.type ||
    event.type === SessionEvent.Step.Ended.type ||
    event.type === SessionEvent.Step.Failed.type

  const isQuestionAsked = (event: EventV2.Payload): event is EventV2.Payload<typeof QuestionV2.Event.Asked> =>
    event.type === QuestionV2.Event.Asked.type

  const prompt = Effect.fn("GoalSupervisor.prompt")(function* (
    sessionID: SessionSchema.ID,
    owner: ActiveGoal,
    text: string,
    id = SessionMessage.ID.create(),
  ) {
    if (goals.get(sessionID) !== owner || !owner.state.active) return false
    owner.supervisorPrompts.add(id)
    yield* sessions.prompt({ id, sessionID, prompt: { text }, delivery: "steer", resume: true })
    return goals.get(sessionID) === owner && owner.state.active
  })

  const retire = Effect.fn("GoalSupervisor.retire")(function* (
    sessionID: SessionSchema.ID,
    owner: ActiveGoal,
    failed = false,
  ) {
    if (goals.get(sessionID) !== owner) return
    owner.failed = failed
    yield* setState(sessionID, owner, (state) => ({ ...state, active: false }))
    yield* persistActive(sessionID, owner)
    yield* Scope.close(owner.scope, Exit.void).pipe(Effect.forkIn(scope, { startImmediately: true }))
  })

  const continueGoal = Effect.fn("GoalSupervisor.continueGoal")(function* (
    sessionID: SessionSchema.ID,
    owner: ActiveGoal,
    initial?: { text: string; messageID?: SessionMessage.ID },
  ) {
    if (goals.get(sessionID) !== owner) return false
    const current = owner.state
    if (!current.active) return false
    if (current.iteration >= current.cap) {
      yield* retire(sessionID, owner)
      return false
    }
    const state = yield* setState(sessionID, owner, (state) => ({ ...state, iteration: state.iteration + 1 }))
    if (!state) return false
    yield* persistActive(sessionID, owner)
    return yield* prompt(sessionID, owner, initial?.text ?? promptText(state, owner), initial?.messageID)
  })

  const run = Effect.fn("GoalSupervisor.run")(function* (
    sessionID: SessionSchema.ID,
    owner: ActiveGoal,
    queue: Queue.Queue<GoalEvent>,
  ) {
    const pendingExternal = new Set<SessionMessage.ID>()
    const seenAssistantMessages = new Set<SessionMessage.ID>()
    let activeAssistantMessageID: SessionMessage.ID | undefined
    let stepEligible = false
    let turn: "work" | "verification" | "external" = "work"
    while (true) {
      const event = yield* Queue.take(queue)
      const active = goals.get(sessionID)
      if (active !== owner || !owner.state.active) return

      if (event.type === SessionEvent.PromptAdmitted.type) {
        if (active.supervisorPrompts.has(event.data.messageID) || event.data.delivery !== "steer") continue
        pendingExternal.add(event.data.messageID)
        active.latestExternalSteer = bounded(event.data.prompt.text)
        active.claimedCompletion = undefined
        active.failedVerification = undefined
        turn = "external"
        continue
      }

      if (event.type === SessionEvent.Prompted.type) {
        if (event.data.delivery !== "steer") continue
        if (active.supervisorPrompts.delete(event.data.messageID)) {
          stepEligible = true
          continue
        }
        if (!pendingExternal.delete(event.data.messageID)) continue
        active.latestExternalSteer = bounded(event.data.prompt.text)
        active.latestAssistantResult = undefined
        active.claimedCompletion = undefined
        active.failedVerification = undefined
        activeAssistantMessageID = undefined
        stepEligible = true
        turn = "external"
        yield* setState(sessionID, owner, (state) => ({
          ...state,
          active: true,
          iteration: 0,
        }))
        continue
      }

      if (event.type === SessionEvent.Step.Started.type) {
        if (seenAssistantMessages.has(event.data.assistantMessageID)) continue
        seenAssistantMessages.add(event.data.assistantMessageID)
        if (!stepEligible) continue
        stepEligible = false
        activeAssistantMessageID = event.data.assistantMessageID
        continue
      }

      if (event.type === SessionEvent.Step.Failed.type) {
        if (activeAssistantMessageID !== event.data.assistantMessageID) continue
        activeAssistantMessageID = undefined
        yield* retire(sessionID, owner, true)
        return
      }

      if (
        event.type !== SessionEvent.Step.Ended.type ||
        pendingExternal.size > 0 ||
        activeAssistantMessageID !== event.data.assistantMessageID
      )
        continue
      activeAssistantMessageID = undefined

      if (turn === "verification") {
        const latest = yield* latestAssistantResult(sessionID)
        const verification = bounded(latest.all)
        if (verified(latest.text)) {
          yield* retire(sessionID, owner)
          return
        }
        if (goals.get(sessionID) !== owner) return
        active.failedVerification = verification
        turn = "work"
        if (!(yield* continueGoal(sessionID, owner))) return
        continue
      }

      const latest = yield* latestAssistantResult(sessionID)
      active.latestAssistantResult = bounded(latest.all)
      if (isReadyForVerification(latest.text)) {
        if (goals.get(sessionID) !== owner || !owner.state.active) return
        active.claimedCompletion = active.latestAssistantResult
        turn = "verification"
        yield* prompt(sessionID, owner, verificationPromptText(owner.state))
        continue
      }

      if (goals.get(sessionID) !== owner) return
      turn = "work"
      if (!(yield* continueGoal(sessionID, owner))) return
    }
  })

  const stop: Interface["stop"] = Effect.fn("GoalSupervisor.stop")((sessionID) =>
    Effect.gen(function* () {
      const active = goals.get(sessionID)
      goals.delete(sessionID)
      if (active) yield* Scope.close(active.scope, Exit.void)
      yield* deleteGoal(sessionID)
    }),
  )

  const start: Interface["start"] = Effect.fn("GoalSupervisor.start")(function* (input) {
    yield* stop(input.sessionID)
    const state = { goal: input.goal, active: true, iteration: 0, cap: input.cap ?? GOAL_MAX_ITERATIONS }
    const active: ActiveGoal = {
      state,
      failed: false,
      scope: yield* Scope.fork(scope),
      supervisorPrompts: new Set(),
    }
    goals.set(input.sessionID, active)
    yield* persistGoal(input.sessionID, state)
    const questions = yield* events.listen((event) => {
      if (!isQuestionAsked(event)) return Effect.void
      if (event.data.sessionID !== input.sessionID || goals.get(input.sessionID) !== active || !active.state.active)
        return Effect.void
      if (!event.location || !locations) return Effect.void
      return Effect.gen(function* () {
        const questions = yield* QuestionV2.Service
        if (goals.get(input.sessionID) !== active || !active.state.active) return
        const answers = event.data.questions.map((question) => {
          const selected = question.options.filter((option) => option.recommended)
          const options = selected.length > 0 ? selected : question.options
          if (options.length === 0) return ["Use your best judgment from the goal and current context, then continue."]
          return options.slice(0, question.multiple ? undefined : 1).map((option) => option.label)
        })
        if (goals.get(input.sessionID) !== active || !active.state.active) return
        yield* questions.reply({
          requestID: event.data.id,
          answers,
        })
      }).pipe(
        Effect.provide(locations.get(event.location)),
        Effect.catchTag("QuestionV2.NotFoundError", () => Effect.void),
        Effect.catchCause((cause) =>
          Effect.logWarning("failed to provision Goal question location", {
            sessionID: input.sessionID,
            requestID: event.data.id,
            cause,
          }),
        ),
      )
    })
    yield* Scope.addFinalizer(active.scope, questions)
    const queue = yield* Queue.unbounded<GoalEvent>()
    const subscription = yield* events
      .all()
      .pipe(
        Stream.filter(
          (event): event is GoalEvent => isGoalEvent(event) && event.data.sessionID === input.sessionID,
        ),
        Stream.runForEach((event) => Queue.offer(queue, event)),
        Effect.forkIn(active.scope, { startImmediately: true }),
      )
    if (goals.get(input.sessionID) !== active) return snapshot({ ...active.state, active: false })
    const started = yield* continueGoal(input.sessionID, active, { text: input.goal, messageID: input.messageID }).pipe(
      Effect.catch((error: PromptError) =>
        Effect.gen(function* () {
          if (goals.get(input.sessionID) === active) yield* stop(input.sessionID)
          return yield* Effect.fail(error)
        }),
      ),
    )
    if (goals.get(input.sessionID) !== active) return snapshot({ ...active.state, active: false })
    if (started)
      yield* run(input.sessionID, active, queue).pipe(
        Effect.ensuring(Fiber.interrupt(subscription)),
        Effect.catch(() =>
          Effect.sync(() => {
            if (goals.get(input.sessionID) === active) goals.delete(input.sessionID)
          }),
        ),
        Effect.forkIn(active.scope),
      )
    if (!started) yield* Fiber.interrupt(subscription)
    if (goals.get(input.sessionID) !== active) return snapshot({ ...active.state, active: false })
    return snapshot(active.state)
  })

  yield* Effect.addFinalizer(() =>
    Effect.forEach(goals.values(), (goal) => Scope.close(goal.scope, Exit.void), { discard: true }),
  )

  // Recover active goals from a previous process that crashed mid-supervision.
  // The supervisor loop itself is not resumed (post-crash continuation recovery
  // requires a separate explicit design), but the durable state is restored so
  // status queries return the correct goal and the client can decide to
  // re-start or stop.
  if (db) {
    const rows = yield* db
      .select()
      .from(GoalTable)
      .where(eq(GoalTable.active, true))
      .all()
      .pipe(Effect.orDie)

    for (const row of rows) {
      const state: GoalState = {
        goal: row.goal,
        active: true,
        iteration: row.iteration,
        cap: row.cap,
      }
      const recovered: ActiveGoal = {
        state,
        failed: false,
        scope: yield* Scope.fork(scope),
        supervisorPrompts: new Set(),
      }
      goals.set(row.session_id as SessionSchema.ID, recovered)
    }

    if (rows.length > 0) {
      yield* Effect.logInfo("GoalSupervisor recovered durable goal state", {
        count: rows.length,
        sessions: rows.map((r: typeof rows[number]) => r.session_id),
      })
    }
  }

  return Service.of({ start, stop, status })
})

export const layer = Layer.effect(Service, make)

export const node = makeGlobalNode({
  service: Service,
  layer: layer.pipe(Layer.orDie),
  deps: [SessionV2.node, EventV2.node, LocationServiceMap.node],
})
