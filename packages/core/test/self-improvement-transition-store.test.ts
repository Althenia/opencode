import { expect, test } from "bun:test"
import { SqliteClient } from "@effect/sql-sqlite-bun"
import { EffectDrizzleSqlite } from "@opencode-ai/effect-drizzle-sqlite"
import { SelfImprovement, SelfImprovementLifecycle } from "@opencode-ai/schema"
import { Database } from "@opencode-ai/core/database/database"
import { SelfImprovementTransitionStore } from "@opencode-ai/core/self-improvement/transition-store"
import { Effect, Layer } from "effect"
import { sql } from "drizzle-orm"

const makeDb = EffectDrizzleSqlite.makeWithDefaults()
const locationID = SelfImprovementLifecycle.LocationID.make("a".repeat(64))
const otherLocationID = SelfImprovementLifecycle.LocationID.make("b".repeat(64))
const versionID = SelfImprovementLifecycle.ArtifactVersionID.make("si_ver_1")

const transition = (id: string, timestamp: number) =>
  new SelfImprovementLifecycle.StageTransition({
    id: SelfImprovementLifecycle.StageTransitionID.make(id),
    versionID,
    previousStage: timestamp === 1 ? null : "draft",
    nextStage: timestamp === 1 ? "draft" : "experimental",
    event: timestamp === 1 ? "version-admitted" : "static-passed",
    reason: timestamp === 1 ? "admission-accepted" : "gates-passed",
    actorID: SelfImprovementLifecycle.PrincipalID.make("owner"),
    timestamp: SelfImprovementLifecycle.TimestampMillis.make(timestamp),
    evaluationRunID: SelfImprovementLifecycle.EvaluationRunID.make("si_run_1"),
    approvalID: SelfImprovementLifecycle.ApprovalID.make("si_app_1"),
    rollbackID: SelfImprovementLifecycle.RollbackID.make("si_rol_1"),
    contextOutboxID: SelfImprovementLifecycle.ContextOutboxID.make("si_obx_1"),
    idempotencyRecordID: SelfImprovementLifecycle.IdempotencyRecordID.make("si_idm_1"),
    idempotencyDigest: SelfImprovement.Digest.make("1".repeat(64)),
  })

const setup = Effect.gen(function* () {
  const db = yield* makeDb
  yield* db.run(sql`
    CREATE TABLE self_improvement_artifact (
      id TEXT PRIMARY KEY,
      location_id TEXT NOT NULL
    )
  `)
  yield* db.run(sql`
    CREATE TABLE self_improvement_artifact_version (
      id TEXT PRIMARY KEY,
      artifact_id TEXT NOT NULL
    )
  `)
  yield* db.run(sql`
    CREATE TABLE self_improvement_stage_transition (
      id TEXT PRIMARY KEY,
      version_id TEXT NOT NULL,
      previous_stage TEXT,
      next_stage TEXT NOT NULL,
      event TEXT NOT NULL,
      reason TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      evaluation_run_id TEXT,
      approval_id TEXT,
      rollback_id TEXT,
      context_outbox_id TEXT,
      idempotency_record_id TEXT,
      idempotency_digest TEXT NOT NULL
    )
  `)
  yield* db.run(sql`
    INSERT INTO self_improvement_artifact (id, location_id) VALUES ('si_art_1', ${locationID})
  `)
  yield* db.run(sql`
    INSERT INTO self_improvement_artifact_version (id, artifact_id) VALUES (${versionID}, 'si_art_1')
  `)
  return yield* SelfImprovementTransitionStore.Service.use((store) =>
    Effect.gen(function* () {
      const wrongLocation = yield* store
        .append({ locationID: otherLocationID, transition: transition("si_trn_wrong", 0) })
        .pipe(Effect.flip)
      expect(wrongLocation._tag).toBe("SelfImprovementTransitionStore.InvalidInput")

      yield* store.append({ locationID, transition: transition("si_trn_b", 2) })
      yield* store.append({ locationID, transition: transition("si_trn_a", 1) })
      yield* store.append({ locationID, transition: transition("si_trn_c", 1) })

      expect(yield* store.listByVersion({ locationID: otherLocationID, versionID })).toEqual([])
      expect(yield* store.listByVersion({ locationID, versionID })).toEqual([
        transition("si_trn_a", 1),
        transition("si_trn_c", 1),
        transition("si_trn_b", 2),
      ])
    }),
  ).pipe(Effect.provide(SelfImprovementTransitionStore.layer), Effect.provide(Layer.succeed(Database.Service, { db })))
})

test("stores location-scoped immutable stage transitions in timestamp and ID order", async () => {
  await Effect.runPromise(
    setup.pipe(Effect.provide(SqliteClient.layer({ filename: ":memory:", disableWAL: true })), Effect.scoped),
  )
})
