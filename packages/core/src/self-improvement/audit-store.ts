export * as SelfImprovementAuditStore from "./audit-store"

import { and, asc, eq, lte, sql } from "drizzle-orm"
import { Context, Effect, Layer, Schema } from "effect"
import { SelfImprovementLearning, SelfImprovementLifecycle } from "@opencode-ai/schema"
import type { EffectDrizzleSqlite } from "@opencode-ai/effect-drizzle-sqlite"
import { Database } from "../database/database"
import { makeLocationNode } from "../effect/app-node"
import { SelfImprovementAuditEntryTable } from "./audit.sql"

type DatabaseClient = EffectDrizzleSqlite.EffectSQLiteDatabase
export type Transaction = Parameters<Parameters<DatabaseClient["transaction"]>[0]>[0]

const AuditPayloadJson = Schema.fromJsonString(SelfImprovementLearning.AuditPayload)
const encodePayload = Schema.encodeSync(AuditPayloadJson)
const decodePayload = Schema.decodeUnknownSync(AuditPayloadJson)
const encodeRetention = Schema.encodeSync(SelfImprovementLearning.RetentionMetadata)
const decodeRetention = Schema.decodeUnknownSync(SelfImprovementLearning.RetentionMetadata)

export class InvalidInput extends Schema.TaggedErrorClass<InvalidInput>()("SelfImprovementAuditStore.InvalidInput", {
  message: Schema.String,
}) {}

export class Conflict extends Schema.TaggedErrorClass<Conflict>()("SelfImprovementAuditStore.Conflict", {
  message: Schema.String,
}) {}

export interface Interface {
  readonly append: (
    input: {
      readonly locationID: SelfImprovementLifecycle.LocationID
      readonly entry: SelfImprovementLearning.AuditEntry
    },
    tx?: Transaction,
  ) => Effect.Effect<void, InvalidInput | Conflict>
  readonly list: (input: {
    readonly locationID: SelfImprovementLifecycle.LocationID
    readonly eventType?: string
    readonly expiresAtOrBefore?: SelfImprovementLifecycle.TimestampMillis
  }) => Effect.Effect<ReadonlyArray<SelfImprovementLearning.AuditEntry>>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SelfImprovementAuditStore") {}

const fromRow = (row: typeof SelfImprovementAuditEntryTable.$inferSelect) =>
  new SelfImprovementLearning.AuditEntry({
    id: row.id,
    locationID: row.location_id,
    eventType: row.event_type,
    actorID: row.actor_id,
    payload: decodePayload(row.payload_json),
    timestamp: row.timestamp,
    retention: decodeRetention({
      _tag: row.retention_tag,
      createdAt: row.retention_created_at,
      ...(row.retention_expires_at === null ? {} : { expiresAt: row.retention_expires_at }),
    }),
  })

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const db = (yield* Database.Service).db

    const append = Effect.fn("SelfImprovementAuditStore.append")(function* (
      input: {
        readonly locationID: SelfImprovementLifecycle.LocationID
        readonly entry: SelfImprovementLearning.AuditEntry
      },
      tx?: Transaction,
    ) {
      if (input.locationID !== input.entry.locationID)
        return yield* new InvalidInput({ message: "Audit entry Location does not match input Location" })

      const retention = encodeRetention(input.entry.retention)
      const insert = (client: Transaction) =>
        Effect.gen(function* () {
          const entry = yield* client
            .get<{ id: SelfImprovementLifecycle.AuditEntryID }>(
              sql`
            INSERT INTO self_improvement_audit_entry (
              id,
              location_id,
              event_type,
              actor_id,
              payload_json,
              timestamp,
              retention_tag,
              retention_created_at,
              retention_expires_at
            ) VALUES (
              ${input.entry.id},
              ${input.entry.locationID},
              ${input.entry.eventType},
              ${input.entry.actorID},
              ${encodePayload(input.entry.payload)},
              ${input.entry.timestamp},
              ${retention._tag},
              ${retention.createdAt},
              ${retention._tag === "governed-metadata" ? null : retention.expiresAt}
            )
            ON CONFLICT DO NOTHING
            RETURNING id
          `,
            )
            .pipe(Effect.orDie)
          if (entry === undefined) return yield* new Conflict({ message: "Audit entry already exists" })
          return undefined
        })

      if (tx) return yield* insert(tx)
      return yield* db.transaction(insert).pipe(Effect.catchTag("SqlError", Effect.die))
    })

    const list = Effect.fn("SelfImprovementAuditStore.list")(function* (input: {
      readonly locationID: SelfImprovementLifecycle.LocationID
      readonly eventType?: string
      readonly expiresAtOrBefore?: SelfImprovementLifecycle.TimestampMillis
    }) {
      const rows = yield* db
        .select()
        .from(SelfImprovementAuditEntryTable)
        .where(
          and(
            eq(SelfImprovementAuditEntryTable.location_id, input.locationID),
            ...(input.eventType === undefined ? [] : [eq(SelfImprovementAuditEntryTable.event_type, input.eventType)]),
            ...(input.expiresAtOrBefore === undefined
              ? []
              : [lte(SelfImprovementAuditEntryTable.retention_expires_at, input.expiresAtOrBefore)]),
          ),
        )
        .orderBy(asc(SelfImprovementAuditEntryTable.timestamp), asc(SelfImprovementAuditEntryTable.id))
        .all()
        .pipe(Effect.orDie)
      return rows.map(fromRow)
    })

    return Service.of({ append, list })
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [Database.node] })
