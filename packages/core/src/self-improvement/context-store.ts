export * as SelfImprovementContextStore from "./context-store"

import { and, asc, eq, inArray, lte, sql } from "drizzle-orm"
import { Context, Effect, Layer, Schema } from "effect"
import { SelfImprovement, SelfImprovementLearning, SelfImprovementLifecycle } from "@opencode-ai/schema"
import type { EffectDrizzleSqlite } from "@opencode-ai/effect-drizzle-sqlite"
import { Database } from "../database/database"
import { makeLocationNode } from "../effect/app-node"
import { SelfImprovementContextDesiredStateTable, SelfImprovementContextOutboxTable } from "./context.sql"

type DatabaseClient = EffectDrizzleSqlite.EffectSQLiteDatabase
export type Transaction = Parameters<Parameters<DatabaseClient["transaction"]>[0]>[0]

const PendingTransitionIntentJson = Schema.fromJsonString(SelfImprovementLearning.PendingTransitionIntent)
const encodeIntent = Schema.encodeSync(PendingTransitionIntentJson)
const decodeIntent = Schema.decodeUnknownSync(PendingTransitionIntentJson)
const TerminalGroupJson = Schema.fromJsonString(SelfImprovementLearning.TerminalGroup)
const encodeTerminalGroup = Schema.encodeSync(TerminalGroupJson)

export class Conflict extends Schema.TaggedErrorClass<Conflict>()("SelfImprovementContextStore.Conflict", {
  message: Schema.String,
}) {}

export interface Interface {
  readonly request: (
    desired: SelfImprovementLearning.ContextDesiredState,
    outbox: SelfImprovementLearning.ContextOutbox,
    tx?: Transaction,
  ) => Effect.Effect<void, Conflict>
  readonly pending: (
    at: SelfImprovementLifecycle.TimestampMillis,
  ) => Effect.Effect<ReadonlyArray<SelfImprovementLearning.ContextOutbox>>
  readonly recoverable: (
    at: SelfImprovementLifecycle.TimestampMillis,
    tx?: Transaction,
  ) => Effect.Effect<ReadonlyArray<SelfImprovementLearning.ContextOutbox>>
  readonly desired: (
    input: {
      readonly locationID: SelfImprovementLifecycle.LocationID
      readonly artifactID: SelfImprovementLifecycle.ArtifactID
      readonly rolloutSlot: "shadow" | "canary" | "active"
    },
    tx?: Transaction,
  ) => Effect.Effect<SelfImprovementLearning.ContextDesiredState | undefined>
  readonly markApplying: (outboxID: SelfImprovementLifecycle.ContextOutboxID) => Effect.Effect<boolean>
  readonly markApplied: (
    outboxID: SelfImprovementLifecycle.ContextOutboxID,
    casResultDigest: SelfImprovement.Digest,
    tx?: Transaction,
  ) => Effect.Effect<boolean>
  readonly markBlocked: (outboxID: SelfImprovementLifecycle.ContextOutboxID, tx?: Transaction) => Effect.Effect<boolean>
  readonly reschedule: (
    outboxID: SelfImprovementLifecycle.ContextOutboxID,
    nextRetryAt: SelfImprovementLifecycle.TimestampMillis,
  ) => Effect.Effect<boolean>
  readonly supersede: (outboxID: SelfImprovementLifecycle.ContextOutboxID, tx?: Transaction) => Effect.Effect<boolean>
  readonly supersedeForArtifact: (
    input: {
      readonly locationID: SelfImprovementLifecycle.LocationID
      readonly artifactID: SelfImprovementLifecycle.ArtifactID
    },
    tx: Transaction,
  ) => Effect.Effect<void>
  readonly terminalGroup: (
    outbox: SelfImprovementLearning.ContextOutbox,
    tx: Transaction,
  ) => Effect.Effect<ReadonlyArray<SelfImprovementLearning.ContextOutbox> | undefined>
  readonly hasBlockedForArtifact: (
    input: {
      readonly locationID: SelfImprovementLifecycle.LocationID
      readonly artifactID: SelfImprovementLifecycle.ArtifactID
    },
    tx?: Transaction,
  ) => Effect.Effect<boolean>
  readonly blockedForArtifact: (
    input: {
      readonly locationID: SelfImprovementLifecycle.LocationID
      readonly artifactID: SelfImprovementLifecycle.ArtifactID
    },
    tx: Transaction,
  ) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SelfImprovementContextStore") {}

const fromOutboxRow = (row: typeof SelfImprovementContextOutboxTable.$inferSelect) =>
  new SelfImprovementLearning.ContextOutbox({
    id: row.id,
    locationID: row.location_id,
    artifactID: row.artifact_id,
    expectedArtifactRevision: row.expected_artifact_revision,
    expectedStage: row.expected_stage,
    desiredStateRevision: row.desired_state_revision,
    intent: decodeIntent(row.intent_json),
    status: row.status,
    attempts: row.attempts,
    nextRetryAt: row.next_retry_at,
    ...(row.cas_result_digest === null ? {} : { casResultDigest: row.cas_result_digest }),
    createdAt: row.created_at,
  })

const fromDesiredStateRow = (row: typeof SelfImprovementContextDesiredStateTable.$inferSelect) => {
  if (row.desired_state === "absent")
    return new SelfImprovementLearning.ContextDesiredState({
      locationID: row.location_id,
      artifactID: row.artifact_id,
      rolloutSlot: row.rollout_slot,
      desired: { state: "absent" },
      desiredRevision: row.desired_revision,
    })
  if (row.version_id === null || row.version_digest === null) throw new Error("Invalid desired context state row")
  return new SelfImprovementLearning.ContextDesiredState({
    locationID: row.location_id,
    artifactID: row.artifact_id,
    rolloutSlot: row.rollout_slot,
    desired: {
      state: "present",
      versionID: row.version_id,
      versionDigest: row.version_digest,
      stage: row.rollout_slot,
    },
    desiredRevision: row.desired_revision,
  })
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const db = (yield* Database.Service).db

    const request = Effect.fn("SelfImprovementContextStore.request")(function* (
      desired: SelfImprovementLearning.ContextDesiredState,
      outbox: SelfImprovementLearning.ContextOutbox,
      tx?: Transaction,
    ) {
      if (
        desired.locationID !== outbox.locationID ||
        desired.artifactID !== outbox.artifactID ||
        desired.desiredRevision !== outbox.desiredStateRevision
      )
        return yield* new Conflict({ message: "Context desired state does not match outbox" })

      const insert = (client: Transaction) =>
        Effect.gen(function* () {
          const desiredState = desired.desired.state === "present" ? desired.desired : undefined
          yield* client
            .insert(SelfImprovementContextDesiredStateTable)
            .values({
              location_id: desired.locationID,
              artifact_id: desired.artifactID,
              rollout_slot: desired.rolloutSlot,
              desired_state: desired.desired.state,
              version_id: desiredState?.versionID ?? null,
              version_digest: desiredState?.versionDigest ?? null,
              desired_revision: desired.desiredRevision,
            })
            .onConflictDoUpdate({
              target: [
                SelfImprovementContextDesiredStateTable.location_id,
                SelfImprovementContextDesiredStateTable.artifact_id,
                SelfImprovementContextDesiredStateTable.rollout_slot,
              ],
              set: {
                desired_state: desired.desired.state,
                version_id: desiredState?.versionID ?? null,
                version_digest: desiredState?.versionDigest ?? null,
                desired_revision: desired.desiredRevision,
              },
            })
            .run()
            .pipe(Effect.orDie)
          const inserted = yield* client
            .insert(SelfImprovementContextOutboxTable)
            .values({
              id: outbox.id,
              location_id: outbox.locationID,
              artifact_id: outbox.artifactID,
              expected_artifact_revision: outbox.expectedArtifactRevision,
              expected_stage: outbox.expectedStage,
              desired_state_revision: outbox.desiredStateRevision,
              intent_json: encodeIntent(outbox.intent),
              status: outbox.status,
              attempts: outbox.attempts,
              next_retry_at: outbox.nextRetryAt,
              cas_result_digest: outbox.casResultDigest ?? null,
              created_at: outbox.createdAt,
            })
            .onConflictDoNothing()
            .returning({ id: SelfImprovementContextOutboxTable.id })
            .get()
            .pipe(Effect.orDie)
          if (inserted === undefined) return yield* new Conflict({ message: "Context outbox already exists" })
          return undefined
        })

      if (tx) return yield* insert(tx)
      return yield* db.transaction(insert).pipe(Effect.catchTag("SqlError", Effect.die))
    })

    const pending = Effect.fn("SelfImprovementContextStore.pending")(function* (
      at: SelfImprovementLifecycle.TimestampMillis,
    ) {
      const rows = yield* db
        .select()
        .from(SelfImprovementContextOutboxTable)
        .where(
          and(
            eq(SelfImprovementContextOutboxTable.status, "pending"),
            lte(SelfImprovementContextOutboxTable.next_retry_at, at),
          ),
        )
        .orderBy(asc(SelfImprovementContextOutboxTable.next_retry_at), asc(SelfImprovementContextOutboxTable.id))
        .all()
        .pipe(Effect.orDie)
      return rows.map(fromOutboxRow)
    })

    const recoverable = Effect.fn("SelfImprovementContextStore.recoverable")(function* (
      at: SelfImprovementLifecycle.TimestampMillis,
      tx?: Transaction,
    ) {
      const client = tx ?? db
      const rows = yield* client
        .select()
        .from(SelfImprovementContextOutboxTable)
        .where(
          and(
            inArray(SelfImprovementContextOutboxTable.status, ["pending", "applying"]),
            lte(SelfImprovementContextOutboxTable.next_retry_at, at),
          ),
        )
        .orderBy(asc(SelfImprovementContextOutboxTable.next_retry_at), asc(SelfImprovementContextOutboxTable.id))
        .all()
        .pipe(Effect.orDie)
      return rows.map(fromOutboxRow)
    })

    const desired = Effect.fn("SelfImprovementContextStore.desired")(function* (
      input: {
        readonly locationID: SelfImprovementLifecycle.LocationID
        readonly artifactID: SelfImprovementLifecycle.ArtifactID
        readonly rolloutSlot: "shadow" | "canary" | "active"
      },
      tx?: Transaction,
    ) {
      const client = tx ?? db
      const row = yield* client
        .select()
        .from(SelfImprovementContextDesiredStateTable)
        .where(
          and(
            eq(SelfImprovementContextDesiredStateTable.location_id, input.locationID),
            eq(SelfImprovementContextDesiredStateTable.artifact_id, input.artifactID),
            eq(SelfImprovementContextDesiredStateTable.rollout_slot, input.rolloutSlot),
          ),
        )
        .get()
        .pipe(Effect.orDie)
      return row === undefined ? undefined : fromDesiredStateRow(row)
    })

    const markApplying = Effect.fn("SelfImprovementContextStore.markApplying")(function* (
      outboxID: SelfImprovementLifecycle.ContextOutboxID,
    ) {
      const updated = yield* db
        .update(SelfImprovementContextOutboxTable)
        .set({ status: "applying" })
        .where(
          and(
            eq(SelfImprovementContextOutboxTable.id, outboxID),
            eq(SelfImprovementContextOutboxTable.status, "pending"),
          ),
        )
        .returning({ id: SelfImprovementContextOutboxTable.id })
        .get()
        .pipe(Effect.orDie)
      return updated !== undefined
    })

    const markApplied = Effect.fn("SelfImprovementContextStore.markApplied")(function* (
      outboxID: SelfImprovementLifecycle.ContextOutboxID,
      casResultDigest: SelfImprovement.Digest,
      tx?: Transaction,
    ) {
      const apply = (client: Transaction | DatabaseClient) =>
        client
          .update(SelfImprovementContextOutboxTable)
          .set({ status: "applied", cas_result_digest: casResultDigest })
          .where(
            and(
              eq(SelfImprovementContextOutboxTable.id, outboxID),
              eq(SelfImprovementContextOutboxTable.status, "applying"),
            ),
          )
          .returning({ id: SelfImprovementContextOutboxTable.id })
          .get()
          .pipe(
            Effect.map((updated) => updated !== undefined),
            Effect.orDie,
          )
      if (tx) return yield* apply(tx)
      return yield* apply(db)
    })

    const markBlocked = Effect.fn("SelfImprovementContextStore.markBlocked")(function* (
      outboxID: SelfImprovementLifecycle.ContextOutboxID,
      tx?: Transaction,
    ) {
      const update = (client: Transaction | DatabaseClient) =>
        client
          .update(SelfImprovementContextOutboxTable)
          .set({ status: "blocked" })
          .where(
            and(
              eq(SelfImprovementContextOutboxTable.id, outboxID),
              inArray(SelfImprovementContextOutboxTable.status, ["pending", "applying"]),
            ),
          )
          .returning({ id: SelfImprovementContextOutboxTable.id })
          .get()
          .pipe(
            Effect.map((updated) => updated !== undefined),
            Effect.orDie,
          )
      if (tx) return yield* update(tx)
      return yield* update(db)
    })

    const reschedule = Effect.fn("SelfImprovementContextStore.reschedule")(function* (
      outboxID: SelfImprovementLifecycle.ContextOutboxID,
      nextRetryAt: SelfImprovementLifecycle.TimestampMillis,
    ) {
      const updated = yield* db
        .update(SelfImprovementContextOutboxTable)
        .set({
          status: "pending",
          attempts: sql`${SelfImprovementContextOutboxTable.attempts} + 1`,
          next_retry_at: nextRetryAt,
        })
        .where(
          and(
            eq(SelfImprovementContextOutboxTable.id, outboxID),
            inArray(SelfImprovementContextOutboxTable.status, ["pending", "applying"]),
          ),
        )
        .returning({ id: SelfImprovementContextOutboxTable.id })
        .get()
        .pipe(Effect.orDie)
      return updated !== undefined
    })

    const supersede = Effect.fn("SelfImprovementContextStore.supersede")(function* (
      outboxID: SelfImprovementLifecycle.ContextOutboxID,
      tx?: Transaction,
    ) {
      const update = (client: Transaction | DatabaseClient) =>
        client
          .update(SelfImprovementContextOutboxTable)
          .set({ status: "superseded" })
          .where(
            and(
              eq(SelfImprovementContextOutboxTable.id, outboxID),
              inArray(SelfImprovementContextOutboxTable.status, ["pending", "applying"]),
            ),
          )
          .returning({ id: SelfImprovementContextOutboxTable.id })
          .get()
          .pipe(
            Effect.map((updated) => updated !== undefined),
            Effect.orDie,
          )
      if (tx) return yield* update(tx)
      return yield* update(db)
    })

    const supersedeForArtifact = Effect.fn("SelfImprovementContextStore.supersedeForArtifact")(function* (
      input: {
        readonly locationID: SelfImprovementLifecycle.LocationID
        readonly artifactID: SelfImprovementLifecycle.ArtifactID
      },
      tx: Transaction,
    ) {
      yield* tx
        .update(SelfImprovementContextOutboxTable)
        .set({ status: "superseded" })
        .where(
          and(
            eq(SelfImprovementContextOutboxTable.location_id, input.locationID),
            eq(SelfImprovementContextOutboxTable.artifact_id, input.artifactID),
            inArray(SelfImprovementContextOutboxTable.status, ["pending", "applying", "blocked"]),
          ),
        )
        .run()
        .pipe(Effect.orDie)
    })

    const terminalGroup = Effect.fn("SelfImprovementContextStore.terminalGroup")(function* (
      outbox: SelfImprovementLearning.ContextOutbox,
      tx: Transaction,
    ) {
      const group = outbox.intent.terminalGroup
      if (group === undefined) return undefined
      if (!group.removalOutboxIDs.includes(outbox.id)) return undefined
      const plan = encodeTerminalGroup(group)
      const rows = yield* tx
        .select()
        .from(SelfImprovementContextOutboxTable)
        .where(inArray(SelfImprovementContextOutboxTable.id, group.removalOutboxIDs))
        .all()
        .pipe(Effect.orDie)
      if (rows.length !== group.removalOutboxIDs.length) return undefined
      const peers = new Map(rows.map((row) => [row.id, fromOutboxRow(row)]))
      const ordered = group.removalOutboxIDs.map((id) => peers.get(id))
      if (ordered.some((peer) => peer === undefined)) return undefined
      const resolved = ordered.filter((peer) => peer !== undefined)
      if (
        !resolved.every(
          (peer) =>
            peer.locationID === outbox.locationID &&
            peer.artifactID === outbox.artifactID &&
            peer.intent.idempotencyRecordID === outbox.intent.idempotencyRecordID &&
            peer.intent.idempotencyDigest === outbox.intent.idempotencyDigest &&
            peer.intent.terminalGroup !== undefined &&
            encodeTerminalGroup(peer.intent.terminalGroup) === plan,
        )
      )
        return undefined
      if (!resolved.every((peer) => (peer.id === outbox.id ? peer.status === "applying" : peer.status === "applied")))
        return undefined
      return resolved
    })

    const hasBlockedForArtifact = Effect.fn("SelfImprovementContextStore.hasBlockedForArtifact")(function* (
      input: {
        readonly locationID: SelfImprovementLifecycle.LocationID
        readonly artifactID: SelfImprovementLifecycle.ArtifactID
      },
      tx?: Transaction,
    ) {
      const blocked = yield* (tx ?? db)
        .select({ id: SelfImprovementContextOutboxTable.id })
        .from(SelfImprovementContextOutboxTable)
        .where(
          and(
            eq(SelfImprovementContextOutboxTable.location_id, input.locationID),
            eq(SelfImprovementContextOutboxTable.artifact_id, input.artifactID),
            eq(SelfImprovementContextOutboxTable.status, "blocked"),
          ),
        )
        .get()
        .pipe(Effect.orDie)
      return blocked !== undefined
    })

    const blockedForArtifact = Effect.fn("SelfImprovementContextStore.blockedForArtifact")(function* (
      input: {
        readonly locationID: SelfImprovementLifecycle.LocationID
        readonly artifactID: SelfImprovementLifecycle.ArtifactID
      },
      tx: Transaction,
    ) {
      yield* tx
        .update(SelfImprovementContextOutboxTable)
        .set({ status: "blocked" })
        .where(
          and(
            eq(SelfImprovementContextOutboxTable.location_id, input.locationID),
            eq(SelfImprovementContextOutboxTable.artifact_id, input.artifactID),
            inArray(SelfImprovementContextOutboxTable.status, ["pending", "applying"]),
          ),
        )
        .run()
        .pipe(Effect.orDie)
    })

    return Service.of({
      request,
      pending,
      recoverable,
      desired,
      markApplying,
      markApplied,
      markBlocked,
      reschedule,
      supersede,
      supersedeForArtifact,
      terminalGroup,
      hasBlockedForArtifact,
      blockedForArtifact,
    })
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [Database.node] })
