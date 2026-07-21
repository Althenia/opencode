import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"
import { SelfImprovement, SelfImprovementLearning, SelfImprovementLifecycle } from "@opencode-ai/schema"

export const SelfImprovementObservationTable = sqliteTable(
  "self_improvement_observation",
  {
    id: text().$type<SelfImprovementLifecycle.ObservationID>().notNull().primaryKey(),
    location_id: text().$type<SelfImprovementLifecycle.LocationID>().notNull(),
    pattern_digest: text().$type<SelfImprovement.Digest>().notNull(),
    identity_digest: text().$type<SelfImprovement.Digest>().notNull(),
    workload: text().notNull(),
    workload_revision: integer().$type<SelfImprovementLifecycle.Revision>().notNull(),
    error_class: text().notNull(),
    ordered_tool_symbol_digest: text().$type<SelfImprovement.Digest>().notNull(),
    outcome_class: text().$type<SelfImprovementLearning.ObservationOutcomeClass>().notNull(),
    task_id_digest: text().$type<SelfImprovement.Digest>().notNull(),
    producer_id: text().$type<SelfImprovementLifecycle.PrincipalID>().notNull(),
    occurred_at: integer().$type<SelfImprovementLifecycle.TimestampMillis>().notNull(),
    expires_at: integer().$type<SelfImprovementLifecycle.TimestampMillis>().notNull(),
  },
  (table) => [
    uniqueIndex("self_improvement_observation_location_identity_idx").on(table.location_id, table.identity_digest),
    index("self_improvement_observation_location_pattern_occurred_id_idx").on(
      table.location_id,
      table.pattern_digest,
      table.occurred_at,
      table.id,
    ),
  ],
)
