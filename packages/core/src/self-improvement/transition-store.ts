export * as SelfImprovementTransitionStore from "./transition-store"

import { and, asc, eq } from "drizzle-orm"
import { Context, Effect, Layer, Schema } from "effect"
import { SelfImprovementLifecycle } from "@opencode-ai/schema"
import type { EffectDrizzleSqlite } from "@opencode-ai/effect-drizzle-sqlite"
import { Database } from "../database/database"
import { SelfImprovementArtifactTable, SelfImprovementArtifactVersionTable } from "./artifact.sql"
import { SelfImprovementStageTransitionTable } from "./transition.sql"

type DatabaseClient = EffectDrizzleSqlite.EffectSQLiteDatabase
export type Transaction = Parameters<Parameters<DatabaseClient["transaction"]>[0]>[0]

export class InvalidInput extends Schema.TaggedErrorClass<InvalidInput>()(
  "SelfImprovementTransitionStore.InvalidInput",
  {
    message: Schema.String,
  },
) {}

export class Conflict extends Schema.TaggedErrorClass<Conflict>()("SelfImprovementTransitionStore.Conflict", {
  message: Schema.String,
}) {}

export interface Interface {
  readonly append: (
    input: {
      readonly locationID: SelfImprovementLifecycle.LocationID
      readonly transition: SelfImprovementLifecycle.StageTransition
    },
    tx?: Transaction,
  ) => Effect.Effect<void, InvalidInput | Conflict>
  readonly listByVersion: (input: {
    readonly locationID: SelfImprovementLifecycle.LocationID
    readonly versionID: SelfImprovementLifecycle.ArtifactVersionID
  }) => Effect.Effect<ReadonlyArray<SelfImprovementLifecycle.StageTransition>>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SelfImprovementTransitionStore") {}

const fromRow = (row: typeof SelfImprovementStageTransitionTable.$inferSelect) => {
  if (row.idempotency_record_id === null) throw new Error("Invalid stage transition row")
  return new SelfImprovementLifecycle.StageTransition({
    id: row.id,
    versionID: row.version_id,
    previousStage: row.previous_stage,
    nextStage: row.next_stage,
    event: row.event,
    reason: row.reason,
    actorID: row.actor_id,
    timestamp: row.timestamp,
    ...(row.evaluation_run_id === null ? {} : { evaluationRunID: row.evaluation_run_id }),
    ...(row.approval_id === null ? {} : { approvalID: row.approval_id }),
    ...(row.rollback_id === null ? {} : { rollbackID: row.rollback_id }),
    ...(row.context_outbox_id === null ? {} : { contextOutboxID: row.context_outbox_id }),
    idempotencyRecordID: row.idempotency_record_id,
    idempotencyDigest: row.idempotency_digest,
  })
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const db = (yield* Database.Service).db

    const append = Effect.fn("SelfImprovementTransitionStore.append")(function* (
      input: {
        readonly locationID: SelfImprovementLifecycle.LocationID
        readonly transition: SelfImprovementLifecycle.StageTransition
      },
      tx?: Transaction,
    ) {
      const insert = (client: Transaction) =>
        Effect.gen(function* () {
          const version = yield* client
            .select({ id: SelfImprovementArtifactVersionTable.id })
            .from(SelfImprovementArtifactVersionTable)
            .innerJoin(
              SelfImprovementArtifactTable,
              and(
                eq(SelfImprovementArtifactVersionTable.artifact_id, SelfImprovementArtifactTable.id),
                eq(SelfImprovementArtifactTable.location_id, input.locationID),
              ),
            )
            .where(eq(SelfImprovementArtifactVersionTable.id, input.transition.versionID))
            .get()
            .pipe(Effect.orDie)
          if (version === undefined)
            return yield* new InvalidInput({ message: "Artifact version does not belong to input Location" })

          const transition = yield* client
            .insert(SelfImprovementStageTransitionTable)
            .values({
              id: input.transition.id,
              version_id: input.transition.versionID,
              previous_stage: input.transition.previousStage,
              next_stage: input.transition.nextStage,
              event: input.transition.event,
              reason: input.transition.reason,
              actor_id: input.transition.actorID,
              timestamp: input.transition.timestamp,
              evaluation_run_id: input.transition.evaluationRunID ?? null,
              approval_id: input.transition.approvalID ?? null,
              rollback_id: input.transition.rollbackID ?? null,
              context_outbox_id: input.transition.contextOutboxID ?? null,
              idempotency_record_id: input.transition.idempotencyRecordID,
              idempotency_digest: input.transition.idempotencyDigest,
            })
            .onConflictDoNothing()
            .returning({ id: SelfImprovementStageTransitionTable.id })
            .get()
            .pipe(Effect.orDie)
          if (transition === undefined) return yield* new Conflict({ message: "Stage transition already exists" })
          return undefined
        })

      if (tx) return yield* insert(tx)
      return yield* db.transaction(insert).pipe(Effect.catchTag("SqlError", Effect.die))
    })

    const listByVersion = Effect.fn("SelfImprovementTransitionStore.listByVersion")(function* (input: {
      readonly locationID: SelfImprovementLifecycle.LocationID
      readonly versionID: SelfImprovementLifecycle.ArtifactVersionID
    }) {
      const rows = yield* db
        .select({ transition: SelfImprovementStageTransitionTable })
        .from(SelfImprovementStageTransitionTable)
        .innerJoin(
          SelfImprovementArtifactVersionTable,
          eq(SelfImprovementStageTransitionTable.version_id, SelfImprovementArtifactVersionTable.id),
        )
        .innerJoin(
          SelfImprovementArtifactTable,
          and(
            eq(SelfImprovementArtifactVersionTable.artifact_id, SelfImprovementArtifactTable.id),
            eq(SelfImprovementArtifactTable.location_id, input.locationID),
          ),
        )
        .where(eq(SelfImprovementStageTransitionTable.version_id, input.versionID))
        .orderBy(asc(SelfImprovementStageTransitionTable.timestamp), asc(SelfImprovementStageTransitionTable.id))
        .all()
        .pipe(Effect.orDie)
      return rows.map((row) => fromRow(row.transition))
    })

    return Service.of({ append, listByVersion })
  }),
)
