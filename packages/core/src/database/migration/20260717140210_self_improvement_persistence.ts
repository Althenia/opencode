import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260717140210_self_improvement_persistence",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`self_improvement_artifact\` (
          \`id\` text PRIMARY KEY,
          \`location_id\` text NOT NULL,
          \`kind\` text NOT NULL,
          \`name\` text NOT NULL,
          \`status\` text NOT NULL,
          \`created_by\` text NOT NULL,
          \`created_at\` integer NOT NULL,
          \`revision\` integer NOT NULL,
          \`tombstone_actor_id\` text,
          \`tombstone_reason\` text,
          \`tombstone_at\` integer,
          CONSTRAINT "self_improvement_artifact_tombstone_state" CHECK(("status" = 'live' AND "tombstone_actor_id" IS NULL AND "tombstone_reason" IS NULL AND "tombstone_at" IS NULL) OR ("status" = 'tombstoned' AND "tombstone_actor_id" IS NOT NULL AND "tombstone_reason" IS NOT NULL AND "tombstone_at" IS NOT NULL))
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`self_improvement_artifact_version\` (
          \`id\` text PRIMARY KEY,
          \`artifact_id\` text NOT NULL,
          \`version_number\` integer NOT NULL,
          \`source\` text NOT NULL,
          \`behavior_class\` text NOT NULL,
          \`proposal_json\` text NOT NULL,
          \`canonical_json\` text NOT NULL,
          \`proposal_digest\` text NOT NULL,
          \`input_snapshot_digest\` text NOT NULL,
          \`version_digest\` text NOT NULL,
          \`capability_manifest_json\` text NOT NULL,
          \`capability_manifest_digest\` text NOT NULL,
          \`creator_id\` text NOT NULL,
          \`created_at\` integer NOT NULL,
          \`generation_lease_id\` text,
          \`strategy_pull_id\` text,
          \`originating_task_id_digest\` text,
          \`model_request_digest\` text,
          \`model_output_digest\` text,
          \`retention_deadline\` integer,
          CONSTRAINT \`fk_self_improvement_artifact_version_artifact_id_self_improvement_artifact_id_fk\` FOREIGN KEY (\`artifact_id\`) REFERENCES \`self_improvement_artifact\`(\`id\`) ON DELETE RESTRICT,
          CONSTRAINT "self_improvement_artifact_version_generated_metadata" CHECK(("source" = 'human' AND "generation_lease_id" IS NULL AND "strategy_pull_id" IS NULL AND "originating_task_id_digest" IS NULL AND "model_request_digest" IS NULL AND "model_output_digest" IS NULL AND "retention_deadline" IS NULL) OR ("source" = 'generated' AND "generation_lease_id" IS NOT NULL AND "strategy_pull_id" IS NOT NULL AND "originating_task_id_digest" IS NOT NULL AND "model_request_digest" IS NOT NULL AND "model_output_digest" IS NOT NULL AND "retention_deadline" IS NOT NULL))
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`self_improvement_audit_entry\` (
          \`id\` text PRIMARY KEY,
          \`location_id\` text NOT NULL,
          \`event_type\` text NOT NULL,
          \`actor_id\` text NOT NULL,
          \`payload_json\` text NOT NULL,
          \`timestamp\` integer NOT NULL,
          \`retention_tag\` text NOT NULL,
          \`retention_created_at\` integer NOT NULL,
          \`retention_expires_at\` integer
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`self_improvement_idempotency\` (
          \`id\` text PRIMARY KEY,
          \`principal_id\` text NOT NULL,
          \`location_id\` text NOT NULL,
          \`operation\` text NOT NULL,
          \`key\` text NOT NULL,
          \`request_digest\` text NOT NULL,
          \`status\` integer NOT NULL,
          \`body_digest\` text NOT NULL,
          \`body_json\` text NOT NULL,
          \`created_at\` integer NOT NULL,
          \`expires_at\` integer NOT NULL
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`self_improvement_artifact_slot\` (
          \`location_id\` text NOT NULL,
          \`artifact_id\` text NOT NULL,
          \`slot\` text NOT NULL,
          \`version_id\` text NOT NULL,
          \`artifact_revision\` integer NOT NULL,
          \`updated_at\` integer NOT NULL,
          CONSTRAINT \`self_improvement_artifact_slot_pk\` PRIMARY KEY(\`location_id\`, \`artifact_id\`, \`slot\`),
          CONSTRAINT \`fk_self_improvement_artifact_slot_artifact_id_self_improvement_artifact_id_fk\` FOREIGN KEY (\`artifact_id\`) REFERENCES \`self_improvement_artifact\`(\`id\`) ON DELETE RESTRICT,
          CONSTRAINT \`fk_self_improvement_artifact_slot_version_id_self_improvement_artifact_version_id_fk\` FOREIGN KEY (\`version_id\`) REFERENCES \`self_improvement_artifact_version\`(\`id\`) ON DELETE RESTRICT,
          CONSTRAINT "self_improvement_artifact_slot_slot" CHECK("slot" IN ('active', 'shadow', 'canary'))
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`self_improvement_stage_transition\` (
          \`id\` text PRIMARY KEY,
          \`version_id\` text NOT NULL,
          \`previous_stage\` text,
          \`next_stage\` text NOT NULL,
          \`event\` text NOT NULL,
          \`reason\` text NOT NULL,
          \`actor_id\` text NOT NULL,
          \`timestamp\` integer NOT NULL,
          \`evaluation_run_id\` text,
          \`approval_id\` text,
          \`rollback_id\` text,
          \`context_outbox_id\` text,
          \`idempotency_record_id\` text,
          \`idempotency_digest\` text NOT NULL,
          CONSTRAINT \`fk_self_improvement_stage_transition_version_id_self_improvement_artifact_version_id_fk\` FOREIGN KEY (\`version_id\`) REFERENCES \`self_improvement_artifact_version\`(\`id\`) ON DELETE RESTRICT
        );
      `)
      yield* tx.run(
        `CREATE UNIQUE INDEX \`self_improvement_artifact_location_kind_name_idx\` ON \`self_improvement_artifact\` (\`location_id\`,\`kind\`,\`name\`);`,
      )
      yield* tx.run(
        `CREATE INDEX \`self_improvement_artifact_location_status_kind_name_id_idx\` ON \`self_improvement_artifact\` (\`location_id\`,\`status\`,\`kind\`,\`name\`,\`id\`);`,
      )
      yield* tx.run(
        `CREATE UNIQUE INDEX \`self_improvement_artifact_version_artifact_number_idx\` ON \`self_improvement_artifact_version\` (\`artifact_id\`,\`version_number\`);`,
      )
      yield* tx.run(
        `CREATE UNIQUE INDEX \`self_improvement_artifact_version_digest_idx\` ON \`self_improvement_artifact_version\` (\`version_digest\`);`,
      )
      yield* tx.run(
        `CREATE INDEX \`self_improvement_audit_entry_location_timestamp_id_idx\` ON \`self_improvement_audit_entry\` (\`location_id\`,\`timestamp\`,\`id\`);`,
      )
      yield* tx.run(
        `CREATE INDEX \`self_improvement_audit_entry_location_event_type_timestamp_id_idx\` ON \`self_improvement_audit_entry\` (\`location_id\`,\`event_type\`,\`timestamp\`,\`id\`);`,
      )
      yield* tx.run(
        `CREATE UNIQUE INDEX \`self_improvement_idempotency_identity_idx\` ON \`self_improvement_idempotency\` (\`principal_id\`,\`location_id\`,\`operation\`,\`key\`);`,
      )
      yield* tx.run(
        `CREATE INDEX \`self_improvement_idempotency_location_expires_id_idx\` ON \`self_improvement_idempotency\` (\`location_id\`,\`expires_at\`,\`id\`);`,
      )
      yield* tx.run(
        `CREATE UNIQUE INDEX \`self_improvement_artifact_slot_version_id_idx\` ON \`self_improvement_artifact_slot\` (\`version_id\`);`,
      )
      yield* tx.run(
        `CREATE INDEX \`self_improvement_artifact_slot_location_artifact_slot_idx\` ON \`self_improvement_artifact_slot\` (\`location_id\`,\`artifact_id\`,\`slot\`);`,
      )
      yield* tx.run(
        `CREATE INDEX \`self_improvement_stage_transition_version_timestamp_id_idx\` ON \`self_improvement_stage_transition\` (\`version_id\`,\`timestamp\`,\`id\`);`,
      )
    })
  },
} satisfies DatabaseMigration.Migration
