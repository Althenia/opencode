import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"
import { SelfImprovement, SelfImprovementLearning, SelfImprovementLifecycle } from "@opencode-ai/schema"

export const SelfImprovementIdempotencyTable = sqliteTable(
  "self_improvement_idempotency",
  {
    id: text().$type<SelfImprovementLifecycle.IdempotencyRecordID>().notNull().primaryKey(),
    principal_id: text().$type<SelfImprovementLifecycle.PrincipalID>().notNull(),
    location_id: text().$type<SelfImprovementLifecycle.LocationID>().notNull(),
    operation: text().$type<SelfImprovementLifecycle.Operation>().notNull(),
    key: text().$type<SelfImprovementLearning.IdempotencyKey>().notNull(),
    request_digest: text().$type<SelfImprovement.Digest>().notNull(),
    status: integer().notNull(),
    body_digest: text().$type<SelfImprovement.Digest>().notNull(),
    body_json: text().notNull(),
    created_at: integer().$type<SelfImprovementLifecycle.TimestampMillis>().notNull(),
    expires_at: integer().$type<SelfImprovementLifecycle.TimestampMillis>().notNull(),
  },
  (table) => [
    uniqueIndex("self_improvement_idempotency_identity_idx").on(
      table.principal_id,
      table.location_id,
      table.operation,
      table.key,
    ),
    index("self_improvement_idempotency_location_expires_id_idx").on(table.location_id, table.expires_at, table.id),
  ],
)
