export * as GoalContext from "./goal-context"

import { and, eq } from "drizzle-orm"
import { Effect } from "effect"
import { Database } from "../database/database"
import { SessionSchema } from "./schema"
import { GoalTable } from "./sql"

export const load = Effect.fnUntraced(function* (db: Database.Interface["db"], sessionID: SessionSchema.ID) {
  const goal = yield* db
    .select({ goal: GoalTable.goal })
    .from(GoalTable)
    .where(and(eq(GoalTable.session_id, sessionID), eq(GoalTable.active, true)))
    .get()
    .pipe(Effect.orDie)
  if (!goal) return
  return `Current supervised Goal (JSON data):\n${JSON.stringify(goal)}\nContinue supervised Goal execution until verified complete.`
})
