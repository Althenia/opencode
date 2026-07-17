export * as GoalSupervisor from "./goal"

import { Context, Effect, Exit, Fiber, Layer, Option, Queue, Scope, Stream } from "effect"
import { eq } from "drizzle-orm"
import { EventV2 } from "../event"
import { makeGlobalNode } from "../effect/app-node"
import { KeyedMutex } from "../effect/keyed-mutex"
import { LocationServiceMap } from "../location-service-map"
import { QuestionV2 } from "../question"
import { SessionV2 } from "../session"
import { Database } from "../database/database"
import { SessionEvent } from "./event"
import { SessionMessage } from "./message"
import { SessionSchema } from "./schema"
import { GoalTable } from "./sql"
import { PromptInput } from "@opencode-ai/schema/prompt-input"
import { SessionTodo } from "./todo"

export const GOAL_MAX_ITERATIONS = 25
const EVIDENCE_LIMIT = 1_000

type DatabaseService = Database.Interface["db"]

export type GoalPhase = "starting" | "running" | "stalled"

export interface GoalState {
  readonly goal: string
  readonly active: boolean
  readonly iteration: number
  readonly cap: number
  readonly phase: GoalPhase
}

export interface StartInput {
  readonly sessionID: SessionSchema.ID
  readonly goal: string
  readonly messageID?: SessionMessage.ID
  readonly files?: ReadonlyArray<PromptInput.FileAttachment>
  readonly cap?: number
}

type PromptError = SessionV2.NotFoundError | SessionV2.PromptConflictError
type GoalEvent =
  | EventV2.Payload<typeof SessionEvent.PromptAdmitted>
  | EventV2.Payload<typeof SessionEvent.Prompted>
  | EventV2.Payload<typeof SessionEvent.Step.Started>
  | EventV2.Payload<typeof SessionEvent.Step.Ended>
  | EventV2.Payload<typeof SessionEvent.Step.Failed>

type SupervisorPrompt = {
  readonly kind: "work" | "verification"
  readonly revision: number
}

type Turn = SupervisorPrompt | { readonly kind: "external"; readonly revision: number }

export interface Interface {
  readonly start: (input: StartInput) => Effect.Effect<GoalState, PromptError>
  readonly resume: (sessionID: SessionSchema.ID) => Effect.Effect<GoalState | undefined, PromptError>
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
  revision: number
  readonly scope: Scope.Closeable
  readonly supervisorPrompts: Map<SessionMessage.ID, SupervisorPrompt>
  activeAssistantMessageID?: SessionMessage.ID
  attached: boolean
}

export const make = Effect.gen(function* () {
  const sessions = yield* SessionV2.Service
  const events = yield* EventV2.Service
  const dbOption = yield* Effect.serviceOption(Database.Service)
  const db = Option.getOrUndefined(dbOption)?.db
  const locations = Option.getOrUndefined(yield* Effect.serviceOption(LocationServiceMap.Service))
  const scope = yield* Scope.Scope
  const goals = new Map<SessionSchema.ID, ActiveGoal>()
  const lifecycle = KeyedMutex.makeUnsafe<SessionSchema.ID>()

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

  const deleteGoal = (sessionID: SessionSchema.ID): Effect.Effect<void> =>
    db
      ? db.delete(GoalTable).where(eq(GoalTable.session_id, sessionID)).run().pipe(Effect.orDie, Effect.asVoid)
      : Effect.void

  const status: Interface["status"] = Effect.fn("GoalSupervisor.status")((sessionID) =>
    Effect.sync(() => {
      const active = goals.get(sessionID)
      return active ? snapshot(active.state) : undefined
    }),
  )

  const setState = (
    sessionID: SessionSchema.ID,
    owner: ActiveGoal,
    update: (state: GoalState) => GoalState,
    persist = false,
  ) =>
    lifecycle.withLock(sessionID)(
      Effect.gen(function* () {
        const active = goals.get(sessionID)
        if (active !== owner) return
        const next = update(active.state)
        active.state = next
        if (persist) yield* persistGoal(sessionID, next)
        return next
      }),
    )

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
      "Every todowrite call while supervising this Goal must include the concise effective goal in the goal field.",
      "Before starting or delegating work, use todowrite to mark the matching item in_progress and keep future work pending.",
      "When a subagent is implementing, testing, or reviewing an item, keep its parent todo in_progress until the subagent result is reviewed and accepted; do not advance the current target to later work early.",
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

  const isTodoUpdated = (event: EventV2.Payload): event is EventV2.Payload<typeof SessionTodo.Event.Updated> =>
    event.type === SessionTodo.Event.Updated.type

  const prompt = Effect.fn("GoalSupervisor.prompt")(function* (
    sessionID: SessionSchema.ID,
    owner: ActiveGoal,
    text: string,
    kind: SupervisorPrompt["kind"],
    delivery: "steer" | "queue" = "queue",
    id = SessionMessage.ID.create(),
    files?: ReadonlyArray<PromptInput.FileAttachment>,
  ) {
    if (goals.get(sessionID) !== owner || !owner.state.active) return false
    owner.supervisorPrompts.set(id, { kind, revision: owner.revision })
    yield* sessions.prompt({ id, sessionID, prompt: { text, ...(files ? { files } : {}) }, delivery, resume: true })
    return goals.get(sessionID) === owner && owner.state.active
  })

  const retire = Effect.fn("GoalSupervisor.retire")(function* (
    sessionID: SessionSchema.ID,
    owner: ActiveGoal,
    failed = false,
  ) {
    if (goals.get(sessionID) !== owner) return
    owner.failed = failed
    yield* setState(sessionID, owner, (state) => ({ ...state, active: false }), true)
    yield* Scope.close(owner.scope, Exit.void).pipe(Effect.forkIn(scope, { startImmediately: true }))
  })

  const continueGoal = Effect.fn("GoalSupervisor.continueGoal")(function* (
    sessionID: SessionSchema.ID,
    owner: ActiveGoal,
    initial?: { text: string; messageID?: SessionMessage.ID; files?: ReadonlyArray<PromptInput.FileAttachment> },
  ) {
    if (goals.get(sessionID) !== owner) return false
    const current = owner.state
    if (!current.active) return false
    if (current.iteration >= current.cap) {
      yield* retire(sessionID, owner)
      return false
    }
    const state = yield* setState(
      sessionID,
      owner,
      (state) => ({ ...state, iteration: state.iteration + 1 }),
      true,
    )
    if (!state) return false
    return yield* prompt(
      sessionID,
      owner,
      promptText(state, owner),
      "work",
      initial ? "steer" : "queue",
      initial?.messageID,
      initial?.files,
    )
  })

  const run = Effect.fn("GoalSupervisor.run")(function* (
    sessionID: SessionSchema.ID,
    owner: ActiveGoal,
    queue: Queue.Queue<GoalEvent>,
  ) {
    const pendingExternal = new Map<SessionMessage.ID, number>()
    const seenAssistantMessages = new Set<SessionMessage.ID>()
    let activeAssistantMessageID: SessionMessage.ID | undefined
    let pendingTurn: Turn | undefined
    let activeTurn: Turn | undefined
    while (true) {
      const event = yield* Queue.take(queue)
      const active = goals.get(sessionID)
      if (active !== owner || !owner.state.active) return

      if (event.type === SessionEvent.PromptAdmitted.type) {
        if (active.supervisorPrompts.has(event.data.messageID) || event.data.delivery !== "steer") continue
        active.revision++
        pendingExternal.set(event.data.messageID, active.revision)
        active.latestExternalSteer = bounded(event.data.prompt.text)
        active.claimedCompletion = undefined
        active.failedVerification = undefined
        continue
      }

      if (event.type === SessionEvent.Prompted.type) {
        const supervisor = active.supervisorPrompts.get(event.data.messageID)
        if (supervisor) {
          active.supervisorPrompts.delete(event.data.messageID)
          pendingTurn = supervisor
          continue
        }
        if (event.data.delivery !== "steer") continue
        const revision = pendingExternal.get(event.data.messageID)
        if (revision === undefined) continue
        pendingExternal.delete(event.data.messageID)
        active.latestExternalSteer = bounded(event.data.prompt.text)
        active.latestAssistantResult = undefined
        active.claimedCompletion = undefined
        active.failedVerification = undefined
        activeAssistantMessageID = undefined
        activeTurn = undefined
        pendingTurn = { kind: "external", revision }
        yield* setState(sessionID, owner, (state) => ({
          ...state,
          active: true,
          iteration: 0,
          phase: "starting",
        }))
        continue
      }

      if (event.type === SessionEvent.Step.Started.type) {
        if (seenAssistantMessages.has(event.data.assistantMessageID)) continue
        seenAssistantMessages.add(event.data.assistantMessageID)
        if (!pendingTurn) continue
        activeAssistantMessageID = event.data.assistantMessageID
        active.activeAssistantMessageID = event.data.assistantMessageID
        active.state = { ...active.state, phase: "running" }
        activeTurn = pendingTurn
        pendingTurn = undefined
        continue
      }

      if (event.type === SessionEvent.Step.Failed.type) {
        if (activeAssistantMessageID !== event.data.assistantMessageID) continue
        const failedTurn = activeTurn
        activeAssistantMessageID = undefined
        active.activeAssistantMessageID = undefined
        activeTurn = undefined
        if (
          pendingExternal.size === 0 &&
          failedTurn &&
          failedTurn.kind !== "external" &&
          failedTurn.revision !== active.revision
        )
          continue
        active.state = { ...active.state, phase: "stalled" }
        continue
      }

      if (
        event.type !== SessionEvent.Step.Ended.type ||
        pendingExternal.size > 0 ||
        activeAssistantMessageID !== event.data.assistantMessageID ||
        !activeTurn
      )
        continue
      const completedTurn = activeTurn
      activeAssistantMessageID = undefined
      active.activeAssistantMessageID = undefined
      activeTurn = undefined
      if (completedTurn.kind !== "external" && completedTurn.revision !== active.revision) continue

      if (completedTurn.kind === "verification") {
        const latest = yield* latestAssistantResult(sessionID)
        const verification = bounded(latest.all)
        if (verified(latest.text)) {
          yield* retire(sessionID, owner)
          return
        }
        if (goals.get(sessionID) !== owner) return
        active.failedVerification = verification
        if (!(yield* continueGoal(sessionID, owner))) return
        continue
      }

      const latest = yield* latestAssistantResult(sessionID)
      active.latestAssistantResult = bounded(latest.all)
      if (isReadyForVerification(latest.text)) {
        if (goals.get(sessionID) !== owner || !owner.state.active) return
        active.claimedCompletion = active.latestAssistantResult
        yield* prompt(sessionID, owner, verificationPromptText(owner.state), "verification")
        continue
      }

      if (goals.get(sessionID) !== owner) return
      if (!(yield* continueGoal(sessionID, owner))) return
    }
  })

  const stop: Interface["stop"] = Effect.fn("GoalSupervisor.stop")((sessionID) =>
    Effect.gen(function* () {
      const active = yield* lifecycle.withLock(sessionID)(
        Effect.gen(function* () {
          const active = goals.get(sessionID)
          goals.delete(sessionID)
          yield* deleteGoal(sessionID)
          return active
        }),
      )
      if (active) yield* Scope.close(active.scope, Exit.void)
    }),
  )

  const attach = Effect.fn("GoalSupervisor.attach")(function* (sessionID: SessionSchema.ID, active: ActiveGoal) {
    if (active.attached || goals.get(sessionID) !== active) return
    const questions = yield* events.listen((event) => {
      if (!isQuestionAsked(event)) return Effect.void
      if (event.data.sessionID !== sessionID || goals.get(sessionID) !== active || !active.state.active)
        return Effect.void
      if (!event.location || !locations) return Effect.void
      return Effect.gen(function* () {
        const questions = yield* QuestionV2.Service
        if (goals.get(sessionID) !== active || !active.state.active) return
        const answers = event.data.questions.map((question) => {
          const selected = question.options.filter((option) => option.recommended)
          const options = selected.length > 0 ? selected : question.options
          if (options.length === 0) return ["Use your best judgment from the goal and current context, then continue."]
          return options.slice(0, question.multiple ? undefined : 1).map((option) => option.label)
        })
        if (goals.get(sessionID) !== active || !active.state.active) return
        yield* questions.reply({
          requestID: event.data.id,
          answers,
        })
      }).pipe(
        Effect.provide(locations.get(event.location)),
        Effect.catchTag("QuestionV2.NotFoundError", () => Effect.void),
        Effect.catchCause((cause) =>
          Effect.logWarning("failed to provision Goal question location", {
            sessionID,
            requestID: event.data.id,
            cause,
          }),
        ),
      )
    })
    yield* Scope.addFinalizer(active.scope, questions)
    const todos = yield* events.listen((event) => {
      if (
        !isTodoUpdated(event) ||
        event.data.sessionID !== sessionID ||
        !event.data.goal ||
        event.data.assistantMessageID !== active.activeAssistantMessageID ||
        goals.get(sessionID) !== active
      )
        return Effect.void
      return setState(sessionID, active, (state) => ({ ...state, goal: event.data.goal! }), true).pipe(Effect.asVoid)
    })
    yield* Scope.addFinalizer(active.scope, todos)
    const queue = yield* Queue.unbounded<GoalEvent>()
    const subscription = yield* events
      .all()
      .pipe(
        Stream.filter((event): event is GoalEvent => isGoalEvent(event) && event.data.sessionID === sessionID),
        Stream.runForEach((event) => Queue.offer(queue, event)),
        Effect.forkIn(active.scope, { startImmediately: true }),
      )
    yield* run(sessionID, active, queue).pipe(
      Effect.ensuring(Fiber.interrupt(subscription)),
      Effect.catch(() => Effect.void),
      Effect.forkIn(active.scope),
    )
    active.attached = true
  })

  const resume: Interface["resume"] = Effect.fn("GoalSupervisor.resume")(function* (sessionID) {
    return yield* Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const active = yield* restore(
          lifecycle.withLock(sessionID)(
            Effect.sync(() => {
              const active = goals.get(sessionID)
              if (!active || !active.state.active || active.state.phase !== "stalled") return
              active.state = { ...active.state, phase: "starting" }
              return active
            }),
          ),
        )
        if (!active) return yield* status(sessionID)
        yield* attach(sessionID, active)
        const stall = setState(sessionID, active, (state) =>
          state.phase === "starting" ? { ...state, phase: "stalled" } : state,
        ).pipe(Effect.asVoid)
        const started = yield* restore(continueGoal(sessionID, active)).pipe(
          Effect.onInterrupt(() => stall),
          Effect.catch((error: PromptError) => stall.pipe(Effect.andThen(Effect.fail(error)))),
        )
        if (!started) return snapshot(active.state)
        return snapshot(active.state)
      }),
    )
  })

  const start: Interface["start"] = Effect.fn("GoalSupervisor.start")(function* (input) {
    yield* stop(input.sessionID)
    const state = {
      goal: input.goal,
      active: true,
      iteration: 0,
      cap: input.cap ?? GOAL_MAX_ITERATIONS,
      phase: "starting" as const,
    }
    const active: ActiveGoal = {
      state,
      failed: false,
      revision: 0,
      scope: yield* Scope.fork(scope),
      supervisorPrompts: new Map(),
      attached: false,
    }
    yield* lifecycle.withLock(input.sessionID)(
      Effect.gen(function* () {
        goals.set(input.sessionID, active)
        yield* persistGoal(input.sessionID, state)
      }),
    )
    yield* attach(input.sessionID, active).pipe(Effect.uninterruptible)
    if (goals.get(input.sessionID) !== active) return snapshot({ ...active.state, active: false })
    const started = yield* continueGoal(input.sessionID, active, {
      text: input.goal,
      messageID: input.messageID,
      files: input.files,
    }).pipe(
      Effect.catch((error: PromptError) =>
        Effect.gen(function* () {
          if (goals.get(input.sessionID) === active) yield* stop(input.sessionID)
          return yield* Effect.fail(error)
        }),
      ),
    )
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
        phase: "stalled",
      }
      const recovered: ActiveGoal = {
        state,
        failed: false,
        revision: 0,
        scope: yield* Scope.fork(scope),
        supervisorPrompts: new Map(),
        attached: false,
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

  return Service.of({ start, resume, stop, status })
})

export const layer = Layer.effect(Service, make)

export const node = makeGlobalNode({
  service: Service,
  layer: layer.pipe(Layer.orDie),
  deps: [SessionV2.node, EventV2.node, LocationServiceMap.node],
})
