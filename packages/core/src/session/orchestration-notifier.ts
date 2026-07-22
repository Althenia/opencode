export * as SessionOrchestrationNotifier from "./orchestration-notifier"

import { Context, Effect, Layer, Stream } from "effect"
import { and, asc, eq } from "drizzle-orm"
import { Database } from "../database/database"
import { makeGlobalNode } from "../effect/app-node"
import { KeyedMutex } from "../effect/keyed-mutex"
import { EventV2 } from "../event"
import { SessionV2 } from "../session"
import { SessionExecution } from "./execution"
import { SessionEvent } from "./event"
import { identities } from "./orchestration"
import { SessionTaskNotificationTable, SessionTaskTable } from "./sql"

export interface Interface {
  readonly dispatch: Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/SessionOrchestrationNotifier") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const db = (yield* Database.Service).db
    const events = yield* EventV2.Service
    const execution = yield* SessionExecution.Service
    const sessions = yield* SessionV2.Service
    const lock = KeyedMutex.makeUnsafe<string>()

    const dispatch = lock.withLock("outbox")(
      Effect.gen(function* () {
        const rows = yield* db
          .select({ notification: SessionTaskNotificationTable, task: SessionTaskTable })
          .from(SessionTaskNotificationTable)
          .innerJoin(SessionTaskTable, eq(SessionTaskTable.session_id, SessionTaskNotificationTable.task_session_id))
          .where(eq(SessionTaskNotificationTable.delivered, false))
          .orderBy(asc(SessionTaskNotificationTable.time_created), asc(SessionTaskNotificationTable.id))
          .all()
          .pipe(Effect.orDie)
        for (const row of rows) {
          const notification = row.notification
          const task = row.task
          const id = identities(task.parent_id, task.parent_assistant_message_id, task.tool_call_id).notification(
            notification.revision,
            notification.type,
          )
          const data = {
            source: "subagent_notification",
            childID: task.session_id,
            type: notification.type,
            revision: notification.revision,
            excerpt: notification.excerpt ?? undefined,
          }
          const admitted = yield* sessions
            .synthetic({
              id,
              sessionID: task.parent_id,
              text: `Subagent notification:\n${JSON.stringify(data)}`,
              description: "Subagent notification",
              metadata: data,
              delivery: "steer",
              resume: false,
            })
            .pipe(
              Effect.as(true),
              Effect.catchTag("Session.NotFoundError", () =>
                Effect.logWarning("Parent Session missing for subagent notification").pipe(
                  Effect.annotateLogs({ parentID: task.parent_id, childID: task.session_id }),
                  Effect.as(false),
                ),
              ),
              Effect.catchTag("Session.SyntheticConflictError", () =>
                Effect.logError("Deterministic subagent notification conflicts with parent history").pipe(
                  Effect.annotateLogs({
                    parentID: task.parent_id,
                    childID: task.session_id,
                    notification: notification.id,
                  }),
                  Effect.as(false),
                ),
              ),
            )
          if (!admitted) continue
          yield* execution.wake(task.parent_id)
          yield* db
            .update(SessionTaskNotificationTable)
            .set({ delivered: true, time_delivered: Date.now() })
            .where(
              and(
                eq(SessionTaskNotificationTable.id, notification.id),
                eq(SessionTaskNotificationTable.delivered, false),
              ),
            )
            .run()
            .pipe(Effect.orDie)
        }
      }),
    )
    const service = Service.of({ dispatch })
    yield* events.subscribe(SessionEvent.Task.Updated).pipe(
      Stream.runForEach(() => dispatch),
      Effect.forkScoped({ startImmediately: true }),
    )
    yield* dispatch
    return service
  }),
)

export const node = makeGlobalNode({
  service: Service,
  layer,
  deps: [Database.node, EventV2.node, SessionExecution.node, SessionV2.node],
})
