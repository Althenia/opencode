export * as ConfigExperimental from "./experimental"

import { Schema } from "effect"
import { SelfImprovementLifecycle } from "@opencode-ai/schema"
import { Catalog } from "../catalog"
import { Policy as PolicyV2 } from "../policy"

// Each core domain exports the policy actions it supports. Adding an action to
// this union makes it valid in authored config while keeping Policy generic.
export const PolicyAction = Schema.Union([Catalog.PolicyActions])

export class Policy extends Schema.Class<Policy>("ConfigV2.Experimental.Policy")({
  ...PolicyV2.Info.fields,
  action: PolicyAction,
}) {}

export class SelfImprovement extends Schema.Class<SelfImprovement>("ConfigV2.Experimental.SelfImprovement")({
  automatic: Schema.Boolean.pipe(Schema.optional),
  interval_seconds: Schema.Int.check(Schema.isGreaterThanOrEqualTo(5), Schema.isLessThanOrEqualTo(3_600)).pipe(
    Schema.optional,
  ),
  evaluation_window_minutes: Schema.Int.check(
    Schema.isGreaterThanOrEqualTo(1),
    Schema.isLessThanOrEqualTo(10_080),
  ).pipe(Schema.optional),
  evidence_principal_id: SelfImprovementLifecycle.PrincipalID.pipe(Schema.optional),
}) {}

export class Experimental extends Schema.Class<Experimental>("ConfigV2.Experimental")({
  policies: Policy.pipe(Schema.Array, Schema.optional),
  self_improvement: SelfImprovement.pipe(Schema.optional),
}) {}
