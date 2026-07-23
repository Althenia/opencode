import { expect, test } from "bun:test"
import { SqliteClient } from "@effect/sql-sqlite-bun"
import { EffectDrizzleSqlite } from "@opencode-ai/effect-drizzle-sqlite"
import { Database } from "@opencode-ai/core/database/database"
import { Location } from "@opencode-ai/core/location"
import { SelfImprovementAuditStore } from "@opencode-ai/core/self-improvement/audit-store"
import { SelfImprovementContracts } from "@opencode-ai/core/self-improvement/contracts"
import { SelfImprovementRetention } from "@opencode-ai/core/self-improvement/retention"
import { AbsolutePath, SelfImprovementLifecycle } from "@opencode-ai/schema"
import { WorkspaceID } from "@opencode-ai/schema/workspace-id"
import { Effect, Layer } from "effect"
import { sql } from "drizzle-orm"
import { location as makeLocation } from "./fixture/location"

const DAY = 86_400_000
const now = SelfImprovementLifecycle.TimestampMillis.make(200 * DAY)
const locationRef = Location.Ref.make({ directory: AbsolutePath.make("/self-improvement-retention") })
const locationA = SelfImprovementContracts.locationID(locationRef)
const locationB = "b".repeat(64)
const makeDb = EffectDrizzleSqlite.makeWithDefaults()
const locationLayer = Layer.succeed(Location.Service, Location.Service.of(makeLocation(locationRef)))

test("uses one self-improvement scope across projects and workspaces", () => {
  expect(
    SelfImprovementContracts.locationID(
      Location.Ref.make({
        directory: AbsolutePath.make("/another-project"),
        workspaceID: WorkspaceID.create(),
      }),
    ),
  ).toBe(locationA)
})

const createTables = (db: Effect.Success<typeof makeDb>) =>
  Effect.gen(function* () {
    yield* db.run(
      sql`CREATE TABLE self_improvement_observation (id TEXT PRIMARY KEY, location_id TEXT NOT NULL, expires_at INTEGER NOT NULL)`,
    )
    yield* db.run(
      sql`CREATE TABLE self_improvement_generation_lease (id TEXT PRIMARY KEY, location_id TEXT NOT NULL, completed_at INTEGER, acquired_at INTEGER NOT NULL)`,
    )
    yield* db.run(
      sql`CREATE TABLE self_improvement_evaluation_sample (id TEXT PRIMARY KEY, location_id TEXT NOT NULL, expires_at INTEGER NOT NULL)`,
    )
    yield* db.run(
      sql`CREATE TABLE self_improvement_evaluation_decision (run_id TEXT PRIMARY KEY, location_id TEXT NOT NULL, expires_at INTEGER NOT NULL)`,
    )
    yield* db.run(
      sql`CREATE TABLE self_improvement_evaluation_finding (id TEXT PRIMARY KEY, location_id TEXT NOT NULL, expires_at INTEGER NOT NULL)`,
    )
    yield* db.run(
      sql`CREATE TABLE self_improvement_pull_event (id TEXT PRIMARY KEY, location_id TEXT NOT NULL, expires_at INTEGER NOT NULL)`,
    )
    yield* db.run(
      sql`CREATE TABLE self_improvement_reward_event (id TEXT PRIMARY KEY, location_id TEXT NOT NULL, pull_event_id TEXT NOT NULL REFERENCES self_improvement_pull_event(id), expires_at INTEGER NOT NULL)`,
    )
    yield* db.run(
      sql`CREATE TABLE self_improvement_routing_decision (id TEXT PRIMARY KEY, location_id TEXT NOT NULL, expires_at INTEGER NOT NULL)`,
    )
    yield* db.run(sql`CREATE TABLE self_improvement_context_outbox (id TEXT PRIMARY KEY, location_id TEXT NOT NULL)`)
    yield* db.run(
      sql`CREATE TABLE self_improvement_context_selection_evidence (id TEXT PRIMARY KEY, location_id TEXT NOT NULL, outbox_id TEXT NOT NULL REFERENCES self_improvement_context_outbox(id), expires_at INTEGER NOT NULL)`,
    )
    yield* db.run(
      sql`CREATE TABLE self_improvement_audit_entry (id TEXT PRIMARY KEY, location_id TEXT NOT NULL, event_type TEXT NOT NULL, actor_id TEXT NOT NULL, payload_json TEXT NOT NULL, timestamp INTEGER NOT NULL, retention_tag TEXT NOT NULL, retention_created_at INTEGER NOT NULL, retention_expires_at INTEGER)`,
    )
    yield* db.run(
      sql`CREATE TABLE self_improvement_idempotency (id TEXT PRIMARY KEY, location_id TEXT NOT NULL, expires_at INTEGER NOT NULL)`,
    )
    yield* db.run(
      sql`CREATE TABLE self_improvement_artifact (id TEXT PRIMARY KEY, location_id TEXT NOT NULL, status TEXT NOT NULL, tombstone_at INTEGER)`,
    )
    yield* db.run(
      sql`CREATE TABLE self_improvement_artifact_version (id TEXT PRIMARY KEY, artifact_id TEXT NOT NULL REFERENCES self_improvement_artifact(id), retention_deadline INTEGER)`,
    )
    yield* db.run(sql`PRAGMA foreign_keys = ON`)
  })

const seed = (db: Effect.Success<typeof makeDb>) =>
  Effect.gen(function* () {
    yield* db.run(
      sql`INSERT INTO self_improvement_observation VALUES ('ob-before', ${locationA}, ${now - 1}), ('ob-equal', ${locationA}, ${now}), ('ob-after', ${locationA}, ${now + 1}), ('ob-other', ${locationB}, ${now + 1}), ('ob-other-expired', ${locationB}, ${now - 1})`,
    )
    yield* db.run(
      sql`INSERT INTO self_improvement_generation_lease VALUES ('lease-before', ${locationA}, ${now - 30 * DAY - 1}, ${now - 30 * DAY - 1}), ('lease-equal', ${locationA}, ${now - 30 * DAY}, ${now - 30 * DAY}), ('lease-after', ${locationA}, ${now - 30 * DAY + 1}, ${now - 30 * DAY + 1}), ('lease-other', ${locationB}, ${now - 30 * DAY - 1}, ${now - 30 * DAY - 1})`,
    )
    yield* db.run(
      sql`INSERT INTO self_improvement_evaluation_sample VALUES ('sample-before', ${locationA}, ${now - 1}), ('sample-equal', ${locationA}, ${now}), ('sample-after', ${locationA}, ${now + 1}), ('sample-other', ${locationB}, ${now - 1})`,
    )
    yield* db.run(
      sql`INSERT INTO self_improvement_evaluation_decision VALUES ('decision-before', ${locationA}, ${now - 1}), ('decision-equal', ${locationA}, ${now}), ('decision-after', ${locationA}, ${now + 1}), ('decision-other', ${locationB}, ${now - 1})`,
    )
    yield* db.run(
      sql`INSERT INTO self_improvement_evaluation_finding VALUES ('finding-before', ${locationA}, ${now - 1}), ('finding-equal', ${locationA}, ${now}), ('finding-after', ${locationA}, ${now + 1}), ('finding-other', ${locationB}, ${now - 1})`,
    )
    yield* db.run(
      sql`INSERT INTO self_improvement_pull_event VALUES ('pull-before', ${locationA}, ${now - 1}), ('pull-equal', ${locationA}, ${now}), ('pull-after', ${locationA}, ${now + 1}), ('pull-other', ${locationB}, ${now - 1})`,
    )
    yield* db.run(
      sql`INSERT INTO self_improvement_reward_event VALUES ('reward-before', ${locationA}, 'pull-before', ${now - 1}), ('reward-equal', ${locationA}, 'pull-equal', ${now}), ('reward-after', ${locationA}, 'pull-after', ${now + 1}), ('reward-other', ${locationB}, 'pull-other', ${now - 1})`,
    )
    yield* db.run(
      sql`INSERT INTO self_improvement_routing_decision VALUES ('routing-before', ${locationA}, ${now - 1}), ('routing-equal', ${locationA}, ${now}), ('routing-after', ${locationA}, ${now + 1}), ('routing-other', ${locationB}, ${now - 1})`,
    )
    yield* db.run(
      sql`INSERT INTO self_improvement_context_outbox VALUES ('outbox-before', ${locationA}), ('outbox-equal', ${locationA}), ('outbox-after', ${locationA}), ('outbox-other', ${locationB})`,
    )
    yield* db.run(
      sql`INSERT INTO self_improvement_context_selection_evidence VALUES ('context-before', ${locationA}, 'outbox-before', ${now - 1}), ('context-equal', ${locationA}, 'outbox-equal', ${now}), ('context-after', ${locationA}, 'outbox-after', ${now + 1}), ('context-other', ${locationB}, 'outbox-other', ${now - 1})`,
    )
    yield* db.run(
      sql`INSERT INTO self_improvement_audit_entry VALUES ('audit-before', ${locationA}, 'event', 'actor', '{}', ${now - 1}, 'evidence-180d', 1, ${now - 1}), ('audit-equal', ${locationA}, 'event', 'actor', '{}', ${now}, 'evidence-180d', 1, ${now}), ('audit-after', ${locationA}, 'event', 'actor', '{}', ${now + 1}, 'evidence-180d', 1, ${now + 1}), ('audit-governed', ${locationA}, 'event', 'actor', '{}', ${now}, 'governed-metadata', 1, NULL), ('audit-other', ${locationB}, 'event', 'actor', '{}', ${now - 1}, 'evidence-180d', 1, ${now - 1})`,
    )
    yield* db.run(
      sql`INSERT INTO self_improvement_idempotency VALUES ('idempotency-before', ${locationA}, ${now - 1}), ('idempotency-equal', ${locationA}, ${now}), ('idempotency-after', ${locationA}, ${now + 1}), ('idempotency-other', ${locationB}, ${now - 1})`,
    )
    yield* db.run(sql`INSERT INTO self_improvement_artifact VALUES ('artifact', ${locationA}, 'tombstoned', 1)`)
    yield* db.run(sql`INSERT INTO self_improvement_artifact_version VALUES ('version', 'artifact', ${now - 1})`)
  })

const ids = (db: Effect.Success<typeof makeDb>, table: string) =>
  db
    .all<{ id: string }>(sql.raw(`SELECT id FROM ${table} ORDER BY id`))
    .pipe(Effect.map((rows) => rows.map((row) => row.id)))

test("purges expired self-improvement evidence at explicit deadlines without retaining sensitive material", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const db = (yield* Database.Service).db
      yield* createTables(db)
      yield* seed(db)
      const retention = yield* SelfImprovementRetention.Service

      expect(yield* retention.purgeExpired(now)).toEqual({ observations: 4, evidence: 18 })
      expect(yield* ids(db, "self_improvement_observation")).toEqual(["ob-after", "ob-other", "ob-other-expired"])
      expect(yield* ids(db, "self_improvement_generation_lease")).toEqual(["lease-after", "lease-other"])
      expect(yield* ids(db, "self_improvement_evaluation_sample")).toEqual(["sample-after", "sample-other"])
      expect(yield* ids(db, "self_improvement_reward_event")).toEqual(["reward-after", "reward-other"])
      expect(yield* ids(db, "self_improvement_pull_event")).toEqual(["pull-after", "pull-other"])
      expect(yield* ids(db, "self_improvement_context_selection_evidence")).toEqual(["context-after", "context-other"])
      expect(yield* ids(db, "self_improvement_idempotency")).toEqual(["idempotency-after", "idempotency-other"])
      expect(yield* ids(db, "self_improvement_audit_entry")).toEqual(
        expect.arrayContaining(["audit-after", "audit-governed", "audit-other"]),
      )
      const retentionAudit = yield* db.get<{ actor_id: string; payload_json: string }>(sql`
        SELECT actor_id, payload_json
        FROM self_improvement_audit_entry
        WHERE location_id = ${locationA} AND event_type = 'retention-purged'
      `)
      expect(retentionAudit?.actor_id).toBe("system-retention")
      expect(JSON.parse(retentionAudit?.payload_json ?? "{}")).toEqual({
        linkedDigests: [],
        rejectedFieldNames: [],
        retentionDeletionCounts: expect.arrayContaining([
          { category: "observations", count: 2 },
          { category: "generation", count: 2 },
          { category: "idempotency", count: 2 },
        ]),
      })
      expect(yield* ids(db, "self_improvement_artifact")).toEqual(["artifact"])
      expect(yield* ids(db, "self_improvement_artifact_version")).toEqual(["version"])

      const definitions = yield* db.all<{ sql: string }>(sql`SELECT sql FROM sqlite_master WHERE type = 'table'`)
      expect(
        definitions
          .map((row) => row.sql)
          .join(" ")
          .toLowerCase(),
      ).not.toContain("hmac")
      expect(
        definitions
          .map((row) => row.sql)
          .join(" ")
          .toLowerCase(),
      ).not.toContain("raw_")
      expect(yield* retention.purgeExpired(now)).toEqual({ observations: 0, evidence: 0 })
      expect(
        yield* db.all<{ id: string }>(sql`
          SELECT id FROM self_improvement_audit_entry
          WHERE location_id = ${locationA} AND event_type = 'retention-purged'
        `),
      ).toHaveLength(1)
    }).pipe(
      Effect.provide(SelfImprovementRetention.layer),
      Effect.provide(SelfImprovementAuditStore.layer),
      Effect.provide(locationLayer),
      Effect.provide(
        Layer.effect(
          Database.Service,
          Effect.map(makeDb, (db) => ({ db })),
        ),
      ),
      Effect.provide(SqliteClient.layer({ filename: ":memory:", disableWAL: true })),
      Effect.scoped,
    ),
  )
})

test("rolls back every retention deletion when one evidence delete fails", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const db = (yield* Database.Service).db
      yield* createTables(db)
      yield* seed(db)
      yield* db.run(sql`
        CREATE TRIGGER self_improvement_retention_failure
        BEFORE DELETE ON self_improvement_routing_decision
        WHEN OLD.id = 'routing-before'
        BEGIN SELECT RAISE(ABORT, 'rollback'); END
      `)
      const retention = yield* SelfImprovementRetention.Service

      expect((yield* retention.purgeExpired(now).pipe(Effect.exit))._tag).toBe("Failure")
      expect(yield* ids(db, "self_improvement_observation")).toEqual([
        "ob-after",
        "ob-before",
        "ob-equal",
        "ob-other",
        "ob-other-expired",
      ])
      expect(yield* ids(db, "self_improvement_reward_event")).toEqual([
        "reward-after",
        "reward-before",
        "reward-equal",
        "reward-other",
      ])
    }).pipe(
      Effect.provide(SelfImprovementRetention.layer),
      Effect.provide(SelfImprovementAuditStore.layer),
      Effect.provide(locationLayer),
      Effect.provide(
        Layer.effect(
          Database.Service,
          Effect.map(makeDb, (db) => ({ db })),
        ),
      ),
      Effect.provide(SqliteClient.layer({ filename: ":memory:", disableWAL: true })),
      Effect.scoped,
    ),
  )
})
