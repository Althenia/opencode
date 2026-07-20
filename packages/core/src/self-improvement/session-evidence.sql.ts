import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"
import { SelfImprovement, SelfImprovementEvaluation, SelfImprovementLearning, SelfImprovementLifecycle } from "@opencode-ai/schema"

export const SelfImprovementSessionEvidenceTable = sqliteTable(
  "self_improvement_session_evidence",
  {
    id: text().notNull().primaryKey(),
    location_id: text().$type<SelfImprovementLifecycle.LocationID>().notNull(),
    task_id_digest: text().$type<SelfImprovement.Digest>().notNull(),
    sample_id_digest: text().$type<SelfImprovement.Digest>().notNull(),
    request_digest: text().$type<SelfImprovement.Digest>().notNull(),
    workload: text().$type<SelfImprovementEvaluation.Workload>().notNull(),
    workload_revision: integer().$type<SelfImprovementLifecycle.Revision>().notNull(),
    producer_id: text().$type<SelfImprovementLifecycle.PrincipalID>().notNull(),
    outcome_class: text().$type<SelfImprovementLearning.ObservationOutcomeClass>().notNull(),
    outcome: text().$type<SelfImprovementEvaluation.TaskOutcome>().notNull(),
    metrics_json: text().notNull(),
    started_at: integer().$type<SelfImprovementLifecycle.TimestampMillis>().notNull(),
    terminal_at: integer().$type<SelfImprovementLifecycle.TimestampMillis>().notNull(),
    created_at: integer().$type<SelfImprovementLifecycle.TimestampMillis>().notNull(),
  },
  (table) => [
    uniqueIndex("self_improvement_session_evidence_location_task_idx").on(table.location_id, table.task_id_digest),
    index("self_improvement_session_evidence_location_workload_terminal_idx").on(
      table.location_id,
      table.workload,
      table.workload_revision,
      table.terminal_at,
    ),
  ],
)
