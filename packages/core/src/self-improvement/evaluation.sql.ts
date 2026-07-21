import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"
import { SelfImprovement, SelfImprovementLifecycle } from "@opencode-ai/schema"

export const SelfImprovementEvaluationSuiteRevisionTable = sqliteTable(
  "self_improvement_evaluation_suite_revision",
  {
    location_id: text().$type<SelfImprovementLifecycle.LocationID>().notNull(),
    suite_id: text().$type<SelfImprovementLifecycle.SuiteID>().notNull(),
    revision: integer().$type<SelfImprovementLifecycle.Revision>().notNull(),
    suite_json: text().notNull(),
  },
  (table) => [
    uniqueIndex("self_improvement_evaluation_suite_revision_tuple_idx").on(
      table.location_id,
      table.suite_id,
      table.revision,
    ),
  ],
)

export const SelfImprovementEvaluationBaselineTable = sqliteTable(
  "self_improvement_evaluation_baseline",
  {
    id: text().$type<SelfImprovementLifecycle.BaselineID>().notNull().primaryKey(),
    location_id: text().$type<SelfImprovementLifecycle.LocationID>().notNull(),
    workload: text().notNull(),
    workload_revision: integer().$type<SelfImprovementLifecycle.Revision>().notNull(),
    suite_id: text().$type<SelfImprovementLifecycle.SuiteID>().notNull(),
    suite_revision: integer().$type<SelfImprovementLifecycle.Revision>().notNull(),
    baseline_json: text().notNull(),
  },
  (table) => [
    uniqueIndex("self_improvement_evaluation_baseline_tuple_idx").on(
      table.location_id,
      table.workload,
      table.workload_revision,
      table.suite_id,
      table.suite_revision,
    ),
  ],
)

export const SelfImprovementEvaluationRunTable = sqliteTable(
  "self_improvement_evaluation_run",
  {
    id: text().$type<SelfImprovementLifecycle.EvaluationRunID>().notNull().primaryKey(),
    location_id: text().$type<SelfImprovementLifecycle.LocationID>().notNull(),
    request_digest: text().$type<SelfImprovement.Digest>().notNull(),
    state: text().notNull(),
    cutoff_sample_set_digest: text().$type<SelfImprovement.Digest>(),
    decided_at: integer().$type<SelfImprovementLifecycle.TimestampMillis>(),
    run_json: text().notNull(),
  },
  (table) => [index("self_improvement_evaluation_run_location_state_idx").on(table.location_id, table.state, table.id)],
)

export const SelfImprovementEvaluationSampleTable = sqliteTable(
  "self_improvement_evaluation_sample",
  {
    id: text().$type<SelfImprovementLifecycle.MetricSampleID>().notNull().primaryKey(),
    location_id: text().$type<SelfImprovementLifecycle.LocationID>().notNull(),
    run_id: text().$type<SelfImprovementLifecycle.EvaluationRunID>().notNull(),
    sample_id_digest: text().$type<SelfImprovement.Digest>().notNull(),
    task_id_digest: text().$type<SelfImprovement.Digest>().notNull(),
    request_digest: text().$type<SelfImprovement.Digest>().notNull(),
    sample_json: text().notNull(),
    expires_at: integer().$type<SelfImprovementLifecycle.TimestampMillis>().notNull(),
  },
  (table) => [
    uniqueIndex("self_improvement_evaluation_sample_identity_idx").on(
      table.location_id,
      table.run_id,
      table.sample_id_digest,
    ),
    uniqueIndex("self_improvement_evaluation_sample_task_idx").on(
      table.location_id,
      table.run_id,
      table.task_id_digest,
    ),
    index("self_improvement_evaluation_sample_expiry_idx").on(table.expires_at),
  ],
)

export const SelfImprovementEvaluationDecisionTable = sqliteTable(
  "self_improvement_evaluation_decision",
  {
    run_id: text().$type<SelfImprovementLifecycle.EvaluationRunID>().notNull().primaryKey(),
    location_id: text().$type<SelfImprovementLifecycle.LocationID>().notNull(),
    decision_json: text().notNull(),
    expires_at: integer().$type<SelfImprovementLifecycle.TimestampMillis>().notNull(),
  },
  (table) => [index("self_improvement_evaluation_decision_expiry_idx").on(table.expires_at)],
)

export const SelfImprovementEvaluationFindingTable = sqliteTable(
  "self_improvement_evaluation_finding",
  {
    id: text().$type<SelfImprovementLifecycle.GateFindingID>().notNull().primaryKey(),
    location_id: text().$type<SelfImprovementLifecycle.LocationID>().notNull(),
    run_id: text().$type<SelfImprovementLifecycle.EvaluationRunID>().notNull(),
    finding_order: integer().notNull(),
    finding_json: text().notNull(),
    expires_at: integer().$type<SelfImprovementLifecycle.TimestampMillis>().notNull(),
  },
  (table) => [
    uniqueIndex("self_improvement_evaluation_finding_order_idx").on(table.run_id, table.finding_order),
    index("self_improvement_evaluation_finding_expiry_idx").on(table.expires_at),
  ],
)
