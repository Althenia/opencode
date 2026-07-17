export * as SelfImprovementMutationStore from "./mutation-store"

import { and, asc, eq, sql } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import { SelfImprovementLifecycle } from "@opencode-ai/schema"
import type { EffectDrizzleSqlite } from "@opencode-ai/effect-drizzle-sqlite"
import { Database } from "../database/database"
import { SelfImprovementArtifactTable, SelfImprovementArtifactVersionTable } from "./artifact.sql"
import { SelfImprovementArtifactSlotTable } from "./projection.sql"

type DatabaseClient = EffectDrizzleSqlite.EffectSQLiteDatabase
export type Transaction = Parameters<Parameters<DatabaseClient["transaction"]>[0]>[0]

export interface Interface {
  readonly compareAndSetRevision: (
    input: {
      readonly locationID: SelfImprovementLifecycle.LocationID
      readonly artifactID: SelfImprovementLifecycle.ArtifactID
      readonly expectedRevision: SelfImprovementLifecycle.Revision
      readonly nextRevision: SelfImprovementLifecycle.Revision
    },
    tx?: Transaction,
  ) => Effect.Effect<boolean>
  readonly tombstoneAndClearSlots: (
    input: {
      readonly locationID: SelfImprovementLifecycle.LocationID
      readonly artifactID: SelfImprovementLifecycle.ArtifactID
      readonly expectedRevision: SelfImprovementLifecycle.Revision
      readonly tombstone: SelfImprovementLifecycle.Tombstone
    },
    tx: Transaction,
  ) => Effect.Effect<{ readonly revision: SelfImprovementLifecycle.Revision } | undefined>
  readonly upsertSlot: (
    input: {
      readonly locationID: SelfImprovementLifecycle.LocationID
      readonly artifactID: SelfImprovementLifecycle.ArtifactID
      readonly versionID: SelfImprovementLifecycle.ArtifactVersionID
      readonly slot: "active" | "shadow" | "canary"
      readonly expectedArtifactRevision: SelfImprovementLifecycle.Revision
      readonly updatedAt: SelfImprovementLifecycle.TimestampMillis
    },
    tx?: Transaction,
  ) => Effect.Effect<boolean>
  readonly listSlots: (input: {
    readonly locationID: SelfImprovementLifecycle.LocationID
    readonly artifactID: SelfImprovementLifecycle.ArtifactID
  }) => Effect.Effect<
    ReadonlyArray<{
      readonly artifactID: SelfImprovementLifecycle.ArtifactID
      readonly versionID: SelfImprovementLifecycle.ArtifactVersionID
      readonly slot: "active" | "shadow" | "canary"
      readonly artifactRevision: SelfImprovementLifecycle.Revision
      readonly updatedAt: SelfImprovementLifecycle.TimestampMillis
    }>
  >
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SelfImprovementMutationStore") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const db = (yield* Database.Service).db

    const compareAndSetRevision = Effect.fn("SelfImprovementMutationStore.compareAndSetRevision")(function* (
      input: {
        readonly locationID: SelfImprovementLifecycle.LocationID
        readonly artifactID: SelfImprovementLifecycle.ArtifactID
        readonly expectedRevision: SelfImprovementLifecycle.Revision
        readonly nextRevision: SelfImprovementLifecycle.Revision
      },
      tx?: Transaction,
    ) {
      const update = (client: Transaction) =>
        client
          .update(SelfImprovementArtifactTable)
          .set({ revision: input.nextRevision })
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
          .pipe(
            Effect.orDie,
            Effect.map((updated) => updated !== undefined),
          )

      if (tx) return yield* update(tx)
      return yield* db.transaction(update).pipe(Effect.catchTag("SqlError", Effect.die))
    })

    const tombstoneAndClearSlots = Effect.fn("SelfImprovementMutationStore.tombstoneAndClearSlots")(function* (
      input: {
        readonly locationID: SelfImprovementLifecycle.LocationID
        readonly artifactID: SelfImprovementLifecycle.ArtifactID
        readonly expectedRevision: SelfImprovementLifecycle.Revision
        readonly tombstone: SelfImprovementLifecycle.Tombstone
      },
      tx: Transaction,
    ) {
      const updated = yield* tx
        .update(SelfImprovementArtifactTable)
        .set({
          status: "tombstoned",
          revision: sql`${SelfImprovementArtifactTable.revision} + 1`,
          tombstone_actor_id: input.tombstone.actorID,
          tombstone_reason: input.tombstone.reason,
          tombstone_at: input.tombstone.timestamp,
        })
        .where(
          and(
            eq(SelfImprovementArtifactTable.id, input.artifactID),
            eq(SelfImprovementArtifactTable.location_id, input.locationID),
            eq(SelfImprovementArtifactTable.status, "live"),
            eq(SelfImprovementArtifactTable.revision, input.expectedRevision),
          ),
        )
        .returning({ revision: SelfImprovementArtifactTable.revision })
        .get()
        .pipe(Effect.orDie)
      if (updated === undefined) return undefined
      yield* tx
        .delete(SelfImprovementArtifactSlotTable)
        .where(
          and(
            eq(SelfImprovementArtifactSlotTable.location_id, input.locationID),
            eq(SelfImprovementArtifactSlotTable.artifact_id, input.artifactID),
          ),
        )
        .run()
        .pipe(Effect.orDie)
      return { revision: updated.revision }
    })

    const upsertSlot = Effect.fn("SelfImprovementMutationStore.upsertSlot")(function* (
      input: {
        readonly locationID: SelfImprovementLifecycle.LocationID
        readonly artifactID: SelfImprovementLifecycle.ArtifactID
        readonly versionID: SelfImprovementLifecycle.ArtifactVersionID
        readonly slot: "active" | "shadow" | "canary"
        readonly expectedArtifactRevision: SelfImprovementLifecycle.Revision
        readonly updatedAt: SelfImprovementLifecycle.TimestampMillis
      },
      tx?: Transaction,
    ) {
      const upsert = (client: Transaction) =>
        Effect.gen(function* () {
          const version = yield* client
            .select({ id: SelfImprovementArtifactVersionTable.id })
            .from(SelfImprovementArtifactVersionTable)
            .innerJoin(
              SelfImprovementArtifactTable,
              and(
                eq(SelfImprovementArtifactVersionTable.artifact_id, SelfImprovementArtifactTable.id),
                eq(SelfImprovementArtifactTable.location_id, input.locationID),
                eq(SelfImprovementArtifactTable.id, input.artifactID),
                eq(SelfImprovementArtifactTable.status, "live"),
                eq(SelfImprovementArtifactTable.revision, input.expectedArtifactRevision),
              ),
            )
            .where(eq(SelfImprovementArtifactVersionTable.id, input.versionID))
            .get()
            .pipe(Effect.orDie)
          if (version === undefined) return false
          yield* client
            .insert(SelfImprovementArtifactSlotTable)
            .values({
              location_id: input.locationID,
              artifact_id: input.artifactID,
              version_id: input.versionID,
              slot: input.slot,
              artifact_revision: input.expectedArtifactRevision,
              updated_at: input.updatedAt,
            })
            .onConflictDoUpdate({
              target: [
                SelfImprovementArtifactSlotTable.location_id,
                SelfImprovementArtifactSlotTable.artifact_id,
                SelfImprovementArtifactSlotTable.slot,
              ],
              set: {
                version_id: input.versionID,
                artifact_revision: input.expectedArtifactRevision,
                updated_at: input.updatedAt,
              },
            })
            .run()
            .pipe(Effect.orDie)
          return true
        })

      if (tx) return yield* upsert(tx)
      return yield* db.transaction(upsert).pipe(Effect.catchTag("SqlError", Effect.die))
    })

    const listSlots = Effect.fn("SelfImprovementMutationStore.listSlots")(function* (input: {
      readonly locationID: SelfImprovementLifecycle.LocationID
      readonly artifactID: SelfImprovementLifecycle.ArtifactID
    }) {
      return yield* db
        .select({
          artifactID: SelfImprovementArtifactSlotTable.artifact_id,
          versionID: SelfImprovementArtifactSlotTable.version_id,
          slot: SelfImprovementArtifactSlotTable.slot,
          artifactRevision: SelfImprovementArtifactSlotTable.artifact_revision,
          updatedAt: SelfImprovementArtifactSlotTable.updated_at,
        })
        .from(SelfImprovementArtifactSlotTable)
        .innerJoin(
          SelfImprovementArtifactTable,
          and(
            eq(SelfImprovementArtifactSlotTable.artifact_id, SelfImprovementArtifactTable.id),
            eq(SelfImprovementArtifactTable.location_id, input.locationID),
          ),
        )
        .where(
          and(
            eq(SelfImprovementArtifactSlotTable.location_id, input.locationID),
            eq(SelfImprovementArtifactSlotTable.artifact_id, input.artifactID),
          ),
        )
        .orderBy(asc(SelfImprovementArtifactSlotTable.slot))
        .all()
        .pipe(Effect.orDie)
    })

    return Service.of({ compareAndSetRevision, tombstoneAndClearSlots, upsertSlot, listSlots })
  }),
)
