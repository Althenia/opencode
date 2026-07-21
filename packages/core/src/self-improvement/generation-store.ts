export * as SelfImprovementGenerationStore from "./generation-store"

import { and, asc, desc, eq, gt, isNotNull, lte, ne } from "drizzle-orm"
import { Context, Effect, Layer, Schema } from "effect"
import { SelfImprovement, SelfImprovementLearning, SelfImprovementLifecycle } from "@opencode-ai/schema"
import { Hash } from "../util/hash"
import { Database } from "../database/database"
import { makeLocationNode } from "../effect/app-node"
import { SelfImprovementGenerationLeaseTable } from "./generation.sql"
import { SelfImprovementObservationTable } from "./ingress.sql"
import { SelfImprovementLearningStore } from "./learning-store"

const leaseDuration = 10 * 60_000
const attemptWindow = 24 * 60 * 60_000

export class NotEligible extends Schema.TaggedErrorClass<NotEligible>()("SelfImprovementGenerationStore.NotEligible", {
  message: Schema.String,
}) {}

export type LeaseDetails = SelfImprovementLearning.GenerationLease & {
  readonly lease: SelfImprovementLearning.GenerationLease
  readonly pullEventID?: SelfImprovementLifecycle.PullEventID
  readonly originatingTaskIDDigest: SelfImprovement.Digest
  readonly output?: Uint8Array
}

export interface Interface {
  readonly acquire: (input: {
    readonly locationID: SelfImprovementLifecycle.LocationID
    readonly ownerID: SelfImprovementLifecycle.PrincipalID
    readonly patternDigest: SelfImprovement.Digest
    readonly requestDigest: SelfImprovement.Digest
    readonly leaseTokenDigest: SelfImprovement.Digest
    readonly now: SelfImprovementLifecycle.TimestampMillis
    readonly selectedPull?: SelfImprovementLearning.PullEvent
  }) => Effect.Effect<LeaseDetails | undefined, NotEligible>
  readonly renew: (input: {
    readonly leaseID: SelfImprovementLifecycle.GenerationLeaseID
    readonly leaseTokenDigest: SelfImprovement.Digest
    readonly now: SelfImprovementLifecycle.TimestampMillis
  }) => Effect.Effect<boolean>
  readonly recordOutput: (input: {
    readonly leaseID: SelfImprovementLifecycle.GenerationLeaseID
    readonly leaseTokenDigest: SelfImprovement.Digest
    readonly output: Uint8Array
    readonly now: SelfImprovementLifecycle.TimestampMillis
  }) => Effect.Effect<boolean>
  readonly finish: (input: {
    readonly leaseID: SelfImprovementLifecycle.GenerationLeaseID
    readonly leaseTokenDigest: SelfImprovement.Digest
    readonly now: SelfImprovementLifecycle.TimestampMillis
    readonly outcome: Exclude<SelfImprovementLearning.GenerationOutcome, "pending">
  }) => Effect.Effect<boolean>
  readonly complete: (input: {
    readonly leaseID: SelfImprovementLifecycle.GenerationLeaseID
    readonly leaseTokenDigest: SelfImprovement.Digest
    readonly output: Uint8Array
    readonly now: SelfImprovementLifecycle.TimestampMillis
    readonly outcome: Exclude<SelfImprovementLearning.GenerationOutcome, "pending">
  }) => Effect.Effect<boolean>
  readonly get: (leaseID: SelfImprovementLifecycle.GenerationLeaseID) => Effect.Effect<LeaseDetails | undefined>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SelfImprovementGenerationStore") {}

const lease = (row: typeof SelfImprovementGenerationLeaseTable.$inferSelect) =>
  new SelfImprovementLearning.GenerationLease({
    id: row.id,
    locationID: row.location_id,
    patternDigest: row.pattern_digest,
    ownerID: row.owner_id,
    leaseTokenDigest: row.lease_token_digest,
    attemptNumber: row.attempt_number,
    acquiredAt: row.acquired_at,
    expiresAt: row.expires_at,
    ...(row.completed_at === null ? {} : { completedAt: row.completed_at }),
    modelRequestDigest: row.model_request_digest,
    ...(row.model_output_digest === null ? {} : { modelOutputDigest: row.model_output_digest }),
    outcome: row.outcome,
  })

const details = (row: typeof SelfImprovementGenerationLeaseTable.$inferSelect): LeaseDetails => {
  const domainLease = lease(row)
  return {
    id: domainLease.id,
    locationID: domainLease.locationID,
    patternDigest: domainLease.patternDigest,
    ownerID: domainLease.ownerID,
    leaseTokenDigest: domainLease.leaseTokenDigest,
    attemptNumber: domainLease.attemptNumber,
    acquiredAt: domainLease.acquiredAt,
    expiresAt: domainLease.expiresAt,
    ...(domainLease.completedAt === undefined ? {} : { completedAt: domainLease.completedAt }),
    modelRequestDigest: domainLease.modelRequestDigest,
    ...(domainLease.modelOutputDigest === undefined ? {} : { modelOutputDigest: domainLease.modelOutputDigest }),
    outcome: domainLease.outcome,
    lease: domainLease,
    ...(row.pull_event_id === null ? {} : { pullEventID: row.pull_event_id }),
    originatingTaskIDDigest: row.originating_task_id_digest,
    ...(row.model_output_bytes === null ? {} : { output: Uint8Array.from(row.model_output_bytes) }),
  }
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const db = (yield* Database.Service).db
    const learning = yield* SelfImprovementLearningStore.Service
    const acquire = Effect.fn("SelfImprovementGenerationStore.acquire")(function* (input: {
      readonly locationID: SelfImprovementLifecycle.LocationID
      readonly ownerID: SelfImprovementLifecycle.PrincipalID
      readonly patternDigest: SelfImprovement.Digest
      readonly requestDigest: SelfImprovement.Digest
      readonly leaseTokenDigest: SelfImprovement.Digest
      readonly now: SelfImprovementLifecycle.TimestampMillis
      readonly selectedPull?: SelfImprovementLearning.PullEvent
    }) {
      return yield* db
        .transaction((tx) =>
          Effect.gen(function* () {
            const active = yield* tx
              .select()
              .from(SelfImprovementGenerationLeaseTable)
              .where(
                and(
                  eq(SelfImprovementGenerationLeaseTable.location_id, input.locationID),
                  eq(SelfImprovementGenerationLeaseTable.pattern_digest, input.patternDigest),
                  eq(SelfImprovementGenerationLeaseTable.outcome, "pending"),
                  gt(SelfImprovementGenerationLeaseTable.expires_at, input.now),
                ),
              )
              .get()
              .pipe(Effect.orDie)
            if (active) return undefined

            const expired = yield* tx
              .select()
              .from(SelfImprovementGenerationLeaseTable)
              .where(
                and(
                  eq(SelfImprovementGenerationLeaseTable.location_id, input.locationID),
                  eq(SelfImprovementGenerationLeaseTable.pattern_digest, input.patternDigest),
                  eq(SelfImprovementGenerationLeaseTable.outcome, "pending"),
                  lte(SelfImprovementGenerationLeaseTable.expires_at, input.now),
                ),
              )
              .orderBy(
                desc(SelfImprovementGenerationLeaseTable.acquired_at),
                asc(SelfImprovementGenerationLeaseTable.id),
              )
              .get()
              .pipe(Effect.orDie)
            if (expired) {
              const updated = yield* tx
                .update(SelfImprovementGenerationLeaseTable)
                .set({
                  owner_id: input.ownerID,
                  lease_token_digest: input.leaseTokenDigest,
                  expires_at: SelfImprovementLifecycle.TimestampMillis.make(input.now + leaseDuration),
                })
                .where(
                  and(
                    eq(SelfImprovementGenerationLeaseTable.id, expired.id),
                    eq(SelfImprovementGenerationLeaseTable.outcome, "pending"),
                    lte(SelfImprovementGenerationLeaseTable.expires_at, input.now),
                  ),
                )
                .returning()
                .get()
                .pipe(Effect.orDie)
              return updated === undefined ? undefined : details(updated)
            }

            const terminal = yield* tx
              .select({
                acquiredAt: SelfImprovementGenerationLeaseTable.acquired_at,
                attemptNumber: SelfImprovementGenerationLeaseTable.attempt_number,
              })
              .from(SelfImprovementGenerationLeaseTable)
              .where(
                and(
                  eq(SelfImprovementGenerationLeaseTable.location_id, input.locationID),
                  eq(SelfImprovementGenerationLeaseTable.pattern_digest, input.patternDigest),
                  ne(SelfImprovementGenerationLeaseTable.outcome, "pending"),
                ),
              )
              .orderBy(
                desc(SelfImprovementGenerationLeaseTable.acquired_at),
                asc(SelfImprovementGenerationLeaseTable.id),
              )
              .get()
              .pipe(Effect.orDie)
            if (terminal && terminal.acquiredAt + attemptWindow > input.now)
              return yield* new NotEligible({ message: "Pattern already attempted in the last 24 hours" })

            const observations = yield* tx
              .select({
                identityDigest: SelfImprovementObservationTable.identity_digest,
                taskIDDigest: SelfImprovementObservationTable.task_id_digest,
              })
              .from(SelfImprovementObservationTable)
              .where(
                and(
                  eq(SelfImprovementObservationTable.location_id, input.locationID),
                  eq(SelfImprovementObservationTable.pattern_digest, input.patternDigest),
                  gt(SelfImprovementObservationTable.expires_at, input.now),
                ),
              )
              .orderBy(desc(SelfImprovementObservationTable.occurred_at), asc(SelfImprovementObservationTable.id))
              .all()
              .pipe(Effect.orDie)
            if (new Set(observations.map((observation) => observation.identityDigest)).size < 3)
              return yield* new NotEligible({ message: "Pattern has fewer than three unexpired identities" })

            if (input.selectedPull) yield* learning.appendPull(input.selectedPull, tx)
            const created = yield* tx
              .insert(SelfImprovementGenerationLeaseTable)
              .values({
                id: SelfImprovementLifecycle.GenerationLeaseID.create(),
                location_id: input.locationID,
                pattern_digest: input.patternDigest,
                owner_id: input.ownerID,
                lease_token_digest: input.leaseTokenDigest,
                attempt_number: (terminal?.attemptNumber ?? 0) + 1,
                acquired_at: input.now,
                expires_at: SelfImprovementLifecycle.TimestampMillis.make(input.now + leaseDuration),
                completed_at: null,
                model_request_digest: input.requestDigest,
                model_output_digest: null,
                model_output_bytes: null,
                outcome: "pending",
                pull_event_id: input.selectedPull?.id ?? null,
                originating_task_id_digest: observations[0].taskIDDigest,
              })
              .onConflictDoNothing()
              .returning()
              .get()
              .pipe(Effect.orDie)
            if (created === undefined)
              return yield* new NotEligible({ message: "Generation lease was acquired concurrently" })
            return details(created)
          }),
        )
        .pipe(
          Effect.catchTag("SqlError", Effect.die),
          Effect.catchTag("SelfImprovementLearningStore.Conflict", (error) =>
            Effect.fail(new NotEligible({ message: error.message })),
          ),
        )
    })
    const renew = Effect.fn("SelfImprovementGenerationStore.renew")(function* (input: {
      readonly leaseID: SelfImprovementLifecycle.GenerationLeaseID
      readonly leaseTokenDigest: SelfImprovement.Digest
      readonly now: SelfImprovementLifecycle.TimestampMillis
    }) {
      const updated = yield* db
        .update(SelfImprovementGenerationLeaseTable)
        .set({ expires_at: SelfImprovementLifecycle.TimestampMillis.make(input.now + leaseDuration) })
        .where(
          and(
            eq(SelfImprovementGenerationLeaseTable.id, input.leaseID),
            eq(SelfImprovementGenerationLeaseTable.lease_token_digest, input.leaseTokenDigest),
            eq(SelfImprovementGenerationLeaseTable.outcome, "pending"),
            gt(SelfImprovementGenerationLeaseTable.expires_at, input.now),
          ),
        )
        .returning({ id: SelfImprovementGenerationLeaseTable.id })
        .get()
        .pipe(Effect.orDie)
      return updated !== undefined
    })
    const recordOutput = Effect.fn("SelfImprovementGenerationStore.recordOutput")(function* (input: {
      readonly leaseID: SelfImprovementLifecycle.GenerationLeaseID
      readonly leaseTokenDigest: SelfImprovement.Digest
      readonly output: Uint8Array
      readonly now: SelfImprovementLifecycle.TimestampMillis
    }) {
      const updated = yield* db
        .update(SelfImprovementGenerationLeaseTable)
        .set({
          model_output_digest: SelfImprovement.Digest.make(Hash.sha256(Buffer.from(input.output))),
          model_output_bytes: Array.from(input.output),
        })
        .where(
          and(
            eq(SelfImprovementGenerationLeaseTable.id, input.leaseID),
            eq(SelfImprovementGenerationLeaseTable.lease_token_digest, input.leaseTokenDigest),
            eq(SelfImprovementGenerationLeaseTable.outcome, "pending"),
            gt(SelfImprovementGenerationLeaseTable.expires_at, input.now),
          ),
        )
        .returning({ id: SelfImprovementGenerationLeaseTable.id })
        .get()
        .pipe(Effect.orDie)
      return updated !== undefined
    })
    const finish = Effect.fn("SelfImprovementGenerationStore.finish")(function* (input: {
      readonly leaseID: SelfImprovementLifecycle.GenerationLeaseID
      readonly leaseTokenDigest: SelfImprovement.Digest
      readonly now: SelfImprovementLifecycle.TimestampMillis
      readonly outcome: Exclude<SelfImprovementLearning.GenerationOutcome, "pending">
    }) {
      const updated = yield* db
        .update(SelfImprovementGenerationLeaseTable)
        .set({ completed_at: input.now, outcome: input.outcome })
        .where(
          and(
            eq(SelfImprovementGenerationLeaseTable.id, input.leaseID),
            eq(SelfImprovementGenerationLeaseTable.lease_token_digest, input.leaseTokenDigest),
            eq(SelfImprovementGenerationLeaseTable.outcome, "pending"),
            gt(SelfImprovementGenerationLeaseTable.expires_at, input.now),
            ...(input.outcome === "model-failed"
              ? []
              : [
                  isNotNull(SelfImprovementGenerationLeaseTable.model_output_digest),
                  isNotNull(SelfImprovementGenerationLeaseTable.model_output_bytes),
                ]),
          ),
        )
        .returning({ id: SelfImprovementGenerationLeaseTable.id })
        .get()
        .pipe(Effect.orDie)
      return updated !== undefined
    })
    const complete = Effect.fn("SelfImprovementGenerationStore.complete")(function* (input: {
      readonly leaseID: SelfImprovementLifecycle.GenerationLeaseID
      readonly leaseTokenDigest: SelfImprovement.Digest
      readonly output: Uint8Array
      readonly now: SelfImprovementLifecycle.TimestampMillis
      readonly outcome: Exclude<SelfImprovementLearning.GenerationOutcome, "pending">
    }) {
      if (!(yield* recordOutput(input))) return false
      return yield* finish(input)
    })
    const get = (leaseID: SelfImprovementLifecycle.GenerationLeaseID) =>
      db
        .select()
        .from(SelfImprovementGenerationLeaseTable)
        .where(eq(SelfImprovementGenerationLeaseTable.id, leaseID))
        .get()
        .pipe(
          Effect.map((row) => (row === undefined ? undefined : details(row))),
          Effect.orDie,
        )
    return Service.of({ acquire, renew, recordOutput, finish, complete, get })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [Database.node, SelfImprovementLearningStore.node],
})
