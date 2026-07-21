export * as SelfImprovementIdempotencyStore from "./idempotency-store"

import { and, asc, eq, lte } from "drizzle-orm"
import { Context, Effect, Layer, Schema } from "effect"
import {
  SelfImprovement,
  SelfImprovementApi,
  SelfImprovementLearning,
  SelfImprovementLifecycle,
} from "@opencode-ai/schema"
import type { EffectDrizzleSqlite } from "@opencode-ai/effect-drizzle-sqlite"
import { Database } from "../database/database"
import { makeLocationNode } from "../effect/app-node"
import { SelfImprovementIdempotencyTable } from "./idempotency.sql"

type DatabaseClient = EffectDrizzleSqlite.EffectSQLiteDatabase
export type Transaction = Parameters<Parameters<DatabaseClient["transaction"]>[0]>[0]

const StoredResponseJson = Schema.fromJsonString(SelfImprovementApi.StoredResponse)
const encodeStoredResponse = Schema.encodeSync(StoredResponseJson)
const decodeStoredResponse = Schema.decodeUnknownSync(StoredResponseJson)

export class InvalidInput extends Schema.TaggedErrorClass<InvalidInput>()(
  "SelfImprovementIdempotencyStore.InvalidInput",
  {
    message: Schema.String,
  },
) {}

export class Conflict extends Schema.TaggedErrorClass<Conflict>()("SelfImprovementIdempotencyStore.Conflict", {
  message: Schema.String,
}) {}

export interface Interface {
  readonly put: (
    input: {
      readonly locationID: SelfImprovementLifecycle.LocationID
      readonly record: SelfImprovementApi.IdempotencyRecord
    },
    tx?: Transaction,
  ) => Effect.Effect<void, InvalidInput | Conflict>
  readonly get: (input: {
    readonly locationID: SelfImprovementLifecycle.LocationID
    readonly identity: SelfImprovementLearning.IdempotencyIdentity
  }) => Effect.Effect<SelfImprovementApi.IdempotencyRecord | undefined>
  readonly valid: (
    input: {
      readonly locationID: SelfImprovementLifecycle.LocationID
      readonly recordID: SelfImprovementLifecycle.IdempotencyRecordID
      readonly requestDigest: SelfImprovement.Digest
    },
    tx: Transaction,
  ) => Effect.Effect<boolean>
  readonly listExpired: (input: {
    readonly locationID: SelfImprovementLifecycle.LocationID
    readonly now: SelfImprovementLifecycle.TimestampMillis
  }) => Effect.Effect<ReadonlyArray<SelfImprovementApi.IdempotencyRecord>>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SelfImprovementIdempotencyStore") {}

const fromRow = (row: typeof SelfImprovementIdempotencyTable.$inferSelect): SelfImprovementApi.IdempotencyRecord => ({
  id: row.id,
  identity: new SelfImprovementLearning.IdempotencyIdentity({
    principalID: row.principal_id,
    locationID: row.location_id,
    operation: row.operation,
    key: SelfImprovementLearning.IdempotencyKey.make(row.key),
  }),
  requestDigest: row.request_digest,
  storedBodyDigest: row.body_digest,
  storedResponse: decodeStoredResponse(row.body_json),
  createdAt: row.created_at,
  expiresAt: row.expires_at,
})

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const db = (yield* Database.Service).db

    const put = Effect.fn("SelfImprovementIdempotencyStore.put")(function* (
      input: {
        readonly locationID: SelfImprovementLifecycle.LocationID
        readonly record: SelfImprovementApi.IdempotencyRecord
      },
      tx?: Transaction,
    ) {
      if (input.locationID !== input.record.identity.locationID)
        return yield* new InvalidInput({ message: "Idempotency record Location does not match input Location" })

      const values = {
        id: input.record.id,
        principal_id: input.record.identity.principalID,
        location_id: input.record.identity.locationID,
        operation: input.record.identity.operation,
        key: input.record.identity.key,
        request_digest: input.record.requestDigest,
        status: input.record.storedResponse.status,
        body_digest: input.record.storedBodyDigest,
        body_json: encodeStoredResponse(input.record.storedResponse),
        created_at: input.record.createdAt,
        expires_at: input.record.expiresAt,
      }
      const stored = yield* (tx ?? db)
        .insert(SelfImprovementIdempotencyTable)
        .values(values)
        .onConflictDoNothing()
        .returning({ id: SelfImprovementIdempotencyTable.id })
        .get()
        .pipe(Effect.orDie)
      if (stored === undefined) return yield* new Conflict({ message: "Idempotency record already exists" })
      return undefined
    })

    const get = Effect.fn("SelfImprovementIdempotencyStore.get")(function* (input: {
      readonly locationID: SelfImprovementLifecycle.LocationID
      readonly identity: SelfImprovementLearning.IdempotencyIdentity
    }) {
      if (input.locationID !== input.identity.locationID) return undefined
      const row = yield* db
        .select()
        .from(SelfImprovementIdempotencyTable)
        .where(
          and(
            eq(SelfImprovementIdempotencyTable.principal_id, input.identity.principalID),
            eq(SelfImprovementIdempotencyTable.location_id, input.locationID),
            eq(SelfImprovementIdempotencyTable.operation, input.identity.operation),
            eq(SelfImprovementIdempotencyTable.key, input.identity.key),
          ),
        )
        .get()
        .pipe(Effect.orDie)
      return row === undefined ? undefined : fromRow(row)
    })

    const valid = Effect.fn("SelfImprovementIdempotencyStore.valid")(function* (
      input: {
        readonly locationID: SelfImprovementLifecycle.LocationID
        readonly recordID: SelfImprovementLifecycle.IdempotencyRecordID
        readonly requestDigest: SelfImprovement.Digest
      },
      tx: Transaction,
    ) {
      const row = yield* tx
        .select({ id: SelfImprovementIdempotencyTable.id })
        .from(SelfImprovementIdempotencyTable)
        .where(
          and(
            eq(SelfImprovementIdempotencyTable.id, input.recordID),
            eq(SelfImprovementIdempotencyTable.location_id, input.locationID),
            eq(SelfImprovementIdempotencyTable.request_digest, input.requestDigest),
          ),
        )
        .get()
        .pipe(Effect.orDie)
      return row !== undefined
    })

    const listExpired = Effect.fn("SelfImprovementIdempotencyStore.listExpired")(function* (input: {
      readonly locationID: SelfImprovementLifecycle.LocationID
      readonly now: SelfImprovementLifecycle.TimestampMillis
    }) {
      const rows = yield* db
        .select()
        .from(SelfImprovementIdempotencyTable)
        .where(
          and(
            eq(SelfImprovementIdempotencyTable.location_id, input.locationID),
            lte(SelfImprovementIdempotencyTable.expires_at, input.now),
          ),
        )
        .orderBy(asc(SelfImprovementIdempotencyTable.expires_at), asc(SelfImprovementIdempotencyTable.id))
        .all()
        .pipe(Effect.orDie)
      return rows.map(fromRow)
    })

    return Service.of({ put, get, valid, listExpired })
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [Database.node] })
