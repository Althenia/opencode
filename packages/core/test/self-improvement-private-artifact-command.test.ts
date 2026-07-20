import { expect, test } from "bun:test"
import { SqliteClient } from "@effect/sql-sqlite-bun"
import { EffectDrizzleSqlite } from "@opencode-ai/effect-drizzle-sqlite"
import { SelfImprovementApi, SelfImprovementLearning, SelfImprovementLifecycle } from "@opencode-ai/schema"
import { Database } from "@opencode-ai/core/database/database"
import { SelfImprovementPrivateArtifactCommand } from "@opencode-ai/core/self-improvement/private-artifact-command"
import { SelfImprovementAdmission } from "@opencode-ai/core/self-improvement/admission"
import { SelfImprovementApprovalStore } from "@opencode-ai/core/self-improvement/approval-store"
import { SelfImprovementArtifactStore } from "@opencode-ai/core/self-improvement/artifact-store"
import { SelfImprovementAuditStore } from "@opencode-ai/core/self-improvement/audit-store"
import { SelfImprovementContextStore } from "@opencode-ai/core/self-improvement/context-store"
import { SelfImprovementIdempotencyStore } from "@opencode-ai/core/self-improvement/idempotency-store"
import { SelfImprovementLifecycleCoordinator } from "@opencode-ai/core/self-improvement/lifecycle-coordinator"
import { SelfImprovementLifecycleWorkflow } from "@opencode-ai/core/self-improvement/lifecycle-workflow"
import { SelfImprovementMutationStore } from "@opencode-ai/core/self-improvement/mutation-store"
import { SelfImprovementTransitionStore } from "@opencode-ai/core/self-improvement/transition-store"
import { Effect, Layer } from "effect"
import { sql } from "drizzle-orm"

const makeDb = EffectDrizzleSqlite.makeWithDefaults()
const locationA = SelfImprovementLifecycle.LocationID.make("a".repeat(64))
const locationB = SelfImprovementLifecycle.LocationID.make("b".repeat(64))
const manifest = new SelfImprovementLifecycle.CapabilityManifest({
  toolIDs: [],
  filesystemScopeIDs: [],
  networkOriginIDs: [],
  modelRoutes: [],
  childAgentTargets: [],
  artifactReferences: [],
  denies: [],
})

const principal = (locationID: SelfImprovementLifecycle.LocationID) =>
  new SelfImprovementLifecycle.Principal({
    id: SelfImprovementLifecycle.PrincipalID.make("owner"),
    kind: "first-party-user",
    locationID,
  })

const request = (content = "Use it") =>
  new SelfImprovementApi.CreateArtifactRequest({
    proposalBytes: new TextEncoder().encode(
      JSON.stringify({
        kind: "skill",
        name: "artifact",
        definition: { description: "Artifact", content },
        references: [],
      }),
    ),
    behaviorClass: "instruction-only",
    capabilityManifest: manifest,
  })

const setup = Effect.gen(function* () {
  const db = yield* makeDb
  for (const statement of [
    `CREATE TABLE self_improvement_artifact (id TEXT PRIMARY KEY, location_id TEXT NOT NULL, kind TEXT NOT NULL, name TEXT NOT NULL, status TEXT NOT NULL, created_by TEXT NOT NULL, created_at INTEGER NOT NULL, revision INTEGER NOT NULL, tombstone_actor_id TEXT, tombstone_reason TEXT, tombstone_at INTEGER, UNIQUE (location_id, kind, name))`,
    `CREATE TABLE self_improvement_artifact_version (id TEXT PRIMARY KEY, artifact_id TEXT NOT NULL, version_number INTEGER NOT NULL, source TEXT NOT NULL, behavior_class TEXT NOT NULL, proposal_json TEXT NOT NULL, canonical_json TEXT NOT NULL, proposal_digest TEXT NOT NULL, input_snapshot_digest TEXT NOT NULL, version_digest TEXT NOT NULL UNIQUE, capability_manifest_json TEXT NOT NULL, capability_manifest_digest TEXT NOT NULL, creator_id TEXT NOT NULL, created_at INTEGER NOT NULL, generation_lease_id TEXT, strategy_pull_id TEXT, originating_task_id_digest TEXT, model_request_digest TEXT, model_output_digest TEXT, retention_deadline INTEGER)`,
    `CREATE TABLE self_improvement_stage_transition (id TEXT PRIMARY KEY, version_id TEXT NOT NULL, previous_stage TEXT, next_stage TEXT NOT NULL, event TEXT NOT NULL, reason TEXT NOT NULL, actor_id TEXT NOT NULL, timestamp INTEGER NOT NULL, evaluation_run_id TEXT, approval_id TEXT, rollback_id TEXT, context_outbox_id TEXT, idempotency_record_id TEXT, idempotency_digest TEXT NOT NULL)`,
    `CREATE TABLE self_improvement_audit_entry (id TEXT PRIMARY KEY, location_id TEXT NOT NULL, event_type TEXT NOT NULL, actor_id TEXT NOT NULL, payload_json TEXT NOT NULL, timestamp INTEGER NOT NULL, retention_tag TEXT NOT NULL, retention_created_at INTEGER NOT NULL, retention_expires_at INTEGER)`,
    `CREATE TABLE self_improvement_idempotency (id TEXT PRIMARY KEY, principal_id TEXT NOT NULL, location_id TEXT NOT NULL, operation TEXT NOT NULL, key TEXT NOT NULL, request_digest TEXT NOT NULL, status INTEGER NOT NULL, body_digest TEXT NOT NULL, body_json TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, UNIQUE (principal_id, location_id, operation, key))`,
  ])
    yield* db.run(sql.raw(statement))
  return { db }
})

test("creates, replays, and isolates artifact commands by Location", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const database = yield* setup
      yield* SelfImprovementPrivateArtifactCommand.Service.use((command) =>
        Effect.gen(function* () {
          const createRequest = request()
          const input = (locationID: SelfImprovementLifecycle.LocationID) => ({
            locationID,
            principal: principal(locationID),
            request: createRequest,
            idempotencyKey: SelfImprovementLearning.IdempotencyKey.make("create"),
            now: SelfImprovementLifecycle.TimestampMillis.make(1),
          })
          const created = yield* command.createArtifact(input(locationA))
          expect(created).toMatchObject({ replayed: false, response: { status: 201 } })
          expect(
            yield* database.db.get<{ count: number }>(
              sql`SELECT count(*) AS count FROM self_improvement_idempotency WHERE location_id = ${locationA}`,
            ),
          ).toEqual({ count: 1 })
          expect(yield* command.createArtifact(input(locationA))).toEqual({ ...created, replayed: true })
          expect(
            yield* command.createArtifact({ ...input(locationB), request: request("Use it in location B") }),
          ).toMatchObject({
            replayed: false,
            response: { status: 201 },
          })
          expect(
            yield* database.db.get<{ count: number }>(
              sql`SELECT count(*) AS count FROM self_improvement_artifact WHERE location_id = ${locationA}`,
            ),
          ).toEqual({ count: 1 })
          expect(
            yield* database.db.get<{ count: number }>(
              sql`SELECT count(*) AS count FROM self_improvement_artifact WHERE location_id = ${locationB}`,
            ),
          ).toEqual({ count: 1 })
        }),
      ).pipe(
        Effect.provide(SelfImprovementPrivateArtifactCommand.layer),
        Effect.provide(SelfImprovementPrivateArtifactCommand.admissionPolicyLayer),
        Effect.provide(SelfImprovementLifecycleCoordinator.layer),
        Effect.provideService(
          SelfImprovementLifecycleWorkflow.Service,
          SelfImprovementLifecycleWorkflow.Service.of({
            prepareShadow: () => Effect.die("unused"),
            applyDecision: () => Effect.die("unused"),
            consumeApproval: () => Effect.die("unused"),
            rejectApproval: () => Effect.die("unused"),
          }),
        ),
        Effect.provide(SelfImprovementAdmission.layer),
        Effect.provide(SelfImprovementApprovalStore.layer),
        Effect.provide(SelfImprovementContextStore.layer),
        Effect.provide(SelfImprovementMutationStore.layer),
        Effect.provide(SelfImprovementArtifactStore.layer),
        Effect.provide(SelfImprovementAuditStore.layer),
        Effect.provide(SelfImprovementIdempotencyStore.layer),
        Effect.provide(SelfImprovementTransitionStore.layer),
        Effect.provide(Layer.succeed(Database.Service, database)),
      )
    }).pipe(Effect.provide(SqliteClient.layer({ filename: ":memory:", disableWAL: true })), Effect.scoped),
  )
})
