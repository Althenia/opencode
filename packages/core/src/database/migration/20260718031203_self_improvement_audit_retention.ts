import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260718031203_self_improvement_audit_retention",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`PRAGMA foreign_keys=OFF;`)
      yield* tx.run(`
        CREATE TABLE \`__new_self_improvement_audit_entry\` (
          \`id\` text PRIMARY KEY,
          \`location_id\` text NOT NULL,
          \`event_type\` text NOT NULL,
          \`actor_id\` text NOT NULL,
          \`payload_json\` text NOT NULL,
          \`timestamp\` integer NOT NULL,
          \`retention_tag\` text NOT NULL,
          \`retention_created_at\` integer NOT NULL,
          \`retention_expires_at\` integer,
          CONSTRAINT "self_improvement_audit_entry_retention" CHECK(("retention_tag" = 'observation-30d' AND "retention_expires_at" = "retention_created_at" + 2592000000) OR ("retention_tag" = 'evidence-180d' AND "retention_expires_at" = "retention_created_at" + 15552000000) OR ("retention_tag" = 'governed-metadata' AND "retention_expires_at" IS NULL))
        );
      `)
      yield* tx.run(
        `INSERT INTO \`__new_self_improvement_audit_entry\`(\`id\`, \`location_id\`, \`event_type\`, \`actor_id\`, \`payload_json\`, \`timestamp\`, \`retention_tag\`, \`retention_created_at\`, \`retention_expires_at\`) SELECT \`id\`, \`location_id\`, \`event_type\`, \`actor_id\`, \`payload_json\`, \`timestamp\`, \`retention_tag\`, \`retention_created_at\`, \`retention_expires_at\` FROM \`self_improvement_audit_entry\`;`,
      )
      yield* tx.run(`DROP TABLE \`self_improvement_audit_entry\`;`)
      yield* tx.run(`ALTER TABLE \`__new_self_improvement_audit_entry\` RENAME TO \`self_improvement_audit_entry\`;`)
      yield* tx.run(`PRAGMA foreign_keys=ON;`)
      yield* tx.run(
        `CREATE INDEX \`self_improvement_audit_entry_location_timestamp_id_idx\` ON \`self_improvement_audit_entry\` (\`location_id\`,\`timestamp\`,\`id\`);`,
      )
      yield* tx.run(
        `CREATE INDEX \`self_improvement_audit_entry_location_event_type_timestamp_id_idx\` ON \`self_improvement_audit_entry\` (\`location_id\`,\`event_type\`,\`timestamp\`,\`id\`);`,
      )
      yield* tx.run(
        `CREATE INDEX \`self_improvement_audit_entry_location_expiry_id_idx\` ON \`self_improvement_audit_entry\` (\`location_id\`,\`retention_expires_at\`,\`id\`);`,
      )
    })
  },
} satisfies DatabaseMigration.Migration
