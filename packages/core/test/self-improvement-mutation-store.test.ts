import { expect, test } from "bun:test"
import { SqliteClient } from "@effect/sql-sqlite-bun"
import { EffectDrizzleSqlite } from "@opencode-ai/effect-drizzle-sqlite"
import { SelfImprovementLifecycle } from "@opencode-ai/schema"
import { Database } from "@opencode-ai/core/database/database"
import { SelfImprovementMutationStore } from "@opencode-ai/core/self-improvement/mutation-store"
import { Effect, Layer } from "effect"
import { sql } from "drizzle-orm"

const makeDb = EffectDrizzleSqlite.makeWithDefaults()
const locationID = SelfImprovementLifecycle.LocationID.make("a".repeat(64))
const otherLocationID = SelfImprovementLifecycle.LocationID.make("b".repeat(64))
const artifactID = SelfImprovementLifecycle.ArtifactID.make("si_art_1")
const otherArtifactID = SelfImprovementLifecycle.ArtifactID.make("si_art_2")
const versionID = SelfImprovementLifecycle.ArtifactVersionID.make("si_ver_1")
const otherVersionID = SelfImprovementLifecycle.ArtifactVersionID.make("si_ver_2")
const shadowVersionID = SelfImprovementLifecycle.ArtifactVersionID.make("si_ver_3")
const canaryVersionID = SelfImprovementLifecycle.ArtifactVersionID.make("si_ver_4")
const revision0 = SelfImprovementLifecycle.Revision.make(0)
const revision1 = SelfImprovementLifecycle.Revision.make(1)
const revision2 = SelfImprovementLifecycle.Revision.make(2)

const setup = Effect.gen(function* () {
  const db = yield* makeDb
  yield* db.run(sql`
    CREATE TABLE self_improvement_artifact (
      id TEXT PRIMARY KEY,
      location_id TEXT NOT NULL,
      status TEXT NOT NULL,
      revision INTEGER NOT NULL,
      tombstone_actor_id TEXT,
      tombstone_reason TEXT,
      tombstone_at INTEGER
    )
  `)
  yield* db.run(sql`
    CREATE TABLE self_improvement_artifact_version (
      id TEXT PRIMARY KEY,
      artifact_id TEXT NOT NULL
    )
  `)
  yield* db.run(sql`
    CREATE TABLE self_improvement_artifact_slot (
      location_id TEXT NOT NULL,
      artifact_id TEXT NOT NULL,
      slot TEXT NOT NULL,
      version_id TEXT NOT NULL UNIQUE,
      artifact_revision INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (location_id, artifact_id, slot)
    )
  `)
  yield* db.run(sql`
    INSERT INTO self_improvement_artifact (id, location_id, status, revision)
    VALUES (${artifactID}, ${locationID}, 'live', 0), (${otherArtifactID}, ${locationID}, 'live', 0)
  `)
  yield* db.run(sql`
    INSERT INTO self_improvement_artifact_version (id, artifact_id)
    VALUES
      (${versionID}, ${artifactID}),
      (${otherVersionID}, ${otherArtifactID}),
      (${shadowVersionID}, ${artifactID}),
      (${canaryVersionID}, ${artifactID})
  `)
  return db
})

test("mutates only live artifacts at the expected location and revision", async () => {
  await Effect.runPromise(
    setup.pipe(
      Effect.flatMap((db) =>
        SelfImprovementMutationStore.Service.use((store) =>
          Effect.gen(function* () {
            expect(
              yield* store.compareAndSetRevision({
                locationID,
                artifactID,
                expectedRevision: revision0,
                nextRevision: revision1,
              }),
            ).toBe(true)
            expect(
              yield* store.compareAndSetRevision({
                locationID: otherLocationID,
                artifactID,
                expectedRevision: revision1,
                nextRevision: revision2,
              }),
            ).toBe(false)
            expect(
              yield* store.upsertSlot({
                locationID,
                artifactID,
                versionID: otherVersionID,
                slot: "active",
                expectedArtifactRevision: revision1,
                updatedAt: SelfImprovementLifecycle.TimestampMillis.make(1),
              }),
            ).toBe(false)
            expect(
              yield* store.upsertSlot({
                locationID,
                artifactID,
                versionID,
                slot: "active",
                expectedArtifactRevision: revision1,
                updatedAt: SelfImprovementLifecycle.TimestampMillis.make(2),
              }),
            ).toBe(true)
            expect(
              yield* store.upsertSlot({
                locationID,
                artifactID,
                versionID: shadowVersionID,
                slot: "shadow",
                expectedArtifactRevision: revision1,
                updatedAt: SelfImprovementLifecycle.TimestampMillis.make(2),
              }),
            ).toBe(true)
            expect(
              yield* store.upsertSlot({
                locationID,
                artifactID,
                versionID: canaryVersionID,
                slot: "canary",
                expectedArtifactRevision: revision1,
                updatedAt: SelfImprovementLifecycle.TimestampMillis.make(2),
              }),
            ).toBe(true)
            expect(yield* store.listSlots({ locationID, artifactID })).toEqual([
              {
                artifactID,
                artifactRevision: revision1,
                slot: "active",
                updatedAt: SelfImprovementLifecycle.TimestampMillis.make(2),
                versionID,
              },
              {
                artifactID,
                artifactRevision: revision1,
                slot: "canary",
                updatedAt: SelfImprovementLifecycle.TimestampMillis.make(2),
                versionID: canaryVersionID,
              },
              {
                artifactID,
                artifactRevision: revision1,
                slot: "shadow",
                updatedAt: SelfImprovementLifecycle.TimestampMillis.make(2),
                versionID: shadowVersionID,
              },
            ])

            const tombstoned = yield* db.transaction((tx) =>
              store.tombstone(
                {
                  locationID,
                  artifactID,
                  expectedRevision: revision1,
                  tombstone: new SelfImprovementLifecycle.Tombstone({
                    actorID: SelfImprovementLifecycle.PrincipalID.make("owner"),
                    reason: "removed",
                    timestamp: SelfImprovementLifecycle.TimestampMillis.make(3),
                  }),
                },
                tx,
              ),
            )
            expect(tombstoned).toEqual({
              revision: revision2,
              slots: [
                {
                  artifactID,
                  artifactRevision: revision1,
                  slot: "active",
                  updatedAt: SelfImprovementLifecycle.TimestampMillis.make(2),
                  versionID,
                },
                {
                  artifactID,
                  artifactRevision: revision1,
                  slot: "canary",
                  updatedAt: SelfImprovementLifecycle.TimestampMillis.make(2),
                  versionID: canaryVersionID,
                },
                {
                  artifactID,
                  artifactRevision: revision1,
                  slot: "shadow",
                  updatedAt: SelfImprovementLifecycle.TimestampMillis.make(2),
                  versionID: shadowVersionID,
                },
              ],
            })
            expect(yield* store.listSlots({ locationID, artifactID })).toEqual(tombstoned?.slots ?? [])
            expect(
              yield* db.transaction((tx) =>
                store.clearTombstonedSlots({ locationID, artifactID, expectedRevision: revision1 }, tx),
              ),
            ).toBe(false)
            expect(
              yield* db.transaction((tx) =>
                store.clearTombstonedSlots({ locationID, artifactID, expectedRevision: revision2 }, tx),
              ),
            ).toBe(true)
            expect(yield* store.listSlots({ locationID, artifactID })).toEqual([])
            expect(
              yield* store.upsertSlot({
                locationID,
                artifactID,
                versionID,
                slot: "active",
                expectedArtifactRevision: revision2,
                updatedAt: SelfImprovementLifecycle.TimestampMillis.make(4),
              }),
            ).toBe(false)
          }),
        ).pipe(
          Effect.provide(SelfImprovementMutationStore.layer),
          Effect.provide(Layer.succeed(Database.Service, { db })),
        ),
      ),
      Effect.provide(SqliteClient.layer({ filename: ":memory:", disableWAL: true })),
      Effect.scoped,
    ),
  )
})

test("validates an artifact revision inside a transaction without incrementing it", async () => {
  await Effect.runPromise(
    setup.pipe(
      Effect.flatMap((db) =>
        SelfImprovementMutationStore.Service.use((store) =>
          Effect.gen(function* () {
            expect(
              yield* db.transaction((tx) =>
                store.validateRevision({ locationID, artifactID, expectedRevision: revision0, status: "live" }, tx),
              ),
            ).toBe(true)
            expect(
              yield* db.transaction((tx) =>
                store.validateRevision({ locationID, artifactID, expectedRevision: revision1 }, tx),
              ),
            ).toBe(false)
            expect(
              yield* db.get<{ revision: number }>(sql`
                SELECT revision FROM self_improvement_artifact WHERE id = ${artifactID}
              `),
            ).toEqual({ revision: revision0 })
          }),
        ).pipe(
          Effect.provide(SelfImprovementMutationStore.layer),
          Effect.provide(Layer.succeed(Database.Service, { db })),
        ),
      ),
      Effect.provide(SqliteClient.layer({ filename: ":memory:", disableWAL: true })),
      Effect.scoped,
    ),
  )
})

test("removes an exact slot only for a live artifact at the expected revision", async () => {
  await Effect.runPromise(
    setup.pipe(
      Effect.flatMap((db) =>
        SelfImprovementMutationStore.Service.use((store) =>
          Effect.gen(function* () {
            yield* store.upsertSlot({
              locationID,
              artifactID,
              versionID: shadowVersionID,
              slot: "shadow",
              expectedArtifactRevision: revision0,
              updatedAt: SelfImprovementLifecycle.TimestampMillis.make(1),
            })
            expect(
              yield* db.transaction((tx) =>
                store.removeSlot(
                  {
                    locationID,
                    artifactID,
                    slot: "shadow",
                    expectedArtifactRevision: revision1,
                  },
                  tx,
                ),
              ),
            ).toBe(false)
            expect(
              yield* db.transaction((tx) =>
                store.removeSlot(
                  {
                    locationID,
                    artifactID,
                    slot: "shadow",
                    expectedArtifactRevision: revision0,
                  },
                  tx,
                ),
              ),
            ).toBe(true)
            expect(
              yield* db.transaction((tx) =>
                store.removeSlot(
                  {
                    locationID,
                    artifactID,
                    slot: "shadow",
                    expectedArtifactRevision: revision0,
                  },
                  tx,
                ),
              ),
            ).toBe(false)
          }),
        ).pipe(
          Effect.provide(SelfImprovementMutationStore.layer),
          Effect.provide(Layer.succeed(Database.Service, { db })),
        ),
      ),
      Effect.provide(SqliteClient.layer({ filename: ":memory:", disableWAL: true })),
      Effect.scoped,
    ),
  )
})
