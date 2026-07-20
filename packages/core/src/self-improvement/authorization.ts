export * as SelfImprovementAuthorization from "./authorization"

import { Effect, Schema } from "effect"
import { SelfImprovementLifecycle } from "@opencode-ai/schema"

export class Forbidden extends Schema.TaggedErrorClass<Forbidden>()("SelfImprovementAuthorization.Forbidden", {
  message: Schema.String,
}) {}

const allowed: Readonly<
  Record<SelfImprovementLifecycle.Operation, ReadonlyArray<SelfImprovementLifecycle.PrincipalKind>>
> = {
  "artifact.read": ["first-party-user", "location-approver", "evaluator", "coordinator", "audit-reader"],
  "artifact.create": ["first-party-user", "coordinator"],
  "artifact.archive": ["first-party-user", "coordinator"],
  "artifact.tombstone": ["first-party-user", "coordinator"],
  "approval.decide": ["location-approver"],
  "evidence.ingest": ["runtime-evidence-service"],
  "generation.execute": ["coordinator"],
  "evaluation.decide": ["evaluator"],
  "lifecycle.transition": ["coordinator"],
  "learning.update": ["coordinator"],
  "context.reconcile": ["coordinator"],
  "audit.read": ["audit-reader"],
}

export const authorize = Effect.fn("SelfImprovementAuthorization.authorize")(function* (
  principal: SelfImprovementLifecycle.Principal,
  operation: SelfImprovementLifecycle.Operation,
  locationID: SelfImprovementLifecycle.LocationID,
) {
  if (principal.locationID !== locationID)
    return yield* new Forbidden({ message: "Principal is not granted to this Location" })
  if (!allowed[operation].includes(principal.kind))
    return yield* new Forbidden({ message: "Principal is not authorized for this operation" })
  return undefined
})
