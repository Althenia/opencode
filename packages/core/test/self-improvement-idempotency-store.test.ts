import { expect, test } from "bun:test"
import { SqliteClient } from "@effect/sql-sqlite-bun"
import { EffectDrizzleSqlite } from "@opencode-ai/effect-drizzle-sqlite"
import {
  SelfImprovement,
  SelfImprovementApi,
  SelfImprovementLearning,
  SelfImprovementLifecycle,
} from "@opencode-ai/schema"
import { Database } from "@opencode-ai/core/database/database"
import { SelfImprovementIdempotencyStore } from "@opencode-ai/core/self-improvement/idempotency-store"
import { Effect, Layer } from "effect"
import { sql } from "drizzle-orm"

const makeDb = EffectDrizzleSqlite.makeWithDefaults()
const locationID = SelfImprovementLifecycle.LocationID.make("a".repeat(64))
const otherLocationID = SelfImprovementLifecycle.LocationID.make("b".repeat(64))
const retention = 30 * 86_400_000

const record = (id: string, key: string, expiresAt: number) => ({
  id: SelfImprovementLifecycle.IdempotencyRecordID.make(id),
  identity: new SelfImprovementLearning.IdempotencyIdentity({
    principalID: SelfImprovementLifecycle.PrincipalID.make("owner"),
    locationID,
    operation: "artifact.create",
    key: SelfImprovementLearning.IdempotencyKey.make(key),
  }),
  requestDigest: SelfImprovement.Digest.make("1".repeat(64)),
  storedBodyDigest: SelfImprovement.Digest.make("2".repeat(64)),
  storedResponse: {
    status: 400 as const,
    body: new SelfImprovementApi.ApiError({
      code: "invalid-page",
      message: "Invalid page",
      requestID: "request",
      details: new SelfImprovementApi.ApiErrorDetails({}),
    }),
  },
  createdAt: SelfImprovementLifecycle.TimestampMillis.make(expiresAt - retention),
  expiresAt: SelfImprovementLifecycle.TimestampMillis.make(expiresAt),
})

const setup = Effect.gen(function* () {
  const db = yield* makeDb
  yield* db.run(sql`
    CREATE TABLE self_improvement_idempotency (
      id TEXT PRIMARY KEY,
      principal_id TEXT NOT NULL,
      location_id TEXT NOT NULL,
      operation TEXT NOT NULL,
      key TEXT NOT NULL,
      request_digest TEXT NOT NULL,
      status INTEGER NOT NULL,
      body_digest TEXT NOT NULL,
      body_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      UNIQUE (principal_id, location_id, operation, key)
    )
  `)
  return yield* SelfImprovementIdempotencyStore.Service.use((store) =>
    Effect.gen(function* () {
      const expired = record("si_idm_expired", "expired", retention + 10)
      const current = record("si_idm_current", "current", retention + 11)
      yield* store.put({ locationID, record: expired })
      yield* store.put({ locationID, record: current })

      expect(yield* store.get({ locationID: otherLocationID, identity: expired.identity })).toBeUndefined()
      expect(yield* store.get({ locationID, identity: expired.identity })).toEqual(expired)
      expect(
        yield* store.listExpired({ locationID, now: SelfImprovementLifecycle.TimestampMillis.make(retention + 10) }),
      ).toEqual([expired])
    }),
  ).pipe(Effect.provide(SelfImprovementIdempotencyStore.layer), Effect.provide(Layer.succeed(Database.Service, { db })))
})

test("stores location-scoped idempotency replay records", async () => {
  await Effect.runPromise(
    setup.pipe(Effect.provide(SqliteClient.layer({ filename: ":memory:", disableWAL: true })), Effect.scoped),
  )
})
