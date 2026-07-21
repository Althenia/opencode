import { check, index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"
import { sql } from "drizzle-orm"
import { SelfImprovement, SelfImprovementLearning, SelfImprovementLifecycle } from "@opencode-ai/schema"

export const SelfImprovementGenerationStrategyArmTable = sqliteTable(
  "self_improvement_generation_strategy_arm",
  {
    id: text().$type<SelfImprovementLifecycle.GenerationStrategyArmID>().notNull().primaryKey(),
    location_id: text().$type<SelfImprovementLifecycle.LocationID>().notNull(),
    strategy_id: text().notNull(),
    allowlist_revision: integer().$type<SelfImprovementLifecycle.Revision>().notNull(),
    active: integer({ mode: "boolean" }).notNull(),
  },
  (table) => [
    uniqueIndex("self_improvement_generation_strategy_arm_location_strategy_idx").on(
      table.location_id,
      table.strategy_id,
    ),
  ],
)

export const SelfImprovementModelRouteArmTable = sqliteTable(
  "self_improvement_model_route_arm",
  {
    id: text().$type<SelfImprovementLifecycle.ModelRouteArmID>().notNull().primaryKey(),
    location_id: text().$type<SelfImprovementLifecycle.LocationID>().notNull(),
    route_json: text().notNull(),
    allowlist_revision: integer().$type<SelfImprovementLifecycle.Revision>().notNull(),
    active: integer({ mode: "boolean" }).notNull(),
  },
  (table) => [
    uniqueIndex("self_improvement_model_route_arm_location_route_idx").on(table.location_id, table.route_json),
  ],
)

export const SelfImprovementPullEventTable = sqliteTable(
  "self_improvement_pull_event",
  {
    id: text().$type<SelfImprovementLifecycle.PullEventID>().notNull().primaryKey(),
    location_id: text().$type<SelfImprovementLifecycle.LocationID>().notNull(),
    action_domain: text().$type<SelfImprovementLearning.ActionDomain>().notNull(),
    bucket_digest: text().$type<SelfImprovement.Digest>().notNull(),
    derivation_revision: integer().$type<SelfImprovementLifecycle.Revision>().notNull(),
    allowlist_revision: integer().$type<SelfImprovementLifecycle.Revision>().notNull(),
    ordered_eligible_arm_ids_json: text().notNull(),
    selected_arm_id: text().$type<SelfImprovementLearning.BanditArmID>().notNull(),
    proposal_digest: text().$type<SelfImprovement.Digest>(),
    session_digest: text().$type<SelfImprovement.Digest>(),
    version_id: text().$type<SelfImprovementLifecycle.ArtifactVersionID>(),
    timestamp: integer().$type<SelfImprovementLifecycle.TimestampMillis>().notNull(),
    expires_at: integer().$type<SelfImprovementLifecycle.TimestampMillis>().notNull(),
  },
  (table) => [
    index("self_improvement_pull_event_location_bucket_timestamp_idx").on(
      table.location_id,
      table.action_domain,
      table.bucket_digest,
      table.timestamp,
      table.id,
    ),
    check("self_improvement_pull_event_retention", sql`${table.expires_at} = ${table.timestamp} + 180 * 86400000`),
  ],
)

export const SelfImprovementRewardEventTable = sqliteTable(
  "self_improvement_reward_event",
  {
    id: text().$type<SelfImprovementLifecycle.RewardEventID>().notNull().primaryKey(),
    location_id: text().$type<SelfImprovementLifecycle.LocationID>().notNull(),
    pull_event_id: text().$type<SelfImprovementLifecycle.PullEventID>().notNull(),
    outcome_class: text().$type<SelfImprovementLearning.RewardOutcomeClass>().notNull(),
    numeric_reward: real(),
    evidence_digest: text().$type<SelfImprovement.Digest>().notNull(),
    timestamp: integer().$type<SelfImprovementLifecycle.TimestampMillis>().notNull(),
    expires_at: integer().$type<SelfImprovementLifecycle.TimestampMillis>().notNull(),
  },
  (table) => [
    uniqueIndex("self_improvement_reward_event_pull_idx").on(table.pull_event_id),
    index("self_improvement_reward_event_location_timestamp_idx").on(table.location_id, table.timestamp, table.id),
    check("self_improvement_reward_event_retention", sql`${table.expires_at} = ${table.timestamp} + 180 * 86400000`),
  ],
)

export const SelfImprovementRoutingDecisionTable = sqliteTable(
  "self_improvement_routing_decision",
  {
    id: text().$type<SelfImprovementLifecycle.RoutingDecisionID>().notNull().primaryKey(),
    location_id: text().$type<SelfImprovementLifecycle.LocationID>().notNull(),
    session_digest: text().$type<SelfImprovement.Digest>().notNull(),
    workload: text().notNull(),
    workload_revision: integer().$type<SelfImprovementLifecycle.Revision>().notNull(),
    role_digest: text().$type<SelfImprovement.Digest>().notNull(),
    precedence_source: text().$type<SelfImprovementLearning.RoutingPrecedenceSource>().notNull(),
    policy_snapshot_digest: text().$type<SelfImprovement.Digest>().notNull(),
    catalog_snapshot_digest: text().$type<SelfImprovement.Digest>().notNull(),
    variant_snapshot_digest: text().$type<SelfImprovement.Digest>().notNull(),
    ordered_eligible_arms_json: text().notNull(),
    selected_route_json: text().notNull(),
    reason_code: text().notNull(),
    pull_event_id: text().$type<SelfImprovementLifecycle.PullEventID>(),
    timestamp: integer().$type<SelfImprovementLifecycle.TimestampMillis>().notNull(),
    expires_at: integer().$type<SelfImprovementLifecycle.TimestampMillis>().notNull(),
  },
  (table) => [
    index("self_improvement_routing_decision_location_timestamp_idx").on(table.location_id, table.timestamp, table.id),
    check(
      "self_improvement_routing_decision_retention",
      sql`${table.expires_at} = ${table.timestamp} + 180 * 86400000`,
    ),
  ],
)

export const SelfImprovementBanditStateTable = sqliteTable(
  "self_improvement_bandit_state",
  {
    location_id: text().$type<SelfImprovementLifecycle.LocationID>().notNull(),
    action_domain: text().$type<SelfImprovementLearning.ActionDomain>().notNull(),
    bucket_digest: text().$type<SelfImprovement.Digest>().notNull(),
    derivation_revision: integer().$type<SelfImprovementLifecycle.Revision>().notNull(),
    allowlist_revision: integer().$type<SelfImprovementLifecycle.Revision>().notNull(),
    arm_id: text().$type<SelfImprovementLearning.BanditArmID>().notNull(),
    pull_total: integer().notNull(),
    rewarded_pull_total: integer().notNull(),
    cumulative_reward: real().notNull(),
    mean_reward: real().notNull(),
    active: integer({ mode: "boolean" }).notNull(),
    latest_pull_event_id: text().$type<SelfImprovementLifecycle.PullEventID>(),
    latest_reward_event_id: text().$type<SelfImprovementLifecycle.RewardEventID>(),
  },
  (table) => [
    uniqueIndex("self_improvement_bandit_state_key_idx").on(
      table.location_id,
      table.action_domain,
      table.bucket_digest,
      table.derivation_revision,
      table.allowlist_revision,
      table.arm_id,
    ),
  ],
)
