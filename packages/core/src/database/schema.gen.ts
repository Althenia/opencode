import { Effect } from "effect"
import type { DatabaseMigration } from "./migration"

export default {
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`workspace\` (
          \`id\` text PRIMARY KEY,
          \`type\` text NOT NULL,
          \`name\` text DEFAULT '' NOT NULL,
          \`branch\` text,
          \`directory\` text,
          \`extra\` text,
          \`project_id\` text NOT NULL,
          \`time_used\` integer NOT NULL,
          CONSTRAINT \`fk_workspace_project_id_project_id_fk\` FOREIGN KEY (\`project_id\`) REFERENCES \`project\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`data_migration\` (
          \`name\` text PRIMARY KEY,
          \`time_completed\` integer NOT NULL
        );
      `)
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
          \`retention_expires_at\` integer,
          CONSTRAINT "self_improvement_audit_entry_retention" CHECK(("retention_tag" = 'observation-30d' AND "retention_expires_at" = "retention_created_at" + 2592000000) OR ("retention_tag" = 'evidence-180d' AND "retention_expires_at" = "retention_created_at" + 15552000000) OR ("retention_tag" = 'governed-metadata' AND "retention_expires_at" IS NULL))
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
      yield* tx.run(`
        CREATE TABLE \`account_state\` (
          \`id\` integer PRIMARY KEY,
          \`active_account_id\` text,
          \`active_org_id\` text,
          CONSTRAINT \`fk_account_state_active_account_id_account_id_fk\` FOREIGN KEY (\`active_account_id\`) REFERENCES \`account\`(\`id\`) ON DELETE SET NULL
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`account\` (
          \`id\` text PRIMARY KEY,
          \`email\` text NOT NULL,
          \`url\` text NOT NULL,
          \`access_token\` text NOT NULL,
          \`refresh_token\` text NOT NULL,
          \`token_expiry\` integer,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`control_account\` (
          \`email\` text NOT NULL,
          \`url\` text NOT NULL,
          \`access_token\` text NOT NULL,
          \`refresh_token\` text NOT NULL,
          \`token_expiry\` integer,
          \`active\` integer NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          CONSTRAINT \`control_account_pk\` PRIMARY KEY(\`email\`, \`url\`)
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`credential\` (
          \`id\` text PRIMARY KEY,
          \`integration_id\` text,
          \`label\` text NOT NULL,
          \`value\` text NOT NULL,
          \`connector_id\` text,
          \`method_id\` text,
          \`active\` integer,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`event_sequence\` (
          \`aggregate_id\` text PRIMARY KEY,
          \`seq\` integer NOT NULL,
          \`owner_id\` text
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`event\` (
          \`id\` text PRIMARY KEY,
          \`aggregate_id\` text NOT NULL,
          \`seq\` integer NOT NULL,
          \`type\` text NOT NULL,
          \`data\` text NOT NULL,
          CONSTRAINT \`fk_event_aggregate_id_event_sequence_aggregate_id_fk\` FOREIGN KEY (\`aggregate_id\`) REFERENCES \`event_sequence\`(\`aggregate_id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`permission\` (
          \`id\` text PRIMARY KEY,
          \`project_id\` text NOT NULL,
          \`action\` text NOT NULL,
          \`resource\` text NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          CONSTRAINT \`fk_permission_project_id_project_id_fk\` FOREIGN KEY (\`project_id\`) REFERENCES \`project\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`project_directory\` (
          \`project_id\` text NOT NULL,
          \`directory\` text NOT NULL,
          \`type\` text,
          \`strategy\` text,
          \`time_created\` integer NOT NULL,
          CONSTRAINT \`project_directory_pk\` PRIMARY KEY(\`project_id\`, \`directory\`),
          CONSTRAINT \`fk_project_directory_project_id_project_id_fk\` FOREIGN KEY (\`project_id\`) REFERENCES \`project\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`project\` (
          \`id\` text PRIMARY KEY,
          \`worktree\` text NOT NULL,
          \`vcs\` text,
          \`name\` text,
          \`icon_url\` text,
          \`icon_url_override\` text,
          \`icon_color\` text,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          \`time_initialized\` integer,
          \`sandboxes\` text NOT NULL,
          \`commands\` text
        );
      `)
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
      yield* tx.run(`
        CREATE TABLE \`message\` (
          \`id\` text PRIMARY KEY,
          \`session_id\` text NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          \`data\` text NOT NULL,
          CONSTRAINT \`fk_message_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`part\` (
          \`id\` text PRIMARY KEY,
          \`message_id\` text NOT NULL,
          \`session_id\` text NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          \`data\` text NOT NULL,
          CONSTRAINT \`fk_part_message_id_message_id_fk\` FOREIGN KEY (\`message_id\`) REFERENCES \`message\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`session_context_epoch\` (
          \`session_id\` text PRIMARY KEY,
          \`baseline\` text NOT NULL,
          \`snapshot\` text NOT NULL,
          \`baseline_seq\` integer NOT NULL,
          CONSTRAINT \`fk_session_context_epoch_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`session_input\` (
          \`id\` text PRIMARY KEY,
          \`session_id\` text NOT NULL,
          \`prompt\` text NOT NULL,
          \`delivery\` text NOT NULL,
          \`admitted_seq\` integer NOT NULL,
          \`promoted_seq\` integer,
          \`time_created\` integer NOT NULL,
          CONSTRAINT \`fk_session_input_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`session_message\` (
          \`id\` text PRIMARY KEY,
          \`session_id\` text NOT NULL,
          \`type\` text NOT NULL,
          \`seq\` integer NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          \`data\` text NOT NULL,
          CONSTRAINT \`fk_session_message_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`session\` (
          \`id\` text PRIMARY KEY,
          \`project_id\` text NOT NULL,
          \`workspace_id\` text,
          \`parent_id\` text,
          \`slug\` text NOT NULL,
          \`directory\` text NOT NULL,
          \`path\` text,
          \`title\` text NOT NULL,
          \`version\` text NOT NULL,
          \`share_url\` text,
          \`summary_additions\` integer,
          \`summary_deletions\` integer,
          \`summary_files\` integer,
          \`summary_diffs\` text,
          \`metadata\` text,
          \`cost\` real DEFAULT 0 NOT NULL,
          \`tokens_input\` integer DEFAULT 0 NOT NULL,
          \`tokens_output\` integer DEFAULT 0 NOT NULL,
          \`tokens_reasoning\` integer DEFAULT 0 NOT NULL,
          \`tokens_cache_read\` integer DEFAULT 0 NOT NULL,
          \`tokens_cache_write\` integer DEFAULT 0 NOT NULL,
          \`revert\` text,
          \`permission\` text,
          \`agent\` text,
          \`model\` text,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          \`time_compacting\` integer,
          \`time_archived\` integer,
          CONSTRAINT \`fk_session_project_id_project_id_fk\` FOREIGN KEY (\`project_id\`) REFERENCES \`project\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`todo\` (
          \`session_id\` text NOT NULL,
          \`content\` text NOT NULL,
          \`status\` text NOT NULL,
          \`priority\` text NOT NULL,
          \`position\` integer NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          CONSTRAINT \`todo_pk\` PRIMARY KEY(\`session_id\`, \`position\`),
          CONSTRAINT \`fk_todo_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`session_share\` (
          \`session_id\` text PRIMARY KEY,
          \`id\` text NOT NULL,
          \`secret\` text NOT NULL,
          \`url\` text NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          CONSTRAINT \`fk_session_share_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
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
        `CREATE INDEX \`self_improvement_audit_entry_location_expiry_id_idx\` ON \`self_improvement_audit_entry\` (\`location_id\`,\`retention_expires_at\`,\`id\`);`,
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
        `CREATE UNIQUE INDEX \`self_improvement_generation_lease_location_pattern_attempt_idx\` ON \`self_improvement_generation_lease\` (\`location_id\`,\`pattern_digest\`,\`attempt_number\`);`,
      )
      yield* tx.run(
        `CREATE UNIQUE INDEX \`self_improvement_generation_lease_pending_idx\` ON \`self_improvement_generation_lease\` (\`location_id\`,\`pattern_digest\`) WHERE "self_improvement_generation_lease"."outcome" = 'pending';`,
      )
      yield* tx.run(
        `CREATE INDEX \`self_improvement_generation_lease_location_pattern_acquired_idx\` ON \`self_improvement_generation_lease\` (\`location_id\`,\`pattern_digest\`,\`acquired_at\`);`,
      )
      yield* tx.run(
        `CREATE UNIQUE INDEX \`self_improvement_idempotency_identity_idx\` ON \`self_improvement_idempotency\` (\`principal_id\`,\`location_id\`,\`operation\`,\`key\`);`,
      )
      yield* tx.run(
        `CREATE INDEX \`self_improvement_idempotency_location_expires_id_idx\` ON \`self_improvement_idempotency\` (\`location_id\`,\`expires_at\`,\`id\`);`,
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
      yield* tx.run(
        `CREATE UNIQUE INDEX \`self_improvement_artifact_slot_version_id_idx\` ON \`self_improvement_artifact_slot\` (\`version_id\`);`,
      )
      yield* tx.run(
        `CREATE INDEX \`self_improvement_artifact_slot_location_artifact_slot_idx\` ON \`self_improvement_artifact_slot\` (\`location_id\`,\`artifact_id\`,\`slot\`);`,
      )
      yield* tx.run(
        `CREATE UNIQUE INDEX \`self_improvement_session_evidence_location_task_idx\` ON \`self_improvement_session_evidence\` (\`location_id\`,\`task_id_digest\`);`,
      )
      yield* tx.run(
        `CREATE INDEX \`self_improvement_session_evidence_location_workload_terminal_idx\` ON \`self_improvement_session_evidence\` (\`location_id\`,\`workload\`,\`workload_revision\`,\`terminal_at\`);`,
      )
      yield* tx.run(
        `CREATE INDEX \`self_improvement_stage_transition_version_timestamp_id_idx\` ON \`self_improvement_stage_transition\` (\`version_id\`,\`timestamp\`,\`id\`);`,
      )
      yield* tx.run(`CREATE UNIQUE INDEX \`event_aggregate_seq_idx\` ON \`event\` (\`aggregate_id\`,\`seq\`);`)
      yield* tx.run(`CREATE INDEX \`event_aggregate_type_seq_idx\` ON \`event\` (\`aggregate_id\`,\`type\`,\`seq\`);`)
      yield* tx.run(
        `CREATE UNIQUE INDEX \`permission_project_action_resource_idx\` ON \`permission\` (\`project_id\`,\`action\`,\`resource\`);`,
      )
      yield* tx.run(`CREATE INDEX \`session_goal_active_idx\` ON \`session_goal\` (\`active\`);`)
      yield* tx.run(
        `CREATE INDEX \`message_session_time_created_id_idx\` ON \`message\` (\`session_id\`,\`time_created\`,\`id\`);`,
      )
      yield* tx.run(`CREATE INDEX \`part_message_id_id_idx\` ON \`part\` (\`message_id\`,\`id\`);`)
      yield* tx.run(`CREATE INDEX \`part_session_idx\` ON \`part\` (\`session_id\`);`)
      yield* tx.run(
        `CREATE INDEX \`session_input_session_pending_delivery_seq_idx\` ON \`session_input\` (\`session_id\`,\`promoted_seq\`,\`delivery\`,\`admitted_seq\`);`,
      )
      yield* tx.run(
        `CREATE UNIQUE INDEX \`session_input_session_admitted_seq_idx\` ON \`session_input\` (\`session_id\`,\`admitted_seq\`);`,
      )
      yield* tx.run(
        `CREATE UNIQUE INDEX \`session_input_session_promoted_seq_idx\` ON \`session_input\` (\`session_id\`,\`promoted_seq\`);`,
      )
      yield* tx.run(
        `CREATE UNIQUE INDEX \`session_message_session_seq_idx\` ON \`session_message\` (\`session_id\`,\`seq\`);`,
      )
      yield* tx.run(
        `CREATE INDEX \`session_message_session_type_seq_idx\` ON \`session_message\` (\`session_id\`,\`type\`,\`seq\`);`,
      )
      yield* tx.run(
        `CREATE INDEX \`session_message_session_time_created_id_idx\` ON \`session_message\` (\`session_id\`,\`time_created\`,\`id\`);`,
      )
      yield* tx.run(`CREATE INDEX \`session_message_time_created_idx\` ON \`session_message\` (\`time_created\`);`)
      yield* tx.run(`CREATE INDEX \`session_project_idx\` ON \`session\` (\`project_id\`);`)
      yield* tx.run(`CREATE INDEX \`session_workspace_idx\` ON \`session\` (\`workspace_id\`);`)
      yield* tx.run(`CREATE INDEX \`session_parent_idx\` ON \`session\` (\`parent_id\`);`)
      yield* tx.run(`CREATE INDEX \`todo_session_idx\` ON \`todo\` (\`session_id\`);`)
    })
  },
} satisfies Omit<DatabaseMigration.Migration, "id">
