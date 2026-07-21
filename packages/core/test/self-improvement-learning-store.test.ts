import { expect, test } from "bun:test"
import { SqliteClient } from "@effect/sql-sqlite-bun"
import { EffectDrizzleSqlite } from "@opencode-ai/effect-drizzle-sqlite"
import {
  Model,
  SelfImprovement,
  SelfImprovementEvaluation,
  SelfImprovementLearning,
  SelfImprovementLifecycle,
} from "@opencode-ai/schema"
import { Database } from "@opencode-ai/core/database/database"
import { SelfImprovementLearningStore } from "@opencode-ai/core/self-improvement/learning-store"
import { Effect, Layer, Schema } from "effect"
import { sql } from "drizzle-orm"

const makeDb = EffectDrizzleSqlite.makeWithDefaults()
const locationID = SelfImprovementLifecycle.LocationID.make("a".repeat(64))
const otherLocationID = SelfImprovementLifecycle.LocationID.make("b".repeat(64))
const revision = SelfImprovementLifecycle.Revision.make(1)
const now = SelfImprovementLifecycle.TimestampMillis.make(Date.now())
const retention = 180 * 86_400_000
const digest = (value: string) => SelfImprovement.Digest.make(value[0].repeat(64))
const armID = SelfImprovementLifecycle.GenerationStrategyArmID.make("si_gsa_1")
const expiredArmID = SelfImprovementLifecycle.GenerationStrategyArmID.make("si_gsa_expired")
const candidateVersionID = SelfImprovementLifecycle.ArtifactVersionID.make("si_ver_1")
const otherVersionID = SelfImprovementLifecycle.ArtifactVersionID.make("si_ver_2")
const pull = {
  id: SelfImprovementLifecycle.PullEventID.make("si_pul_1"),
  locationID,
  actionDomain: "generation-strategy",
  bucketDigest: digest("b"),
  derivationRevision: revision,
  allowlistRevision: revision,
  orderedEligibleArmIDs: [armID],
  selectedArmID: armID,
  timestamp: now,
} satisfies SelfImprovementLearning.PullEvent
const reward = new SelfImprovementLearning.RewardEvent({
  id: SelfImprovementLifecycle.RewardEventID.make("si_rew_1"),
  locationID,
  pullEventID: pull.id,
  outcomeClass: "passing-evidence",
  numericReward: 1,
  evidenceDigest: digest("e"),
  timestamp: SelfImprovementLifecycle.TimestampMillis.make(now + 1),
})

const setup = Effect.gen(function* () {
  const db = yield* makeDb
  yield* db.run(sql`
    CREATE TABLE self_improvement_generation_strategy_arm (
      id TEXT PRIMARY KEY, location_id TEXT NOT NULL, strategy_id TEXT NOT NULL,
      allowlist_revision INTEGER NOT NULL, active INTEGER NOT NULL
    )
  `)
  yield* db.run(sql`
    CREATE TABLE self_improvement_model_route_arm (
      id TEXT PRIMARY KEY, location_id TEXT NOT NULL, route_json TEXT NOT NULL,
      allowlist_revision INTEGER NOT NULL, active INTEGER NOT NULL
    )
  `)
  yield* db.run(sql`
    CREATE TABLE self_improvement_pull_event (
      id TEXT PRIMARY KEY, location_id TEXT NOT NULL, action_domain TEXT NOT NULL,
      bucket_digest TEXT NOT NULL, derivation_revision INTEGER NOT NULL, allowlist_revision INTEGER NOT NULL,
      ordered_eligible_arm_ids_json TEXT NOT NULL, selected_arm_id TEXT NOT NULL, proposal_digest TEXT,
      session_digest TEXT, version_id TEXT, timestamp INTEGER NOT NULL, expires_at INTEGER NOT NULL
    )
  `)
  yield* db.run(sql`
    CREATE TABLE self_improvement_reward_event (
      id TEXT PRIMARY KEY, location_id TEXT NOT NULL, pull_event_id TEXT NOT NULL UNIQUE,
      outcome_class TEXT NOT NULL, numeric_reward REAL, evidence_digest TEXT NOT NULL,
      timestamp INTEGER NOT NULL, expires_at INTEGER NOT NULL
    )
  `)
  yield* db.run(sql`
    CREATE TABLE self_improvement_routing_decision (
      id TEXT PRIMARY KEY, location_id TEXT NOT NULL, session_digest TEXT NOT NULL, workload TEXT NOT NULL,
      workload_revision INTEGER NOT NULL, role_digest TEXT NOT NULL, precedence_source TEXT NOT NULL,
      policy_snapshot_digest TEXT NOT NULL, catalog_snapshot_digest TEXT NOT NULL, variant_snapshot_digest TEXT NOT NULL,
      ordered_eligible_arms_json TEXT NOT NULL, selected_route_json TEXT NOT NULL, reason_code TEXT NOT NULL,
      pull_event_id TEXT, timestamp INTEGER NOT NULL, expires_at INTEGER NOT NULL
    )
  `)
  yield* db.run(sql`
    CREATE TABLE self_improvement_bandit_state (
      location_id TEXT NOT NULL, action_domain TEXT NOT NULL, bucket_digest TEXT NOT NULL,
      derivation_revision INTEGER NOT NULL, allowlist_revision INTEGER NOT NULL, arm_id TEXT NOT NULL,
      pull_total INTEGER NOT NULL, rewarded_pull_total INTEGER NOT NULL, cumulative_reward REAL NOT NULL,
      mean_reward REAL NOT NULL, active INTEGER NOT NULL, latest_pull_event_id TEXT, latest_reward_event_id TEXT,
      PRIMARY KEY (location_id, action_domain, bucket_digest, derivation_revision, allowlist_revision, arm_id)
    )
  `)
  return yield* SelfImprovementLearningStore.Service.use((store) =>
    Effect.gen(function* () {
      yield* store.putGenerationArm(
        new SelfImprovementLearning.GenerationStrategyArm({
          id: armID,
          locationID,
          strategyID: "strategy",
          allowlistRevision: revision,
          active: true,
        }),
      )
      yield* store.putGenerationArm(
        new SelfImprovementLearning.GenerationStrategyArm({
          id: expiredArmID,
          locationID,
          strategyID: "expired",
          allowlistRevision: revision,
          active: true,
        }),
      )
      yield* store.appendPull(pull)
      yield* store.appendReward(reward)
      const route = Schema.decodeUnknownSync(Model.Ref)({ providerID: "opencode", id: "gpt-5", variant: "default" })
      const routeArmID = SelfImprovementLifecycle.ModelRouteArmID.make("si_arm_1")
      const canaryPull = {
        ...pull,
        id: SelfImprovementLifecycle.PullEventID.make("si_pul_canary"),
        actionDomain: "model-route" as const,
        orderedEligibleArmIDs: [routeArmID],
        selectedArmID: routeArmID,
        versionID: candidateVersionID,
      }
      yield* store.putModelRouteArm(
        new SelfImprovementLearning.ModelRouteArm({
          id: routeArmID,
          locationID,
          route,
          allowlistRevision: revision,
          active: true,
        }),
      )
      yield* store.appendPull(canaryPull)
      const laterCanaryPull = {
        ...canaryPull,
        id: SelfImprovementLifecycle.PullEventID.make("si_pul_canary_later"),
        timestamp: SelfImprovementLifecycle.TimestampMillis.make(now + 1),
      }
      const tiedCanaryPull = {
        ...canaryPull,
        id: SelfImprovementLifecycle.PullEventID.make("si_pul_canary_tied"),
        timestamp: laterCanaryPull.timestamp,
      }
      yield* store.appendPull(laterCanaryPull)
      yield* store.appendPull(tiedCanaryPull)
      expect(yield* store.modelRoutePullForVersion(locationID, candidateVersionID)).toEqual(tiedCanaryPull)
      expect(yield* store.modelRoutePullForVersion(otherLocationID, candidateVersionID)).toBeUndefined()
      const regression = new SelfImprovementLearning.RewardEvent({
        id: SelfImprovementLifecycle.RewardEventID.make("si_rew_canary"),
        locationID,
        pullEventID: canaryPull.id,
        outcomeClass: "canary-regression",
        numericReward: -1,
        evidenceDigest: digest("e"),
        timestamp: SelfImprovementLifecycle.TimestampMillis.make(now + 1),
      })
      const wrongCandidate = yield* db
        .transaction((tx) => store.canaryRegression(regression, otherVersionID, tx))
        .pipe(Effect.flip)
      expect(wrongCandidate._tag).toBe("SelfImprovementLearningStore.Conflict")
      expect(
        yield* db.get<{ active: number }>(sql`
          SELECT active FROM self_improvement_model_route_arm WHERE id = ${routeArmID}
        `),
      ).toEqual({ active: 1 })
      yield* db.transaction((tx) => store.canaryRegression(regression, candidateVersionID, tx))
      expect(
        yield* db.get<{ active: number }>(sql`
          SELECT active FROM self_improvement_model_route_arm WHERE id = ${routeArmID}
        `),
      ).toEqual({ active: 0 })
      expect(
        yield* db.get<{ outcome_class: string; numeric_reward: number }>(sql`
          SELECT outcome_class, numeric_reward FROM self_improvement_reward_event WHERE id = ${regression.id}
        `),
      ).toEqual({ outcome_class: "canary-regression", numeric_reward: -1 })
      const laterPull = {
        ...pull,
        id: SelfImprovementLifecycle.PullEventID.make("si_pul_2"),
        timestamp: SelfImprovementLifecycle.TimestampMillis.make(now + 2),
      }
      const expiredPull = {
        ...pull,
        id: SelfImprovementLifecycle.PullEventID.make("si_pul_expired"),
        orderedEligibleArmIDs: [expiredArmID],
        selectedArmID: expiredArmID,
        timestamp: SelfImprovementLifecycle.TimestampMillis.make(now - retention - 1),
      }
      yield* store.appendPull(laterPull)
      yield* store.appendPull(expiredPull)
      yield* db.run(sql`
        INSERT INTO self_improvement_bandit_state (
          location_id, action_domain, bucket_digest, derivation_revision, allowlist_revision, arm_id,
          pull_total, rewarded_pull_total, cumulative_reward, mean_reward, active, latest_pull_event_id, latest_reward_event_id
        ) VALUES (
          ${locationID}, 'generation-strategy', ${pull.bucketDigest}, ${revision}, ${revision}, ${expiredArmID},
          100, 100, -100, -1, 1, ${expiredPull.id}, NULL
        )
      `)
      expect((yield* store.appendPull(pull).pipe(Effect.flip))._tag).toBe("SelfImprovementLearningStore.Conflict")
      expect((yield* store.appendReward(reward).pipe(Effect.flip))._tag).toBe("SelfImprovementLearningStore.Conflict")
      const crossLocationDecision = new SelfImprovementLearning.RoutingDecision({
        id: SelfImprovementLifecycle.RoutingDecisionID.make("si_rte_1"),
        locationID,
        sessionDigest: digest("a"),
        workload: SelfImprovementEvaluation.Workload.make("typescript"),
        workloadRevision: revision,
        roleDigest: digest("b"),
        precedenceSource: "active-recommendation",
        policySnapshotDigest: digest("c"),
        catalogSnapshotDigest: digest("c"),
        variantSnapshotDigest: digest("d"),
        orderedEligibleArms: [
          new SelfImprovementLearning.ModelRouteArm({
            id: SelfImprovementLifecycle.ModelRouteArmID.make("si_arm_1"),
            locationID,
            route,
            allowlistRevision: revision,
            active: true,
          }),
        ],
        selectedRoute: route,
        reasonCode: "test",
        pullEventID: expiredPull.id,
        timestamp: SelfImprovementLifecycle.TimestampMillis.make(now + 3),
      })
      expect(
        (yield* store
          .appendRoutingDecision(
            new SelfImprovementLearning.RoutingDecision({
              id: crossLocationDecision.id,
              locationID: otherLocationID,
              sessionDigest: crossLocationDecision.sessionDigest,
              workload: crossLocationDecision.workload,
              workloadRevision: crossLocationDecision.workloadRevision,
              roleDigest: crossLocationDecision.roleDigest,
              precedenceSource: crossLocationDecision.precedenceSource,
              policySnapshotDigest: crossLocationDecision.policySnapshotDigest,
              catalogSnapshotDigest: crossLocationDecision.catalogSnapshotDigest,
              variantSnapshotDigest: crossLocationDecision.variantSnapshotDigest,
              orderedEligibleArms: crossLocationDecision.orderedEligibleArms,
              selectedRoute: crossLocationDecision.selectedRoute,
              reasonCode: crossLocationDecision.reasonCode,
              pullEventID: crossLocationDecision.pullEventID,
              timestamp: crossLocationDecision.timestamp,
            }),
          )
          .pipe(Effect.flip))._tag,
      ).toBe("SelfImprovementLearningStore.Conflict")
      expect(
        yield* store.select({
          locationID,
          actionDomain: "generation-strategy",
          derivationRevision: revision,
          allowlistRevision: revision,
          eligibleArmIDs: [armID, expiredArmID],
          buckets: [pull.bucketDigest],
        }),
      ).toEqual({ bucketDigest: pull.bucketDigest, selectedArmID: expiredArmID })
      expect(yield* store.rebuild(locationID)).toEqual([
        {
          locationID,
          actionDomain: "generation-strategy",
          bucketDigest: pull.bucketDigest,
          derivationRevision: revision,
          allowlistRevision: revision,
          armID,
          pullTotal: 2,
          rewardedPullTotal: 1,
          cumulativeReward: 1,
          meanReward: 1,
          active: true,
          latestPullEventID: laterPull.id,
          latestRewardEventID: reward.id,
        },
        {
          locationID,
          actionDomain: "model-route",
          bucketDigest: pull.bucketDigest,
          derivationRevision: revision,
          allowlistRevision: revision,
          armID: routeArmID,
          pullTotal: 3,
          rewardedPullTotal: 1,
          cumulativeReward: -1,
          meanReward: -1,
          active: false,
          latestPullEventID: tiedCanaryPull.id,
          latestRewardEventID: regression.id,
        },
      ])
    }),
  ).pipe(Effect.provide(SelfImprovementLearningStore.layer), Effect.provide(Layer.succeed(Database.Service, { db })))
})

test("stores immutable learning events and rebuilds the bandit projection", async () => {
  await Effect.runPromise(
    setup.pipe(Effect.provide(SqliteClient.layer({ filename: ":memory:", disableWAL: true })), Effect.scoped),
  )
})

test("rejects malformed model-route evidence and rolls back its pull when decision persistence conflicts", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const db = yield* makeDb
      yield* db.run(sql`
        CREATE TABLE self_improvement_model_route_arm (
          id TEXT PRIMARY KEY, location_id TEXT NOT NULL, route_json TEXT NOT NULL,
          allowlist_revision INTEGER NOT NULL, active INTEGER NOT NULL
        )
      `)
      yield* db.run(sql`
        CREATE TABLE self_improvement_pull_event (
          id TEXT PRIMARY KEY, location_id TEXT NOT NULL, action_domain TEXT NOT NULL,
          bucket_digest TEXT NOT NULL, derivation_revision INTEGER NOT NULL, allowlist_revision INTEGER NOT NULL,
          ordered_eligible_arm_ids_json TEXT NOT NULL, selected_arm_id TEXT NOT NULL, proposal_digest TEXT,
          session_digest TEXT, version_id TEXT, timestamp INTEGER NOT NULL, expires_at INTEGER NOT NULL
        )
      `)
      yield* db.run(sql`
        CREATE TABLE self_improvement_routing_decision (
          id TEXT PRIMARY KEY, location_id TEXT NOT NULL, session_digest TEXT NOT NULL, workload TEXT NOT NULL,
          workload_revision INTEGER NOT NULL, role_digest TEXT NOT NULL, precedence_source TEXT NOT NULL,
          policy_snapshot_digest TEXT NOT NULL, catalog_snapshot_digest TEXT NOT NULL, variant_snapshot_digest TEXT NOT NULL,
          ordered_eligible_arms_json TEXT NOT NULL, selected_route_json TEXT NOT NULL, reason_code TEXT NOT NULL,
          pull_event_id TEXT, timestamp INTEGER NOT NULL, expires_at INTEGER NOT NULL
        )
      `)
      yield* SelfImprovementLearningStore.Service.use((store) =>
        Effect.gen(function* () {
          const selectedRoute = Schema.decodeUnknownSync(Model.Ref)({
            providerID: "opencode",
            id: "gpt-5",
            variant: "default",
          })
          const arm = new SelfImprovementLearning.ModelRouteArm({
            id: SelfImprovementLifecycle.ModelRouteArmID.make("si_arm_atomic"),
            locationID,
            route: selectedRoute,
            allowlistRevision: revision,
            active: true,
          })
          const linkedPull = {
            id: SelfImprovementLifecycle.PullEventID.make("si_pul_atomic"),
            locationID,
            actionDomain: "model-route",
            bucketDigest: digest("a"),
            derivationRevision: revision,
            allowlistRevision: revision,
            orderedEligibleArmIDs: [arm.id],
            selectedArmID: arm.id,
            versionID: candidateVersionID,
            timestamp: now,
          } satisfies SelfImprovementLearning.PullEvent
          const decision = new SelfImprovementLearning.RoutingDecision({
            id: SelfImprovementLifecycle.RoutingDecisionID.make("si_rte_atomic"),
            locationID,
            sessionDigest: digest("b"),
            workload: SelfImprovementEvaluation.Workload.make("typescript"),
            workloadRevision: revision,
            roleDigest: digest("c"),
            precedenceSource: "active-recommendation",
            policySnapshotDigest: digest("d"),
            catalogSnapshotDigest: digest("e"),
            variantSnapshotDigest: digest("f"),
            orderedEligibleArms: [arm],
            selectedRoute,
            reasonCode: "eligible-evaluation",
            pullEventID: linkedPull.id,
            timestamp: now,
          })
          yield* store.putModelRouteArm(arm)

          const malformed = new SelfImprovementLearning.RoutingDecision({
            id: SelfImprovementLifecycle.RoutingDecisionID.make("si_rte_malformed"),
            locationID: decision.locationID,
            sessionDigest: decision.sessionDigest,
            workload: decision.workload,
            workloadRevision: decision.workloadRevision,
            roleDigest: decision.roleDigest,
            precedenceSource: decision.precedenceSource,
            policySnapshotDigest: decision.policySnapshotDigest,
            catalogSnapshotDigest: decision.catalogSnapshotDigest,
            variantSnapshotDigest: decision.variantSnapshotDigest,
            orderedEligibleArms: decision.orderedEligibleArms,
            selectedRoute: decision.selectedRoute,
            reasonCode: decision.reasonCode,
            pullEventID: SelfImprovementLifecycle.PullEventID.make("si_pul_other"),
            timestamp: decision.timestamp,
          })
          expect(
            (yield* store.appendModelRouteEvidence({ pull: linkedPull, decision: malformed }).pipe(Effect.flip))._tag,
          ).toBe("SelfImprovementLearningStore.Conflict")
          expect(
            yield* db.get<{ count: number }>(sql`SELECT COUNT(*) AS count FROM self_improvement_pull_event`),
          ).toEqual({
            count: 0,
          })

          yield* db.run(sql`
            INSERT INTO self_improvement_routing_decision VALUES (
              ${decision.id}, ${locationID}, ${decision.sessionDigest}, ${decision.workload}, ${decision.workloadRevision},
              ${decision.roleDigest}, ${decision.precedenceSource}, ${decision.policySnapshotDigest},
              ${decision.catalogSnapshotDigest}, ${decision.variantSnapshotDigest}, '[]',
              ${JSON.stringify(selectedRoute)}, 'preexisting', NULL, ${now}, ${now + retention}
            )
          `)
          expect((yield* store.appendModelRouteEvidence({ pull: linkedPull, decision }).pipe(Effect.flip))._tag).toBe(
            "SelfImprovementLearningStore.Conflict",
          )
          expect(
            yield* db.get<{ count: number }>(sql`SELECT COUNT(*) AS count FROM self_improvement_pull_event`),
          ).toEqual({
            count: 0,
          })
          expect(
            yield* db.get<{ count: number }>(sql`SELECT COUNT(*) AS count FROM self_improvement_routing_decision`),
          ).toEqual({ count: 1 })
        }),
      ).pipe(
        Effect.provide(SelfImprovementLearningStore.layer),
        Effect.provide(Layer.succeed(Database.Service, { db })),
      )
    }).pipe(Effect.provide(SqliteClient.layer({ filename: ":memory:", disableWAL: true })), Effect.scoped),
  )
})

test("lists active generation arms for a Location in deterministic order", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const db = yield* makeDb
      yield* db.run(sql`
        CREATE TABLE self_improvement_generation_strategy_arm (
          id TEXT PRIMARY KEY, location_id TEXT NOT NULL, strategy_id TEXT NOT NULL,
          allowlist_revision INTEGER NOT NULL, active INTEGER NOT NULL
        )
      `)
      yield* SelfImprovementLearningStore.Service.use((store) =>
        Effect.gen(function* () {
          const arm = (
            id: string,
            strategyID: string,
            allowlistRevision: number,
            active = true,
            armLocationID = locationID,
          ) =>
            new SelfImprovementLearning.GenerationStrategyArm({
              id: SelfImprovementLifecycle.GenerationStrategyArmID.make(id),
              locationID: armLocationID,
              strategyID,
              allowlistRevision: SelfImprovementLifecycle.Revision.make(allowlistRevision),
              active,
            })
          yield* store.putGenerationArm(arm("si_gsa_old", "zeta", 1))
          yield* store.putGenerationArm(arm("si_gsa_beta", "beta", 3))
          yield* store.putGenerationArm(arm("si_gsa_alpha_b", "alpha", 3))
          yield* store.putGenerationArm(arm("si_gsa_alpha_a", "alpha", 3))
          yield* store.putGenerationArm(arm("si_gsa_inactive", "first", 4, false))
          yield* store.putGenerationArm(arm("si_gsa_other", "first", 4, true, otherLocationID))

          expect((yield* store.listGenerationArms(locationID)).map((arm) => arm.id)).toEqual([
            SelfImprovementLifecycle.GenerationStrategyArmID.make("si_gsa_alpha_a"),
            SelfImprovementLifecycle.GenerationStrategyArmID.make("si_gsa_alpha_b"),
            SelfImprovementLifecycle.GenerationStrategyArmID.make("si_gsa_beta"),
            SelfImprovementLifecycle.GenerationStrategyArmID.make("si_gsa_old"),
          ])
        }),
      ).pipe(
        Effect.provide(SelfImprovementLearningStore.layer),
        Effect.provide(Layer.succeed(Database.Service, { db })),
      )
    }).pipe(Effect.provide(SqliteClient.layer({ filename: ":memory:", disableWAL: true })), Effect.scoped),
  )
})

test("lists only current route arms with complete canary routing evidence", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const db = yield* makeDb
      yield* db.run(sql`
        CREATE TABLE self_improvement_model_route_arm (
          id TEXT PRIMARY KEY, location_id TEXT NOT NULL, route_json TEXT NOT NULL,
          allowlist_revision INTEGER NOT NULL, active INTEGER NOT NULL
        )
      `)
      yield* db.run(sql`
        CREATE TABLE self_improvement_pull_event (
          id TEXT PRIMARY KEY, location_id TEXT NOT NULL, action_domain TEXT NOT NULL,
          bucket_digest TEXT NOT NULL, derivation_revision INTEGER NOT NULL, allowlist_revision INTEGER NOT NULL,
          ordered_eligible_arm_ids_json TEXT NOT NULL, selected_arm_id TEXT NOT NULL, proposal_digest TEXT,
          session_digest TEXT, version_id TEXT, timestamp INTEGER NOT NULL, expires_at INTEGER NOT NULL
        )
      `)
      yield* db.run(sql`
        CREATE TABLE self_improvement_evaluation_run (
          id TEXT PRIMARY KEY, location_id TEXT NOT NULL, request_digest TEXT NOT NULL, state TEXT NOT NULL,
          cutoff_sample_set_digest TEXT, decided_at INTEGER, run_json TEXT NOT NULL
        )
      `)
      yield* db.run(sql`
        CREATE TABLE self_improvement_evaluation_decision (
          run_id TEXT PRIMARY KEY, location_id TEXT NOT NULL, decision_json TEXT NOT NULL, expires_at INTEGER NOT NULL
        )
      `)
      yield* db.run(sql`
        CREATE TABLE self_improvement_evaluation_finding (
          id TEXT PRIMARY KEY, location_id TEXT NOT NULL, run_id TEXT NOT NULL, finding_order INTEGER NOT NULL,
          finding_json TEXT NOT NULL, expires_at INTEGER NOT NULL
        )
      `)
      yield* db.run(sql`
        CREATE TABLE self_improvement_evaluation_sample (
          id TEXT PRIMARY KEY, location_id TEXT NOT NULL, run_id TEXT NOT NULL, sample_id_digest TEXT NOT NULL,
          task_id_digest TEXT NOT NULL, request_digest TEXT NOT NULL, sample_json TEXT NOT NULL, expires_at INTEGER NOT NULL
        )
      `)

      const workload = SelfImprovementEvaluation.Workload.make("typescript")
      const currentRevision = SelfImprovementLifecycle.Revision.make(2)
      const indexedDigest = (index: number) =>
        SelfImprovement.Digest.make(index.toString(16).padStart(2, "0").repeat(32))
      const route = (providerID: string, id: string, variant: string) =>
        Schema.decodeUnknownSync(Model.Ref)({ providerID, id, variant })
      const alpha = new SelfImprovementLearning.ModelRouteArm({
        id: SelfImprovementLifecycle.ModelRouteArmID.make("si_arm_alpha"),
        locationID,
        route: route("alpha", "model", "stable"),
        allowlistRevision: currentRevision,
        active: true,
      })
      const beta = new SelfImprovementLearning.ModelRouteArm({
        id: SelfImprovementLifecycle.ModelRouteArmID.make("si_arm_beta"),
        locationID,
        route: route("alpha", "model", "preview"),
        allowlistRevision: currentRevision,
        active: true,
      })
      const preview = new SelfImprovementLearning.ModelRouteArm({
        id: SelfImprovementLifecycle.ModelRouteArmID.make("si_arm_alpha_preview"),
        locationID,
        route: route("alpha", "model", "preview"),
        allowlistRevision: currentRevision,
        active: true,
      })
      const otherModel = new SelfImprovementLearning.ModelRouteArm({
        id: SelfImprovementLifecycle.ModelRouteArmID.make("si_arm_other_model"),
        locationID,
        route: route("alpha", "zmodel", "stable"),
        allowlistRevision: currentRevision,
        active: true,
      })
      const previous = new SelfImprovementLearning.ModelRouteArm({
        id: SelfImprovementLifecycle.ModelRouteArmID.make("si_arm_previous"),
        locationID,
        route: route("zero", "model", "stable"),
        allowlistRevision: revision,
        active: true,
      })
      const versionID = SelfImprovementLifecycle.ArtifactVersionID.make("si_ver_alpha")
      const runID = SelfImprovementLifecycle.EvaluationRunID.make("si_run_alpha")
      const totals = {
        taskQualityEarnedAllowlistedPoints: 20,
        taskQualityPossibleAllowlistedPoints: 20,
        correctnessPassedRequiredChecks: 20,
        correctnessRequiredChecks: 20,
        repeatFixRepeatedTasks: 0,
        repeatFixCompletedTasks: 20,
        precisionAcceptedRelevantItems: 20,
        precisionAssessedItems: 20,
        acceptedLatencySampleCount: 20,
        latencySampleSetDigest: digest("a"),
        inputTokens: 20,
        outputTokens: 20,
        successfulTasks: 20,
        cacheReadTokens: 20,
        cacheEligibleTokens: 20,
      }
      const findings = SelfImprovementEvaluation.GateIDs.map((gateID, index) =>
        Schema.decodeUnknownSync(SelfImprovementEvaluation.GateFinding)({
          id: SelfImprovementLifecycle.GateFindingID.make(`si_gat_route_${index + 1}`),
          evaluationRunID: runID,
          order: index + 1,
          gateID,
          result: index === 0 ? "not-applicable" : "pass",
          code: "accepted",
        }),
      )
      const run = new SelfImprovementEvaluation.EvaluationRun({
        id: runID,
        locationID,
        versionID,
        stage: "canary",
        workload,
        workloadRevision: revision,
        suiteID: SelfImprovementLifecycle.SuiteID.make("si_sui_route"),
        suiteRevision: revision,
        baselineID: SelfImprovementLifecycle.BaselineID.make("si_bas_route"),
        state: "decided",
        trustedProducerIDs: [SelfImprovementLifecycle.PrincipalID.make("producer")],
        acceptanceStart: now,
        acceptanceEnd: SelfImprovementLifecycle.TimestampMillis.make(now + 1),
        cutoffAt: SelfImprovementLifecycle.TimestampMillis.make(now + 2),
        requestDigest: digest("a"),
        createdAt: now,
        cutoffSampleSetDigest: digest("c"),
        decidedAt: SelfImprovementLifecycle.TimestampMillis.make(now + 3),
      })
      const decision = new SelfImprovementEvaluation.EvaluationDecision({
        runID,
        cutoffSampleSetDigest: digest("c"),
        findings,
        metricTotals: totals,
        aggregates: new SelfImprovementEvaluation.MetricAggregates({
          taskQuality: 1,
          correctness: 1,
          repeatFixRate: 0,
          precision: 1,
          latencyP95Ms: 1,
          tokensPerSuccess: 1,
          cacheHitRatio: 1,
        }),
        aggregateReward: 1,
        decision: "passed",
        decidedAt: SelfImprovementLifecycle.TimestampMillis.make(now + 3),
      })
      const pull = {
        id: SelfImprovementLifecycle.PullEventID.make("si_pul_alpha"),
        locationID,
        actionDomain: "model-route",
        bucketDigest: digest("a"),
        derivationRevision: revision,
        allowlistRevision: currentRevision,
        orderedEligibleArmIDs: [alpha.id],
        selectedArmID: alpha.id,
        versionID,
        timestamp: now,
      } satisfies SelfImprovementLearning.PullEvent

      yield* db.run(sql`
        INSERT INTO self_improvement_model_route_arm VALUES
          (${previous.id}, ${locationID}, ${JSON.stringify(previous.route)}, ${revision}, 1),
          (${alpha.id}, ${locationID}, ${JSON.stringify(alpha.route)}, ${currentRevision}, 1),
          (${beta.id}, ${locationID}, ${JSON.stringify(beta.route)}, ${currentRevision}, 1),
          (${preview.id}, ${locationID}, ${JSON.stringify(preview.route)}, ${currentRevision}, 1),
          (${otherModel.id}, ${locationID}, ${JSON.stringify(otherModel.route)}, ${currentRevision}, 1)
      `)
      yield* db.run(sql`
        INSERT INTO self_improvement_pull_event VALUES (
          ${pull.id}, ${locationID}, 'model-route', ${pull.bucketDigest}, ${revision}, ${currentRevision},
          ${JSON.stringify(pull.orderedEligibleArmIDs)}, ${alpha.id}, NULL, NULL, ${versionID}, ${now}, ${now + retention}
        )
      `)
      yield* db.run(sql`
        INSERT INTO self_improvement_evaluation_run VALUES (
          ${runID}, ${locationID}, ${run.requestDigest}, 'decided', ${decision.cutoffSampleSetDigest}, ${decision.decidedAt}, ${JSON.stringify(run)}
        )
      `)
      yield* db.run(sql`
        INSERT INTO self_improvement_evaluation_decision VALUES (${runID}, ${locationID}, ${JSON.stringify(decision)}, ${now + retention})
      `)
      for (const finding of findings)
        yield* db.run(sql`
          INSERT INTO self_improvement_evaluation_finding VALUES (
            ${finding.id}, ${locationID}, ${runID}, ${finding.order}, ${JSON.stringify(finding)}, ${now + retention}
          )
        `)
      for (let index = 0; index < 20; index++)
        yield* db.run(sql`
          INSERT INTO self_improvement_evaluation_sample VALUES (
            ${`si_sam_route_${index}`}, ${locationID}, ${runID}, ${indexedDigest(index)}, ${indexedDigest(index + 32)},
            ${indexedDigest(index + 64)}, '{}', ${now + retention}
          )
        `)

      yield* SelfImprovementLearningStore.Service.use((store) =>
        Effect.gen(function* () {
          expect((yield* store.listCurrentModelRouteArms(locationID)).map((arm) => arm.id)).toEqual([
            preview.id,
            beta.id,
            alpha.id,
            otherModel.id,
          ])
          expect(
            (yield* store.eligibleModelRouteArms({ locationID, workload, workloadRevision: revision })).map(
              (arm) => arm.id,
            ),
          ).toEqual([alpha.id])

          yield* db.run(sql`DELETE FROM self_improvement_evaluation_sample WHERE id = 'si_sam_route_19'`)
          yield* db.run(sql`
            INSERT INTO self_improvement_evaluation_sample VALUES (
              'si_sam_duplicate', ${locationID}, ${runID}, ${digest("d")}, ${indexedDigest(32)}, ${digest("d")}, '{}', ${now + retention}
            )
          `)
          expect(yield* store.eligibleModelRouteArms({ locationID, workload, workloadRevision: revision })).toEqual([])

          yield* db.run(sql`DELETE FROM self_improvement_evaluation_sample WHERE id = 'si_sam_duplicate'`)
          yield* db.run(sql`
            INSERT INTO self_improvement_evaluation_sample VALUES (
              'si_sam_route_19', ${locationID}, ${runID}, ${indexedDigest(19)}, ${indexedDigest(51)}, ${indexedDigest(83)}, '{}', ${now + retention}
            )
          `)
          yield* db.run(sql`
            UPDATE self_improvement_evaluation_finding
            SET finding_json = ${JSON.stringify({ ...findings[0], result: "fail" })}
            WHERE id = ${findings[0].id}
          `)
          expect(yield* store.eligibleModelRouteArms({ locationID, workload, workloadRevision: revision })).toEqual([])
          yield* db.run(sql`
            UPDATE self_improvement_evaluation_finding SET finding_json = ${JSON.stringify(findings[0])} WHERE id = ${findings[0].id}
          `)
          yield* db.run(sql`DELETE FROM self_improvement_evaluation_finding WHERE id = ${findings[22].id}`)
          expect(yield* store.eligibleModelRouteArms({ locationID, workload, workloadRevision: revision })).toEqual([])
          yield* db.run(sql`
            INSERT INTO self_improvement_evaluation_finding VALUES (
              ${findings[22].id}, ${locationID}, ${runID}, ${findings[22].order}, ${JSON.stringify(findings[22])}, ${now + retention}
            )
          `)
          yield* db.run(sql`
            UPDATE self_improvement_evaluation_decision
            SET decision_json = ${JSON.stringify(Object.assign({}, decision, { aggregateReward: 0 }))}
            WHERE run_id = ${runID}
          `)
          expect(yield* store.eligibleModelRouteArms({ locationID, workload, workloadRevision: revision })).toEqual([])
          yield* db.run(sql`
            UPDATE self_improvement_evaluation_decision SET decision_json = ${JSON.stringify(decision)} WHERE run_id = ${runID}
          `)
          yield* db.run(sql`UPDATE self_improvement_evaluation_run SET state = 'open' WHERE id = ${runID}`)
          expect(yield* store.eligibleModelRouteArms({ locationID, workload, workloadRevision: revision })).toEqual([])
          yield* db.run(sql`UPDATE self_improvement_evaluation_run SET state = 'decided' WHERE id = ${runID}`)
          yield* db.run(
            sql`UPDATE self_improvement_evaluation_run SET location_id = ${otherLocationID} WHERE id = ${runID}`,
          )
          expect(yield* store.eligibleModelRouteArms({ locationID, workload, workloadRevision: revision })).toEqual([])
          yield* db.run(sql`UPDATE self_improvement_evaluation_run SET location_id = ${locationID} WHERE id = ${runID}`)
          yield* db.run(
            sql`UPDATE self_improvement_pull_event SET allowlist_revision = ${revision} WHERE id = ${pull.id}`,
          )
          expect(yield* store.eligibleModelRouteArms({ locationID, workload, workloadRevision: revision })).toEqual([])
          yield* db.run(
            sql`UPDATE self_improvement_pull_event SET allowlist_revision = ${currentRevision} WHERE id = ${pull.id}`,
          )
          yield* db.run(sql`
            INSERT INTO self_improvement_model_route_arm VALUES (
              'si_arm_retired', ${locationID}, ${JSON.stringify(route("retired", "model", "stable"))}, 3, 0
            )
          `)
          expect(yield* store.listCurrentModelRouteArms(locationID)).toEqual([])
          expect(yield* store.eligibleModelRouteArms({ locationID, workload, workloadRevision: revision })).toEqual([])
        }),
      ).pipe(
        Effect.provide(SelfImprovementLearningStore.layer),
        Effect.provide(Layer.succeed(Database.Service, { db })),
      )
    }).pipe(Effect.provide(SqliteClient.layer({ filename: ":memory:", disableWAL: true })), Effect.scoped),
  )
})
