import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260714051845_flowery_zeigeist",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`session_goal\` (
          \`session_id\` text PRIMARY KEY,
          \`goal\` text NOT NULL,
          \`active\` integer DEFAULT true NOT NULL,
          \`iteration\` integer DEFAULT 0 NOT NULL,
          \`cap\` integer NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          CONSTRAINT \`fk_session_goal_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`CREATE INDEX \`session_goal_active_idx\` ON \`session_goal\` (\`active\`);`)
    })
  },
} satisfies DatabaseMigration.Migration
