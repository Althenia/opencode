export * as SelfImprovementContracts from "./contracts"

import { AbsolutePath, SelfImprovement, SelfImprovementLifecycle } from "@opencode-ai/schema"
import { type WorkspaceID } from "@opencode-ai/schema/workspace-id"
import { Effect } from "effect"
import { Catalog } from "../catalog"
import { Location } from "../location"
import { ModelV2 } from "../model"
import { Policy } from "../policy"
import { Project } from "../project"
import { ProviderV2 } from "../provider"
import { SessionRunnerModel } from "../session/runner/model"
import { SessionSchema } from "../session/schema"
import { SystemContext } from "../system-context"
import { Hash } from "../util/hash"
import { SelfImprovementProposal } from "./proposal"

export interface LiveDependencies {
  readonly proposalParse: (input: Uint8Array) => SelfImprovement.ProposalParseResult
  readonly policyEvaluate: (action: string, resource: string, fallback: Policy.Effect) => Effect.Effect<Policy.Effect>
  readonly catalogProviderGet: (providerID: ProviderV2.ID) => Effect.Effect<ProviderV2.Info | undefined>
  readonly catalogProviderAll: () => Effect.Effect<ProviderV2.Info[]>
  readonly catalogProviderAvailable: () => Effect.Effect<ProviderV2.Info[]>
  readonly catalogModelGet: (providerID: ProviderV2.ID, modelID: ModelV2.ID) => Effect.Effect<ModelV2.Info | undefined>
  readonly catalogModelAll: () => Effect.Effect<ModelV2.Info[]>
  readonly catalogModelAvailable: () => Effect.Effect<ModelV2.Info[]>
  readonly catalogModelDefault: () => Effect.Effect<ModelV2.Info | undefined>
  readonly catalogModelSmall: (providerID: ProviderV2.ID) => Effect.Effect<ModelV2.Info | undefined>
  readonly runnerResolve: SessionRunnerModel.Interface["resolve"]
  readonly systemContextMake: <A>(source: SystemContext.Source<A>) => SystemContext.SystemContext
  readonly systemContextCombine: (values: ReadonlyArray<SystemContext.SystemContext>) => SystemContext.SystemContext
  readonly locationRef: { readonly directory: AbsolutePath; readonly workspaceID?: WorkspaceID }
  readonly location: {
    readonly directory: AbsolutePath
    readonly workspaceID?: WorkspaceID
    readonly project: { readonly id: Project.ID; readonly directory: AbsolutePath }
    readonly vcs?: Project.Vcs
  }
}

type Equal<Left, Right> = [Left, Right] extends [Right, Left] ? true : false
type Assert<Condition extends true> = Condition
export type LiveTypeAssertions = {
  readonly proposalParse: Assert<Equal<LiveDependencies["proposalParse"], typeof SelfImprovementProposal.parse>>
  readonly policyEvaluate: Assert<Equal<LiveDependencies["policyEvaluate"], Policy.Interface["evaluate"]>>
  readonly catalogProviderGet: Assert<
    Equal<LiveDependencies["catalogProviderGet"], Catalog.Interface["provider"]["get"]>
  >
  readonly catalogProviderAll: Assert<
    Equal<LiveDependencies["catalogProviderAll"], Catalog.Interface["provider"]["all"]>
  >
  readonly catalogProviderAvailable: Assert<
    Equal<LiveDependencies["catalogProviderAvailable"], Catalog.Interface["provider"]["available"]>
  >
  readonly catalogModelGet: Assert<Equal<LiveDependencies["catalogModelGet"], Catalog.Interface["model"]["get"]>>
  readonly catalogModelAll: Assert<Equal<LiveDependencies["catalogModelAll"], Catalog.Interface["model"]["all"]>>
  readonly catalogModelAvailable: Assert<
    Equal<LiveDependencies["catalogModelAvailable"], Catalog.Interface["model"]["available"]>
  >
  readonly catalogModelDefault: Assert<
    Equal<LiveDependencies["catalogModelDefault"], Catalog.Interface["model"]["default"]>
  >
  readonly catalogModelSmall: Assert<Equal<LiveDependencies["catalogModelSmall"], Catalog.Interface["model"]["small"]>>
  readonly runnerResolve: Assert<Equal<LiveDependencies["runnerResolve"], SessionRunnerModel.Interface["resolve"]>>
  readonly systemContextMake: Assert<Equal<LiveDependencies["systemContextMake"], typeof SystemContext.make>>
  readonly systemContextCombine: Assert<Equal<LiveDependencies["systemContextCombine"], typeof SystemContext.combine>>
  readonly locationRef: Assert<Equal<LiveDependencies["locationRef"], Location.Ref>>
  readonly location: Assert<Equal<LiveDependencies["location"], Location.Interface>>
}

export const ProposalParse: LiveDependencies["proposalParse"] = SelfImprovementProposal.parse
export const SystemContextFunctions: {
  readonly make: LiveDependencies["systemContextMake"]
  readonly combine: LiveDependencies["systemContextCombine"]
} = {
  make: SystemContext.make,
  combine: SystemContext.combine,
}
export const ScopeID = SelfImprovementLifecycle.LocationID.make(Hash.sha256("self-improvement/global/v1"))

// Self-improvement evidence and policy intentionally span every project, workspace, and Session.
export const locationID = (_location: Location.Ref): SelfImprovementLifecycle.LocationID => ScopeID

export const S01Traceability = {
  "R-01": {
    contracts: [
      "SelfImprovementLifecycle.LocationID",
      "SelfImprovementLifecycle.ArtifactKey",
      "SelfImprovementLifecycle.ArtifactVersion",
    ],
    behaviorDeferredTo: ["S02"],
  },
  "R-02": {
    contracts: [
      "SelfImprovementLifecycle.PrincipalKind",
      "SelfImprovementLifecycle.Operation",
      "SelfImprovementApi.PrivateApiOperations",
    ],
    behaviorDeferredTo: ["S08", "S09"],
  },
  "R-03": {
    contracts: [
      "SelfImprovementLifecycle.ApprovalBinding",
      "SelfImprovementLifecycle.ApprovalRequest",
      "SelfImprovementLifecycle.ApprovalDecision",
      "SelfImprovementLifecycle.Approval",
    ],
    behaviorDeferredTo: ["S06"],
  },
  "R-04": { contracts: [], behaviorDeferredTo: ["S04"] },
  "R-05": { contracts: ["SelfImprovementLifecycle.CapabilityManifest"], behaviorDeferredTo: ["S04"] },
  "R-06": {
    contracts: [
      "SelfImprovementContracts.LiveDependencies",
      "SelfImprovementContracts.LiveTypeAssertions",
      "SelfImprovementContracts.locationID",
    ],
    behaviorDeferredTo: ["S08", "S10", "S11"],
  },
  "R-07": {
    contracts: [
      "SelfImprovementEvaluation.Baseline",
      "SelfImprovementEvaluation.RequiredGateSequence",
      "SelfImprovementEvaluation.MetricThresholds",
      "SelfImprovementEvaluation.MetricTotals",
    ],
    behaviorDeferredTo: ["S03"],
  },
  "R-08": {
    contracts: [
      "SelfImprovementLifecycle.ArtifactStage",
      "SelfImprovementLifecycle.LifecycleEvent",
      "SelfImprovementLifecycle.Rollback",
    ],
    behaviorDeferredTo: ["S05", "S06"],
  },
  "R-09": {
    contracts: ["SelfImprovementEvaluation.GateID", "SelfImprovementEvaluation.GateFinding"],
    behaviorDeferredTo: ["S04"],
  },
  "R-10": {
    contracts: [
      "SelfImprovementEvaluation.MetricComponents",
      "SelfImprovementEvaluation.MetricTotals",
      "SelfImprovementEvaluation.MetricAggregates",
    ],
    behaviorDeferredTo: ["S03", "S04"],
  },
  "R-11": {
    contracts: [
      "SelfImprovementLearning.GenerationStrategyArm",
      "SelfImprovementLearning.ModelRouteArm",
      "SelfImprovementLearning.BanditArmID",
      "SelfImprovementLearning.PullEvent",
      "SelfImprovementLearning.RewardEvent",
      "SelfImprovementLearning.BanditState",
    ],
    behaviorDeferredTo: ["S11"],
  },
  "R-12": {
    contracts: [
      "SelfImprovementLearning.RoutingPrecedenceSource",
      "SelfImprovementLearning.RoutingDecision",
      "SelfImprovementLearning.ContextSelectionEvidence",
    ],
    behaviorDeferredTo: ["S07", "S11"],
  },
  "R-13": {
    contracts: [
      "SelfImprovementApi.PrivateApiOperations",
      "SelfImprovementApi.LocationSource",
      "SelfImprovementApi.ConditionalAuthorizationRule",
      "SelfImprovementApi.ApiError",
      "SelfImprovementApi.ApiErrorDetails",
    ],
    behaviorDeferredTo: ["S08", "S09"],
  },
  "R-14": {
    contracts: [
      "SelfImprovementLearning.IdempotencyIdentity",
      "SelfImprovementApi.StoredResponse",
      "SelfImprovementApi.IdempotencyRecord",
    ],
    behaviorDeferredTo: ["S02", "S08"],
  },
  "R-15": {
    contracts: [
      "SelfImprovementLearning.ContextDesiredState",
      "SelfImprovementLearning.PendingTransitionIntent",
      "SelfImprovementLearning.ContextOutbox",
      "SelfImprovementLearning.ContextSelectionEvidence",
    ],
    behaviorDeferredTo: ["S07"],
  },
  "R-16": {
    contracts: ["SelfImprovementEvaluation.EvaluationRun", "SelfImprovementEvaluation.MetricSample"],
    behaviorDeferredTo: ["S03"],
  },
  "R-17": {
    contracts: ["SelfImprovementLearning.Observation", "SelfImprovementLearning.GenerationLease"],
    behaviorDeferredTo: ["S09", "S10"],
  },
  "R-18": {
    contracts: [
      "SelfImprovementLearning.Observation",
      "SelfImprovementLearning.RetentionMetadata",
      "SelfImprovementLearning.AuditEntry",
    ],
    behaviorDeferredTo: ["S09"],
  },
  "R-19": { contracts: [], behaviorDeferredTo: ["S12"] },
  "R-20": { contracts: ["SelfImprovementContracts.S01Traceability"], behaviorDeferredTo: ["S12"] },
  "R-21": {
    contracts: ["SelfImprovementApi.PrivateApiOperations"],
    behaviorDeferredTo: ["S02", "S03", "S04", "S05", "S06", "S07", "S08", "S09", "S10", "S11", "S12"],
  },
  "R-22": { contracts: ["SelfImprovementLifecycle.GlossaryTerm"], behaviorDeferredTo: [] },
  "R-23": {
    contracts: [
      "SelfImprovementLifecycle.LifecycleEvent",
      "SelfImprovementLifecycle.ApprovalDecision",
      "SelfImprovementLifecycle.Rollback",
      "SelfImprovementLearning.PendingTransitionIntent",
      "SelfImprovementLearning.ContextOutboxStatus",
    ],
    behaviorDeferredTo: ["S12"],
  },
  "R-24": { contracts: ["SelfImprovementLifecycle.Rollback"], behaviorDeferredTo: ["S06", "S12"] },
} as const
