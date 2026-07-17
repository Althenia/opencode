export * as SelfImprovementArtifactStore from "./artifact-store"

import { and, asc, desc, eq, sql } from "drizzle-orm"
import { Context, Effect, Layer, Schema } from "effect"
import { SelfImprovement, SelfImprovementLifecycle } from "@opencode-ai/schema"
import type { EffectDrizzleSqlite } from "@opencode-ai/effect-drizzle-sqlite"
import { Database } from "../database/database"
import { SelfImprovementArtifactTable, SelfImprovementArtifactVersionTable } from "./artifact.sql"

type DatabaseClient = EffectDrizzleSqlite.EffectSQLiteDatabase
export type Transaction = Parameters<Parameters<DatabaseClient["transaction"]>[0]>[0]

const CandidateProposalJson = Schema.fromJsonString(SelfImprovement.CandidateProposal)
const CapabilityManifestJson = Schema.fromJsonString(SelfImprovementLifecycle.CapabilityManifest)
const encodeProposal = Schema.encodeSync(CandidateProposalJson)
const decodeProposal = Schema.decodeUnknownSync(CandidateProposalJson)
const encodeCapabilityManifest = Schema.encodeSync(CapabilityManifestJson)
const decodeCapabilityManifest = Schema.decodeUnknownSync(CapabilityManifestJson)

export class InvalidInput extends Schema.TaggedErrorClass<InvalidInput>()("SelfImprovementArtifactStore.InvalidInput", {
  message: Schema.String,
}) {}

export class Conflict extends Schema.TaggedErrorClass<Conflict>()("SelfImprovementArtifactStore.Conflict", {
  message: Schema.String,
}) {}

export interface Interface {
  readonly create: (
    input: {
      readonly locationID: SelfImprovementLifecycle.LocationID
      readonly artifact: SelfImprovementLifecycle.Artifact
      readonly version: SelfImprovementLifecycle.ArtifactVersion
    },
    tx?: Transaction,
  ) => Effect.Effect<void, InvalidInput | Conflict>
  readonly getArtifact: (input: {
    readonly locationID: SelfImprovementLifecycle.LocationID
    readonly artifactID: SelfImprovementLifecycle.ArtifactID
  }) => Effect.Effect<SelfImprovementLifecycle.Artifact | undefined>
  readonly getVersion: (input: {
    readonly locationID: SelfImprovementLifecycle.LocationID
    readonly versionID: SelfImprovementLifecycle.ArtifactVersionID
  }) => Effect.Effect<SelfImprovementLifecycle.ArtifactVersion | undefined>
  readonly appendVersion: (
    input: {
      readonly locationID: SelfImprovementLifecycle.LocationID
      readonly artifactID: SelfImprovementLifecycle.ArtifactID
      readonly expectedRevision: SelfImprovementLifecycle.Revision
      readonly version: SelfImprovementLifecycle.ArtifactVersion
    },
    tx?: Transaction,
  ) => Effect.Effect<boolean, InvalidInput | Conflict>
  readonly listVersions: (input: {
    readonly locationID: SelfImprovementLifecycle.LocationID
    readonly artifactID: SelfImprovementLifecycle.ArtifactID
  }) => Effect.Effect<ReadonlyArray<SelfImprovementLifecycle.ArtifactVersion>>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SelfImprovementArtifactStore") {}

const fromArtifactRow = (row: typeof SelfImprovementArtifactTable.$inferSelect) => {
  const tombstone =
    row.tombstone_actor_id === null
      ? undefined
      : row.tombstone_reason === null || row.tombstone_at === null
        ? (() => {
            throw new Error("Invalid artifact tombstone row")
          })()
        : new SelfImprovementLifecycle.Tombstone({
            actorID: row.tombstone_actor_id,
            reason: row.tombstone_reason,
            timestamp: row.tombstone_at,
          })
  return new SelfImprovementLifecycle.Artifact({
    id: row.id,
    key: new SelfImprovementLifecycle.ArtifactKey({ locationID: row.location_id, kind: row.kind, name: row.name }),
    status: row.status,
    createdBy: row.created_by,
    createdAt: row.created_at,
    revision: row.revision,
    ...(tombstone === undefined ? {} : { tombstone }),
  })
}

const fromVersionRow = (row: typeof SelfImprovementArtifactVersionTable.$inferSelect) => {
  const generated =
    row.generation_lease_id === null
      ? undefined
      : row.strategy_pull_id === null ||
          row.originating_task_id_digest === null ||
          row.model_request_digest === null ||
          row.model_output_digest === null ||
          row.retention_deadline === null
        ? (() => {
            throw new Error("Invalid generated artifact version row")
          })()
        : new SelfImprovementLifecycle.GeneratedContentMetadata({
            generationLeaseID: row.generation_lease_id,
            strategyPullID: row.strategy_pull_id,
            originatingTaskIDDigest: row.originating_task_id_digest,
            modelRequestDigest: row.model_request_digest,
            modelOutputDigest: row.model_output_digest,
            retentionDeadline: row.retention_deadline,
          })
  return new SelfImprovementLifecycle.ArtifactVersion({
    id: row.id,
    artifactID: row.artifact_id,
    versionNumber: row.version_number,
    source: row.source,
    behaviorClass: row.behavior_class,
    proposal: decodeProposal(row.proposal_json),
    canonicalJson: row.canonical_json,
    proposalDigest: row.proposal_digest,
    inputSnapshotDigest: row.input_snapshot_digest,
    versionDigest: row.version_digest,
    capabilityManifest: decodeCapabilityManifest(row.capability_manifest_json),
    capabilityManifestDigest: row.capability_manifest_digest,
    creatorID: row.creator_id,
    createdAt: row.created_at,
    ...(generated === undefined ? {} : { generated }),
  })
}

const versionValues = (version: SelfImprovementLifecycle.ArtifactVersion) => ({
  id: version.id,
  artifact_id: version.artifactID,
  version_number: version.versionNumber,
  source: version.source,
  behavior_class: version.behaviorClass,
  proposal_json: encodeProposal(version.proposal),
  canonical_json: version.canonicalJson,
  proposal_digest: version.proposalDigest,
  input_snapshot_digest: version.inputSnapshotDigest,
  version_digest: version.versionDigest,
  capability_manifest_json: encodeCapabilityManifest(version.capabilityManifest),
  capability_manifest_digest: version.capabilityManifestDigest,
  creator_id: version.creatorID,
  created_at: version.createdAt,
  generation_lease_id: version.generated?.generationLeaseID ?? null,
  strategy_pull_id: version.generated?.strategyPullID ?? null,
  originating_task_id_digest: version.generated?.originatingTaskIDDigest ?? null,
  model_request_digest: version.generated?.modelRequestDigest ?? null,
  model_output_digest: version.generated?.modelOutputDigest ?? null,
  retention_deadline: version.generated?.retentionDeadline ?? null,
})

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const db = (yield* Database.Service).db

    const create = Effect.fn("SelfImprovementArtifactStore.create")(function* (
      input: {
        readonly locationID: SelfImprovementLifecycle.LocationID
        readonly artifact: SelfImprovementLifecycle.Artifact
        readonly version: SelfImprovementLifecycle.ArtifactVersion
      },
      tx?: Transaction,
    ) {
      if (input.locationID !== input.artifact.key.locationID)
        return yield* new InvalidInput({ message: "Artifact Location does not match input Location" })
      if (input.version.artifactID !== input.artifact.id)
        return yield* new InvalidInput({ message: "Artifact version does not belong to artifact" })
      if (input.version.versionNumber !== 1)
        return yield* new InvalidInput({ message: "Initial artifact version must be numbered one" })

      const insert = (client: Transaction) =>
        Effect.gen(function* () {
          const artifact = yield* client
            .insert(SelfImprovementArtifactTable)
            .values({
              id: input.artifact.id,
              location_id: input.artifact.key.locationID,
              kind: input.artifact.key.kind,
              name: input.artifact.key.name,
              status: input.artifact.status,
              created_by: input.artifact.createdBy,
              created_at: input.artifact.createdAt,
              revision: input.artifact.revision,
              tombstone_actor_id: input.artifact.tombstone?.actorID ?? null,
              tombstone_reason: input.artifact.tombstone?.reason ?? null,
              tombstone_at: input.artifact.tombstone?.timestamp ?? null,
            })
            .onConflictDoNothing()
            .returning({ id: SelfImprovementArtifactTable.id })
            .get()
            .pipe(Effect.orDie)
          if (artifact === undefined) return yield* new Conflict({ message: "Artifact already exists" })

          const version = yield* client
            .insert(SelfImprovementArtifactVersionTable)
            .values(versionValues(input.version))
            .onConflictDoNothing()
            .returning({ id: SelfImprovementArtifactVersionTable.id })
            .get()
            .pipe(Effect.orDie)
          if (version === undefined) return yield* new Conflict({ message: "Artifact version already exists" })
        })

      if (tx) return yield* insert(tx)
      return yield* db.transaction(insert).pipe(Effect.catchTag("SqlError", Effect.die))
    })

    const getArtifact = Effect.fn("SelfImprovementArtifactStore.getArtifact")(function* (input: {
      readonly locationID: SelfImprovementLifecycle.LocationID
      readonly artifactID: SelfImprovementLifecycle.ArtifactID
    }) {
      const row = yield* db
        .select()
        .from(SelfImprovementArtifactTable)
        .where(
          and(
            eq(SelfImprovementArtifactTable.id, input.artifactID),
            eq(SelfImprovementArtifactTable.location_id, input.locationID),
          ),
        )
        .get()
        .pipe(Effect.orDie)
      return row === undefined ? undefined : fromArtifactRow(row)
    })

    const getVersion = Effect.fn("SelfImprovementArtifactStore.getVersion")(function* (input: {
      readonly locationID: SelfImprovementLifecycle.LocationID
      readonly versionID: SelfImprovementLifecycle.ArtifactVersionID
    }) {
      const row = yield* db
        .select({ version: SelfImprovementArtifactVersionTable })
        .from(SelfImprovementArtifactVersionTable)
        .innerJoin(
          SelfImprovementArtifactTable,
          and(
            eq(SelfImprovementArtifactVersionTable.artifact_id, SelfImprovementArtifactTable.id),
            eq(SelfImprovementArtifactTable.location_id, input.locationID),
          ),
        )
        .where(eq(SelfImprovementArtifactVersionTable.id, input.versionID))
        .get()
        .pipe(Effect.orDie)
      return row === undefined ? undefined : fromVersionRow(row.version)
    })

    const appendVersion = Effect.fn("SelfImprovementArtifactStore.appendVersion")(function* (
      input: {
        readonly locationID: SelfImprovementLifecycle.LocationID
        readonly artifactID: SelfImprovementLifecycle.ArtifactID
        readonly expectedRevision: SelfImprovementLifecycle.Revision
        readonly version: SelfImprovementLifecycle.ArtifactVersion
      },
      tx?: Transaction,
    ) {
      if (input.version.artifactID !== input.artifactID)
        return yield* new InvalidInput({ message: "Artifact version does not belong to artifact" })

      const append = (client: Transaction) =>
        Effect.gen(function* () {
          const latest = yield* client
            .select({ versionNumber: SelfImprovementArtifactVersionTable.version_number })
            .from(SelfImprovementArtifactVersionTable)
            .innerJoin(
              SelfImprovementArtifactTable,
              and(
                eq(SelfImprovementArtifactVersionTable.artifact_id, SelfImprovementArtifactTable.id),
                eq(SelfImprovementArtifactTable.location_id, input.locationID),
              ),
            )
            .where(eq(SelfImprovementArtifactVersionTable.artifact_id, input.artifactID))
            .orderBy(desc(SelfImprovementArtifactVersionTable.version_number))
            .limit(1)
            .get()
            .pipe(Effect.orDie)
          if (latest === undefined || input.version.versionNumber !== latest.versionNumber + 1)
            return yield* new InvalidInput({ message: "Artifact version number is not monotonic" })

          const updated = yield* client
            .update(SelfImprovementArtifactTable)
            .set({ revision: sql`${SelfImprovementArtifactTable.revision} + 1` })
            .where(
              and(
                eq(SelfImprovementArtifactTable.id, input.artifactID),
                eq(SelfImprovementArtifactTable.location_id, input.locationID),
                eq(SelfImprovementArtifactTable.status, "live"),
                eq(SelfImprovementArtifactTable.revision, input.expectedRevision),
              ),
            )
            .returning({ id: SelfImprovementArtifactTable.id })
            .get()
            .pipe(Effect.orDie)
          if (updated === undefined) return false

          const version = yield* client
            .insert(SelfImprovementArtifactVersionTable)
            .values(versionValues(input.version))
            .onConflictDoNothing()
            .returning({ id: SelfImprovementArtifactVersionTable.id })
            .get()
            .pipe(Effect.orDie)
          if (version === undefined) return yield* new Conflict({ message: "Artifact version already exists" })
          return true
        })

      if (tx) return yield* append(tx)
      return yield* db.transaction(append).pipe(Effect.catchTag("SqlError", Effect.die))
    })

    const listVersions = Effect.fn("SelfImprovementArtifactStore.listVersions")(function* (input: {
      readonly locationID: SelfImprovementLifecycle.LocationID
      readonly artifactID: SelfImprovementLifecycle.ArtifactID
    }) {
      const rows = yield* db
        .select({ version: SelfImprovementArtifactVersionTable })
        .from(SelfImprovementArtifactVersionTable)
        .innerJoin(
          SelfImprovementArtifactTable,
          and(
            eq(SelfImprovementArtifactVersionTable.artifact_id, SelfImprovementArtifactTable.id),
            eq(SelfImprovementArtifactTable.location_id, input.locationID),
          ),
        )
        .where(eq(SelfImprovementArtifactVersionTable.artifact_id, input.artifactID))
        .orderBy(asc(SelfImprovementArtifactVersionTable.version_number))
        .all()
        .pipe(Effect.orDie)
      return rows.map((row) => fromVersionRow(row.version))
    })

    return Service.of({ create, getArtifact, getVersion, appendVersion, listVersions })
  }),
)
