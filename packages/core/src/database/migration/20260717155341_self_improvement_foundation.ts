import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260717155341_self_improvement_foundation",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`self_improvement_approval_request\` (
          \`id\` text PRIMARY KEY,
          \`location_id\` text NOT NULL,
          \`version_id\` text NOT NULL,
          \`version_digest\` text NOT NULL,
          \`suite_id\` text NOT NULL,
          \`suite_revision\` integer NOT NULL,
          \`evaluation_run_id\` text NOT NULL,
          \`shadow_evidence_digest\` text NOT NULL,
          \`creator_id\` text NOT NULL,
          \`requested_at\` integer NOT NULL,
          \`shadow_evidence_expires_at\` integer NOT NULL,
          CONSTRAINT \`fk_self_improvement_approval_request_version_id_self_improvement_artifact_version_id_fk\` FOREIGN KEY (\`version_id\`) REFERENCES \`self_improvement_artifact_version\`(\`id\`) ON DELETE RESTRICT,
          CONSTRAINT "self_improvement_approval_request_evidence_expiry" CHECK("shadow_evidence_expires_at" = "requested_at" + 15552000000)
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`self_improvement_approval\` (
          \`id\` text PRIMARY KEY,
          \`request_id\` text NOT NULL,
          \`location_id\` text NOT NULL,
          \`version_id\` text NOT NULL,
          \`version_digest\` text NOT NULL,
          \`suite_id\` text NOT NULL,
          \`suite_revision\` integer NOT NULL,
          \`evaluation_run_id\` text NOT NULL,
          \`shadow_evidence_digest\` text NOT NULL,
          \`decision\` text NOT NULL,
          \`approver_id\` text NOT NULL,
          \`decided_at\` integer NOT NULL,
          \`expires_at\` integer,
          \`shadow_evidence_expires_at\` integer NOT NULL,
          \`consumed_at\` integer,
          CONSTRAINT \`fk_self_improvement_approval_request_id_self_improvement_approval_request_id_fk\` FOREIGN KEY (\`request_id\`) REFERENCES \`self_improvement_approval_request\`(\`id\`) ON DELETE RESTRICT,
          CONSTRAINT "self_improvement_approval_decision_expiry" CHECK(("decision" = 'rejected' AND "expires_at" IS NULL AND "consumed_at" IS NULL) OR ("decision" = 'approved' AND "expires_at" = "decided_at" + 86400000))
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`self_improvement_rollback\` (
          \`id\` text PRIMARY KEY,
          \`location_id\` text NOT NULL,
          \`artifact_id\` text NOT NULL,
          \`candidate_version_id\` text NOT NULL,
          \`retained_active_version_id\` text NOT NULL,
          \`canary_run_id\` text NOT NULL,
          \`reason\` text NOT NULL,
          \`reward_event_id\` text NOT NULL,
          \`timestamp\` integer NOT NULL,
          CONSTRAINT \`fk_self_improvement_rollback_artifact_id_self_improvement_artifact_id_fk\` FOREIGN KEY (\`artifact_id\`) REFERENCES \`self_improvement_artifact\`(\`id\`) ON DELETE RESTRICT,
          CONSTRAINT \`fk_self_improvement_rollback_candidate_version_id_self_improvement_artifact_version_id_fk\` FOREIGN KEY (\`candidate_version_id\`) REFERENCES \`self_improvement_artifact_version\`(\`id\`) ON DELETE RESTRICT,
          CONSTRAINT \`fk_self_improvement_rollback_retained_active_version_id_self_improvement_artifact_version_id_fk\` FOREIGN KEY (\`retained_active_version_id\`) REFERENCES \`self_improvement_artifact_version\`(\`id\`) ON DELETE RESTRICT,
          CONSTRAINT "self_improvement_rollback_canary_reason" CHECK("reason" = 'canary-regression')
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`self_improvement_context_desired_state\` (
          \`location_id\` text NOT NULL,
          \`artifact_id\` text NOT NULL,
          \`rollout_slot\` text NOT NULL,
          \`desired_state\` text NOT NULL,
          \`version_id\` text,
          \`version_digest\` text,
          \`desired_revision\` integer NOT NULL,
          CONSTRAINT \`self_improvement_context_desired_state_pk\` PRIMARY KEY(\`location_id\`, \`artifact_id\`, \`rollout_slot\`),
          CONSTRAINT \`fk_self_improvement_context_desired_state_artifact_id_self_improvement_artifact_id_fk\` FOREIGN KEY (\`artifact_id\`) REFERENCES \`self_improvement_artifact\`(\`id\`) ON DELETE RESTRICT,
          CONSTRAINT \`fk_self_improvement_context_desired_state_version_id_self_improvement_artifact_version_id_fk\` FOREIGN KEY (\`version_id\`) REFERENCES \`self_improvement_artifact_version\`(\`id\`) ON DELETE RESTRICT,
          CONSTRAINT "self_improvement_context_desired_state_target" CHECK(("desired_state" = 'absent' AND "version_id" IS NULL AND "version_digest" IS NULL) OR ("desired_state" = 'present' AND "version_id" IS NOT NULL AND "version_digest" IS NOT NULL))
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`self_improvement_context_outbox\` (
          \`id\` text PRIMARY KEY,
          \`location_id\` text NOT NULL,
          \`artifact_id\` text NOT NULL,
          \`expected_artifact_revision\` integer NOT NULL,
          \`expected_stage\` text NOT NULL,
          \`desired_state_revision\` integer NOT NULL,
          \`intent_json\` text NOT NULL,
          \`status\` text NOT NULL,
          \`attempts\` integer NOT NULL,
          \`next_retry_at\` integer NOT NULL,
          \`cas_result_digest\` text,
          \`created_at\` integer NOT NULL,
          CONSTRAINT \`fk_self_improvement_context_outbox_artifact_id_self_improvement_artifact_id_fk\` FOREIGN KEY (\`artifact_id\`) REFERENCES \`self_improvement_artifact\`(\`id\`) ON DELETE RESTRICT,
          CONSTRAINT "self_improvement_context_outbox_attempts" CHECK("attempts" >= 0)
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`self_improvement_context_selection_evidence\` (
          \`id\` text PRIMARY KEY,
          \`artifact_id\` text NOT NULL,
          \`version_id\` text NOT NULL,
          \`version_digest\` text NOT NULL,
          \`location_id\` text NOT NULL,
          \`stage\` text NOT NULL,
          \`context_epoch\` integer NOT NULL,
          \`session_digest\` text NOT NULL,
          \`cohort_result\` text NOT NULL,
          \`outbox_id\` text NOT NULL,
          \`created_at\` integer NOT NULL,
          \`expires_at\` integer NOT NULL,
          CONSTRAINT \`fk_self_improvement_context_selection_evidence_artifact_id_self_improvement_artifact_id_fk\` FOREIGN KEY (\`artifact_id\`) REFERENCES \`self_improvement_artifact\`(\`id\`) ON DELETE RESTRICT,
          CONSTRAINT \`fk_self_improvement_context_selection_evidence_version_id_self_improvement_artifact_version_id_fk\` FOREIGN KEY (\`version_id\`) REFERENCES \`self_improvement_artifact_version\`(\`id\`) ON DELETE RESTRICT,
          CONSTRAINT \`fk_self_improvement_context_selection_evidence_outbox_id_self_improvement_context_outbox_id_fk\` FOREIGN KEY (\`outbox_id\`) REFERENCES \`self_improvement_context_outbox\`(\`id\`) ON DELETE RESTRICT,
          CONSTRAINT "self_improvement_context_selection_evidence_expiry" CHECK("expires_at" = "created_at" + 180 * 86400000)
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`self_improvement_evaluation_baseline\` (
          \`id\` text PRIMARY KEY,
          \`location_id\` text NOT NULL,
          \`workload\` text NOT NULL,
          \`workload_revision\` integer NOT NULL,
          \`suite_id\` text NOT NULL,
          \`suite_revision\` integer NOT NULL,
          \`baseline_json\` text NOT NULL
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`self_improvement_evaluation_decision\` (
          \`run_id\` text PRIMARY KEY,
          \`location_id\` text NOT NULL,
          \`decision_json\` text NOT NULL,
          \`expires_at\` integer NOT NULL
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`self_improvement_evaluation_finding\` (
          \`id\` text PRIMARY KEY,
          \`location_id\` text NOT NULL,
          \`run_id\` text NOT NULL,
          \`finding_order\` integer NOT NULL,
          \`finding_json\` text NOT NULL,
          \`expires_at\` integer NOT NULL
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`self_improvement_evaluation_run\` (
          \`id\` text PRIMARY KEY,
          \`location_id\` text NOT NULL,
          \`request_digest\` text NOT NULL,
          \`state\` text NOT NULL,
          \`cutoff_sample_set_digest\` text,
          \`decided_at\` integer,
          \`run_json\` text NOT NULL
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`self_improvement_evaluation_sample\` (
          \`id\` text PRIMARY KEY,
          \`location_id\` text NOT NULL,
          \`run_id\` text NOT NULL,
          \`sample_id_digest\` text NOT NULL,
          \`task_id_digest\` text NOT NULL,
          \`request_digest\` text NOT NULL,
          \`sample_json\` text NOT NULL,
          \`expires_at\` integer NOT NULL
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`self_improvement_evaluation_suite_revision\` (
          \`location_id\` text NOT NULL,
          \`suite_id\` text NOT NULL,
          \`revision\` integer NOT NULL,
          \`suite_json\` text NOT NULL
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`self_improvement_observation\` (
          \`id\` text PRIMARY KEY,
          \`location_id\` text NOT NULL,
          \`pattern_digest\` text NOT NULL,
          \`identity_digest\` text NOT NULL,
          \`workload\` text NOT NULL,
          \`workload_revision\` integer NOT NULL,
          \`error_class\` text NOT NULL,
          \`ordered_tool_symbol_digest\` text NOT NULL,
          \`outcome_class\` text NOT NULL,
          \`task_id_digest\` text NOT NULL,
          \`producer_id\` text NOT NULL,
          \`occurred_at\` integer NOT NULL,
          \`expires_at\` integer NOT NULL
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`self_improvement_bandit_state\` (
          \`location_id\` text NOT NULL,
          \`action_domain\` text NOT NULL,
          \`bucket_digest\` text NOT NULL,
          \`derivation_revision\` integer NOT NULL,
          \`allowlist_revision\` integer NOT NULL,
          \`arm_id\` text NOT NULL,
          \`pull_total\` integer NOT NULL,
          \`rewarded_pull_total\` integer NOT NULL,
          \`cumulative_reward\` real NOT NULL,
          \`mean_reward\` real NOT NULL,
          \`active\` integer NOT NULL,
          \`latest_pull_event_id\` text,
          \`latest_reward_event_id\` text
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`self_improvement_generation_strategy_arm\` (
          \`id\` text PRIMARY KEY,
          \`location_id\` text NOT NULL,
          \`strategy_id\` text NOT NULL,
          \`allowlist_revision\` integer NOT NULL,
          \`active\` integer NOT NULL
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`self_improvement_model_route_arm\` (
          \`id\` text PRIMARY KEY,
          \`location_id\` text NOT NULL,
          \`route_json\` text NOT NULL,
          \`allowlist_revision\` integer NOT NULL,
          \`active\` integer NOT NULL
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`self_improvement_pull_event\` (
          \`id\` text PRIMARY KEY,
          \`location_id\` text NOT NULL,
          \`action_domain\` text NOT NULL,
          \`bucket_digest\` text NOT NULL,
          \`derivation_revision\` integer NOT NULL,
          \`allowlist_revision\` integer NOT NULL,
          \`ordered_eligible_arm_ids_json\` text NOT NULL,
          \`selected_arm_id\` text NOT NULL,
          \`proposal_digest\` text,
          \`session_digest\` text,
          \`version_id\` text,
          \`timestamp\` integer NOT NULL,
          \`expires_at\` integer NOT NULL,
          CONSTRAINT "self_improvement_pull_event_retention" CHECK("expires_at" = "timestamp" + 180 * 86400000)
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`self_improvement_reward_event\` (
          \`id\` text PRIMARY KEY,
          \`location_id\` text NOT NULL,
          \`pull_event_id\` text NOT NULL,
          \`outcome_class\` text NOT NULL,
          \`numeric_reward\` real,
          \`evidence_digest\` text NOT NULL,
          \`timestamp\` integer NOT NULL,
          \`expires_at\` integer NOT NULL,
          CONSTRAINT "self_improvement_reward_event_retention" CHECK("expires_at" = "timestamp" + 180 * 86400000)
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`self_improvement_routing_decision\` (
          \`id\` text PRIMARY KEY,
          \`location_id\` text NOT NULL,
          \`session_digest\` text NOT NULL,
          \`workload\` text NOT NULL,
          \`workload_revision\` integer NOT NULL,
          \`role_digest\` text NOT NULL,
          \`precedence_source\` text NOT NULL,
          \`policy_snapshot_digest\` text NOT NULL,
          \`catalog_snapshot_digest\` text NOT NULL,
          \`variant_snapshot_digest\` text NOT NULL,
          \`ordered_eligible_arms_json\` text NOT NULL,
          \`selected_route_json\` text NOT NULL,
          \`reason_code\` text NOT NULL,
          \`pull_event_id\` text,
          \`timestamp\` integer NOT NULL,
          \`expires_at\` integer NOT NULL,
          CONSTRAINT "self_improvement_routing_decision_retention" CHECK("expires_at" = "timestamp" + 180 * 86400000)
        );
      `)
      yield* tx.run(
        `CREATE INDEX \`self_improvement_approval_request_location_version_idx\` ON \`self_improvement_approval_request\` (\`location_id\`,\`version_id\`);`,
      )
      yield* tx.run(
        `CREATE UNIQUE INDEX \`self_improvement_approval_request_idx\` ON \`self_improvement_approval\` (\`request_id\`);`,
      )
      yield* tx.run(
        `CREATE INDEX \`self_improvement_approval_location_version_idx\` ON \`self_improvement_approval\` (\`location_id\`,\`version_id\`);`,
      )
      yield* tx.run(
        `CREATE UNIQUE INDEX \`self_improvement_rollback_canary_run_idx\` ON \`self_improvement_rollback\` (\`canary_run_id\`);`,
      )
      yield* tx.run(
        `CREATE INDEX \`self_improvement_rollback_location_artifact_timestamp_idx\` ON \`self_improvement_rollback\` (\`location_id\`,\`artifact_id\`,\`timestamp\`);`,
      )
      yield* tx.run(
        `CREATE INDEX \`self_improvement_context_desired_state_location_artifact_idx\` ON \`self_improvement_context_desired_state\` (\`location_id\`,\`artifact_id\`);`,
      )
      yield* tx.run(
        `CREATE INDEX \`self_improvement_context_outbox_pending_retry_id_idx\` ON \`self_improvement_context_outbox\` (\`status\`,\`next_retry_at\`,\`id\`);`,
      )
      yield* tx.run(
        `CREATE UNIQUE INDEX \`self_improvement_context_outbox_pending_slot_idx\` ON \`self_improvement_context_outbox\` (\`artifact_id\`,\`expected_stage\`) WHERE "self_improvement_context_outbox"."status" IN ('pending', 'applying');`,
      )
      yield* tx.run(
        `CREATE INDEX \`self_improvement_context_selection_evidence_location_created_id_idx\` ON \`self_improvement_context_selection_evidence\` (\`location_id\`,\`created_at\`,\`id\`);`,
      )
      yield* tx.run(
        `CREATE UNIQUE INDEX \`self_improvement_evaluation_baseline_tuple_idx\` ON \`self_improvement_evaluation_baseline\` (\`location_id\`,\`workload\`,\`workload_revision\`,\`suite_id\`,\`suite_revision\`);`,
      )
      yield* tx.run(
        `CREATE INDEX \`self_improvement_evaluation_decision_expiry_idx\` ON \`self_improvement_evaluation_decision\` (\`expires_at\`);`,
      )
      yield* tx.run(
        `CREATE UNIQUE INDEX \`self_improvement_evaluation_finding_order_idx\` ON \`self_improvement_evaluation_finding\` (\`run_id\`,\`finding_order\`);`,
      )
      yield* tx.run(
        `CREATE INDEX \`self_improvement_evaluation_finding_expiry_idx\` ON \`self_improvement_evaluation_finding\` (\`expires_at\`);`,
      )
      yield* tx.run(
        `CREATE INDEX \`self_improvement_evaluation_run_location_state_idx\` ON \`self_improvement_evaluation_run\` (\`location_id\`,\`state\`,\`id\`);`,
      )
      yield* tx.run(
        `CREATE UNIQUE INDEX \`self_improvement_evaluation_sample_identity_idx\` ON \`self_improvement_evaluation_sample\` (\`location_id\`,\`run_id\`,\`sample_id_digest\`);`,
      )
      yield* tx.run(
        `CREATE UNIQUE INDEX \`self_improvement_evaluation_sample_task_idx\` ON \`self_improvement_evaluation_sample\` (\`location_id\`,\`run_id\`,\`task_id_digest\`);`,
      )
      yield* tx.run(
        `CREATE INDEX \`self_improvement_evaluation_sample_expiry_idx\` ON \`self_improvement_evaluation_sample\` (\`expires_at\`);`,
      )
      yield* tx.run(
        `CREATE UNIQUE INDEX \`self_improvement_evaluation_suite_revision_tuple_idx\` ON \`self_improvement_evaluation_suite_revision\` (\`location_id\`,\`suite_id\`,\`revision\`);`,
      )
      yield* tx.run(
        `CREATE UNIQUE INDEX \`self_improvement_observation_location_identity_idx\` ON \`self_improvement_observation\` (\`location_id\`,\`identity_digest\`);`,
      )
      yield* tx.run(
        `CREATE INDEX \`self_improvement_observation_location_pattern_occurred_id_idx\` ON \`self_improvement_observation\` (\`location_id\`,\`pattern_digest\`,\`occurred_at\`,\`id\`);`,
      )
      yield* tx.run(
        `CREATE UNIQUE INDEX \`self_improvement_bandit_state_key_idx\` ON \`self_improvement_bandit_state\` (\`location_id\`,\`action_domain\`,\`bucket_digest\`,\`derivation_revision\`,\`allowlist_revision\`,\`arm_id\`);`,
      )
      yield* tx.run(
        `CREATE UNIQUE INDEX \`self_improvement_generation_strategy_arm_location_strategy_idx\` ON \`self_improvement_generation_strategy_arm\` (\`location_id\`,\`strategy_id\`);`,
      )
      yield* tx.run(
        `CREATE UNIQUE INDEX \`self_improvement_model_route_arm_location_route_idx\` ON \`self_improvement_model_route_arm\` (\`location_id\`,\`route_json\`);`,
      )
      yield* tx.run(
        `CREATE INDEX \`self_improvement_pull_event_location_bucket_timestamp_idx\` ON \`self_improvement_pull_event\` (\`location_id\`,\`action_domain\`,\`bucket_digest\`,\`timestamp\`,\`id\`);`,
      )
      yield* tx.run(
        `CREATE UNIQUE INDEX \`self_improvement_reward_event_pull_idx\` ON \`self_improvement_reward_event\` (\`pull_event_id\`);`,
      )
      yield* tx.run(
        `CREATE INDEX \`self_improvement_reward_event_location_timestamp_idx\` ON \`self_improvement_reward_event\` (\`location_id\`,\`timestamp\`,\`id\`);`,
      )
      yield* tx.run(
        `CREATE INDEX \`self_improvement_routing_decision_location_timestamp_idx\` ON \`self_improvement_routing_decision\` (\`location_id\`,\`timestamp\`,\`id\`);`,
      )
    })
  },
} satisfies DatabaseMigration.Migration
