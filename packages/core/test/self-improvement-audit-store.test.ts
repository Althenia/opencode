import { expect, test } from "bun:test"
import { SqliteClient } from "@effect/sql-sqlite-bun"
import { EffectDrizzleSqlite } from "@opencode-ai/effect-drizzle-sqlite"
import { SelfImprovement, SelfImprovementLearning, SelfImprovementLifecycle } from "@opencode-ai/schema"
import { Database } from "@opencode-ai/core/database/database"
import { SelfImprovementAuditStore } from "@opencode-ai/core/self-improvement/audit-store"
import { Effect, Layer } from "effect"
import { sql } from "drizzle-orm"

const makeDb = EffectDrizzleSqlite.makeWithDefaults()
const locationID = SelfImprovementLifecycle.LocationID.make("a".repeat(64))
const otherLocationID = SelfImprovementLifecycle.LocationID.make("b".repeat(64))

const entry = (id: string, timestamp: number, eventType = "artifact.created") =>
  new SelfImprovementLearning.AuditEntry({
    id: SelfImprovementLifecycle.AuditEntryID.make(id),
    locationID,
    eventType,
    actorID: SelfImprovementLifecycle.PrincipalID.make("owner"),
    payload: new SelfImprovementLearning.AuditPayload({
      artifactID: SelfImprovementLifecycle.ArtifactID.make("si_art_1"),
      linkedDigests: [SelfImprovement.Digest.make("1".repeat(64))],
      rejectedFieldNames: ["secret"],
    }),
    timestamp: SelfImprovementLifecycle.TimestampMillis.make(timestamp),
    retention: new SelfImprovementLearning.EvidenceRetention({
      createdAt: SelfImprovementLifecycle.TimestampMillis.make(1),
      expiresAt: SelfImprovementLifecycle.TimestampMillis.make(180 * 86_400_000 + 1),
    }),
  })

const setup = Effect.gen(function* () {
  const db = yield* makeDb
  yield* db.run(sql`
    CREATE TABLE self_improvement_audit_entry (
      id TEXT PRIMARY KEY,
      location_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      retention_tag TEXT NOT NULL,
      retention_created_at INTEGER NOT NULL,
      retention_expires_at INTEGER
    )
  `)
  return yield* SelfImprovementAuditStore.Service.use((store) =>
    Effect.gen(function* () {
      expect(Object.keys(store).sort()).toEqual(["append", "list"])

      const mismatched = yield* store
        .append({ locationID: otherLocationID, entry: entry("si_aud_mismatch", 1) })
        .pipe(Effect.flip)
      expect(mismatched._tag).toBe("SelfImprovementAuditStore.InvalidInput")

      yield* store.append({ locationID, entry: entry("si_aud_2", 2) })
      yield* store.append({ locationID, entry: entry("si_aud_1", 1, "artifact.updated") })
      yield* store.append({ locationID, entry: entry("si_aud_3", 2) })
      const duplicate = yield* store.append({ locationID, entry: entry("si_aud_2", 2) }).pipe(Effect.flip)
      expect(duplicate._tag).toBe("SelfImprovementAuditStore.Conflict")

      expect(yield* store.list({ locationID: otherLocationID })).toEqual([])
      expect((yield* store.list({ locationID })).map((item) => item.id)).toEqual([
        SelfImprovementLifecycle.AuditEntryID.make("si_aud_1"),
        SelfImprovementLifecycle.AuditEntryID.make("si_aud_2"),
        SelfImprovementLifecycle.AuditEntryID.make("si_aud_3"),
      ])
      expect(yield* store.list({ locationID, eventType: "artifact.created" })).toEqual([
        entry("si_aud_2", 2),
        entry("si_aud_3", 2),
      ])
    }),
  ).pipe(Effect.provide(SelfImprovementAuditStore.layer), Effect.provide(Layer.succeed(Database.Service, { db })))
})

test("stores immutable location-scoped audit entries", async () => {
  await Effect.runPromise(
    setup.pipe(Effect.provide(SqliteClient.layer({ filename: ":memory:", disableWAL: true })), Effect.scoped),
  )
})
