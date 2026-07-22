import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260722010956_session-orchestration",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`session_task_notification\` (
          \`id\` text PRIMARY KEY,
          \`task_session_id\` text NOT NULL,
          \`parent_id\` text NOT NULL,
          \`type\` text NOT NULL,
          \`revision\` integer NOT NULL,
          \`excerpt\` text,
          \`delivered\` integer DEFAULT false NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_delivered\` integer,
          CONSTRAINT \`fk_session_task_notification_task_session_id_session_task_session_id_fk\` FOREIGN KEY (\`task_session_id\`) REFERENCES \`session_task\`(\`session_id\`) ON DELETE CASCADE,
          CONSTRAINT \`fk_session_task_notification_parent_id_session_id_fk\` FOREIGN KEY (\`parent_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`session_task\` (
          \`session_id\` text PRIMARY KEY,
          \`parent_id\` text NOT NULL,
          \`parent_assistant_message_id\` text NOT NULL,
          \`tool_call_id\` text NOT NULL,
          \`input_id\` text NOT NULL UNIQUE,
          \`description\` text NOT NULL,
          \`agent\` text NOT NULL,
          \`model\` text NOT NULL,
          \`prompt_digest\` text NOT NULL,
          \`background\` integer NOT NULL,
          \`delivery\` text NOT NULL,
          \`state\` text NOT NULL,
          \`progress\` text,
          \`progress_time\` integer,
          \`question_id\` text,
          \`question\` text,
          \`question_data\` text,
          \`question_time\` integer,
          \`attempt_started\` integer DEFAULT false NOT NULL,
          \`revision\` integer DEFAULT 0 NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          CONSTRAINT \`fk_session_task_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE,
          CONSTRAINT \`fk_session_task_parent_id_session_id_fk\` FOREIGN KEY (\`parent_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(
        `CREATE UNIQUE INDEX \`session_task_notification_transition_idx\` ON \`session_task_notification\` (\`task_session_id\`,\`type\`,\`revision\`);`,
      )
      yield* tx.run(
        `CREATE INDEX \`session_task_notification_delivery_idx\` ON \`session_task_notification\` (\`delivered\`,\`time_created\`,\`id\`);`,
      )
      yield* tx.run(
        `CREATE UNIQUE INDEX \`session_task_launch_identity_idx\` ON \`session_task\` (\`parent_id\`,\`parent_assistant_message_id\`,\`tool_call_id\`);`,
      )
      yield* tx.run(
        `CREATE INDEX \`session_task_parent_state_updated_idx\` ON \`session_task\` (\`parent_id\`,\`state\`,\`time_updated\`);`,
      )
    })
  },
} satisfies DatabaseMigration.Migration
