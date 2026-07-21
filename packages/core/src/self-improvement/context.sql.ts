import { check, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"
import { sql } from "drizzle-orm"
import { SelfImprovement, SelfImprovementLearning, SelfImprovementLifecycle } from "@opencode-ai/schema"
import { SelfImprovementArtifactTable, SelfImprovementArtifactVersionTable } from "./artifact.sql"

export const SelfImprovementContextDesiredStateTable = sqliteTable(
  "self_improvement_context_desired_state",
  {
    location_id: text().$type<SelfImprovementLifecycle.LocationID>().notNull(),
    artifact_id: text()
      .$type<SelfImprovementLifecycle.ArtifactID>()
      .notNull()
      .references(() => SelfImprovementArtifactTable.id, { onDelete: "restrict" }),
    rollout_slot: text().$type<"shadow" | "canary" | "active">().notNull(),
    desired_state: text().$type<"present" | "absent">().notNull(),
    version_id: text()
      .$type<SelfImprovementLifecycle.ArtifactVersionID>()
      .references(() => SelfImprovementArtifactVersionTable.id, {
        onDelete: "restrict",
      }),
    version_digest: text().$type<SelfImprovement.Digest>(),
    desired_revision: integer().$type<SelfImprovementLifecycle.Revision>().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.location_id, table.artifact_id, table.rollout_slot] }),
    index("self_improvement_context_desired_state_location_artifact_idx").on(table.location_id, table.artifact_id),
    check(
      "self_improvement_context_desired_state_target",
      sql`(${table.desired_state} = 'absent' AND ${table.version_id} IS NULL AND ${table.version_digest} IS NULL) OR (${table.desired_state} = 'present' AND ${table.version_id} IS NOT NULL AND ${table.version_digest} IS NOT NULL)`,
    ),
  ],
)

export const SelfImprovementContextOutboxTable = sqliteTable(
  "self_improvement_context_outbox",
  {
    id: text().$type<SelfImprovementLifecycle.ContextOutboxID>().notNull().primaryKey(),
    location_id: text().$type<SelfImprovementLifecycle.LocationID>().notNull(),
    artifact_id: text()
      .$type<SelfImprovementLifecycle.ArtifactID>()
      .notNull()
      .references(() => SelfImprovementArtifactTable.id, { onDelete: "restrict" }),
    expected_artifact_revision: integer().$type<SelfImprovementLifecycle.Revision>().notNull(),
    expected_stage: text().$type<SelfImprovementLifecycle.ArtifactStage>().notNull(),
    desired_state_revision: integer().$type<SelfImprovementLifecycle.Revision>().notNull(),
    intent_json: text().notNull(),
    status: text().$type<SelfImprovementLearning.ContextOutboxStatus>().notNull(),
    attempts: integer().notNull(),
    next_retry_at: integer().$type<SelfImprovementLifecycle.TimestampMillis>().notNull(),
    cas_result_digest: text().$type<SelfImprovement.Digest>(),
    created_at: integer().$type<SelfImprovementLifecycle.TimestampMillis>().notNull(),
  },
  (table) => [
    index("self_improvement_context_outbox_pending_retry_id_idx").on(table.status, table.next_retry_at, table.id),
    uniqueIndex("self_improvement_context_outbox_pending_slot_idx")
      .on(table.artifact_id, table.expected_stage)
      .where(sql`${table.status} IN ('pending', 'applying')`),
    check("self_improvement_context_outbox_attempts", sql`${table.attempts} >= 0`),
  ],
)

export const SelfImprovementContextSelectionEvidenceTable = sqliteTable(
  "self_improvement_context_selection_evidence",
  {
    id: text().$type<SelfImprovementLifecycle.ContextSelectionEvidenceID>().notNull().primaryKey(),
    artifact_id: text()
      .$type<SelfImprovementLifecycle.ArtifactID>()
      .notNull()
      .references(() => SelfImprovementArtifactTable.id, { onDelete: "restrict" }),
    version_id: text()
      .$type<SelfImprovementLifecycle.ArtifactVersionID>()
      .notNull()
      .references(() => SelfImprovementArtifactVersionTable.id, { onDelete: "restrict" }),
    version_digest: text().$type<SelfImprovement.Digest>().notNull(),
    location_id: text().$type<SelfImprovementLifecycle.LocationID>().notNull(),
    stage: text().$type<SelfImprovementLifecycle.ArtifactStage>().notNull(),
    context_epoch: integer().$type<SelfImprovementLifecycle.Revision>().notNull(),
    session_digest: text().$type<SelfImprovement.Digest>().notNull(),
    cohort_result: text().$type<SelfImprovementLearning.ContextCohortResult>().notNull(),
    outbox_id: text()
      .$type<SelfImprovementLifecycle.ContextOutboxID>()
      .notNull()
      .references(() => SelfImprovementContextOutboxTable.id, { onDelete: "restrict" }),
    created_at: integer().$type<SelfImprovementLifecycle.TimestampMillis>().notNull(),
    expires_at: integer().$type<SelfImprovementLifecycle.TimestampMillis>().notNull(),
  },
  (table) => [
    index("self_improvement_context_selection_evidence_location_created_id_idx").on(
      table.location_id,
      table.created_at,
      table.id,
    ),
    check(
      "self_improvement_context_selection_evidence_expiry",
      sql`${table.expires_at} = ${table.created_at} + 180 * 86400000`,
    ),
  ],
)
