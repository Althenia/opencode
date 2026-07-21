import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"
import { sql } from "drizzle-orm"
import { SelfImprovement, SelfImprovementLifecycle } from "@opencode-ai/schema"
import { SelfImprovementArtifactTable, SelfImprovementArtifactVersionTable } from "./artifact.sql"

export const SelfImprovementApprovalRequestTable = sqliteTable(
  "self_improvement_approval_request",
  {
    id: text().$type<SelfImprovementLifecycle.ApprovalRequestID>().notNull().primaryKey(),
    location_id: text().$type<SelfImprovementLifecycle.LocationID>().notNull(),
    version_id: text()
      .$type<SelfImprovementLifecycle.ArtifactVersionID>()
      .notNull()
      .references(() => SelfImprovementArtifactVersionTable.id, { onDelete: "restrict" }),
    version_digest: text().$type<SelfImprovement.Digest>().notNull(),
    suite_id: text().$type<SelfImprovementLifecycle.SuiteID>().notNull(),
    suite_revision: integer().$type<SelfImprovementLifecycle.Revision>().notNull(),
    evaluation_run_id: text().$type<SelfImprovementLifecycle.EvaluationRunID>().notNull(),
    shadow_evidence_digest: text().$type<SelfImprovement.Digest>().notNull(),
    creator_id: text().$type<SelfImprovementLifecycle.PrincipalID>().notNull(),
    requested_at: integer().$type<SelfImprovementLifecycle.TimestampMillis>().notNull(),
    shadow_evidence_expires_at: integer().$type<SelfImprovementLifecycle.TimestampMillis>().notNull(),
  },
  (table) => [
    index("self_improvement_approval_request_location_version_idx").on(table.location_id, table.version_id),
    check(
      "self_improvement_approval_request_evidence_expiry",
      sql`${table.shadow_evidence_expires_at} = ${table.requested_at} + 15552000000`,
    ),
  ],
)

export const SelfImprovementApprovalTable = sqliteTable(
  "self_improvement_approval",
  {
    id: text().$type<SelfImprovementLifecycle.ApprovalID>().notNull().primaryKey(),
    request_id: text()
      .$type<SelfImprovementLifecycle.ApprovalRequestID>()
      .notNull()
      .references(() => SelfImprovementApprovalRequestTable.id, { onDelete: "restrict" }),
    location_id: text().$type<SelfImprovementLifecycle.LocationID>().notNull(),
    version_id: text().$type<SelfImprovementLifecycle.ArtifactVersionID>().notNull(),
    version_digest: text().$type<SelfImprovement.Digest>().notNull(),
    suite_id: text().$type<SelfImprovementLifecycle.SuiteID>().notNull(),
    suite_revision: integer().$type<SelfImprovementLifecycle.Revision>().notNull(),
    evaluation_run_id: text().$type<SelfImprovementLifecycle.EvaluationRunID>().notNull(),
    shadow_evidence_digest: text().$type<SelfImprovement.Digest>().notNull(),
    decision: text().$type<SelfImprovementLifecycle.ApprovalDecision["_tag"]>().notNull(),
    approver_id: text().$type<SelfImprovementLifecycle.PrincipalID>().notNull(),
    decided_at: integer().$type<SelfImprovementLifecycle.TimestampMillis>().notNull(),
    expires_at: integer().$type<SelfImprovementLifecycle.TimestampMillis>(),
    shadow_evidence_expires_at: integer().$type<SelfImprovementLifecycle.TimestampMillis>().notNull(),
    consumed_at: integer().$type<SelfImprovementLifecycle.TimestampMillis>(),
  },
  (table) => [
    uniqueIndex("self_improvement_approval_request_idx").on(table.request_id),
    index("self_improvement_approval_location_version_idx").on(table.location_id, table.version_id),
    check(
      "self_improvement_approval_decision_expiry",
      sql`(${table.decision} = 'rejected' AND ${table.expires_at} IS NULL AND ${table.consumed_at} IS NULL) OR (${table.decision} = 'approved' AND ${table.expires_at} = ${table.decided_at} + 86400000)`,
    ),
  ],
)

export const SelfImprovementRollbackTable = sqliteTable(
  "self_improvement_rollback",
  {
    id: text().$type<SelfImprovementLifecycle.RollbackID>().notNull().primaryKey(),
    location_id: text().$type<SelfImprovementLifecycle.LocationID>().notNull(),
    artifact_id: text()
      .$type<SelfImprovementLifecycle.ArtifactID>()
      .notNull()
      .references(() => SelfImprovementArtifactTable.id, { onDelete: "restrict" }),
    candidate_version_id: text()
      .$type<SelfImprovementLifecycle.ArtifactVersionID>()
      .notNull()
      .references(() => SelfImprovementArtifactVersionTable.id, { onDelete: "restrict" }),
    retained_active_version_id: text()
      .$type<SelfImprovementLifecycle.ArtifactVersionID>()
      .notNull()
      .references(() => SelfImprovementArtifactVersionTable.id, { onDelete: "restrict" }),
    canary_run_id: text().$type<SelfImprovementLifecycle.EvaluationRunID>().notNull(),
    reason: text().$type<SelfImprovementLifecycle.Rollback["reason"]>().notNull(),
    reward_event_id: text().$type<SelfImprovementLifecycle.RewardEventID>().notNull(),
    timestamp: integer().$type<SelfImprovementLifecycle.TimestampMillis>().notNull(),
  },
  (table) => [
    uniqueIndex("self_improvement_rollback_canary_run_idx").on(table.canary_run_id),
    index("self_improvement_rollback_location_artifact_timestamp_idx").on(
      table.location_id,
      table.artifact_id,
      table.timestamp,
    ),
    check("self_improvement_rollback_canary_reason", sql`${table.reason} = 'canary-regression'`),
  ],
)
