export * as ConfigExperimental from "./experimental"

import { SelfImprovementLifecycle } from "@opencode-ai/schema"
import { Schema } from "effect"
import { NonNegativeInt } from "../schema"
import { ConfigPolicy } from "./policy"

export class SelfImprovement extends Schema.Class<SelfImprovement>("ConfigExperimental.SelfImprovement")({
  automatic: Schema.Boolean.pipe(Schema.optional),
  auto_approve: Schema.Boolean.pipe(Schema.optional),
  interval_seconds: Schema.Int.check(Schema.isGreaterThanOrEqualTo(5), Schema.isLessThanOrEqualTo(3_600)).pipe(
    Schema.optional,
  ),
  evaluation_window_minutes: Schema.Int.check(
    Schema.isGreaterThanOrEqualTo(1),
    Schema.isLessThanOrEqualTo(10_080),
  ).pipe(Schema.optional),
  evidence_principal_id: SelfImprovementLifecycle.PrincipalID.pipe(Schema.optional),
}) {}

export class Info extends Schema.Class<Info>("ConfigExperimental.Info")({
  subagent_depth: NonNegativeInt.pipe(Schema.optional).annotate({
    description: "Maximum subagent nesting depth. Defaults to 1.",
  }),
  policies: ConfigPolicy.Info.pipe(Schema.Array, Schema.optional).annotate({
    description: "Ordered policies controlling access to configured resources",
  }),
  self_improvement: SelfImprovement.pipe(Schema.optional).annotate({
    description: "Automatic, governed self-improvement settings",
  }),
}) {}

export const Experimental = Info
