export * as SelfImprovementRetention from "./retention"

import { Context, Effect, Layer } from "effect"
import { sql, type SQL } from "drizzle-orm"
import { SelfImprovementLearning, SelfImprovementLifecycle } from "@opencode-ai/schema"
import type { EffectDrizzleSqlite } from "@opencode-ai/effect-drizzle-sqlite"
import { Database } from "../database/database"
import { makeLocationNode } from "../effect/app-node"
import { Location } from "../location"
import { SelfImprovementAuditStore } from "./audit-store"
import { SelfImprovementContracts } from "./contracts"

type DatabaseClient = EffectDrizzleSqlite.EffectSQLiteDatabase
type Transaction = Parameters<Parameters<DatabaseClient["transaction"]>[0]>[0]

const DAY = 86_400_000

export interface Interface {
  readonly purgeExpired: (
    now: SelfImprovementLifecycle.TimestampMillis,
  ) => Effect.Effect<{ readonly observations: number; readonly evidence: number }>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SelfImprovementRetention") {}

const deleteExpired = (tx: Transaction, statement: SQL) =>
  tx.all(statement).pipe(
    Effect.orDie,
    Effect.map((rows) => rows.length),
  )

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const db = (yield* Database.Service).db
    const audit = yield* SelfImprovementAuditStore.Service
    const location = yield* Location.Service
    const locationID = SelfImprovementContracts.locationID(location)
    const purgeExpired = Effect.fn("SelfImprovementRetention.purgeExpired")(function* (
      now: SelfImprovementLifecycle.TimestampMillis,
    ) {
      return yield* db
        .transaction((tx) =>
          Effect.gen(function* () {
            const generation = yield* deleteExpired(
              tx,
              sql`DELETE FROM self_improvement_generation_lease WHERE location_id = ${locationID} AND completed_at IS NOT NULL AND completed_at + ${30 * DAY} <= ${now} RETURNING 1`,
            )
            const observations = yield* deleteExpired(
              tx,
              sql`DELETE FROM self_improvement_observation WHERE location_id = ${locationID} AND expires_at <= ${now} RETURNING 1`,
            )
            const rewards = yield* deleteExpired(
              tx,
              sql`DELETE FROM self_improvement_reward_event WHERE location_id = ${locationID} AND expires_at <= ${now} RETURNING 1`,
            )
            const context = yield* deleteExpired(
              tx,
              sql`DELETE FROM self_improvement_context_selection_evidence WHERE location_id = ${locationID} AND expires_at <= ${now} RETURNING 1`,
            )
            const samples = yield* deleteExpired(
              tx,
              sql`DELETE FROM self_improvement_evaluation_sample WHERE location_id = ${locationID} AND expires_at <= ${now} RETURNING 1`,
            )
            const findings = yield* deleteExpired(
              tx,
              sql`DELETE FROM self_improvement_evaluation_finding WHERE location_id = ${locationID} AND expires_at <= ${now} RETURNING 1`,
            )
            const decisions = yield* deleteExpired(
              tx,
              sql`DELETE FROM self_improvement_evaluation_decision WHERE location_id = ${locationID} AND expires_at <= ${now} RETURNING 1`,
            )
            const routing = yield* deleteExpired(
              tx,
              sql`DELETE FROM self_improvement_routing_decision WHERE location_id = ${locationID} AND expires_at <= ${now} RETURNING 1`,
            )
            const pulls = yield* deleteExpired(
              tx,
              sql`DELETE FROM self_improvement_pull_event WHERE location_id = ${locationID} AND expires_at <= ${now} RETURNING 1`,
            )
            const auditEntries = yield* deleteExpired(
              tx,
              sql`DELETE FROM self_improvement_audit_entry WHERE location_id = ${locationID} AND retention_expires_at <= ${now} RETURNING 1`,
            )
            const idempotency = yield* deleteExpired(
              tx,
              sql`DELETE FROM self_improvement_idempotency WHERE location_id = ${locationID} AND expires_at <= ${now} RETURNING 1`,
            )
            const retentionDeletionCounts = [
              { category: "generation", count: generation },
              { category: "observations", count: observations },
              { category: "rewards", count: rewards },
              { category: "context", count: context },
              { category: "samples", count: samples },
              { category: "findings", count: findings },
              { category: "decisions", count: decisions },
              { category: "routing", count: routing },
              { category: "pulls", count: pulls },
              { category: "audit", count: auditEntries },
              { category: "idempotency", count: idempotency },
            ].filter((item) => item.count > 0)
            if (retentionDeletionCounts.length > 0)
              yield* audit
                .append(
                  {
                    locationID,
                    entry: new SelfImprovementLearning.AuditEntry({
                      id: SelfImprovementLifecycle.AuditEntryID.create(),
                      locationID,
                      eventType: "retention-purged",
                      actorID: SelfImprovementLifecycle.PrincipalID.make("system-retention"),
                      payload: new SelfImprovementLearning.AuditPayload({
                        linkedDigests: [],
                        rejectedFieldNames: [],
                        retentionDeletionCounts,
                      }),
                      timestamp: now,
                      retention: new SelfImprovementLearning.GovernedMetadataRetention({ createdAt: now }),
                    }),
                  },
                  tx,
                )
                .pipe(Effect.orDie)
            return {
              observations: observations + generation,
              evidence:
                rewards + context + samples + findings + decisions + routing + pulls + auditEntries + idempotency,
            }
          }),
        )
        .pipe(Effect.catchTag("SqlError", Effect.die))
    })
    return Service.of({ purgeExpired })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [Database.node, Location.node, SelfImprovementAuditStore.node],
})
