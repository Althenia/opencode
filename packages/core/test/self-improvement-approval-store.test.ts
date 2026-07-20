import { expect, test } from "bun:test"
import { SqliteClient } from "@effect/sql-sqlite-bun"
import { EffectDrizzleSqlite } from "@opencode-ai/effect-drizzle-sqlite"
import { SelfImprovement, SelfImprovementLifecycle } from "@opencode-ai/schema"
import { Database } from "@opencode-ai/core/database/database"
import { SelfImprovementApprovalStore } from "@opencode-ai/core/self-improvement/approval-store"
import { Effect, Layer } from "effect"
import { sql } from "drizzle-orm"

const makeDb = EffectDrizzleSqlite.makeWithDefaults()
const locationID = SelfImprovementLifecycle.LocationID.make("a".repeat(64))
const otherLocationID = SelfImprovementLifecycle.LocationID.make("b".repeat(64))
const creatorID = SelfImprovementLifecycle.PrincipalID.make("creator")
const approverID = SelfImprovementLifecycle.PrincipalID.make("approver")
const artifactID = SelfImprovementLifecycle.ArtifactID.make("si_art_1")
const otherArtifactID = SelfImprovementLifecycle.ArtifactID.make("si_art_2")
const candidateVersionID = SelfImprovementLifecycle.ArtifactVersionID.make("si_ver_1")
const retainedActiveVersionID = SelfImprovementLifecycle.ArtifactVersionID.make("si_ver_2")
const otherVersionID = SelfImprovementLifecycle.ArtifactVersionID.make("si_ver_3")
const requestID = SelfImprovementLifecycle.ApprovalRequestID.make("si_apr_1")
const approvalID = SelfImprovementLifecycle.ApprovalID.make("si_app_1")
const canaryRunID = SelfImprovementLifecycle.EvaluationRunID.make("si_run_1")
const binding = new SelfImprovementLifecycle.ApprovalBinding({
  versionID: candidateVersionID,
  versionDigest: SelfImprovement.Digest.make("1".repeat(64)),
  suiteID: SelfImprovementLifecycle.SuiteID.make("si_sui_1"),
  suiteRevision: SelfImprovementLifecycle.Revision.make(1),
  evaluationRunID: SelfImprovementLifecycle.EvaluationRunID.make("si_run_shadow"),
  shadowEvidenceDigest: SelfImprovement.Digest.make("2".repeat(64)),
})

const request = new SelfImprovementLifecycle.ApprovalRequest({
  id: requestID,
  locationID,
  binding,
  creatorID,
  requestedAt: SelfImprovementLifecycle.TimestampMillis.make(10),
})

const approval = (input: {
  readonly approverID: SelfImprovementLifecycle.PrincipalID
  readonly binding?: SelfImprovementLifecycle.ApprovalBinding
  readonly decidedAt?: SelfImprovementLifecycle.TimestampMillis
  readonly consumedAt?: SelfImprovementLifecycle.TimestampMillis
}) =>
  new SelfImprovementLifecycle.Approval({
    id: approvalID,
    requestID,
    locationID,
    binding: input.binding ?? binding,
    decision: new SelfImprovementLifecycle.ApprovalGranted({
      approverID: input.approverID,
      decidedAt: input.decidedAt ?? SelfImprovementLifecycle.TimestampMillis.make(20),
      expiresAt: SelfImprovementLifecycle.TimestampMillis.make((input.decidedAt ?? 20) + 86_400_000),
      ...(input.consumedAt === undefined ? {} : { consumedAt: input.consumedAt }),
    }),
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
      id TEXT PRIMARY KEY, artifact_id TEXT NOT NULL, version_digest TEXT NOT NULL
    )
  `)
  yield* db.run(sql`
    CREATE TABLE self_improvement_approval_request (
      id TEXT PRIMARY KEY,
      location_id TEXT NOT NULL,
      version_id TEXT NOT NULL,
      version_digest TEXT NOT NULL,
      suite_id TEXT NOT NULL,
      suite_revision INTEGER NOT NULL,
      evaluation_run_id TEXT NOT NULL,
      shadow_evidence_digest TEXT NOT NULL,
      creator_id TEXT NOT NULL,
      requested_at INTEGER NOT NULL,
      shadow_evidence_expires_at INTEGER NOT NULL DEFAULT 0
    )
  `)
  yield* db.run(sql`
    CREATE TABLE self_improvement_approval (
      id TEXT PRIMARY KEY,
      request_id TEXT NOT NULL UNIQUE,
      location_id TEXT NOT NULL,
      version_id TEXT NOT NULL,
      version_digest TEXT NOT NULL,
      suite_id TEXT NOT NULL,
      suite_revision INTEGER NOT NULL,
      evaluation_run_id TEXT NOT NULL,
      shadow_evidence_digest TEXT NOT NULL,
      decision TEXT NOT NULL,
      approver_id TEXT NOT NULL,
      decided_at INTEGER NOT NULL,
      expires_at INTEGER,
      shadow_evidence_expires_at INTEGER NOT NULL DEFAULT 0,
      consumed_at INTEGER
    )
  `)
  yield* db.run(sql`
    CREATE TABLE self_improvement_rollback (
      id TEXT PRIMARY KEY,
      location_id TEXT NOT NULL,
      artifact_id TEXT NOT NULL,
      candidate_version_id TEXT NOT NULL,
      retained_active_version_id TEXT NOT NULL,
      canary_run_id TEXT NOT NULL,
      reason TEXT NOT NULL,
      reward_event_id TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      UNIQUE (canary_run_id),
      CHECK (reason = 'canary-regression')
    )
  `)
  yield* db.run(sql`
    INSERT INTO self_improvement_artifact (id, location_id)
    VALUES (${artifactID}, ${locationID}), (${otherArtifactID}, ${otherLocationID})
  `)
  yield* db.run(sql`
    INSERT INTO self_improvement_artifact_version (id, artifact_id, version_digest)
    VALUES
      (${candidateVersionID}, ${artifactID}, ${binding.versionDigest}),
      (${retainedActiveVersionID}, ${artifactID}, ${SelfImprovement.Digest.make("4".repeat(64))}),
      (${otherVersionID}, ${otherArtifactID}, ${SelfImprovement.Digest.make("5".repeat(64))})
  `)
  return db
})

test("persists exact, one-time approval decisions and canary rollbacks", async () => {
  await Effect.runPromise(
    setup.pipe(
      Effect.flatMap((db) =>
        SelfImprovementApprovalStore.Service.use((store) =>
          Effect.gen(function* () {
            yield* store.request(request)

            const selfApproval = yield* store.decide(approval({ approverID: creatorID })).pipe(Effect.flip)
            expect(selfApproval._tag).toBe("SelfImprovementApprovalStore.InvalidInput")

            const mismatched = yield* store
              .decide(
                approval({
                  approverID,
                  binding: new SelfImprovementLifecycle.ApprovalBinding({
                    versionID: binding.versionID,
                    versionDigest: SelfImprovement.Digest.make("3".repeat(64)),
                    suiteID: binding.suiteID,
                    suiteRevision: binding.suiteRevision,
                    evaluationRunID: binding.evaluationRunID,
                    shadowEvidenceDigest: binding.shadowEvidenceDigest,
                  }),
                }),
              )
              .pipe(Effect.flip)
            expect(mismatched._tag).toBe("SelfImprovementApprovalStore.InvalidInput")

            expect(yield* store.decide(approval({ approverID }))).toEqual(approval({ approverID }))
            const decidedAgain = yield* store.decide(approval({ approverID })).pipe(Effect.flip)
            expect(decidedAgain._tag).toBe("SelfImprovementApprovalStore.Conflict")

            expect(
              yield* store.consumable(
                locationID,
                requestID,
                binding,
                SelfImprovementLifecycle.TimestampMillis.make(86_400_021),
              ),
            ).toBeUndefined()
            expect(
              yield* store.consumable(
                locationID,
                requestID,
                binding,
                SelfImprovementLifecycle.TimestampMillis.make(86_400_020),
              ),
            ).toEqual(
              new SelfImprovementLifecycle.ApprovalGranted({
                approverID,
                decidedAt: SelfImprovementLifecycle.TimestampMillis.make(20),
                expiresAt: SelfImprovementLifecycle.TimestampMillis.make(86_400_020),
              }),
            )
            expect(
              yield* store.consume(locationID, approvalID, SelfImprovementLifecycle.TimestampMillis.make(86_400_020)),
            ).toBe(true)
            expect(
              yield* store.consume(locationID, approvalID, SelfImprovementLifecycle.TimestampMillis.make(86_400_020)),
            ).toBe(false)

            const rollback = new SelfImprovementLifecycle.Rollback({
              id: SelfImprovementLifecycle.RollbackID.make("si_rol_1"),
              locationID,
              artifactID,
              candidateVersionID,
              retainedActiveVersionID,
              canaryRunID,
              reason: "canary-regression",
              rewardEventID: SelfImprovementLifecycle.RewardEventID.make("si_rew_1"),
              timestamp: SelfImprovementLifecycle.TimestampMillis.make(30),
            })
            yield* store.appendRollback(rollback)
            expect(
              yield* db.get<{ reason: string }>(sql`
                SELECT reason FROM self_improvement_rollback WHERE id = ${rollback.id}
              `),
            ).toEqual({ reason: "canary-regression" })
          }),
        ).pipe(
          Effect.provide(SelfImprovementApprovalStore.layer),
          Effect.provide(Layer.succeed(Database.Service, { db })),
        ),
      ),
      Effect.provide(SqliteClient.layer({ filename: ":memory:", disableWAL: true })),
      Effect.scoped,
    ),
  )
})

test("rejects invalid approval evidence, locations, and rollback reasons", async () => {
  await Effect.runPromise(
    setup.pipe(
      Effect.flatMap((db) =>
        SelfImprovementApprovalStore.Service.use((store) =>
          Effect.gen(function* () {
            yield* store.request(request)

            const nonExact = approval({ approverID })
            expect(
              Reflect.set(nonExact.decision, "expiresAt", SelfImprovementLifecycle.TimestampMillis.make(86_400_021)),
            ).toBe(true)
            const invalidExpiry = yield* store.decide(nonExact).pipe(Effect.flip)
            expect(invalidExpiry._tag).toBe("SelfImprovementApprovalStore.InvalidInput")

            const lateApproval = yield* store
              .decide(
                approval({
                  approverID,
                  decidedAt: SelfImprovementLifecycle.TimestampMillis.make(180 * 86_400_000 + 11),
                }),
              )
              .pipe(Effect.flip)
            expect(lateApproval._tag).toBe("SelfImprovementApprovalStore.InvalidInput")

            yield* db.run(sql`
              INSERT INTO self_improvement_approval (
                id,
                request_id,
                location_id,
                version_id,
                version_digest,
                suite_id,
                suite_revision,
                evaluation_run_id,
                shadow_evidence_digest,
                decision,
                approver_id,
                decided_at,
                expires_at,
                shadow_evidence_expires_at
              ) VALUES (
                ${approvalID},
                ${requestID},
                ${locationID},
                ${binding.versionID},
                ${binding.versionDigest},
                ${binding.suiteID},
                ${binding.suiteRevision},
                ${binding.evaluationRunID},
                ${binding.shadowEvidenceDigest},
                'approved',
                ${approverID},
                ${180 * 86_400_000 + 11},
                ${181 * 86_400_000 + 11},
                ${180 * 86_400_000 + 10}
              )
            `)
            expect(
              yield* store.consumable(
                locationID,
                requestID,
                binding,
                SelfImprovementLifecycle.TimestampMillis.make(180 * 86_400_000 + 11),
              ),
            ).toBeUndefined()

            const crossLocation = yield* store
              .request(
                new SelfImprovementLifecycle.ApprovalRequest({
                  id: SelfImprovementLifecycle.ApprovalRequestID.make("si_apr_2"),
                  locationID: request.locationID,
                  binding: new SelfImprovementLifecycle.ApprovalBinding({
                    versionID: otherVersionID,
                    versionDigest: binding.versionDigest,
                    suiteID: binding.suiteID,
                    suiteRevision: binding.suiteRevision,
                    evaluationRunID: binding.evaluationRunID,
                    shadowEvidenceDigest: binding.shadowEvidenceDigest,
                  }),
                  creatorID: request.creatorID,
                  requestedAt: request.requestedAt,
                }),
              )
              .pipe(Effect.flip)
            expect(crossLocation._tag).toBe("SelfImprovementApprovalStore.Conflict")

            const wrongVersionDigest = yield* store
              .request(
                new SelfImprovementLifecycle.ApprovalRequest({
                  id: SelfImprovementLifecycle.ApprovalRequestID.make("si_apr_3"),
                  locationID: request.locationID,
                  binding: new SelfImprovementLifecycle.ApprovalBinding({
                    versionID: binding.versionID,
                    versionDigest: SelfImprovement.Digest.make("3".repeat(64)),
                    suiteID: binding.suiteID,
                    suiteRevision: binding.suiteRevision,
                    evaluationRunID: binding.evaluationRunID,
                    shadowEvidenceDigest: binding.shadowEvidenceDigest,
                  }),
                  creatorID: request.creatorID,
                  requestedAt: request.requestedAt,
                }),
              )
              .pipe(Effect.flip)
            expect(wrongVersionDigest._tag).toBe("SelfImprovementApprovalStore.Conflict")

            const rollback = (id: string) =>
              new SelfImprovementLifecycle.Rollback({
                id: SelfImprovementLifecycle.RollbackID.make(id),
                locationID,
                artifactID,
                candidateVersionID,
                retainedActiveVersionID,
                canaryRunID,
                reason: "canary-regression",
                rewardEventID: SelfImprovementLifecycle.RewardEventID.make("si_rew_1"),
                timestamp: SelfImprovementLifecycle.TimestampMillis.make(30),
              })
            const canaryRollback = rollback("si_rol_1")
            const nonCanary = rollback("si_rol_2")
            expect(Reflect.set(nonCanary, "reason", "other-regression")).toBe(true)
            const invalidRollback = yield* store.appendRollback(nonCanary).pipe(Effect.flip)
            expect(invalidRollback._tag).toBe("SelfImprovementApprovalStore.Conflict")

            yield* store.appendRollback(canaryRollback)
            const duplicateRollback = yield* store.appendRollback(rollback("si_rol_3")).pipe(Effect.flip)
            expect(duplicateRollback._tag).toBe("SelfImprovementApprovalStore.Conflict")
          }),
        ).pipe(
          Effect.provide(SelfImprovementApprovalStore.layer),
          Effect.provide(Layer.succeed(Database.Service, { db })),
        ),
      ),
      Effect.provide(SqliteClient.layer({ filename: ":memory:", disableWAL: true })),
      Effect.scoped,
    ),
  )
})

test("rejects pre-consumed decisions and cannot consume expired evidence", async () => {
  await Effect.runPromise(
    setup.pipe(
      Effect.flatMap((db) =>
        SelfImprovementApprovalStore.Service.use((store) =>
          Effect.gen(function* () {
            yield* store.request(request)

            const preConsumed = yield* store
              .decide(
                approval({
                  approverID,
                  consumedAt: SelfImprovementLifecycle.TimestampMillis.make(20),
                }),
              )
              .pipe(Effect.flip)
            expect(preConsumed._tag).toBe("SelfImprovementApprovalStore.InvalidInput")

            yield* db.run(sql`
              INSERT INTO self_improvement_approval (
                id,
                request_id,
                location_id,
                version_id,
                version_digest,
                suite_id,
                suite_revision,
                evaluation_run_id,
                shadow_evidence_digest,
                decision,
                approver_id,
                decided_at,
                expires_at,
                shadow_evidence_expires_at
              ) VALUES (
                ${approvalID},
                ${requestID},
                ${locationID},
                ${binding.versionID},
                ${binding.versionDigest},
                ${binding.suiteID},
                ${binding.suiteRevision},
                ${binding.evaluationRunID},
                ${binding.shadowEvidenceDigest},
                'approved',
                ${approverID},
                0,
                86400000,
                100
              )
            `)
            expect(
              yield* store.consume(locationID, approvalID, SelfImprovementLifecycle.TimestampMillis.make(101)),
            ).toBe(false)
          }),
        ).pipe(
          Effect.provide(SelfImprovementApprovalStore.layer),
          Effect.provide(Layer.succeed(Database.Service, { db })),
        ),
      ),
      Effect.provide(SqliteClient.layer({ filename: ":memory:", disableWAL: true })),
      Effect.scoped,
    ),
  )
})

test("loads an exact unconsumed approval and its immutable binding in a transaction", async () => {
  await Effect.runPromise(
    setup.pipe(
      Effect.flatMap((db) =>
        SelfImprovementApprovalStore.Service.use((store) =>
          Effect.gen(function* () {
            yield* store.request(request)
            const approved = approval({ approverID })
            yield* store.decide(approved)

            const loaded = yield* db.transaction((tx) =>
              store.approved(
                { locationID, approvalID, binding, at: SelfImprovementLifecycle.TimestampMillis.make(20) },
                tx,
              ),
            )
            expect(loaded).toEqual(approved)
            expect(
              yield* db.transaction((tx) =>
                store.approved(
                  {
                    locationID: otherLocationID,
                    approvalID,
                    binding,
                    at: SelfImprovementLifecycle.TimestampMillis.make(20),
                  },
                  tx,
                ),
              ),
            ).toBeUndefined()
            expect(
              yield* db.transaction((tx) =>
                store.approved(
                  { locationID, approvalID, binding, at: SelfImprovementLifecycle.TimestampMillis.make(86_400_021) },
                  tx,
                ),
              ),
            ).toBeUndefined()
            expect(
              yield* db.transaction((tx) =>
                store.approved(
                  {
                    locationID,
                    approvalID,
                    binding: new SelfImprovementLifecycle.ApprovalBinding({
                      ...binding,
                      shadowEvidenceDigest: SelfImprovement.Digest.make("3".repeat(64)),
                    }),
                    at: SelfImprovementLifecycle.TimestampMillis.make(20),
                  },
                  tx,
                ),
              ),
            ).toBeUndefined()
          }),
        ).pipe(
          Effect.provide(SelfImprovementApprovalStore.layer),
          Effect.provide(Layer.succeed(Database.Service, { db })),
        ),
      ),
      Effect.provide(SqliteClient.layer({ filename: ":memory:", disableWAL: true })),
      Effect.scoped,
    ),
  )
})
