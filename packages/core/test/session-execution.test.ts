import { describe, expect, test } from "bun:test"
import { LLMError, TransportReason } from "@opencode-ai/ai"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { LocationServiceMap } from "@opencode-ai/core/location-service-map"
import type { LocationServices } from "@opencode-ai/core/location-services"
import { Project } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SelfImprovementSessionObserver } from "@opencode-ai/core/self-improvement/session-observer"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionAutonomy } from "@opencode-ai/core/session/autonomy"
import { SessionRestart } from "@opencode-ai/core/session/execution/restart"
import { UserInterruptedError } from "@opencode-ai/core/session/error"
import { SessionRunner } from "@opencode-ai/core/session/runner"
import { SessionTable, SessionTaskTable } from "@opencode-ai/core/session/sql"
import { SessionStore } from "@opencode-ai/core/session/store"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { AgentV2 } from "@opencode-ai/core/agent"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ToolOutputStore } from "@opencode-ai/core/tool-output-store"
import { SessionOrchestration } from "@opencode-ai/schema/session-orchestration"
import { Cause, Context, Deferred, Effect, Exit, Fiber, Layer, LayerMap, Scope } from "effect"
import { testEffect } from "./lib/effect"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([Database.node, EventV2.node, SessionStore.node])))

describe("SessionExecution lifecycle", () => {
  test("classifies success and typed failure terminals", () => {
    expect(SessionExecution.terminal(Exit.succeed(undefined))).toEqual({ type: "succeeded" })
    expect(
      SessionExecution.terminal(
        Exit.fail(
          new LLMError({
            module: "test",
            method: "stream",
            reason: new TransportReason({ message: "Disconnected" }),
          }),
        ),
      ),
    ).toEqual({ type: "failed", error: { type: "provider.transport", message: "Disconnected" } })
    const storage = new ToolOutputStore.StorageError({ operation: "encode", cause: new Error("invalid output") })
    expect(SessionExecution.terminal(Exit.fail(storage))).toEqual({
      type: "failed",
      error: { type: "unknown", message: storage.message },
    })
  })

  test("defaults owner-scope interruption to shutdown and preserves explicit reasons", () => {
    const interrupted = Effect.runSyncExit(Effect.interrupt)
    expect(SessionExecution.terminal(interrupted)).toEqual({ type: "interrupted", reason: "shutdown" })
    expect(SessionExecution.terminal(interrupted, "user")).toEqual({ type: "interrupted", reason: "user" })
    expect(SessionExecution.terminal(interrupted, "superseded")).toEqual({ type: "interrupted", reason: "superseded" })
    expect(SessionExecution.terminal(Exit.fail(new UserInterruptedError()))).toEqual({
      type: "interrupted",
      reason: "user",
    })
  })

  it.effect("atomically consumes each suspension at most once", () =>
    Effect.gen(function* () {
      const database = yield* Database.Service
      const store = yield* SessionStore.Service
      const first = SessionV2.ID.make("ses_recover_first")
      const second = SessionV2.ID.make("ses_recover_second")
      yield* seedSessions(database, [first, second], { time_suspended: Date.now() })

      expect(yield* store.consumeSuspended(first)).toBe(true)
      expect(yield* store.consumeSuspended(first)).toBe(false)
      expect(yield* store.consumeSuspended(second)).toBe(true)
      expect(yield* suspensions(database)).toEqual({ [first]: false, [second]: false })
    }),
  )

  it.effect("suspension survives teardown interruption and clears when a drain finishes on its own", () =>
    Effect.gen(function* () {
      const database = yield* Database.Service
      const interrupted = SessionV2.ID.make("ses_suspend_interrupted")
      const completed = SessionV2.ID.make("ses_suspend_completed")
      yield* seedSessions(database, [interrupted, completed])

      const draining = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const scope = yield* Scope.make()
      const context = yield* buildExecution(scope, ({ sessionID }) =>
        sessionID === completed
          ? Deferred.await(release)
          : Deferred.succeed(draining, undefined).pipe(Effect.andThen(Effect.never)),
      )
      const execution = Context.get(context, SessionExecution.Service)
      const restart = Context.get(context, SessionRestart.Service)
      yield* execution.resume(interrupted).pipe(Effect.forkScoped)
      const completing = yield* execution.resume(completed).pipe(Effect.forkIn(scope))
      yield* Deferred.await(draining)

      yield* restart.suspendActiveSessions
      expect(yield* suspensions(database)).toEqual({ [interrupted]: true, [completed]: true })

      // A drain that finishes on its own after suspension clears its stale suspension.
      yield* Deferred.succeed(release, undefined)
      yield* Fiber.join(completing)
      yield* execution.awaitIdle(completed)
      expect((yield* suspensions(database))[completed]).toBe(false)

      // Teardown interruption preserves suspension for the next server start.
      yield* Scope.close(scope, Exit.void)
      expect((yield* suspensions(database))[interrupted]).toBe(true)
    }),
  )

  it.effect("resumes each suspended Session at most once", () =>
    Effect.gen(function* () {
      const database = yield* Database.Service
      const first = SessionV2.ID.make("ses_resume_first")
      const second = SessionV2.ID.make("ses_resume_second")
      yield* seedSessions(database, [first, second], { time_suspended: Date.now() })

      const drained: string[] = []
      const scope = yield* Scope.make()
      const context = yield* buildExecution(scope, ({ sessionID }) => Effect.sync(() => void drained.push(sessionID)))
      const restart = Context.get(context, SessionRestart.Service)

      yield* restart.resumeSuspendedSessions
      expect(drained.toSorted()).toEqual([first, second])
      expect(yield* suspensions(database)).toEqual({ [first]: false, [second]: false })

      yield* restart.resumeSuspendedSessions
      expect(drained.length).toBe(2)
      yield* Scope.close(scope, Exit.void)
    }),
  )

  it.effect("does not invoke the runner for a waiting managed child", () =>
    Effect.gen(function* () {
      const database = yield* Database.Service
      const parentID = SessionV2.ID.make("ses_waiting_parent")
      const childID = SessionV2.ID.make("ses_waiting_child")
      yield* seedSessions(database, [parentID, childID])
      yield* database.db
        .insert(SessionTaskTable)
        .values({
          session_id: childID,
          parent_id: parentID,
          parent_assistant_message_id: SessionMessage.ID.make("msg_parent"),
          tool_call_id: "call_waiting",
          input_id: SessionMessage.ID.make("msg_input"),
          description: "waiting",
          agent: AgentV2.ID.make("reviewer"),
          model: ModelV2.Ref.make({ providerID: ProviderV2.ID.make("test"), id: ModelV2.ID.make("model") }),
          prompt_digest: "digest",
          background: false,
          delivery: "steer",
          state: "waiting",
          question_id: SessionOrchestration.QuestionID.make("qst_waiting"),
          question: "Proceed?",
          question_time: 1,
        })
        .run()
      const drained: SessionV2.ID[] = []
      const scope = yield* Scope.make()
      const context = yield* buildExecution(scope, ({ sessionID }) =>
        Effect.sync(() => {
          drained.push(sessionID)
        }),
      )
      yield* Context.get(context, SessionExecution.Service).resume(childID)
      expect(drained).toEqual([])
      yield* Scope.close(scope, Exit.void)
    }),
  )

  it.effect("records one terminal observation for a completed busy period", () =>
    Effect.gen(function* () {
      const database = yield* Database.Service
      const sessionID = SessionV2.ID.make("ses_observed")
      yield* seedSessions(database, [sessionID])

      const observed: Array<{ sessionID: SessionV2.ID; exit: Exit.Exit<void, unknown> }> = []
      const scope = yield* Scope.make()
      const context = yield* buildExecution(
        scope,
        () => Effect.void,
        (input) => Effect.sync(() => void observed.push(input)),
      )
      const execution = Context.get(context, SessionExecution.Service)

      yield* execution.resume(sessionID)
      yield* execution.awaitIdle(sessionID)

      expect(observed).toHaveLength(1)
      expect(observed[0]?.sessionID).toBe(sessionID)
      expect(Exit.isSuccess(observed[0]!.exit)).toBe(true)
      yield* Scope.close(scope, Exit.void)
    }),
  )

  it.effect("records a typed user interruption as cancelled evidence", () =>
    Effect.gen(function* () {
      const database = yield* Database.Service
      const sessionID = SessionV2.ID.make("ses_user_interrupted")
      yield* seedSessions(database, [sessionID])

      const observed: Exit.Exit<void, unknown>[] = []
      const scope = yield* Scope.make()
      const context = yield* buildExecution(
        scope,
        () => Effect.fail(new UserInterruptedError()),
        (input) => Effect.sync(() => void observed.push(input.exit)),
      )
      const execution = Context.get(context, SessionExecution.Service)

      yield* execution.resume(sessionID).pipe(Effect.exit)
      yield* execution.awaitIdle(sessionID)

      expect(observed).toHaveLength(1)
      expect(Exit.isFailure(observed[0]!) && Cause.hasInterrupts(observed[0]!.cause)).toBe(true)
      yield* Scope.close(scope, Exit.void)
    }),
  )
})

function seedSessions(
  database: Database.Service["Service"],
  sessionIDs: ReadonlyArray<SessionV2.ID>,
  values: { time_suspended?: number } = {},
) {
  return Effect.gen(function* () {
    yield* database.db
      .insert(ProjectTable)
      .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
      .run()
      .pipe(Effect.orDie)
    yield* database.db
      .insert(SessionTable)
      .values(
        sessionIDs.map((id) => ({
          id,
          project_id: Project.ID.global,
          slug: id,
          directory: "/project",
          title: id,
          version: "test",
          ...values,
        })),
      )
      .run()
      .pipe(Effect.orDie)
  })
}

function suspensions(database: Database.Service["Service"]) {
  return database.db
    .select({ id: SessionTable.id, suspended: SessionTable.time_suspended })
    .from(SessionTable)
    .all()
    .pipe(
      Effect.orDie,
      Effect.map((rows) => Object.fromEntries(rows.map((row) => [row.id, row.suspended !== null]))),
    )
}

/** Builds the local execution layer plus the restart actions against the test harness services. */
function buildExecution(
  scope: Scope.Closeable,
  drain: SessionRunner.Interface["drain"],
  record: SelfImprovementSessionObserver.Interface["record"] = () => Effect.void,
) {
  return Effect.gen(function* () {
    const database = yield* Database.Service
    const events = yield* EventV2.Service
    const store = yield* SessionStore.Service
    const autonomy = SessionAutonomy.make({ db: database.db })
    const runner = Layer.succeed(SessionRunner.Service, SessionRunner.Service.of({ drain }))
    const observer = Layer.succeed(
      SelfImprovementSessionObserver.Service,
      SelfImprovementSessionObserver.Service.of({ record }),
    )
    const locations = Layer.effect(
      LocationServiceMap.Service,
      LayerMap.make(
        () =>
          // The local execution test only needs the Session runner and terminal observer from the Location graph.
          // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
          Layer.merge(runner, observer) as unknown as Layer.Layer<LocationServices>,
      ),
    )
    return yield* Layer.buildWithScope(
      SessionRestart.layer.pipe(
        Layer.provideMerge(SessionExecution.layer),
        Layer.provide(Layer.succeed(Database.Service, database)),
        Layer.provide(Layer.succeed(EventV2.Service, events)),
        Layer.provide(Layer.succeed(SessionStore.Service, store)),
        Layer.provide(Layer.succeed(SessionAutonomy.Service, autonomy)),
        Layer.provide(locations),
      ),
      scope,
    )
  })
}
