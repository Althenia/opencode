import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { SelfImprovement, SelfImprovementLifecycle } from "@opencode-ai/schema"
import { SelfImprovementArtifactVersionTable } from "./artifact.sql"

export const SelfImprovementStageTransitionTable = sqliteTable(
  "self_improvement_stage_transition",
  {
    id: text().$type<SelfImprovementLifecycle.StageTransitionID>().primaryKey(),
    version_id: text()
      .$type<SelfImprovementLifecycle.ArtifactVersionID>()
      .notNull()
      .references(() => SelfImprovementArtifactVersionTable.id, { onDelete: "restrict" }),
    previous_stage: text().$type<SelfImprovementLifecycle.ArtifactStage>(),
    next_stage: text().$type<SelfImprovementLifecycle.ArtifactStage>().notNull(),
    event: text().$type<SelfImprovementLifecycle.LifecycleEvent>().notNull(),
    reason: text().$type<SelfImprovementLifecycle.LifecycleReason>().notNull(),
    actor_id: text().$type<SelfImprovementLifecycle.PrincipalID>().notNull(),
    timestamp: integer().$type<SelfImprovementLifecycle.TimestampMillis>().notNull(),
    evaluation_run_id: text().$type<SelfImprovementLifecycle.EvaluationRunID>(),
    approval_id: text().$type<SelfImprovementLifecycle.ApprovalID>(),
    rollback_id: text().$type<SelfImprovementLifecycle.RollbackID>(),
    context_outbox_id: text().$type<SelfImprovementLifecycle.ContextOutboxID>(),
    idempotency_record_id: text().$type<SelfImprovementLifecycle.IdempotencyRecordID>(),
    idempotency_digest: text().$type<SelfImprovement.Digest>().notNull(),
  },
  (table) => [
    index("self_improvement_stage_transition_version_timestamp_id_idx").on(table.version_id, table.timestamp, table.id),
  ],
)
