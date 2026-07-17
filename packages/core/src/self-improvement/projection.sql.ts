import { check, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"
import { sql } from "drizzle-orm"
import { SelfImprovementLifecycle } from "@opencode-ai/schema"
import { SelfImprovementArtifactTable, SelfImprovementArtifactVersionTable } from "./artifact.sql"

export const SelfImprovementArtifactSlotTable = sqliteTable(
  "self_improvement_artifact_slot",
  {
    location_id: text().$type<SelfImprovementLifecycle.LocationID>().notNull(),
    artifact_id: text()
      .$type<SelfImprovementLifecycle.ArtifactID>()
      .notNull()
      .references(() => SelfImprovementArtifactTable.id, { onDelete: "restrict" }),
    slot: text().$type<"active" | "shadow" | "canary">().notNull(),
    version_id: text()
      .$type<SelfImprovementLifecycle.ArtifactVersionID>()
      .notNull()
      .references(() => SelfImprovementArtifactVersionTable.id, { onDelete: "restrict" }),
    artifact_revision: integer().$type<SelfImprovementLifecycle.Revision>().notNull(),
    updated_at: integer().$type<SelfImprovementLifecycle.TimestampMillis>().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.location_id, table.artifact_id, table.slot] }),
    uniqueIndex("self_improvement_artifact_slot_version_id_idx").on(table.version_id),
    index("self_improvement_artifact_slot_location_artifact_slot_idx").on(
      table.location_id,
      table.artifact_id,
      table.slot,
    ),
    check("self_improvement_artifact_slot_slot", sql`${table.slot} IN ('active', 'shadow', 'canary')`),
  ],
)
