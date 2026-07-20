import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260720121056_self_improvement_session_evidence",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`self_improvement_session_evidence\` (
          \`id\` text PRIMARY KEY,
          \`location_id\` text NOT NULL,
          \`task_id_digest\` text NOT NULL,
          \`sample_id_digest\` text NOT NULL,
          \`request_digest\` text NOT NULL,
          \`workload\` text NOT NULL,
          \`workload_revision\` integer NOT NULL,
          \`producer_id\` text NOT NULL,
          \`outcome_class\` text NOT NULL,
          \`outcome\` text NOT NULL,
          \`metrics_json\` text NOT NULL,
          \`started_at\` integer NOT NULL,
          \`terminal_at\` integer NOT NULL,
          \`created_at\` integer NOT NULL
        );
      `)
      yield* tx.run(
        `CREATE UNIQUE INDEX \`self_improvement_session_evidence_location_task_idx\` ON \`self_improvement_session_evidence\` (\`location_id\`,\`task_id_digest\`);`,
      )
      yield* tx.run(
        `CREATE INDEX \`self_improvement_session_evidence_location_workload_terminal_idx\` ON \`self_improvement_session_evidence\` (\`location_id\`,\`workload\`,\`workload_revision\`,\`terminal_at\`);`,
      )
    })
  },
} satisfies DatabaseMigration.Migration
