import { expect, test } from "bun:test"
import {
  SelfImprovementApi,
  SelfImprovementEvaluation,
  SelfImprovementLearning,
  SelfImprovementLifecycle,
} from "@opencode-ai/schema"
import { Schema } from "effect"
import { Location } from "../src/location"
import { PluginV2 } from "../src/plugin"
import { SystemContext } from "../src/system-context"
import { SelfImprovementContracts } from "../src/self-improvement/contracts"
import { SelfImprovementProposal } from "../src/self-improvement/proposal"

const expectedTraceability = {
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
  "R-05": {
    contracts: ["SelfImprovementLifecycle.CapabilityManifest"],
    behaviorDeferredTo: ["S04"],
  },
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

const schemaInventory = {
  SelfImprovementLifecycle: [
    SelfImprovementLifecycle.LocationID,
    SelfImprovementLifecycle.PrincipalID,
    SelfImprovementLifecycle.ArtifactID,
    SelfImprovementLifecycle.ArtifactVersionID,
    SelfImprovementLifecycle.StageTransitionID,
    SelfImprovementLifecycle.ApprovalID,
    SelfImprovementLifecycle.ApprovalRequestID,
    SelfImprovementLifecycle.RollbackID,
    SelfImprovementLifecycle.SuiteID,
    SelfImprovementLifecycle.BaselineID,
    SelfImprovementLifecycle.EvaluationRunID,
    SelfImprovementLifecycle.MetricSampleID,
    SelfImprovementLifecycle.GateFindingID,
    SelfImprovementLifecycle.ObservationID,
    SelfImprovementLifecycle.GenerationLeaseID,
    SelfImprovementLifecycle.PullEventID,
    SelfImprovementLifecycle.RewardEventID,
    SelfImprovementLifecycle.GenerationStrategyArmID,
    SelfImprovementLifecycle.ModelRouteArmID,
    SelfImprovementLifecycle.RoutingDecisionID,
    SelfImprovementLifecycle.ContextSelectionEvidenceID,
    SelfImprovementLifecycle.ContextOutboxID,
    SelfImprovementLifecycle.AuditEntryID,
    SelfImprovementLifecycle.IdempotencyRecordID,
    SelfImprovementLifecycle.Revision,
    SelfImprovementLifecycle.TimestampMillis,
    SelfImprovementLifecycle.GlossaryTerm,
    SelfImprovementLifecycle.ArtifactSource,
    SelfImprovementLifecycle.BehaviorClass,
    SelfImprovementLifecycle.ArtifactStage,
    SelfImprovementLifecycle.ArtifactStatus,
    SelfImprovementLifecycle.PrincipalKind,
    SelfImprovementLifecycle.Operation,
    SelfImprovementLifecycle.LifecycleEvent,
    SelfImprovementLifecycle.LifecycleReason,
    SelfImprovementLifecycle.ArtifactKey,
    SelfImprovementLifecycle.TypedArtifactReference,
    SelfImprovementLifecycle.CapabilityDeny,
    SelfImprovementLifecycle.CapabilityManifest,
    SelfImprovementLifecycle.GeneratedContentMetadata,
    SelfImprovementLifecycle.Artifact,
    SelfImprovementLifecycle.ArtifactVersion,
    SelfImprovementLifecycle.StageTransition,
    SelfImprovementLifecycle.ApprovalBinding,
    SelfImprovementLifecycle.ApprovalRejectionReason,
    SelfImprovementLifecycle.ApprovalRequest,
    SelfImprovementLifecycle.ApprovalGranted,
    SelfImprovementLifecycle.ApprovalRejected,
    SelfImprovementLifecycle.ApprovalDecision,
    SelfImprovementLifecycle.Approval,
    SelfImprovementLifecycle.Rollback,
    SelfImprovementLifecycle.Tombstone,
  ],
  SelfImprovementEvaluation: [
    SelfImprovementEvaluation.Workload,
    SelfImprovementEvaluation.RunState,
    SelfImprovementEvaluation.TaskOutcome,
    SelfImprovementEvaluation.GateID,
    SelfImprovementEvaluation.RequiredGateSequence,
    SelfImprovementEvaluation.GateResult,
    SelfImprovementEvaluation.HigherIsBetterNonRegression,
    SelfImprovementEvaluation.LowerIsBetterNonRegression,
    SelfImprovementEvaluation.MaximumRatioThreshold,
    SelfImprovementEvaluation.PositiveAggregateRewardThreshold,
    SelfImprovementEvaluation.MetricThresholds,
    SelfImprovementEvaluation.GateThresholdTightening,
    SelfImprovementEvaluation.ArtifactGateOverride,
    SelfImprovementEvaluation.TaskQualityMetric,
    SelfImprovementEvaluation.CorrectnessMetric,
    SelfImprovementEvaluation.RepeatFixRateMetric,
    SelfImprovementEvaluation.PrecisionMetric,
    SelfImprovementEvaluation.LatencyMetric,
    SelfImprovementEvaluation.TokensPerSuccessMetric,
    SelfImprovementEvaluation.CacheHitRatioMetric,
    SelfImprovementEvaluation.MetricComponents,
    SelfImprovementEvaluation.MetricTotals,
    SelfImprovementEvaluation.MetricAggregates,
    SelfImprovementEvaluation.SuiteRevision,
    SelfImprovementEvaluation.Baseline,
    SelfImprovementEvaluation.EvaluationRun,
    SelfImprovementEvaluation.MetricSample,
    SelfImprovementEvaluation.GateFinding,
    SelfImprovementEvaluation.EvaluationDecision,
  ],
  SelfImprovementLearning: [
    SelfImprovementLearning.IdempotencyKey,
    SelfImprovementLearning.ActionDomain,
    SelfImprovementLearning.ObservationOutcomeClass,
    SelfImprovementLearning.GenerationOutcome,
    SelfImprovementLearning.RewardOutcomeClass,
    SelfImprovementLearning.RoutingPrecedenceSource,
    SelfImprovementLearning.ContextOutboxStatus,
    SelfImprovementLearning.ContextCohortResult,
    SelfImprovementLearning.Observation,
    SelfImprovementLearning.GenerationLease,
    SelfImprovementLearning.GenerationStrategyArm,
    SelfImprovementLearning.ModelRouteArm,
    SelfImprovementLearning.BanditArmID,
    SelfImprovementLearning.PullEvent,
    SelfImprovementLearning.RewardEvent,
    SelfImprovementLearning.BanditState,
    SelfImprovementLearning.RoutingDecision,
    SelfImprovementLearning.ContextDesiredTarget,
    SelfImprovementLearning.ContextDesiredState,
    SelfImprovementLearning.PendingTransitionIntent,
    SelfImprovementLearning.ContextOutbox,
    SelfImprovementLearning.ContextSelectionEvidence,
    SelfImprovementLearning.AuditPayload,
    SelfImprovementLearning.AuditEntry,
    SelfImprovementLearning.IdempotencyIdentity,
    SelfImprovementLearning.ObservationRetention,
    SelfImprovementLearning.EvidenceRetention,
    SelfImprovementLearning.GovernedMetadataRetention,
    SelfImprovementLearning.RetentionMetadata,
  ],
  SelfImprovementApi: [
    SelfImprovementApi.PageLimit,
    SelfImprovementApi.Cursor,
    SelfImprovementApi.PageRequest,
    SelfImprovementApi.IfMatchRevision,
    SelfImprovementApi.LocationHeaders,
    SelfImprovementApi.MutationHeaders,
    SelfImprovementApi.ArtifactMutationHeaders,
    SelfImprovementApi.ApiErrorCode,
    SelfImprovementApi.ApiErrorDetails,
    SelfImprovementApi.ApiError,
    SelfImprovementApi.ApiSideEffect,
    SelfImprovementApi.ResponseOrder,
    SelfImprovementApi.CompletedCommandResult,
    SelfImprovementApi.ReconciliationPendingCommandResult,
    SelfImprovementApi.CommandResult,
    SelfImprovementApi.ArtifactRolloutProjection,
    SelfImprovementApi.MetricRunView,
    SelfImprovementApi.EvaluationView,
    SelfImprovementApi.ContextEvidenceView,
    SelfImprovementApi.StoredResponse,
    SelfImprovementApi.IdempotencyRecord,
    SelfImprovementApi.LocationSource,
    SelfImprovementApi.ConditionalAuthorizationRule,
    SelfImprovementApi.ListArtifactsRequest,
    SelfImprovementApi.ListArtifactsResponse,
    SelfImprovementApi.CreateArtifactRequest,
    SelfImprovementApi.CreateArtifactResponse,
    SelfImprovementApi.GetArtifactRequest,
    SelfImprovementApi.GetArtifactResponse,
    SelfImprovementApi.ListVersionsRequest,
    SelfImprovementApi.ListVersionsResponse,
    SelfImprovementApi.CreateVersionRequest,
    SelfImprovementApi.CreateVersionResponse,
    SelfImprovementApi.GetVersionRequest,
    SelfImprovementApi.GetVersionResponse,
    SelfImprovementApi.ArchiveVersionRequest,
    SelfImprovementApi.ArchiveVersionResponse,
    SelfImprovementApi.TombstoneArtifactRequest,
    SelfImprovementApi.TombstoneArtifactResponse,
    SelfImprovementApi.ApproveRequest,
    SelfImprovementApi.ApproveResponse,
    SelfImprovementApi.RejectRequest,
    SelfImprovementApi.RejectResponse,
    SelfImprovementApi.CreateObservationRequest,
    SelfImprovementApi.CreateObservationResponse,
    SelfImprovementApi.CreateMetricRunRequest,
    SelfImprovementApi.CreateMetricRunResponse,
    SelfImprovementApi.AddMetricSampleRequest,
    SelfImprovementApi.AddMetricSampleResponse,
    SelfImprovementApi.DecideMetricRunRequest,
    SelfImprovementApi.DecideMetricRunResponse,
    SelfImprovementApi.ListBaselinesRequest,
    SelfImprovementApi.ListBaselinesResponse,
    SelfImprovementApi.ListMetricRunsRequest,
    SelfImprovementApi.ListMetricRunsResponse,
    SelfImprovementApi.ListEvaluationsRequest,
    SelfImprovementApi.ListEvaluationsResponse,
    SelfImprovementApi.ListTransitionsRequest,
    SelfImprovementApi.ListTransitionsResponse,
    SelfImprovementApi.ListApprovalsRequest,
    SelfImprovementApi.ListApprovalsResponse,
    SelfImprovementApi.ListContextEvidenceRequest,
    SelfImprovementApi.ListContextEvidenceResponse,
    SelfImprovementApi.ListRoutingDecisionsRequest,
    SelfImprovementApi.ListRoutingDecisionsResponse,
    SelfImprovementApi.ListAuditRequest,
    SelfImprovementApi.ListAuditResponse,
  ],
} satisfies Record<string, ReadonlyArray<Schema.Top>>

const liveTypeAssertions = {
  proposalParse: true,
  policyEvaluate: true,
  catalogProviderGet: true,
  catalogProviderAll: true,
  catalogProviderAvailable: true,
  catalogModelGet: true,
  catalogModelAll: true,
  catalogModelAvailable: true,
  catalogModelDefault: true,
  catalogModelSmall: true,
  variantWait: true,
  runnerResolve: true,
  systemContextMake: true,
  systemContextCombine: true,
  locationRef: true,
  location: true,
} satisfies SelfImprovementContracts.LiveTypeAssertions

test("exports canonical S01 namespaces and live dependency identities", () => {
  expect(SelfImprovementLifecycle.ArtifactID).toBeDefined()
  expect(SelfImprovementEvaluation.GateID).toBeDefined()
  expect(SelfImprovementLearning.RoutingDecision).toBeDefined()
  expect(SelfImprovementApi.PrivateApiOperations).toBeDefined()
  expect(SelfImprovementContracts.VariantPluginID).toBe(PluginV2.ID.make("variant"))
  expect(SelfImprovementContracts.ProposalParse).toBe(SelfImprovementProposal.parse)
  expect(SelfImprovementContracts.SystemContextFunctions.make).toBe(SystemContext.make)
  expect(SelfImprovementContracts.SystemContextFunctions.combine).toBe(SystemContext.combine)
})

test("derives opaque Location IDs from the complete versioned Location.Ref", () => {
  const ref = (directory: string, workspaceID?: string) =>
    Schema.decodeUnknownSync(Location.Ref)({ directory, ...(workspaceID === undefined ? {} : { workspaceID }) })
  expect(SelfImprovementContracts.locationID(ref("/tmp/one", "wrk_test"))).toBe(
    SelfImprovementLifecycle.LocationID.make("d24cc3fcbde62bde5441826f944f97b336fafb8ef8f0d427b08ae4f60de0b596"),
  )
  expect(SelfImprovementContracts.locationID(ref("/tmp/project"))).toBe(
    SelfImprovementLifecycle.LocationID.make("fe51b43122d0ae9e9e072da9b714dffd623fa97489917d443695f0e3b7c8ba89"),
  )
  expect(SelfImprovementContracts.locationID(ref("/tmp/two", "wrk_test"))).toBe(
    SelfImprovementLifecycle.LocationID.make("7a53078550e5ae78d0fe6119338af04a8ded3b5d1210f83239eb7ae8468737e6"),
  )
  expect(SelfImprovementContracts.locationID(ref("/tmp/two", "wrk_test"))).not.toBe(
    SelfImprovementContracts.locationID(ref("/tmp/one", "wrk_test")),
  )
  expect(SelfImprovementContracts.locationID(ref("/tmp/one", "wrk_test"))).toBe(
    SelfImprovementContracts.locationID(ref("/tmp/one", "wrk_test")),
  )
  expect(SelfImprovementContracts.locationID(ref("/tmp/one"))).not.toBe(
    SelfImprovementContracts.locationID(ref("/tmp/two")),
  )
  expect(SelfImprovementContracts.locationID(ref("/tmp/project"))).toMatch(/^[0-9a-f]{64}$/)
})

test("pins S01 traceability and routing precedence", () => {
  expect(Object.keys(SelfImprovementContracts.S01Traceability)).toEqual([
    "R-01",
    "R-02",
    "R-03",
    "R-04",
    "R-05",
    "R-06",
    "R-07",
    "R-08",
    "R-09",
    "R-10",
    "R-11",
    "R-12",
    "R-13",
    "R-14",
    "R-15",
    "R-16",
    "R-17",
    "R-18",
    "R-19",
    "R-20",
    "R-21",
    "R-22",
    "R-23",
    "R-24",
  ])
  expect(SelfImprovementContracts.S01Traceability).toEqual(expectedTraceability)
  expect(SelfImprovementContracts.S01Traceability["R-13"]).toEqual({
    contracts: [
      "SelfImprovementApi.PrivateApiOperations",
      "SelfImprovementApi.LocationSource",
      "SelfImprovementApi.ConditionalAuthorizationRule",
      "SelfImprovementApi.ApiError",
      "SelfImprovementApi.ApiErrorDetails",
    ],
    behaviorDeferredTo: ["S08", "S09"],
  })
  expect(SelfImprovementContracts.S01Traceability["R-15"].contracts).toContain(
    "SelfImprovementLearning.ContextSelectionEvidence",
  )
  expect(SelfImprovementLearning.RoutingPrecedence).toEqual([
    "session-user",
    "role",
    "active-recommendation",
    "catalog-default",
    "catalog-fallback",
  ])
})

test("pins explicit live dependency signatures without casts or service tags", () => {
  expect(Object.values(liveTypeAssertions).every(Boolean)).toBe(true)
  expect(SelfImprovementLearning.RoutingPrecedence).toEqual([
    "session-user",
    "role",
    "active-recommendation",
    "catalog-default",
    "catalog-fallback",
  ])
})

test("keeps every public S01 schema identifier stable and unique", () => {
  const identifiers = Object.entries(schemaInventory).flatMap(([namespace, schemas]) =>
    schemas.map((schema) => ({ namespace, identifier: schema.ast.annotations?.identifier })),
  )
  expect(
    identifiers.filter(
      ({ namespace, identifier }) => typeof identifier !== "string" || !identifier.startsWith(`${namespace}.`),
    ),
  ).toEqual([])
  expect(new Set(identifiers.map(({ identifier }) => identifier)).size).toBe(identifiers.length)
})

test("pins the private API and routing hygiene inventory", () => {
  expect(Object.keys(SelfImprovementApi.PrivateApiOperations)).toHaveLength(22)
  expect(
    Object.values(SelfImprovementApi.PrivateApiOperations).every((operation) =>
      operation.path.startsWith("/private/self-improvement"),
    ),
  ).toBe(true)
  expect(Object.values(SelfImprovementApi.PrivateApiOperations).some((operation) => operation.path.includes("stage"))).toBe(
    false,
  )
  expect(SelfImprovementLearning.RoutingPrecedence).toEqual([
    "session-user",
    "role",
    "active-recommendation",
    "catalog-default",
    "catalog-fallback",
  ])
})
