import { expect, test } from "bun:test"
import { DateTime, Effect } from "effect"
import {
  Model,
  Money,
  SelfImprovement,
  SelfImprovementEvaluation,
  SelfImprovementLearning,
  SelfImprovementLifecycle,
} from "@opencode-ai/schema"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProjectV2 } from "@opencode-ai/core/project"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { Routing } from "@opencode-ai/core/self-improvement/routing"
import { SelfImprovementContracts } from "@opencode-ai/core/self-improvement/contracts"

const digest = (value: string) => SelfImprovement.Digest.make(value.repeat(64))
const route = (id: string, providerID = "provider"): Model.Ref => ({
  providerID: ProviderV2.ID.make(providerID),
  id: ModelV2.ID.make(id),
  variant: ModelV2.VariantID.make("configured"),
})
const session = SessionV2.Info.make({
  id: SessionV2.ID.make("ses_routing"),
  projectID: ProjectV2.ID.global,
  title: "routing",
  cost: Money.USD.make(0),
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: DateTime.makeUnsafe(0), updated: DateTime.makeUnsafe(0) },
  location: { directory: AbsolutePath.make("/project") },
})

const model = (id: string, providerID = "provider") =>
  ModelV2.Info.make({
    id: ModelV2.ID.make(id),
    providerID: ProviderV2.ID.make(providerID),
    modelID: ModelV2.ID.make(id),
    name: id,
    package: "@opencode-ai/ai/providers/openai",
    capabilities: { tools: true, input: ["text"], output: ["text"] },
    enabled: true,
    variants: [{ id: ModelV2.VariantID.make("configured") }],
    time: { released: 0 },
    cost: [],
    status: "active",
    limit: { context: 100, output: 20 },
  })

const binding = {
  workload: SelfImprovementEvaluation.Workload.make("typescript"),
  workloadRevision: SelfImprovementLifecycle.Revision.make(1),
  roleDigest: digest("b"),
}
const sessionLocationID = SelfImprovementContracts.locationID(session.location)

const make = (
  options: {
    readonly arms?: ReadonlyArray<SelfImprovementLearning.ModelRouteArm>
    readonly default?: string
    readonly available?: ReadonlyArray<string | { readonly id: string; readonly providerID: string }>
    readonly binding?: Routing.WorkloadBinding
    readonly denied?: string
  } = {},
) => {
  const appended: SelfImprovementLearning.RoutingDecision[] = []
  const pulls: SelfImprovementLearning.PullEvent[] = []
  const router = Routing.make(
    {
      eligibleModelRouteArms: () => Effect.succeed(options.arms ?? []),
      listCurrentModelRouteArms: () => Effect.succeed(options.arms ?? []),
      policyEvaluate: (_action, resource) => Effect.succeed(resource === options.denied ? "deny" : "allow"),
      catalogModelGet: (providerID, modelID) => Effect.succeed(model(modelID, providerID)),
      catalogModelAvailable: () =>
        Effect.succeed(
          (options.available ?? ["session", "role", "recommended", "default", "fallback"]).map((item) =>
            typeof item === "string" ? model(item) : model(item.id, item.providerID),
          ),
        ),
      catalogModelDefault: () =>
        Effect.succeed(options.default === undefined ? model("default") : model(options.default)),
      appendRoutingDecision: (decision) => Effect.sync(() => void appended.push(decision)),
      appendModelRouteEvidence: ({ pull, decision }) =>
        Effect.sync(() => {
          pulls.push(pull)
          appended.push(decision)
        }),
      select: ({ buckets, eligibleArmIDs }) =>
        Effect.succeed({ bucketDigest: buckets[0]!, selectedArmID: eligibleArmIDs[0]! }),
      materialize: () => Effect.succeed({} as never),
    },
    () => Effect.succeed(options.binding),
  )
  return { appended, pulls, router }
}

test("uses session, role, recommendation, default, and fallback precedence in order", async () => {
  const recommended = new SelfImprovementLearning.ModelRouteArm({
    id: SelfImprovementLifecycle.ModelRouteArmID.make("si_arm_routing"),
    locationID: sessionLocationID,
    route: route("recommended"),
    allowlistRevision: SelfImprovementLifecycle.Revision.make(1),
    active: true,
  })
  const cases = [
    {
      input: { session: { ...session, model: route("session") }, roleRoute: route("role") },
      route: "session",
      source: "session-user",
    },
    { input: { session, roleRoute: route("role") }, route: "role", source: "role" },
    { input: { session }, route: "recommended", source: "active-recommendation" },
    { input: { session }, route: "default", source: "catalog-default", arms: [] },
    {
      input: { session },
      route: "fallback",
      source: "catalog-fallback",
      arms: [],
      default: "missing",
      available: ["fallback"],
    },
  ] as const

  for (const item of cases) {
    const { appended, router } = make({
      ...item,
      arms: ("arms" in item ? item.arms : undefined) ?? [recommended],
      binding,
    })
    const result = await Effect.runPromise(router.resolve(item.input))
    expect(String(result.route.id)).toBe(item.route)
    expect(result.decision?.precedenceSource).toBe(item.source)
    expect(appended).toEqual(result.decision ? [result.decision] : [])
  }
})

test("prefers a fallback from the configured default provider", async () => {
  const { router } = make({
    binding,
    default: "missing",
    available: [
      { id: "ambient", providerID: "ambient" },
      { id: "fallback", providerID: "provider" },
    ],
  })
  const result = await Effect.runPromise(router.resolve({ session }))
  expect(result.route).toMatchObject({ providerID: "provider", id: "fallback" })
  expect(result.decision?.precedenceSource).toBe("catalog-fallback")
})

test("fails closed for recommendations without a workload binding while preserving default fallback", async () => {
  const { appended, router } = make({
    arms: [
      new SelfImprovementLearning.ModelRouteArm({
        id: SelfImprovementLifecycle.ModelRouteArmID.make("si_arm_routing"),
        locationID: SelfImprovementLifecycle.LocationID.make("a".repeat(64)),
        route: route("recommended"),
        allowlistRevision: SelfImprovementLifecycle.Revision.make(1),
        active: true,
      }),
    ],
  })
  const result = await Effect.runPromise(router.resolve({ session }))
  expect(String(result.route.id)).toBe("default")
  expect(result.decision).toBeUndefined()
  expect(appended).toEqual([])
})

test("invalidates wrong-location evidence and denied routes before appending one decision", async () => {
  const { appended, router } = make({
    binding,
    denied: "denied",
    arms: [
      new SelfImprovementLearning.ModelRouteArm({
        id: SelfImprovementLifecycle.ModelRouteArmID.make("si_arm_wrong_location"),
        locationID: SelfImprovementLifecycle.LocationID.make("a".repeat(64)),
        route: route("recommended"),
        allowlistRevision: SelfImprovementLifecycle.Revision.make(1),
        active: true,
      }),
    ],
  })
  const result = await Effect.runPromise(router.resolve({ session, roleRoute: route("role", "denied") }))
  expect(String(result.route.id)).toBe("default")
  expect(result.decision?.orderedEligibleArms).toEqual([])
  expect(appended).toHaveLength(1)
})

test("materializes a candidate evaluation route before recording its bound pull and decision", async () => {
  const arm = new SelfImprovementLearning.ModelRouteArm({
    id: SelfImprovementLifecycle.ModelRouteArmID.make("si_arm_evaluation"),
    locationID: sessionLocationID,
    route: route("recommended"),
    allowlistRevision: SelfImprovementLifecycle.Revision.make(1),
    active: true,
  })
  const { appended, pulls, router } = make({ arms: [arm] })
  const result = await Effect.runPromise(
    router.evaluate({
      session,
      versionID: SelfImprovementLifecycle.ArtifactVersionID.make("si_ver_evaluation"),
      binding,
    }),
  )
  if (result.decision === undefined) throw new Error("Expected routing decision")
  expect(result.decision.pullEventID).toBe(pulls[0]?.id)
  expect(pulls[0]).toMatchObject({ versionID: "si_ver_evaluation", selectedArmID: arm.id })
  expect(appended).toEqual([result.decision])
})

test("uses the specified unbiased 5 percent cohort boundary", () => {
  expect(Routing.inCanaryCohort("0".repeat(64), "0".repeat(64))).toBe(false)
  expect(Routing.inCanaryCohort("0".repeat(64), `${"0".repeat(63)}9`)).toBe(true)
  expect(Routing.inCanaryCohort("a".repeat(64), "b".repeat(64))).toBe(false)
})
