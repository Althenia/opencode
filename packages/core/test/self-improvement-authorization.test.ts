import { expect, test } from "bun:test"
import { SelfImprovementLifecycle } from "@opencode-ai/schema"
import { Effect } from "effect"
import { SelfImprovementAuthorization } from "@opencode-ai/core/self-improvement/authorization"

const locationID = SelfImprovementLifecycle.LocationID.make("a".repeat(64))
const otherLocationID = SelfImprovementLifecycle.LocationID.make("b".repeat(64))

const principal = (kind: SelfImprovementLifecycle.PrincipalKind, currentLocationID = locationID) =>
  new SelfImprovementLifecycle.Principal({
    id: SelfImprovementLifecycle.PrincipalID.make(kind),
    kind,
    locationID: currentLocationID,
  })

test("allows only designated principals and rejects every other principal kind", async () => {
  const allowed = [
    ["runtime-evidence-service", "evidence.ingest"],
    ["location-approver", "approval.decide"],
    ["evaluator", "evaluation.decide"],
    ["coordinator", "generation.execute"],
    ["coordinator", "lifecycle.transition"],
    ["coordinator", "learning.update"],
    ["coordinator", "context.reconcile"],
    ["audit-reader", "audit.read"],
  ] as const

  for (const [kind, operation] of allowed) {
    await Effect.runPromise(SelfImprovementAuthorization.authorize(principal(kind), operation, locationID))
    for (const deniedKind of SelfImprovementLifecycle.PrincipalKinds.filter((value) => value !== kind)) {
      const denied = await Effect.runPromise(
        SelfImprovementAuthorization.authorize(principal(deniedKind), operation, locationID).pipe(Effect.flip),
      )
      expect(denied._tag).toBe("SelfImprovementAuthorization.Forbidden")
    }
  }
})

test("rejects every operation across Locations", async () => {
  const denied = await Effect.runPromise(
    SelfImprovementAuthorization.authorize(
      principal("runtime-evidence-service", otherLocationID),
      "evidence.ingest",
      locationID,
    ).pipe(Effect.flip),
  )
  expect(denied._tag).toBe("SelfImprovementAuthorization.Forbidden")
})

test("enforces every artifact operation principal matrix", async () => {
  const allowed = [
    ["artifact.read", ["first-party-user", "location-approver", "evaluator", "coordinator", "audit-reader"]],
    ["artifact.create", ["first-party-user", "coordinator"]],
    ["artifact.archive", ["first-party-user", "coordinator"]],
    ["artifact.tombstone", ["first-party-user", "coordinator"]],
  ] as const

  for (const [operation, allowedKinds] of allowed) {
    for (const kind of SelfImprovementLifecycle.PrincipalKinds) {
      const result = SelfImprovementAuthorization.authorize(principal(kind), operation, locationID)
      if (allowedKinds.some((allowed) => allowed === kind)) {
        await Effect.runPromise(result)
        continue
      }
      expect((await Effect.runPromise(result.pipe(Effect.flip)))._tag).toBe("SelfImprovementAuthorization.Forbidden")
    }
  }
})
