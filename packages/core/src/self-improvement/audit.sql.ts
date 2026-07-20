import { check, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { sql } from "drizzle-orm"
import { SelfImprovementLifecycle } from "@opencode-ai/schema"

export const SelfImprovementAuditEntryTable = sqliteTable(
  "self_improvement_audit_entry",
  {
    id: text().$type<SelfImprovementLifecycle.AuditEntryID>().notNull().primaryKey(),
    location_id: text().$type<SelfImprovementLifecycle.LocationID>().notNull(),
    event_type: text().notNull(),
    actor_id: text().$type<SelfImprovementLifecycle.PrincipalID>().notNull(),
    payload_json: text().notNull(),
    timestamp: integer().$type<SelfImprovementLifecycle.TimestampMillis>().notNull(),
    retention_tag: text().notNull(),
    retention_created_at: integer().$type<SelfImprovementLifecycle.TimestampMillis>().notNull(),
    retention_expires_at: integer().$type<SelfImprovementLifecycle.TimestampMillis>(),
  },
  (table) => [
    index("self_improvement_audit_entry_location_timestamp_id_idx").on(table.location_id, table.timestamp, table.id),
    index("self_improvement_audit_entry_location_event_type_timestamp_id_idx").on(
      table.location_id,
      table.event_type,
      table.timestamp,
      table.id,
    ),
    index("self_improvement_audit_entry_location_expiry_id_idx").on(
      table.location_id,
      table.retention_expires_at,
      table.id,
    ),
    check(
      "self_improvement_audit_entry_retention",
      sql`(${table.retention_tag} = 'observation-30d' AND ${table.retention_expires_at} = ${table.retention_created_at} + 2592000000) OR (${table.retention_tag} = 'evidence-180d' AND ${table.retention_expires_at} = ${table.retention_created_at} + 15552000000) OR (${table.retention_tag} = 'governed-metadata' AND ${table.retention_expires_at} IS NULL)`,
    ),
  ],
)
