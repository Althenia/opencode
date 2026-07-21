import { expect } from "bun:test"
import { Effect } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { Project } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionAutonomy } from "@opencode-ai/core/session/autonomy"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { testEffect } from "./lib/effect"

const it = testEffect(Database.layer({ path: ":memory:" }))
const sessionID = SessionV2.ID.make("ses_autonomy")

const setup = Effect.gen(function* () {
  const { db } = yield* Database.Service
  yield* db
    .insert(ProjectTable)
    .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)
  yield* db
    .insert(SessionTable)
    .values({
      id: sessionID,
      project_id: Project.ID.global,
      slug: "autonomy",
      directory: "/project",
      title: "autonomy",
      version: "test",
      metadata: { preserved: true },
    })
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)
  return SessionAutonomy.make({ db })
})

it.effect("persists modes without overwriting unrelated metadata", () =>
  Effect.gen(function* () {
      const service = yield* setup
      expect(yield* service.get(sessionID)).toEqual({ mode: "normal" })
      expect(yield* service.setMode({ sessionID, mode: "yolo" })).toEqual({ mode: "yolo" })
      expect(yield* service.get(sessionID)).toEqual({ mode: "yolo" })
      const row = yield* (yield* Database.Service).db.select({ metadata: SessionTable.metadata }).from(SessionTable).get().pipe(Effect.orDie)
      expect(row?.metadata).toMatchObject({ preserved: true, autonomy: { mode: "yolo" } })
  }),
)

it.effect("bounds goal continuation by completion, iteration, and repeated no-progress", () =>
  Effect.gen(function* () {
    const service = yield* setup
    yield* service.setGoal({ sessionID, text: "Ship the fix", maxIterations: 4, maxNoProgress: 2 })

    expect((yield* service.advance({ sessionID, progress: "step one" })).goal).toMatchObject({
      status: "active",
      iteration: 1,
      noProgress: 0,
    })
    expect((yield* service.advance({ sessionID, progress: "step one" })).goal).toMatchObject({
      status: "active",
      iteration: 2,
      noProgress: 1,
    })
    const exhausted = yield* service.advance({ sessionID, progress: "step one" })
    expect(exhausted).toMatchObject({ mode: "normal", goal: { status: "exhausted", iteration: 3, noProgress: 2 } })

    yield* service.setGoal({ sessionID, text: "Finish", maxIterations: 4 })
    const completed = yield* service.advance({ sessionID, progress: "done", completed: true })
    expect(completed).toMatchObject({ mode: "normal", goal: { status: "completed", iteration: 1 } })
  }),
)

it.effect("stops an active goal durably", () =>
  Effect.gen(function* () {
    const service = yield* setup
    yield* service.setGoal({ sessionID, text: "Keep going" })
    expect(yield* service.stop(sessionID)).toMatchObject({ mode: "normal", goal: { status: "stopped" } })
    expect(yield* service.get(sessionID)).toMatchObject({ mode: "normal", goal: { status: "stopped" } })
  }),
)
