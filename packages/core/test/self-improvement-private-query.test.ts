import { expect, test } from "bun:test"
import { SqliteClient } from "@effect/sql-sqlite-bun"
import { EffectDrizzleSqlite } from "@opencode-ai/effect-drizzle-sqlite"
import { SelfImprovement, SelfImprovementLearning, SelfImprovementLifecycle } from "@opencode-ai/schema"
import { Database } from "@opencode-ai/core/database/database"
import { SelfImprovementAuditStore } from "@opencode-ai/core/self-improvement/audit-store"
import { SelfImprovementPrivateQuery } from "@opencode-ai/core/self-improvement/private-query"
import { Effect, Layer } from "effect"
import { sql } from "drizzle-orm"

const makeDb = EffectDrizzleSqlite.makeWithDefaults()
const locationID = SelfImprovementLifecycle.LocationID.make("a".repeat(64))
const otherLocationID = SelfImprovementLifecycle.LocationID.make("b".repeat(64))

const setup = Effect.gen(function* () {
  const db = yield* makeDb
  yield* db.run(
    sql`CREATE TABLE self_improvement_artifact (id TEXT PRIMARY KEY, location_id TEXT NOT NULL, kind TEXT NOT NULL, name TEXT NOT NULL, status TEXT NOT NULL, created_by TEXT NOT NULL, created_at INTEGER NOT NULL, revision INTEGER NOT NULL, tombstone_actor_id TEXT, tombstone_reason TEXT, tombstone_at INTEGER)`,
  )
  yield* db.run(
    sql`CREATE TABLE self_improvement_artifact_version (id TEXT PRIMARY KEY, artifact_id TEXT NOT NULL, version_number INTEGER NOT NULL, source TEXT NOT NULL, behavior_class TEXT NOT NULL, proposal_json TEXT NOT NULL, canonical_json TEXT NOT NULL, proposal_digest TEXT NOT NULL, input_snapshot_digest TEXT NOT NULL, version_digest TEXT NOT NULL, capability_manifest_json TEXT NOT NULL, capability_manifest_digest TEXT NOT NULL, creator_id TEXT NOT NULL, created_at INTEGER NOT NULL, generation_lease_id TEXT, strategy_pull_id TEXT, originating_task_id_digest TEXT, model_request_digest TEXT, model_output_digest TEXT, retention_deadline INTEGER)`,
  )
  yield* db.run(
    sql`CREATE TABLE self_improvement_artifact_slot (location_id TEXT NOT NULL, artifact_id TEXT NOT NULL, slot TEXT NOT NULL, version_id TEXT NOT NULL, artifact_revision INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
  )
  yield* db.run(
    sql`CREATE TABLE self_improvement_stage_transition (id TEXT PRIMARY KEY, version_id TEXT NOT NULL, previous_stage TEXT, next_stage TEXT NOT NULL, event TEXT NOT NULL, reason TEXT NOT NULL, actor_id TEXT NOT NULL, timestamp INTEGER NOT NULL, evaluation_run_id TEXT, approval_id TEXT, rollback_id TEXT, context_outbox_id TEXT, idempotency_record_id TEXT, idempotency_digest TEXT NOT NULL)`,
  )
  yield* db.run(
    sql`CREATE TABLE self_improvement_audit_entry (id TEXT PRIMARY KEY, location_id TEXT NOT NULL, event_type TEXT NOT NULL, actor_id TEXT NOT NULL, payload_json TEXT NOT NULL, timestamp INTEGER NOT NULL, retention_tag TEXT NOT NULL, retention_created_at INTEGER NOT NULL, retention_expires_at INTEGER)`,
  )
  yield* db.run(
    sql`CREATE TABLE self_improvement_approval_request (id TEXT PRIMARY KEY, location_id TEXT NOT NULL, version_id TEXT NOT NULL, version_digest TEXT NOT NULL, suite_id TEXT NOT NULL, suite_revision INTEGER NOT NULL, evaluation_run_id TEXT NOT NULL, shadow_evidence_digest TEXT NOT NULL, creator_id TEXT NOT NULL, requested_at INTEGER NOT NULL, shadow_evidence_expires_at INTEGER NOT NULL)`,
  )
  yield* db.run(
    sql`INSERT INTO self_improvement_artifact VALUES ('si_art_1', ${locationID}, 'skill', 'alpha', 'live', 'owner', 1, 0, NULL, NULL, NULL), ('si_art_2', ${locationID}, 'skill', 'beta', 'live', 'owner', 2, 0, NULL, NULL, NULL), ('si_art_3', ${otherLocationID}, 'skill', 'aardvark', 'live', 'owner', 3, 0, NULL, NULL, NULL)`,
  )
  return yield* SelfImprovementPrivateQuery.Service.use((query) =>
    Effect.gen(function* () {
      const first = yield* query.listArtifacts({ locationID, limit: 1 })
      expect(first.items.map((artifact) => artifact.id)).toEqual([SelfImprovementLifecycle.ArtifactID.make("si_art_1")])
      expect(first.nextCursor).toEqual([first.items[0].key.kind, first.items[0].key.name, first.items[0].id])
      if (first.nextCursor === undefined) throw new Error("Expected artifact cursor")
      expect(
        (yield* query.listArtifacts({ locationID, limit: 10, cursor: first.nextCursor })).items.map(
          (artifact) => artifact.id,
        ),
      ).toEqual([SelfImprovementLifecycle.ArtifactID.make("si_art_2")])
      expect(
        (yield* query.listArtifacts({ locationID: otherLocationID, limit: 10 })).items.map((artifact) => artifact.id),
      ).toEqual([SelfImprovementLifecycle.ArtifactID.make("si_art_3")])
      expect(
        yield* query.listVersions({
          locationID: otherLocationID,
          artifactID: SelfImprovementLifecycle.ArtifactID.make("si_art_1"),
          limit: 10,
        }),
      ).toEqual({ items: [] })

      const entry = new SelfImprovementLearning.AuditEntry({
        id: SelfImprovementLifecycle.AuditEntryID.make("si_aud_access"),
        locationID,
        eventType: "access.read",
        actorID: SelfImprovementLifecycle.PrincipalID.make("reader"),
        payload: new SelfImprovementLearning.AuditPayload({
          artifactID: SelfImprovementLifecycle.ArtifactID.make("si_art_1"),
          linkedDigests: [SelfImprovement.Digest.make("1".repeat(64))],
          rejectedFieldNames: [],
        }),
        timestamp: SelfImprovementLifecycle.TimestampMillis.make(4),
        retention: new SelfImprovementLearning.EvidenceRetention({
          createdAt: SelfImprovementLifecycle.TimestampMillis.make(4),
          expiresAt: SelfImprovementLifecycle.TimestampMillis.make(180 * 86_400_000 + 4),
        }),
      })
      yield* query.appendAuditAccess({ locationID, entry })
      expect((yield* query.listAudit({ locationID, limit: 10 })).items).toEqual([entry])
      expect(
        yield* query.getApprovalRequest({
          locationID,
          requestID: SelfImprovementLifecycle.ApprovalRequestID.make("si_apr_missing"),
        }),
      ).toBeUndefined()
    }),
  ).pipe(
    Effect.provide(SelfImprovementPrivateQuery.layer),
    Effect.provide(SelfImprovementAuditStore.layer),
    Effect.provide(Layer.succeed(Database.Service, { db })),
  )
})

test("queries location-scoped pages and writes audit access", async () => {
  await Effect.runPromise(
    setup.pipe(Effect.provide(SqliteClient.layer({ filename: ":memory:", disableWAL: true })), Effect.scoped),
  )
})
