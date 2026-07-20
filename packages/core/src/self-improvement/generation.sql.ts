import { sql } from "drizzle-orm"
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"
import { SelfImprovement, SelfImprovementLearning, SelfImprovementLifecycle } from "@opencode-ai/schema"

export const SelfImprovementGenerationLeaseTable = sqliteTable(
  "self_improvement_generation_lease",
  {
    id: text().$type<SelfImprovementLifecycle.GenerationLeaseID>().notNull().primaryKey(),
    location_id: text().$type<SelfImprovementLifecycle.LocationID>().notNull(),
    pattern_digest: text().$type<SelfImprovement.Digest>().notNull(),
    owner_id: text().$type<SelfImprovementLifecycle.PrincipalID>().notNull(),
    lease_token_digest: text().$type<SelfImprovement.Digest>().notNull(),
    attempt_number: integer().notNull(),
    acquired_at: integer().$type<SelfImprovementLifecycle.TimestampMillis>().notNull(),
    expires_at: integer().$type<SelfImprovementLifecycle.TimestampMillis>().notNull(),
    completed_at: integer().$type<SelfImprovementLifecycle.TimestampMillis>(),
    model_request_digest: text().$type<SelfImprovement.Digest>().notNull(),
    model_output_digest: text().$type<SelfImprovement.Digest>(),
    model_output_bytes: text({ mode: "json" }).$type<ReadonlyArray<number>>(),
    outcome: text().$type<SelfImprovementLearning.GenerationOutcome>().notNull(),
    pull_event_id: text().$type<SelfImprovementLifecycle.PullEventID>(),
    originating_task_id_digest: text().$type<SelfImprovement.Digest>().notNull(),
  },
  (table) => [
    uniqueIndex("self_improvement_generation_lease_location_pattern_attempt_idx").on(
      table.location_id,
      table.pattern_digest,
      table.attempt_number,
    ),
    uniqueIndex("self_improvement_generation_lease_pending_idx")
      .on(table.location_id, table.pattern_digest)
      .where(sql`${table.outcome} = 'pending'`),
    index("self_improvement_generation_lease_location_pattern_acquired_idx").on(
      table.location_id,
      table.pattern_digest,
      table.acquired_at,
    ),
  ],
)
