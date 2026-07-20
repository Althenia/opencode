import { expect, test } from "bun:test"
import { SqliteClient } from "@effect/sql-sqlite-bun"
import { EffectDrizzleSqlite } from "@opencode-ai/effect-drizzle-sqlite"
import { SelfImprovement, SelfImprovementLearning, SelfImprovementLifecycle } from "@opencode-ai/schema"
import { Database } from "@opencode-ai/core/database/database"
import { SelfImprovementContextStore } from "@opencode-ai/core/self-improvement/context-store"
import { Effect, Layer } from "effect"
import { sql } from "drizzle-orm"

const makeDb = EffectDrizzleSqlite.makeWithDefaults()
const locationID = SelfImprovementLifecycle.LocationID.make("a".repeat(64))
const otherLocationID = SelfImprovementLifecycle.LocationID.make("b".repeat(64))

const request = (
  id: string,
  retryAt: number,
  options: {
    locationID?: SelfImprovementLifecycle.LocationID
    artifactID?: SelfImprovementLifecycle.ArtifactID
    status?: SelfImprovementLearning.ContextOutboxStatus
  } = {},
) => {
  const artifactID = options.artifactID ?? SelfImprovementLifecycle.ArtifactID.make(`si_art_${id}`)
  const requestLocationID = options.locationID ?? locationID
  const desired = new SelfImprovementLearning.ContextDesiredState({
    locationID: requestLocationID,
    artifactID,
    rolloutSlot: "shadow",
    desired: {
      state: "present",
      versionID: SelfImprovementLifecycle.ArtifactVersionID.make(`si_ver_${id}`),
      versionDigest: SelfImprovement.Digest.make(id.repeat(64)),
      stage: "shadow",
    },
    desiredRevision: SelfImprovementLifecycle.Revision.make(1),
  })
  return {
    desired,
    outbox: new SelfImprovementLearning.ContextOutbox({
      id: SelfImprovementLifecycle.ContextOutboxID.make(`si_obx_${id}`),
      locationID: requestLocationID,
      artifactID,
      expectedArtifactRevision: SelfImprovementLifecycle.Revision.make(0),
      expectedStage: "candidate",
      desiredStateRevision: desired.desiredRevision,
      intent: new SelfImprovementLearning.PendingTransitionIntent({
        versionID:
          desired.desired.state === "present"
            ? desired.desired.versionID
            : SelfImprovementLifecycle.ArtifactVersionID.make("si_ver_missing"),
        previousStage: "candidate",
        nextStage: "shadow",
        event: "shadow-started",
        reason: "gates-passed",
        actorID: SelfImprovementLifecycle.PrincipalID.make("coordinator"),
        idempotencyRecordID: SelfImprovementLifecycle.IdempotencyRecordID.make(`si_idm_${id}`),
        idempotencyDigest: SelfImprovement.Digest.make("f".repeat(64)),
      }),
      status: options.status ?? "pending",
      attempts: 0,
      nextRetryAt: SelfImprovementLifecycle.TimestampMillis.make(retryAt),
      createdAt: SelfImprovementLifecycle.TimestampMillis.make(0),
    }),
  }
}

test("orders pending context rollouts and rejects a duplicate artifact stage slot", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const db = yield* makeDb
      yield* db.run(sql`
        CREATE TABLE self_improvement_context_desired_state (
          location_id TEXT NOT NULL,
          artifact_id TEXT NOT NULL,
          rollout_slot TEXT NOT NULL,
          desired_state TEXT NOT NULL,
          version_id TEXT,
          version_digest TEXT,
          desired_revision INTEGER NOT NULL,
          PRIMARY KEY (location_id, artifact_id, rollout_slot)
        )
      `)
      yield* db.run(sql`
        CREATE TABLE self_improvement_context_outbox (
          id TEXT PRIMARY KEY,
          location_id TEXT NOT NULL,
          artifact_id TEXT NOT NULL,
          expected_artifact_revision INTEGER NOT NULL,
          expected_stage TEXT NOT NULL,
          desired_state_revision INTEGER NOT NULL,
          intent_json TEXT NOT NULL,
          status TEXT NOT NULL,
          attempts INTEGER NOT NULL,
          next_retry_at INTEGER NOT NULL,
          cas_result_digest TEXT,
          created_at INTEGER NOT NULL
        )
      `)
      yield* db.run(sql`
        CREATE UNIQUE INDEX self_improvement_context_outbox_pending_slot_idx
        ON self_improvement_context_outbox (artifact_id, expected_stage)
        WHERE status IN ('pending', 'applying')
      `)
      const first = request("b", 1)
      const second = request("a", 1)
      const third = request("c", 2)
      const future = request("9", 3)
      const duplicateSlot = request("d", 3, { artifactID: first.desired.artifactID })
      const sharedArtifactID = SelfImprovementLifecycle.ArtifactID.make("si_art_shared")
      const firstLocation = request("e", 4, { artifactID: sharedArtifactID })
      const secondLocation = request("f", 5, {
        locationID: otherLocationID,
        artifactID: sharedArtifactID,
        status: "applied",
      })

      yield* SelfImprovementContextStore.Service.use((store) =>
        Effect.gen(function* () {
          yield* store.request(first.desired, first.outbox)
          yield* store.request(second.desired, second.outbox)
          yield* store.request(third.desired, third.outbox)
          yield* store.request(future.desired, future.outbox)
          expect(
            (yield* store.pending(SelfImprovementLifecycle.TimestampMillis.make(2))).map((outbox) => outbox.id),
          ).toEqual([second.outbox.id, first.outbox.id, third.outbox.id])

          const conflict = yield* store.request(duplicateSlot.desired, duplicateSlot.outbox).pipe(Effect.flip)
          expect(conflict._tag).toBe("SelfImprovementContextStore.Conflict")

          yield* store.request(firstLocation.desired, firstLocation.outbox)
          yield* store.request(secondLocation.desired, secondLocation.outbox)
          expect(
            yield* db.all(sql`
              SELECT location_id
              FROM self_improvement_context_desired_state
              WHERE artifact_id = ${sharedArtifactID}
              ORDER BY location_id
            `),
          ).toEqual([{ location_id: locationID }, { location_id: otherLocationID }])
        }),
      ).pipe(Effect.provide(SelfImprovementContextStore.layer), Effect.provide(Layer.succeed(Database.Service, { db })))
    }).pipe(Effect.provide(SqliteClient.layer({ filename: ":memory:", disableWAL: true })), Effect.scoped),
  )
})

test("recovers due pending and applying outboxes in retry order, excluding blocked rows", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const db = yield* makeDb
      yield* db.run(sql`
        CREATE TABLE self_improvement_context_desired_state (
          location_id TEXT NOT NULL,
          artifact_id TEXT NOT NULL,
          rollout_slot TEXT NOT NULL,
          desired_state TEXT NOT NULL,
          version_id TEXT,
          version_digest TEXT,
          desired_revision INTEGER NOT NULL,
          PRIMARY KEY (location_id, artifact_id, rollout_slot)
        )
      `)
      yield* db.run(sql`
        CREATE TABLE self_improvement_context_outbox (
          id TEXT PRIMARY KEY,
          location_id TEXT NOT NULL,
          artifact_id TEXT NOT NULL,
          expected_artifact_revision INTEGER NOT NULL,
          expected_stage TEXT NOT NULL,
          desired_state_revision INTEGER NOT NULL,
          intent_json TEXT NOT NULL,
          status TEXT NOT NULL,
          attempts INTEGER NOT NULL,
          next_retry_at INTEGER NOT NULL,
          cas_result_digest TEXT,
          created_at INTEGER NOT NULL
        )
      `)
      const pending = request("d", 2)
      const applying = request("e", 1, { artifactID: SelfImprovementLifecycle.ArtifactID.make("si_art_applying") })
      const blocked = request("a", 1, { artifactID: SelfImprovementLifecycle.ArtifactID.make("si_art_blocked") })
      const future = request("f", 3)

      yield* SelfImprovementContextStore.Service.use((store) =>
        Effect.gen(function* () {
          yield* store.request(pending.desired, pending.outbox)
          yield* store.request(applying.desired, applying.outbox)
          yield* store.request(blocked.desired, blocked.outbox)
          yield* store.request(future.desired, future.outbox)
          yield* store.markApplying(applying.outbox.id)
          yield* store.markBlocked(blocked.outbox.id)

          expect(
            (yield* store.pending(SelfImprovementLifecycle.TimestampMillis.make(2))).map((outbox) => outbox.id),
          ).toEqual([pending.outbox.id])
          expect(
            (yield* store.recoverable(SelfImprovementLifecycle.TimestampMillis.make(2))).map((outbox) => outbox.id),
          ).toEqual([applying.outbox.id, pending.outbox.id])

          yield* db.transaction((tx) =>
            Effect.gen(function* () {
              expect(
                yield* store.desired(
                  {
                    locationID,
                    artifactID: pending.desired.artifactID,
                    rolloutSlot: "shadow",
                  },
                  tx,
                ),
              ).toEqual(pending.desired)
              yield* store.supersedeForArtifact({ locationID, artifactID: pending.desired.artifactID }, tx)
            }),
          )

          yield* db.transaction((tx) =>
            Effect.gen(function* () {
              expect(yield* store.markBlocked(applying.outbox.id, tx)).toBe(true)
              expect(
                yield* store.hasBlockedForArtifact({ locationID, artifactID: applying.desired.artifactID }, tx),
              ).toBe(true)
              yield* store.supersedeForArtifact({ locationID, artifactID: applying.desired.artifactID }, tx)
              expect(
                yield* store.hasBlockedForArtifact({ locationID, artifactID: applying.desired.artifactID }, tx),
              ).toBe(false)
              expect(
                yield* store.hasBlockedForArtifact({ locationID, artifactID: pending.desired.artifactID }, tx),
              ).toBe(false)
            }),
          )
          yield* db.transaction((tx) =>
            store.blockedForArtifact({ locationID, artifactID: pending.desired.artifactID }, tx),
          )
          expect(
            (yield* store.recoverable(SelfImprovementLifecycle.TimestampMillis.make(2))).map((outbox) => outbox.id),
          ).toEqual([])
        }),
      ).pipe(Effect.provide(SelfImprovementContextStore.layer), Effect.provide(Layer.succeed(Database.Service, { db })))
    }).pipe(Effect.provide(SqliteClient.layer({ filename: ":memory:", disableWAL: true })), Effect.scoped),
  )
})

test("rejects terminal groups when peers do not share its terminal plan", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const db = yield* makeDb
      yield* db.run(sql`
        CREATE TABLE self_improvement_context_desired_state (
          location_id TEXT NOT NULL,
          artifact_id TEXT NOT NULL,
          rollout_slot TEXT NOT NULL,
          desired_state TEXT NOT NULL,
          version_id TEXT,
          version_digest TEXT,
          desired_revision INTEGER NOT NULL,
          PRIMARY KEY (location_id, artifact_id, rollout_slot)
        )
      `)
      yield* db.run(sql`
        CREATE TABLE self_improvement_context_outbox (
          id TEXT PRIMARY KEY,
          location_id TEXT NOT NULL,
          artifact_id TEXT NOT NULL,
          expected_artifact_revision INTEGER NOT NULL,
          expected_stage TEXT NOT NULL,
          desired_state_revision INTEGER NOT NULL,
          intent_json TEXT NOT NULL,
          status TEXT NOT NULL,
          attempts INTEGER NOT NULL,
          next_retry_at INTEGER NOT NULL,
          cas_result_digest TEXT,
          created_at INTEGER NOT NULL
        )
      `)
      const artifactID = SelfImprovementLifecycle.ArtifactID.make("si_art_terminal")
      const current = request("c", 1, { artifactID })
      const second = request("d", 1, { artifactID })
      const first = request("e", 1, { artifactID })
      const group = {
        removalOutboxIDs: [second.outbox.id, current.outbox.id, first.outbox.id],
        archiveTransitions: [second, current, first].map(
          (entry) =>
            new SelfImprovementLifecycle.StageTransition({
              id: SelfImprovementLifecycle.StageTransitionID.create(),
              versionID: entry.outbox.intent.versionID,
              previousStage: "shadow",
              nextStage: "archived",
              event: "version-archived",
              reason: "artifact-tombstoned",
              actorID: entry.outbox.intent.actorID,
              timestamp: SelfImprovementLifecycle.TimestampMillis.make(2),
              contextOutboxID: entry.outbox.id,
              idempotencyRecordID: SelfImprovementLifecycle.IdempotencyRecordID.create(),
              idempotencyDigest: SelfImprovement.Digest.make("d".repeat(64)),
            }),
        ),
      }
      const terminalCurrent = {
        ...current,
        outbox: new SelfImprovementLearning.ContextOutbox({
          id: current.outbox.id,
          locationID: current.outbox.locationID,
          artifactID: current.outbox.artifactID,
          expectedArtifactRevision: current.outbox.expectedArtifactRevision,
          expectedStage: current.outbox.expectedStage,
          desiredStateRevision: current.outbox.desiredStateRevision,
          intent: new SelfImprovementLearning.PendingTransitionIntent({
            versionID: current.outbox.intent.versionID,
            previousStage: current.outbox.intent.previousStage,
            nextStage: "archived",
            event: "artifact-tombstoned",
            reason: "artifact-tombstoned",
            actorID: current.outbox.intent.actorID,
            idempotencyRecordID: current.outbox.intent.idempotencyRecordID,
            idempotencyDigest: current.outbox.intent.idempotencyDigest,
            terminalGroup: group,
          }),
          status: current.outbox.status,
          attempts: current.outbox.attempts,
          nextRetryAt: current.outbox.nextRetryAt,
          createdAt: current.outbox.createdAt,
        }),
      }

      yield* SelfImprovementContextStore.Service.use((store) =>
        Effect.gen(function* () {
          yield* store.request(terminalCurrent.desired, terminalCurrent.outbox)
          yield* store.request(second.desired, second.outbox)
          yield* store.request(first.desired, first.outbox)
          yield* store.markApplying(terminalCurrent.outbox.id)
          yield* store.markApplying(second.outbox.id)
          yield* store.markApplied(second.outbox.id, SelfImprovement.Digest.make("e".repeat(64)))
          expect(yield* db.transaction((tx) => store.terminalGroup(terminalCurrent.outbox, tx))).toBeUndefined()
          yield* store.markApplying(first.outbox.id)
          yield* store.markApplied(first.outbox.id, SelfImprovement.Digest.make("f".repeat(64)))
          expect(yield* db.transaction((tx) => store.terminalGroup(terminalCurrent.outbox, tx))).toBeUndefined()
        }),
      ).pipe(Effect.provide(SelfImprovementContextStore.layer), Effect.provide(Layer.succeed(Database.Service, { db })))
    }).pipe(Effect.provide(SqliteClient.layer({ filename: ":memory:", disableWAL: true })), Effect.scoped),
  )
})
