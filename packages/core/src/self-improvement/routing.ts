export * as Routing from "./routing"

import { Clock, Context, Effect, Layer, Schema } from "effect"
import {
  Model,
  SelfImprovement,
  SelfImprovementEvaluation,
  SelfImprovementLearning,
  SelfImprovementLifecycle,
} from "@opencode-ai/schema"
import { Catalog } from "../catalog"
import { makeLocationNode } from "../effect/app-node"
import { Policy } from "../policy"
import { SessionSchema } from "../session/schema"
import { SessionRunnerModel } from "../session/runner/model"
import { Hash } from "../util/hash"
import { locationID } from "./contracts"
import { SelfImprovementLearningStore } from "./learning-store"

export class RouteUnavailable extends Schema.TaggedErrorClass<RouteUnavailable>()(
  "SelfImprovementRouting.RouteUnavailable",
  { message: Schema.String },
) {}

export interface WorkloadBinding {
  readonly workload: SelfImprovementEvaluation.Workload
  readonly workloadRevision: SelfImprovementLifecycle.Revision
  readonly roleDigest: SelfImprovement.Digest
}

export interface Result {
  readonly route: Model.Ref
  readonly decision?: SelfImprovementLearning.RoutingDecision
}

export interface Interface {
  readonly resolve: (input: {
    readonly session: SessionSchema.Info
    readonly roleRoute?: Model.Ref
  }) => Effect.Effect<Result, RouteUnavailable | SelfImprovementLearningStore.Conflict>
  readonly evaluate: (input: {
    readonly session: SessionSchema.Info
    readonly versionID: SelfImprovementLifecycle.ArtifactVersionID
    readonly binding: WorkloadBinding
  }) => Effect.Effect<Result, RouteUnavailable | SelfImprovementLearningStore.Conflict>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SelfImprovementRouting") {}

export interface Dependencies {
  readonly policyEvaluate: Policy.Interface["evaluate"]
  readonly catalogModelGet: Catalog.Interface["model"]["get"]
  readonly catalogModelAvailable: Catalog.Interface["model"]["available"]
  readonly catalogModelDefault: Catalog.Interface["model"]["default"]
  readonly eligibleModelRouteArms: SelfImprovementLearningStore.Interface["eligibleModelRouteArms"]
  readonly listCurrentModelRouteArms: SelfImprovementLearningStore.Interface["listCurrentModelRouteArms"]
  readonly appendRoutingDecision: SelfImprovementLearningStore.Interface["appendRoutingDecision"]
  readonly appendModelRouteEvidence: SelfImprovementLearningStore.Interface["appendModelRouteEvidence"]
  readonly select: SelfImprovementLearningStore.Interface["select"]
  readonly materialize: (
    session: SessionSchema.Info,
    route: Model.Ref,
  ) => Effect.Effect<SessionRunnerModel.Resolved, SessionRunnerModel.Error>
}

export const make = (
  dependencies: Dependencies,
  workloadBinding: (session: SessionSchema.Info) => Effect.Effect<WorkloadBinding | undefined> = () =>
    Effect.succeed(undefined),
): Interface => ({
  resolve: Effect.fn("SelfImprovementRouting.resolve")(function* (input) {
    const binding = yield* workloadBinding(input.session)
    const sessionCandidate = input.session.model
      ? { source: "session-user" as const, route: input.session.model }
      : undefined
    const roleCandidate = input.roleRoute ? { source: "role" as const, route: input.roleRoute } : undefined
    const recommendation = binding ? yield* resolveRecommendation(dependencies, input.session, binding) : undefined
    const selected =
      (sessionCandidate && (yield* resolveCandidate(dependencies, sessionCandidate))) ||
      (roleCandidate && (yield* resolveCandidate(dependencies, roleCandidate))) ||
      recommendation?.selected ||
      (yield* resolveDefault(dependencies)) ||
      (yield* resolveFallback(dependencies))
    if (selected === undefined) return yield* new RouteUnavailable({ message: "No eligible model route is available" })
    yield* dependencies
      .materialize(input.session, selected.route)
      .pipe(Effect.mapError(() => new RouteUnavailable({ message: "Selected model route cannot be materialized" })))
    if (binding === undefined) return { route: selected.route }

    const decision = new SelfImprovementLearning.RoutingDecision({
      id: SelfImprovementLifecycle.RoutingDecisionID.create(),
      locationID: locationID(input.session.location),
      sessionDigest: digest(input.session.id),
      workload: binding.workload,
      workloadRevision: binding.workloadRevision,
      roleDigest: binding.roleDigest,
      precedenceSource: selected.source,
      policySnapshotDigest: digest(`provider.use\0${selected.route.providerID}`),
      catalogSnapshotDigest: digest(`${selected.route.providerID}\0${selected.route.id}`),
      variantSnapshotDigest: digest(selected.route.variant ?? "default"),
      orderedEligibleArms: recommendation?.arms ?? [],
      selectedRoute: { ...selected.route },
      reasonCode: `eligible-${selected.source}`,
      timestamp: SelfImprovementLifecycle.TimestampMillis.make(yield* Clock.currentTimeMillis),
    })
    yield* dependencies.appendRoutingDecision(decision)
    return { route: selected.route, decision }
  }),
  evaluate: Effect.fn("SelfImprovementRouting.evaluate")(function* (input) {
    const candidates = yield* dependencies.listCurrentModelRouteArms(locationID(input.session.location))
    const arms = (yield* Effect.forEach(candidates, (arm) =>
      resolveCandidate(dependencies, { source: "active-recommendation", route: arm.route }).pipe(
        Effect.map((candidate) => (candidate === undefined ? undefined : arm)),
      ),
    )).filter((arm): arm is SelfImprovementLearning.ModelRouteArm => arm !== undefined)
    const allowlistRevision = arms[0]?.allowlistRevision
    if (allowlistRevision === undefined)
      return yield* new RouteUnavailable({ message: "No eligible model route arm is available" })
    const selected = yield* dependencies.select({
      locationID: locationID(input.session.location),
      actionDomain: "model-route",
      derivationRevision: input.binding.workloadRevision,
      allowlistRevision,
      eligibleArmIDs: arms.map((arm) => arm.id),
      buckets: [SelfImprovement.Digest.make(Hash.sha256(input.versionID))],
    })
    if (selected === undefined) return yield* new RouteUnavailable({ message: "No model route arm was selected" })
    const arm = arms.find((item) => item.id === selected.selectedArmID)
    if (arm === undefined) return yield* new RouteUnavailable({ message: "Selected model route arm is unavailable" })
    yield* dependencies
      .materialize(input.session, arm.route)
      .pipe(Effect.mapError(() => new RouteUnavailable({ message: "Selected model route cannot be materialized" })))
    const timestamp = SelfImprovementLifecycle.TimestampMillis.make(yield* Clock.currentTimeMillis)
    const pull = SelfImprovementLearning.PullEvent.make({
      id: SelfImprovementLifecycle.PullEventID.create(),
      locationID: locationID(input.session.location),
      actionDomain: "model-route",
      bucketDigest: selected.bucketDigest,
      derivationRevision: input.binding.workloadRevision,
      allowlistRevision,
      orderedEligibleArmIDs: arms.map((item) => item.id),
      selectedArmID: arm.id,
      versionID: input.versionID,
      timestamp,
    })
    const decision = new SelfImprovementLearning.RoutingDecision({
      id: SelfImprovementLifecycle.RoutingDecisionID.create(),
      locationID: locationID(input.session.location),
      sessionDigest: digest(input.session.id),
      workload: input.binding.workload,
      workloadRevision: input.binding.workloadRevision,
      roleDigest: input.binding.roleDigest,
      precedenceSource: "active-recommendation",
      policySnapshotDigest: digest(`provider.use\0${arm.route.providerID}`),
      catalogSnapshotDigest: digest(`${arm.route.providerID}\0${arm.route.id}`),
      variantSnapshotDigest: digest(arm.route.variant ?? "default"),
      orderedEligibleArms: arms,
      selectedRoute: { ...arm.route },
      reasonCode: "eligible-evaluation",
      pullEventID: pull.id,
      timestamp,
    })
    yield* dependencies.appendModelRouteEvidence({ pull, decision })
    return { route: arm.route, decision }
  }),
})

export const layerWith = (
  workloadBinding: (session: SessionSchema.Info) => Effect.Effect<WorkloadBinding | undefined>,
) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const policy = yield* Policy.Service
      const catalog = yield* Catalog.Service
      const models = yield* SessionRunnerModel.Service
      const learning = yield* SelfImprovementLearningStore.Service
      return Service.of(
        make(
          {
            policyEvaluate: policy.evaluate,
            catalogModelGet: catalog.model.get,
            catalogModelAvailable: catalog.model.available,
            catalogModelDefault: catalog.model.default,
            eligibleModelRouteArms: learning.eligibleModelRouteArms,
            listCurrentModelRouteArms: learning.listCurrentModelRouteArms,
            appendRoutingDecision: learning.appendRoutingDecision,
            appendModelRouteEvidence: learning.appendModelRouteEvidence,
            select: learning.select,
            materialize: (session, route) => models.resolve({ ...session, model: route }),
          },
          workloadBinding,
        ),
      )
    }),
  )

export const locationLayer = layerWith(() => Effect.succeed(undefined))

export const node = makeLocationNode({
  service: Service,
  layer: locationLayer,
  deps: [
    Policy.node,
    Catalog.node,
    SelfImprovementLearningStore.node,
    SessionRunnerModel.node,
  ],
})

export const inCanaryCohort = (versionDigest: string, sessionDigest: string) =>
  BigInt(`0x${Hash.sha256(`${versionDigest}\0${sessionDigest}`).slice(0, 16)}`) < (1n << 64n) / 20n

type Candidate = {
  readonly source: SelfImprovementLearning.RoutingPrecedenceSource
  readonly route: Model.Ref
}

const resolveRecommendation = (dependencies: Dependencies, session: SessionSchema.Info, binding: WorkloadBinding) =>
  Effect.gen(function* () {
    const arms = yield* dependencies.eligibleModelRouteArms({
      locationID: locationID(session.location),
      workload: binding.workload,
      workloadRevision: binding.workloadRevision,
    })
    const valid = (yield* Effect.forEach(arms, (arm) =>
      arm.active && arm.locationID === locationID(session.location)
        ? resolveCandidate(dependencies, { source: "active-recommendation", route: arm.route }).pipe(
            Effect.map((candidate) => (candidate ? arm : undefined)),
          )
        : Effect.succeed(undefined),
    )).filter((arm): arm is SelfImprovementLearning.ModelRouteArm => arm !== undefined)
    return {
      arms: valid,
      selected: valid[0] ? { source: "active-recommendation" as const, route: valid[0].route } : undefined,
    }
  })

const resolveDefault = (dependencies: Dependencies) =>
  Effect.gen(function* () {
    const model = yield* dependencies.catalogModelDefault()
    return model
      ? yield* resolveCandidate(dependencies, {
          source: "catalog-default",
          route: { providerID: model.providerID, id: model.id },
        })
      : undefined
  })

const resolveFallback = (dependencies: Dependencies) =>
  Effect.gen(function* () {
    const preferredProviderID = (yield* dependencies.catalogModelDefault())?.providerID
    const available = yield* dependencies.catalogModelAvailable()
    const ordered =
      preferredProviderID === undefined
        ? available
        : [
            ...available.filter((model) => model.providerID === preferredProviderID),
            ...available.filter((model) => model.providerID !== preferredProviderID),
          ]
    for (const model of ordered) {
      const selected = yield* resolveCandidate(dependencies, {
        source: "catalog-fallback",
        route: { providerID: model.providerID, id: model.id },
      })
      if (selected) return selected
    }
    return undefined
  })

const resolveCandidate = (dependencies: Dependencies, candidate: Candidate) =>
  Effect.gen(function* () {
    if ((yield* dependencies.policyEvaluate("provider.use", candidate.route.providerID, "allow")) === "deny")
      return undefined
    const model = yield* dependencies.catalogModelGet(candidate.route.providerID, candidate.route.id)
    if (!model || !SessionRunnerModel.supported(model)) return undefined
    if (
      !(yield* dependencies.catalogModelAvailable()).some(
        (item) => item.providerID === model.providerID && item.id === model.id,
      )
    )
      return undefined
    if (candidate.route.variant && !(model.variants ?? []).some((variant) => variant.id === candidate.route.variant))
      return undefined
    return candidate
  })

const digest = (value: string) => SelfImprovement.Digest.make(Hash.sha256(value))
