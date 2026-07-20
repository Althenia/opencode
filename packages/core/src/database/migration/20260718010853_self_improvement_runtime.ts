import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260718010853_self_improvement_runtime",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`self_improvement_generation_lease\` (
          \`id\` text PRIMARY KEY,
          \`location_id\` text NOT NULL,
          \`pattern_digest\` text NOT NULL,
          \`owner_id\` text NOT NULL,
          \`lease_token_digest\` text NOT NULL,
          \`attempt_number\` integer NOT NULL,
          \`acquired_at\` integer NOT NULL,
          \`expires_at\` integer NOT NULL,
          \`completed_at\` integer,
          \`model_request_digest\` text NOT NULL,
          \`model_output_digest\` text,
          \`model_output_bytes\` text,
          \`outcome\` text NOT NULL,
          \`pull_event_id\` text,
          \`originating_task_id_digest\` text NOT NULL
        );
      `)
      yield* tx.run(
        `CREATE UNIQUE INDEX \`self_improvement_generation_lease_location_pattern_attempt_idx\` ON \`self_improvement_generation_lease\` (\`location_id\`,\`pattern_digest\`,\`attempt_number\`);`,
      )
      yield* tx.run(
        `CREATE UNIQUE INDEX \`self_improvement_generation_lease_pending_idx\` ON \`self_improvement_generation_lease\` (\`location_id\`,\`pattern_digest\`) WHERE "self_improvement_generation_lease"."outcome" = 'pending';`,
      )
      yield* tx.run(
        `CREATE INDEX \`self_improvement_generation_lease_location_pattern_acquired_idx\` ON \`self_improvement_generation_lease\` (\`location_id\`,\`pattern_digest\`,\`acquired_at\`);`,
      )
    })
  },
} satisfies DatabaseMigration.Migration
