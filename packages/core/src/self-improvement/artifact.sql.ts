import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"
import { sql } from "drizzle-orm"
import { SelfImprovement, SelfImprovementLifecycle } from "@opencode-ai/schema"

export const SelfImprovementArtifactTable = sqliteTable(
  "self_improvement_artifact",
  {
    id: text().$type<SelfImprovementLifecycle.ArtifactID>().notNull().primaryKey(),
    location_id: text().$type<SelfImprovementLifecycle.LocationID>().notNull(),
    kind: text().$type<SelfImprovement.ArtifactKind>().notNull(),
    name: text().$type<SelfImprovement.CandidateName>().notNull(),
    status: text().$type<SelfImprovementLifecycle.ArtifactStatus>().notNull(),
    created_by: text().$type<SelfImprovementLifecycle.PrincipalID>().notNull(),
    created_at: integer().$type<SelfImprovementLifecycle.TimestampMillis>().notNull(),
    revision: integer().$type<SelfImprovementLifecycle.Revision>().notNull(),
    tombstone_actor_id: text().$type<SelfImprovementLifecycle.PrincipalID>(),
    tombstone_reason: text(),
    tombstone_at: integer().$type<SelfImprovementLifecycle.TimestampMillis>(),
  },
  (table) => [
    uniqueIndex("self_improvement_artifact_location_kind_name_idx").on(table.location_id, table.kind, table.name),
    index("self_improvement_artifact_location_status_kind_name_id_idx").on(
      table.location_id,
      table.status,
      table.kind,
      table.name,
      table.id,
    ),
    check(
      "self_improvement_artifact_tombstone_state",
      sql`(${table.status} = 'live' AND ${table.tombstone_actor_id} IS NULL AND ${table.tombstone_reason} IS NULL AND ${table.tombstone_at} IS NULL) OR (${table.status} = 'tombstoned' AND ${table.tombstone_actor_id} IS NOT NULL AND ${table.tombstone_reason} IS NOT NULL AND ${table.tombstone_at} IS NOT NULL)`,
    ),
  ],
)

export const SelfImprovementArtifactVersionTable = sqliteTable(
  "self_improvement_artifact_version",
  {
    id: text().$type<SelfImprovementLifecycle.ArtifactVersionID>().notNull().primaryKey(),
    artifact_id: text()
      .$type<SelfImprovementLifecycle.ArtifactID>()
      .notNull()
      .references(() => SelfImprovementArtifactTable.id, { onDelete: "restrict" }),
    version_number: integer().notNull(),
    source: text().$type<SelfImprovementLifecycle.ArtifactSource>().notNull(),
    behavior_class: text().$type<SelfImprovementLifecycle.BehaviorClass>().notNull(),
    proposal_json: text().notNull(),
    canonical_json: text().$type<SelfImprovement.CanonicalJson>().notNull(),
    proposal_digest: text().$type<SelfImprovement.Digest>().notNull(),
    input_snapshot_digest: text().$type<SelfImprovement.Digest>().notNull(),
    version_digest: text().$type<SelfImprovement.Digest>().notNull(),
    capability_manifest_json: text().notNull(),
    capability_manifest_digest: text().$type<SelfImprovement.Digest>().notNull(),
    creator_id: text().$type<SelfImprovementLifecycle.PrincipalID>().notNull(),
    created_at: integer().$type<SelfImprovementLifecycle.TimestampMillis>().notNull(),
    generation_lease_id: text().$type<SelfImprovementLifecycle.GenerationLeaseID>(),
    strategy_pull_id: text().$type<SelfImprovementLifecycle.PullEventID>(),
    originating_task_id_digest: text().$type<SelfImprovement.Digest>(),
    model_request_digest: text().$type<SelfImprovement.Digest>(),
    model_output_digest: text().$type<SelfImprovement.Digest>(),
    retention_deadline: integer().$type<SelfImprovementLifecycle.TimestampMillis>(),
  },
  (table) => [
    uniqueIndex("self_improvement_artifact_version_artifact_number_idx").on(table.artifact_id, table.version_number),
    uniqueIndex("self_improvement_artifact_version_digest_idx").on(table.version_digest),
    check(
      "self_improvement_artifact_version_generated_metadata",
      sql`(${table.source} = 'human' AND ${table.generation_lease_id} IS NULL AND ${table.strategy_pull_id} IS NULL AND ${table.originating_task_id_digest} IS NULL AND ${table.model_request_digest} IS NULL AND ${table.model_output_digest} IS NULL AND ${table.retention_deadline} IS NULL) OR (${table.source} = 'generated' AND ${table.generation_lease_id} IS NOT NULL AND ${table.strategy_pull_id} IS NOT NULL AND ${table.originating_task_id_digest} IS NOT NULL AND ${table.model_request_digest} IS NOT NULL AND ${table.model_output_digest} IS NOT NULL AND ${table.retention_deadline} IS NOT NULL)`,
    ),
  ],
)
