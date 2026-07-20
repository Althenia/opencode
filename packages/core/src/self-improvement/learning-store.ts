export * as SelfImprovementLearningStore from "./learning-store"

import { and, asc, desc, eq, gt, sql } from "drizzle-orm"
import { Clock, Context, Effect, Layer, Schema } from "effect"
import {
  Model,
  SelfImprovementEvaluation,
  SelfImprovementLearning,
  SelfImprovementLifecycle,
} from "@opencode-ai/schema"
import type { EffectDrizzleSqlite } from "@opencode-ai/effect-drizzle-sqlite"
import { Database } from "../database/database"
import { makeLocationNode } from "../effect/app-node"
import {
  SelfImprovementBanditStateTable,
  SelfImprovementGenerationStrategyArmTable,
  SelfImprovementModelRouteArmTable,
  SelfImprovementPullEventTable,
  SelfImprovementRewardEventTable,
} from "./learning.sql"
import {
  SelfImprovementEvaluationDecisionTable,
  SelfImprovementEvaluationFindingTable,
  SelfImprovementEvaluationRunTable,
  SelfImprovementEvaluationSampleTable,
} from "./evaluation.sql"
import { SelfImprovementBandit } from "./bandit"

type DatabaseClient = EffectDrizzleSqlite.EffectSQLiteDatabase
export type Transaction = Parameters<Parameters<DatabaseClient["transaction"]>[0]>[0]

const RETENTION = 180 * 86_400_000
const PullArmIDsJson = Schema.fromJsonString(Schema.Array(SelfImprovementLearning.BanditArmID))
const RouteArmsJson = Schema.fromJsonString(Schema.Array(SelfImprovementLearning.ModelRouteArm))
const ModelRefJson = Schema.fromJsonString(Model.Ref)
const EvaluationRunJson = Schema.fromJsonString(SelfImprovementEvaluation.EvaluationRun)
const EvaluationDecisionJson = Schema.fromJsonString(SelfImprovementEvaluation.EvaluationDecision)
const GateFindingJson = Schema.fromJsonString(SelfImprovementEvaluation.GateFinding)
const encodePullArmIDs = Schema.encodeSync(PullArmIDsJson)
const decodePullArmIDs = Schema.decodeUnknownSync(PullArmIDsJson)
const encodeRouteArms = Schema.encodeSync(RouteArmsJson)
const encodeModelRef = Schema.encodeSync(ModelRefJson)
const decodeModelRef = Schema.decodeUnknownSync(ModelRefJson)
const decodeEvaluationRun = Schema.decodeUnknownSync(EvaluationRunJson)
const decodeEvaluationDecision = Schema.decodeUnknownSync(EvaluationDecisionJson)
const decodeGateFinding = Schema.decodeUnknownSync(GateFindingJson)

export type SelectionInput = Omit<SelfImprovementBandit.SelectionInput, "states">

export class Conflict extends Schema.TaggedErrorClass<Conflict>()("SelfImprovementLearningStore.Conflict", {
  message: Schema.String,
}) {}

export interface Interface {
  readonly putGenerationArm: (arm: SelfImprovementLearning.GenerationStrategyArm) => Effect.Effect<void, Conflict>
  readonly listGenerationArms: (
    locationID: SelfImprovementLifecycle.LocationID,
  ) => Effect.Effect<ReadonlyArray<SelfImprovementLearning.GenerationStrategyArm>>
  readonly putModelRouteArm: (arm: SelfImprovementLearning.ModelRouteArm) => Effect.Effect<void, Conflict>
  readonly listCurrentModelRouteArms: (
    locationID: SelfImprovementLifecycle.LocationID,
  ) => Effect.Effect<ReadonlyArray<SelfImprovementLearning.ModelRouteArm>>
  readonly eligibleModelRouteArms: (input: {
    readonly locationID: SelfImprovementLifecycle.LocationID
    readonly workload: SelfImprovementEvaluation.Workload
    readonly workloadRevision: SelfImprovementLifecycle.Revision
  }) => Effect.Effect<ReadonlyArray<SelfImprovementLearning.ModelRouteArm>>
  readonly appendPull: (pull: SelfImprovementLearning.PullEvent, tx?: Transaction) => Effect.Effect<void, Conflict>
  readonly modelRoutePullForVersion: (
    locationID: SelfImprovementLifecycle.LocationID,
    versionID: SelfImprovementLifecycle.ArtifactVersionID,
    tx?: Transaction,
  ) => Effect.Effect<SelfImprovementLearning.PullEvent | undefined>
  readonly appendReward: (
    reward: SelfImprovementLearning.RewardEvent,
    tx?: Transaction,
  ) => Effect.Effect<void, Conflict>
  readonly canaryRegression: (
    reward: SelfImprovementLearning.RewardEvent,
    candidateVersionID: SelfImprovementLifecycle.ArtifactVersionID,
    tx: Transaction,
  ) => Effect.Effect<void, Conflict>
  readonly appendRoutingDecision: (
    decision: SelfImprovementLearning.RoutingDecision,
    tx?: Transaction,
  ) => Effect.Effect<void, Conflict>
  readonly appendModelRouteEvidence: (input: {
    readonly pull: SelfImprovementLearning.PullEvent
    readonly decision: SelfImprovementLearning.RoutingDecision
  }) => Effect.Effect<void, Conflict>
  readonly rebuild: (
    locationID: SelfImprovementLifecycle.LocationID,
  ) => Effect.Effect<ReadonlyArray<SelfImprovementLearning.BanditState>>
  readonly select: (input: SelectionInput) => Effect.Effect<ReturnType<typeof SelfImprovementBandit.select>>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SelfImprovementLearningStore") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const db = (yield* Database.Service).db

    const putGenerationArm = Effect.fn("SelfImprovementLearningStore.putGenerationArm")(function* (
      arm: SelfImprovementLearning.GenerationStrategyArm,
    ) {
      const stored = yield* db
        .insert(SelfImprovementGenerationStrategyArmTable)
        .values({
          id: arm.id,
          location_id: arm.locationID,
          strategy_id: arm.strategyID,
          allowlist_revision: arm.allowlistRevision,
          active: arm.active,
        })
        .onConflictDoNothing()
        .returning({ id: SelfImprovementGenerationStrategyArmTable.id })
        .get()
        .pipe(Effect.orDie)
      if (stored === undefined) return yield* new Conflict({ message: "Generation strategy arm already exists" })
      return undefined
    })

    const listGenerationArms = Effect.fn("SelfImprovementLearningStore.listGenerationArms")(function* (
      locationID: SelfImprovementLifecycle.LocationID,
    ) {
      const arms = yield* db
        .select()
        .from(SelfImprovementGenerationStrategyArmTable)
        .where(
          and(
            eq(SelfImprovementGenerationStrategyArmTable.location_id, locationID),
            eq(SelfImprovementGenerationStrategyArmTable.active, true),
          ),
        )
        .orderBy(
          desc(SelfImprovementGenerationStrategyArmTable.allowlist_revision),
          asc(SelfImprovementGenerationStrategyArmTable.strategy_id),
          asc(SelfImprovementGenerationStrategyArmTable.id),
        )
        .all()
        .pipe(Effect.orDie)
      return arms.map(
        (arm) =>
          new SelfImprovementLearning.GenerationStrategyArm({
            id: arm.id,
            locationID: arm.location_id,
            strategyID: arm.strategy_id,
            allowlistRevision: arm.allowlist_revision,
            active: arm.active,
          }),
      )
    })

    const putModelRouteArm = Effect.fn("SelfImprovementLearningStore.putModelRouteArm")(function* (
      arm: SelfImprovementLearning.ModelRouteArm,
    ) {
      const stored = yield* db
        .insert(SelfImprovementModelRouteArmTable)
        .values({
          id: arm.id,
          location_id: arm.locationID,
          route_json: encodeModelRef(arm.route),
          allowlist_revision: arm.allowlistRevision,
          active: arm.active,
        })
        .onConflictDoNothing()
        .returning({ id: SelfImprovementModelRouteArmTable.id })
        .get()
        .pipe(Effect.orDie)
      if (stored === undefined) return yield* new Conflict({ message: "Model route arm already exists" })
      return undefined
    })

    const currentModelRouteArms = (client: Transaction, locationID: SelfImprovementLifecycle.LocationID) =>
      Effect.gen(function* () {
        const rows = yield* client
          .select()
          .from(SelfImprovementModelRouteArmTable)
          .where(eq(SelfImprovementModelRouteArmTable.location_id, locationID))
          .all()
          .pipe(Effect.orDie)
        const revision = rows.reduce<number | undefined>(
          (current, arm) =>
            current === undefined || arm.allowlist_revision > current ? arm.allowlist_revision : current,
          undefined,
        )
        if (revision === undefined) return []
        return rows
          .filter((arm) => arm.active && arm.allowlist_revision === revision)
          .map(
            (arm) =>
              new SelfImprovementLearning.ModelRouteArm({
                id: arm.id,
                locationID: arm.location_id,
                route: decodeModelRef(arm.route_json),
                allowlistRevision: arm.allowlist_revision,
                active: arm.active,
              }),
          )
          .toSorted(
            (left, right) =>
              left.route.providerID.localeCompare(right.route.providerID) ||
              left.route.id.localeCompare(right.route.id) ||
              (left.route.variant ?? "").localeCompare(right.route.variant ?? "") ||
              left.id.localeCompare(right.id),
          )
      })

    const listCurrentModelRouteArms = Effect.fn("SelfImprovementLearningStore.listCurrentModelRouteArms")(function* (
      locationID: SelfImprovementLifecycle.LocationID,
    ) {
      return yield* db.transaction((tx) => currentModelRouteArms(tx, locationID)).pipe(Effect.orDie)
    })

    const eligibleModelRouteArms = Effect.fn("SelfImprovementLearningStore.eligibleModelRouteArms")(function* (input: {
      readonly locationID: SelfImprovementLifecycle.LocationID
      readonly workload: SelfImprovementEvaluation.Workload
      readonly workloadRevision: SelfImprovementLifecycle.Revision
    }) {
      return yield* db
        .transaction((tx) =>
          Effect.gen(function* () {
            const arms = yield* currentModelRouteArms(tx, input.locationID)
            if (arms.length === 0) return []
            const [pulls, runs, decisions, findings, samples] = yield* Effect.all([
              tx
                .select()
                .from(SelfImprovementPullEventTable)
                .where(
                  and(
                    eq(SelfImprovementPullEventTable.location_id, input.locationID),
                    eq(SelfImprovementPullEventTable.action_domain, "model-route"),
                  ),
                )
                .all()
                .pipe(Effect.orDie),
              tx
                .select()
                .from(SelfImprovementEvaluationRunTable)
                .where(
                  and(
                    eq(SelfImprovementEvaluationRunTable.location_id, input.locationID),
                    eq(SelfImprovementEvaluationRunTable.state, "decided"),
                  ),
                )
                .all()
                .pipe(Effect.orDie),
              tx
                .select()
                .from(SelfImprovementEvaluationDecisionTable)
                .where(eq(SelfImprovementEvaluationDecisionTable.location_id, input.locationID))
                .all()
                .pipe(Effect.orDie),
              tx
                .select()
                .from(SelfImprovementEvaluationFindingTable)
                .where(eq(SelfImprovementEvaluationFindingTable.location_id, input.locationID))
                .all()
                .pipe(Effect.orDie),
              tx
                .select()
                .from(SelfImprovementEvaluationSampleTable)
                .where(eq(SelfImprovementEvaluationSampleTable.location_id, input.locationID))
                .all()
                .pipe(Effect.orDie),
            ])
            const decisionByRun = new Map(
              decisions.map((decision) => [decision.run_id, decodeEvaluationDecision(decision.decision_json)]),
            )
            const findingsByRun = Map.groupBy(findings, (finding) => finding.run_id)
            const taskIDsByRun = Map.groupBy(samples, (sample) => sample.run_id)
            return arms.filter((arm) =>
              pulls.some((pull) => {
                if (
                  pull.selected_arm_id !== arm.id ||
                  pull.allowlist_revision !== arm.allowlistRevision ||
                  pull.version_id === null
                )
                  return false
                return runs.some((row) => {
                  const run = decodeEvaluationRun(row.run_json)
                  if (
                    row.id !== run.id ||
                    run.versionID !== pull.version_id ||
                    run.stage !== "canary" ||
                    run.workload !== input.workload ||
                    run.workloadRevision !== input.workloadRevision ||
                    run.state !== "decided"
                  )
                    return false
                  const decision = decisionByRun.get(run.id)
                  if (decision?.decision !== "passed" || decision.aggregateReward <= 0) return false
                  const runFindings = findingsByRun.get(run.id) ?? []
                  if (
                    runFindings.length !== 23 ||
                    runFindings.some((finding) => decodeGateFinding(finding.finding_json).result === "fail")
                  )
                    return false
                  return new Set((taskIDsByRun.get(run.id) ?? []).map((sample) => sample.task_id_digest)).size >= 20
                })
              }),
            )
          }),
        )
        .pipe(Effect.orDie)
    })

    const appendPull = Effect.fn("SelfImprovementLearningStore.appendPull")(function* (
      pull: SelfImprovementLearning.PullEvent,
      tx?: Transaction,
    ) {
      const append = (client: Transaction) =>
        Effect.gen(function* () {
          const stored = yield* client
            .get<{ id: string }>(
              sql`
            INSERT INTO self_improvement_pull_event (
              id, location_id, action_domain, bucket_digest, derivation_revision, allowlist_revision,
              ordered_eligible_arm_ids_json, selected_arm_id, proposal_digest, session_digest, version_id, timestamp, expires_at
            ) VALUES (
              ${pull.id}, ${pull.locationID}, ${pull.actionDomain}, ${pull.bucketDigest}, ${pull.derivationRevision}, ${pull.allowlistRevision},
              ${encodePullArmIDs(pull.orderedEligibleArmIDs)}, ${pull.selectedArmID}, ${pull.proposalDigest ?? null}, ${pull.sessionDigest ?? null}, ${pull.versionID ?? null}, ${pull.timestamp}, ${pull.timestamp + RETENTION}
            ) ON CONFLICT DO NOTHING RETURNING id
          `,
            )
            .pipe(Effect.orDie)
          if (stored === undefined) return yield* new Conflict({ message: "Pull event already exists" })
          return undefined
        })
      if (tx) return yield* append(tx)
      return yield* db.transaction(append).pipe(Effect.catchTag("SqlError", Effect.die))
    })

    const modelRoutePullForVersion = Effect.fn("SelfImprovementLearningStore.modelRoutePullForVersion")(function* (
      locationID: SelfImprovementLifecycle.LocationID,
      versionID: SelfImprovementLifecycle.ArtifactVersionID,
      tx?: Transaction,
    ) {
      const row = yield* (tx ?? db)
        .select()
        .from(SelfImprovementPullEventTable)
        .where(
          and(
            eq(SelfImprovementPullEventTable.location_id, locationID),
            eq(SelfImprovementPullEventTable.action_domain, "model-route"),
            eq(SelfImprovementPullEventTable.version_id, versionID),
          ),
        )
        .orderBy(desc(SelfImprovementPullEventTable.timestamp), desc(SelfImprovementPullEventTable.id))
        .get()
        .pipe(Effect.orDie)
      if (row === undefined) return undefined
      return {
        id: row.id,
        locationID: row.location_id,
        actionDomain: row.action_domain,
        bucketDigest: row.bucket_digest,
        derivationRevision: row.derivation_revision,
        allowlistRevision: row.allowlist_revision,
        orderedEligibleArmIDs: decodePullArmIDs(row.ordered_eligible_arm_ids_json),
        selectedArmID: row.selected_arm_id,
        ...(row.proposal_digest === null ? {} : { proposalDigest: row.proposal_digest }),
        ...(row.session_digest === null ? {} : { sessionDigest: row.session_digest }),
        ...(row.version_id === null ? {} : { versionID: row.version_id }),
        timestamp: row.timestamp,
      } satisfies SelfImprovementLearning.PullEvent
    })

    const appendReward = Effect.fn("SelfImprovementLearningStore.appendReward")(function* (
      reward: SelfImprovementLearning.RewardEvent,
      tx?: Transaction,
    ) {
      const append = (client: Transaction) =>
        Effect.gen(function* () {
          const pull = yield* client
            .select({ locationID: SelfImprovementPullEventTable.location_id })
            .from(SelfImprovementPullEventTable)
            .where(eq(SelfImprovementPullEventTable.id, reward.pullEventID))
            .get()
            .pipe(Effect.orDie)
          if (pull === undefined || pull.locationID !== reward.locationID)
            return yield* new Conflict({ message: "Reward event pull is not in Location" })
          const stored = yield* client
            .get<{ id: string }>(
              sql`
            INSERT INTO self_improvement_reward_event (
              id, location_id, pull_event_id, outcome_class, numeric_reward, evidence_digest, timestamp, expires_at
            ) VALUES (
              ${reward.id}, ${reward.locationID}, ${reward.pullEventID}, ${reward.outcomeClass}, ${reward.numericReward ?? null}, ${reward.evidenceDigest}, ${reward.timestamp}, ${reward.timestamp + RETENTION}
            ) ON CONFLICT DO NOTHING RETURNING id
          `,
            )
            .pipe(Effect.orDie)
          if (stored === undefined) return yield* new Conflict({ message: "Reward event already exists" })
          return undefined
        })
      if (tx) return yield* append(tx)
      return yield* db.transaction(append).pipe(Effect.catchTag("SqlError", Effect.die))
    })

    const canaryRegression = Effect.fn("SelfImprovementLearningStore.canaryRegression")(function* (
      reward: SelfImprovementLearning.RewardEvent,
      candidateVersionID: SelfImprovementLifecycle.ArtifactVersionID,
      tx: Transaction,
    ) {
      if (reward.outcomeClass !== "canary-regression" || reward.numericReward !== -1)
        return yield* new Conflict({ message: "Canary regression reward must be -1" })
      const pull = yield* tx
        .select({
          locationID: SelfImprovementPullEventTable.location_id,
          actionDomain: SelfImprovementPullEventTable.action_domain,
          allowlistRevision: SelfImprovementPullEventTable.allowlist_revision,
          selectedArmID: SelfImprovementPullEventTable.selected_arm_id,
        })
        .from(SelfImprovementPullEventTable)
        .where(
          and(
            eq(SelfImprovementPullEventTable.id, reward.pullEventID),
            eq(SelfImprovementPullEventTable.location_id, reward.locationID),
            eq(SelfImprovementPullEventTable.action_domain, "model-route"),
            eq(SelfImprovementPullEventTable.version_id, candidateVersionID),
          ),
        )
        .get()
        .pipe(Effect.orDie)
      if (pull === undefined)
        return yield* new Conflict({ message: "Canary regression pull does not match candidate model route" })
      if (!pull.selectedArmID.startsWith("si_arm_"))
        return yield* new Conflict({ message: "Canary regression pull arm is not a model route" })
      yield* appendReward(reward, tx)
      const arm = yield* tx
        .update(SelfImprovementModelRouteArmTable)
        .set({ active: false })
        .where(
          and(
            eq(SelfImprovementModelRouteArmTable.id, SelfImprovementLifecycle.ModelRouteArmID.make(pull.selectedArmID)),
            eq(SelfImprovementModelRouteArmTable.location_id, reward.locationID),
            eq(SelfImprovementModelRouteArmTable.allowlist_revision, pull.allowlistRevision),
          ),
        )
        .returning({ id: SelfImprovementModelRouteArmTable.id })
        .get()
        .pipe(Effect.orDie)
      if (arm === undefined)
        return yield* new Conflict({ message: "Canary regression pull arm does not match Location revision" })
      return undefined
    })

    const appendRoutingDecision = Effect.fn("SelfImprovementLearningStore.appendRoutingDecision")(function* (
      decision: SelfImprovementLearning.RoutingDecision,
      tx?: Transaction,
    ) {
      const append = (client: Transaction) =>
        Effect.gen(function* () {
          if (decision.pullEventID) {
            const pull = yield* client
              .select({ locationID: SelfImprovementPullEventTable.location_id })
              .from(SelfImprovementPullEventTable)
              .where(eq(SelfImprovementPullEventTable.id, decision.pullEventID))
              .get()
              .pipe(Effect.orDie)
            if (pull === undefined || pull.locationID !== decision.locationID)
              return yield* new Conflict({ message: "Routing decision pull is not in Location" })
          }
          const stored = yield* client
            .get<{ id: string }>(
              sql`
            INSERT INTO self_improvement_routing_decision (
              id, location_id, session_digest, workload, workload_revision, role_digest, precedence_source,
              policy_snapshot_digest, catalog_snapshot_digest, variant_snapshot_digest, ordered_eligible_arms_json,
              selected_route_json, reason_code, pull_event_id, timestamp, expires_at
            ) VALUES (
              ${decision.id}, ${decision.locationID}, ${decision.sessionDigest}, ${decision.workload}, ${decision.workloadRevision}, ${decision.roleDigest}, ${decision.precedenceSource},
              ${decision.policySnapshotDigest}, ${decision.catalogSnapshotDigest}, ${decision.variantSnapshotDigest}, ${encodeRouteArms(decision.orderedEligibleArms)},
              ${encodeModelRef(decision.selectedRoute)}, ${decision.reasonCode}, ${decision.pullEventID ?? null}, ${decision.timestamp}, ${decision.timestamp + RETENTION}
            ) ON CONFLICT DO NOTHING RETURNING id
          `,
            )
            .pipe(Effect.orDie)
          if (stored === undefined) return yield* new Conflict({ message: "Routing decision already exists" })
          return undefined
        })
      if (tx) return yield* append(tx)
      return yield* db.transaction(append).pipe(Effect.catchTag("SqlError", Effect.die))
    })

    const appendModelRouteEvidence = Effect.fn("SelfImprovementLearningStore.appendModelRouteEvidence")(
      function* (input: {
        readonly pull: SelfImprovementLearning.PullEvent
        readonly decision: SelfImprovementLearning.RoutingDecision
      }) {
        if (
          input.pull.actionDomain !== "model-route" ||
          input.pull.versionID === undefined ||
          input.decision.pullEventID !== input.pull.id ||
          input.decision.locationID !== input.pull.locationID ||
          !input.pull.orderedEligibleArmIDs.includes(input.pull.selectedArmID)
        )
          return yield* new Conflict({ message: "Model route evidence is not linked to its selected pull" })
        yield* db
          .transaction((tx) =>
            Effect.gen(function* () {
              const arm = yield* tx
                .select()
                .from(SelfImprovementModelRouteArmTable)
                .where(
                  and(
                    eq(
                      SelfImprovementModelRouteArmTable.id,
                      SelfImprovementLifecycle.ModelRouteArmID.make(input.pull.selectedArmID),
                    ),
                    eq(SelfImprovementModelRouteArmTable.location_id, input.pull.locationID),
                    eq(SelfImprovementModelRouteArmTable.allowlist_revision, input.pull.allowlistRevision),
                    eq(SelfImprovementModelRouteArmTable.active, true),
                  ),
                )
                .get()
                .pipe(Effect.orDie)
              if (
                arm === undefined ||
                JSON.stringify(decodeModelRef(arm.route_json)) !== JSON.stringify(input.decision.selectedRoute)
              )
                return yield* new Conflict({ message: "Model route evidence does not match an active allowlisted arm" })
              yield* appendPull(input.pull, tx)
              yield* appendRoutingDecision(input.decision, tx)
            }),
          )
          .pipe(Effect.catchTag("SqlError", Effect.die))
      },
    )

    const rebuildProjection = (
      client: Transaction,
      locationID: SelfImprovementLifecycle.LocationID,
      now: SelfImprovementLifecycle.TimestampMillis,
    ) => {
      return Effect.gen(function* () {
        const pulls = yield* client
          .select()
          .from(SelfImprovementPullEventTable)
          .where(
            and(
              eq(SelfImprovementPullEventTable.location_id, locationID),
              gt(SelfImprovementPullEventTable.expires_at, now),
            ),
          )
          .orderBy(asc(SelfImprovementPullEventTable.timestamp), asc(SelfImprovementPullEventTable.id))
          .all()
          .pipe(Effect.orDie)
        const rewards = yield* client
          .select()
          .from(SelfImprovementRewardEventTable)
          .where(
            and(
              eq(SelfImprovementRewardEventTable.location_id, locationID),
              gt(SelfImprovementRewardEventTable.expires_at, now),
            ),
          )
          .all()
          .pipe(Effect.orDie)
        const generationArms = yield* client
          .select()
          .from(SelfImprovementGenerationStrategyArmTable)
          .where(eq(SelfImprovementGenerationStrategyArmTable.location_id, locationID))
          .all()
          .pipe(Effect.orDie)
        const routeArms = yield* client
          .select()
          .from(SelfImprovementModelRouteArmTable)
          .where(eq(SelfImprovementModelRouteArmTable.location_id, locationID))
          .all()
          .pipe(Effect.orDie)
        const active = new Map([...generationArms, ...routeArms].map((arm) => [arm.id, arm.active]))
        const rewardByPull = new Map(rewards.map((reward) => [reward.pull_event_id, reward]))
        const states = [
          ...pulls
            .reduce((result, pull) => {
              const key = [
                pull.action_domain,
                pull.bucket_digest,
                pull.derivation_revision,
                pull.allowlist_revision,
                pull.selected_arm_id,
              ].join("\0")
              const previous = result.get(key)
              const reward = rewardByPull.get(pull.id)
              const numericReward = reward?.numeric_reward ?? undefined
              const rewardedPullTotal = previous?.rewardedPullTotal ?? 0
              const cumulativeReward = previous?.cumulativeReward ?? 0
              const nextRewardedPullTotal = rewardedPullTotal + (numericReward === undefined ? 0 : 1)
              const nextCumulativeReward = cumulativeReward + (numericReward ?? 0)
              result.set(key, {
                locationID,
                actionDomain: pull.action_domain,
                bucketDigest: pull.bucket_digest,
                derivationRevision: pull.derivation_revision,
                allowlistRevision: pull.allowlist_revision,
                armID: pull.selected_arm_id,
                pullTotal: (previous?.pullTotal ?? 0) + 1,
                rewardedPullTotal: nextRewardedPullTotal,
                cumulativeReward: nextCumulativeReward,
                meanReward: nextRewardedPullTotal === 0 ? 0 : nextCumulativeReward / nextRewardedPullTotal,
                active: active.get(pull.selected_arm_id) ?? false,
                latestPullEventID: pull.id,
                ...(reward === undefined
                  ? previous?.latestRewardEventID === undefined
                    ? {}
                    : { latestRewardEventID: previous.latestRewardEventID }
                  : { latestRewardEventID: reward.id }),
              })
              return result
            }, new Map<string, SelfImprovementLearning.BanditState>())
            .values(),
        ]

        yield* client
          .delete(SelfImprovementBanditStateTable)
          .where(eq(SelfImprovementBanditStateTable.location_id, locationID))
          .run()
        if (states.length > 0)
          yield* client
            .insert(SelfImprovementBanditStateTable)
            .values(
              states.map((state) => ({
                location_id: state.locationID,
                action_domain: state.actionDomain,
                bucket_digest: state.bucketDigest,
                derivation_revision: state.derivationRevision,
                allowlist_revision: state.allowlistRevision,
                arm_id: state.armID,
                pull_total: state.pullTotal,
                rewarded_pull_total: state.rewardedPullTotal,
                cumulative_reward: state.cumulativeReward,
                mean_reward: state.meanReward,
                active: state.active,
                latest_pull_event_id: state.latestPullEventID ?? null,
                latest_reward_event_id: state.latestRewardEventID ?? null,
              })),
            )
            .run()
        return states
      })
    }

    const rebuild = Effect.fn("SelfImprovementLearningStore.rebuild")(function* (
      locationID: SelfImprovementLifecycle.LocationID,
    ) {
      const now = SelfImprovementLifecycle.TimestampMillis.make(yield* Clock.currentTimeMillis)
      return yield* db.transaction((tx) => rebuildProjection(tx, locationID, now)).pipe(Effect.orDie)
    })

    const select = Effect.fn("SelfImprovementLearningStore.select")(function* (input: SelectionInput) {
      const now = SelfImprovementLifecycle.TimestampMillis.make(yield* Clock.currentTimeMillis)
      return yield* db
        .transaction((tx) =>
          Effect.map(rebuildProjection(tx, input.locationID, now), (states) =>
            SelfImprovementBandit.select({ ...input, states }),
          ),
        )
        .pipe(Effect.orDie)
    })

    return Service.of({
      putGenerationArm,
      listGenerationArms,
      putModelRouteArm,
      listCurrentModelRouteArms,
      eligibleModelRouteArms,
      appendPull,
      modelRoutePullForVersion,
      appendReward,
      canaryRegression,
      appendRoutingDecision,
      appendModelRouteEvidence,
      rebuild,
      select,
    })
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [Database.node] })
