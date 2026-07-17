import { expect, test } from "bun:test"
import { Exit, Schema } from "effect"
import { SelfImprovementLifecycle } from "../src/self-improvement-lifecycle"

const decode = (schema: Schema.Decoder<unknown>, input: unknown): unknown => {
  const result = Schema.decodeUnknownExit(schema, { errors: "all", onExcessProperty: "error" })(input)
  if (Exit.isFailure(result)) throw new Error("schema decode failed")
  return result.value
}

test("defines exact lifecycle vocabulary and Location-owned artifact keys", () => {
  expect(SelfImprovementLifecycle.GlossaryTerms).toEqual([
    "matching-observation",
    "eligible-arm",
    "positive-evidence",
    "improving-sample",
    "complete-audit-chain",
    "active-recommendation",
    "ephemeral",
    "baseline",
    "workload",
    "task",
    "success",
    "repeated-issue-fingerprint",
    "precision",
    "tombstone",
  ])
  expect(SelfImprovementLifecycle.PrincipalKinds).toEqual([
    "first-party-user",
    "location-approver",
    "runtime-evidence-service",
    "evaluator",
    "coordinator",
    "audit-reader",
  ])
  expect(SelfImprovementLifecycle.ArtifactStages).toEqual([
    "draft",
    "experimental",
    "candidate",
    "shadow",
    "canary",
    "active",
    "deprecated",
    "archived",
  ])
  expect(
    decode(SelfImprovementLifecycle.ArtifactKey, {
      locationID: "a".repeat(64),
      kind: "skill",
      name: "repair-types",
    }),
  ).toEqual({ locationID: "a".repeat(64), kind: "skill", name: "repair-types" })
  expect(SelfImprovementLifecycle.ArtifactID.create()).toStartWith("si_art_")
  expect(SelfImprovementLifecycle.ArtifactVersionID.create()).toStartWith("si_ver_")
})

test("capability and generated metadata contracts are fail-closed", () => {
  const manifest = {
    toolIDs: ["read"],
    filesystemScopeIDs: ["workspace"],
    networkOriginIDs: [],
    modelRoutes: [{ providerID: "opencode", id: "gpt-5", variant: "default" }],
    childAgentTargets: ["reviewer"],
    artifactReferences: [{ kind: "skill", name: "reviewer" }],
    denies: [{ capability: "tool", resourceID: "write" }],
  }
  expect(decode(SelfImprovementLifecycle.CapabilityManifest, manifest)).toEqual(manifest)
  expect(() => decode(SelfImprovementLifecycle.CapabilityManifest, { ...manifest, credentials: ["x"] })).toThrow()
  const generated = {
    generationLeaseID: SelfImprovementLifecycle.GenerationLeaseID.create(),
    strategyPullID: SelfImprovementLifecycle.PullEventID.create(),
    originatingTaskIDDigest: "a".repeat(64),
    modelRequestDigest: "b".repeat(64),
    modelOutputDigest: "c".repeat(64),
    retentionDeadline: 1,
  }
  expect(decode(SelfImprovementLifecycle.GeneratedContentMetadata, generated)).toEqual(generated)
  expect(() => decode(SelfImprovementLifecycle.GeneratedContentMetadata, { ...generated, transcript: "raw" })).toThrow()
})

test("defines every closed lifecycle set", () => {
  const closedSets: ReadonlyArray<{
    schema: Schema.Decoder<unknown>
    values: ReadonlyArray<string>
  }> = [
    { schema: SelfImprovementLifecycle.GlossaryTerm, values: SelfImprovementLifecycle.GlossaryTerms },
    { schema: SelfImprovementLifecycle.ArtifactSource, values: SelfImprovementLifecycle.ArtifactSources },
    { schema: SelfImprovementLifecycle.BehaviorClass, values: SelfImprovementLifecycle.BehaviorClasses },
    { schema: SelfImprovementLifecycle.ArtifactStage, values: SelfImprovementLifecycle.ArtifactStages },
    { schema: SelfImprovementLifecycle.ArtifactStatus, values: ["live", "tombstoned"] },
    { schema: SelfImprovementLifecycle.PrincipalKind, values: SelfImprovementLifecycle.PrincipalKinds },
    { schema: SelfImprovementLifecycle.Operation, values: SelfImprovementLifecycle.Operations },
    { schema: SelfImprovementLifecycle.LifecycleEvent, values: SelfImprovementLifecycle.LifecycleEvents },
    { schema: SelfImprovementLifecycle.LifecycleReason, values: SelfImprovementLifecycle.LifecycleReasons },
    { schema: SelfImprovementLifecycle.ApprovalRejectionReason, values: ["approval-rejected"] },
  ]

  for (const entry of closedSets) {
    for (const value of entry.values) expect(decode(entry.schema, value)).toBe(value)
    expect(() => decode(entry.schema, "not-in-the-closed-set")).toThrow()
  }

  for (const capability of [
    "tool",
    "filesystem",
    "network-origin",
    "model-route",
    "child-agent",
    "artifact-reference",
  ]) {
    expect(decode(SelfImprovementLifecycle.CapabilityDeny, { capability, resourceID: "resource" })).toEqual({
      capability,
      resourceID: "resource",
    })
  }
  expect(() =>
    decode(SelfImprovementLifecycle.CapabilityDeny, { capability: "credential", resourceID: "resource" }),
  ).toThrow()
})

test("generated IDs expose create and validate their exact prefixes", () => {
  const generatedIDs = [
    [SelfImprovementLifecycle.ArtifactID, "si_art_"],
    [SelfImprovementLifecycle.ArtifactVersionID, "si_ver_"],
    [SelfImprovementLifecycle.StageTransitionID, "si_trn_"],
    [SelfImprovementLifecycle.ApprovalID, "si_app_"],
    [SelfImprovementLifecycle.ApprovalRequestID, "si_apr_"],
    [SelfImprovementLifecycle.RollbackID, "si_rol_"],
    [SelfImprovementLifecycle.SuiteID, "si_sui_"],
    [SelfImprovementLifecycle.BaselineID, "si_bas_"],
    [SelfImprovementLifecycle.EvaluationRunID, "si_run_"],
    [SelfImprovementLifecycle.MetricSampleID, "si_sam_"],
    [SelfImprovementLifecycle.GateFindingID, "si_gat_"],
    [SelfImprovementLifecycle.ObservationID, "si_obs_"],
    [SelfImprovementLifecycle.GenerationLeaseID, "si_les_"],
    [SelfImprovementLifecycle.PullEventID, "si_pul_"],
    [SelfImprovementLifecycle.RewardEventID, "si_rew_"],
    [SelfImprovementLifecycle.GenerationStrategyArmID, "si_gsa_"],
    [SelfImprovementLifecycle.ModelRouteArmID, "si_arm_"],
    [SelfImprovementLifecycle.RoutingDecisionID, "si_rte_"],
    [SelfImprovementLifecycle.ContextSelectionEvidenceID, "si_sel_"],
    [SelfImprovementLifecycle.ContextOutboxID, "si_obx_"],
    [SelfImprovementLifecycle.AuditEntryID, "si_aud_"],
    [SelfImprovementLifecycle.IdempotencyRecordID, "si_idm_"],
  ] as const

  for (const [schema, prefix] of generatedIDs) {
    const id = schema.create()
    expect(id).toStartWith(prefix)
    expect(decode(schema, id)).toBe(id)
    expect(() => decode(schema, `si_wrong_${id.slice(prefix.length)}`)).toThrow()
  }
})

test("LocationID is an opaque lowercase digest without a generated constructor", () => {
  expect(decode(SelfImprovementLifecycle.LocationID, "a".repeat(64))).toBe("a".repeat(64))
  for (const value of ["a".repeat(63), "a".repeat(65), "A".repeat(64), `${"a".repeat(63)}g`]) {
    expect(() => decode(SelfImprovementLifecycle.LocationID, value)).toThrow()
  }
  expect("create" in SelfImprovementLifecycle.LocationID).toBe(false)
})

test("numeric identities reject unsafe positive integers", () => {
  expect(() => decode(SelfImprovementLifecycle.Revision, Number.MAX_SAFE_INTEGER + 1)).toThrow()
  expect(() => decode(SelfImprovementLifecycle.TimestampMillis, Number.MAX_SAFE_INTEGER + 1)).toThrow()
})

test("ArtifactKey accepts every artifact kind and rejects stage setters", () => {
  for (const kind of ["agent", "skill", "workflow", "mode", "command", "routing-policy"] as const) {
    const key = { locationID: "a".repeat(64), kind, name: "repair-types" }
    expect(decode(SelfImprovementLifecycle.ArtifactKey, key)).toEqual(key)
  }
  expect(() =>
    decode(SelfImprovementLifecycle.ArtifactKey, {
      locationID: "a".repeat(64),
      kind: "skill",
      name: "repair-types",
      currentStage: "active",
    }),
  ).toThrow()
})

test("lifecycle contracts require modeled fields, reject excess fields, and omit optional fields", () => {
  const digest = "a".repeat(64)
  const locationID = "b".repeat(64)
  const manifest = {
    toolIDs: [],
    filesystemScopeIDs: [],
    networkOriginIDs: [],
    modelRoutes: [],
    childAgentTargets: [],
    artifactReferences: [],
    denies: [],
  }
  const key = { locationID, kind: "skill", name: "reviewer" }
  const tombstone = { actorID: "principal", reason: "retired", timestamp: 1 }
  const binding = {
    versionID: SelfImprovementLifecycle.ArtifactVersionID.create(),
    versionDigest: digest,
    suiteID: SelfImprovementLifecycle.SuiteID.create(),
    suiteRevision: 1,
    evaluationRunID: SelfImprovementLifecycle.EvaluationRunID.create(),
    shadowEvidenceDigest: digest,
  }
  const proposal = {
    kind: "skill",
    name: "reviewer",
    definition: { description: "review", content: "Review changes" },
    references: [],
  }
  const artifactVersionInput = {
    id: SelfImprovementLifecycle.ArtifactVersionID.create(),
    artifactID: SelfImprovementLifecycle.ArtifactID.create(),
    versionNumber: 1,
    source: "human",
    behaviorClass: "instruction-only",
    proposal,
    canonicalJson: "{}",
    proposalDigest: digest,
    inputSnapshotDigest: digest,
    versionDigest: digest,
    capabilityManifest: manifest,
    capabilityManifestDigest: digest,
    creatorID: "principal",
    createdAt: 1,
  }
  const fixtures: ReadonlyArray<{
    schema: Schema.Decoder<unknown>
    input: Record<string, unknown>
    required: ReadonlyArray<string>
  }> = [
    {
      schema: SelfImprovementLifecycle.ArtifactKey,
      input: key,
      required: ["locationID", "kind", "name"],
    },
    {
      schema: SelfImprovementLifecycle.TypedArtifactReference,
      input: { kind: "skill", name: "reviewer" },
      required: ["kind", "name"],
    },
    {
      schema: SelfImprovementLifecycle.Principal,
      input: { id: "principal", kind: "coordinator", locationID },
      required: ["id", "kind", "locationID"],
    },
    {
      schema: SelfImprovementLifecycle.CapabilityDeny,
      input: { capability: "tool", resourceID: "write" },
      required: ["capability", "resourceID"],
    },
    {
      schema: SelfImprovementLifecycle.CapabilityManifest,
      input: manifest,
      required: [
        "toolIDs",
        "filesystemScopeIDs",
        "networkOriginIDs",
        "modelRoutes",
        "childAgentTargets",
        "artifactReferences",
        "denies",
      ],
    },
    {
      schema: SelfImprovementLifecycle.GeneratedContentMetadata,
      input: {
        generationLeaseID: SelfImprovementLifecycle.GenerationLeaseID.create(),
        strategyPullID: SelfImprovementLifecycle.PullEventID.create(),
        originatingTaskIDDigest: digest,
        modelRequestDigest: digest,
        modelOutputDigest: digest,
        retentionDeadline: 1,
      },
      required: [
        "generationLeaseID",
        "strategyPullID",
        "originatingTaskIDDigest",
        "modelRequestDigest",
        "modelOutputDigest",
        "retentionDeadline",
      ],
    },
    {
      schema: SelfImprovementLifecycle.Artifact,
      input: {
        id: SelfImprovementLifecycle.ArtifactID.create(),
        key,
        status: "live",
        createdBy: "principal",
        createdAt: 1,
        revision: 0,
      },
      required: ["id", "key", "status", "createdBy", "createdAt", "revision"],
    },
    {
      schema: SelfImprovementLifecycle.ArtifactVersion,
      input: artifactVersionInput,
      required: [
        "id",
        "artifactID",
        "versionNumber",
        "source",
        "behaviorClass",
        "proposal",
        "canonicalJson",
        "proposalDigest",
        "inputSnapshotDigest",
        "versionDigest",
        "capabilityManifest",
        "capabilityManifestDigest",
        "creatorID",
        "createdAt",
      ],
    },
    {
      schema: SelfImprovementLifecycle.StageTransition,
      input: {
        id: SelfImprovementLifecycle.StageTransitionID.create(),
        versionID: SelfImprovementLifecycle.ArtifactVersionID.create(),
        previousStage: null,
        nextStage: "draft",
        event: "version-admitted",
        reason: "admission-accepted",
        actorID: "principal",
        timestamp: 1,
        idempotencyRecordID: SelfImprovementLifecycle.IdempotencyRecordID.create(),
        idempotencyDigest: digest,
      },
      required: [
        "id",
        "versionID",
        "previousStage",
        "nextStage",
        "event",
        "reason",
        "actorID",
        "timestamp",
        "idempotencyRecordID",
        "idempotencyDigest",
      ],
    },
    {
      schema: SelfImprovementLifecycle.ApprovalBinding,
      input: binding,
      required: ["versionID", "versionDigest", "suiteID", "suiteRevision", "evaluationRunID", "shadowEvidenceDigest"],
    },
    {
      schema: SelfImprovementLifecycle.ApprovalRequest,
      input: {
        id: SelfImprovementLifecycle.ApprovalRequestID.create(),
        locationID,
        binding,
        creatorID: "principal",
        requestedAt: 1,
      },
      required: ["id", "locationID", "binding", "creatorID", "requestedAt"],
    },
    {
      schema: SelfImprovementLifecycle.ApprovalGranted,
      input: { _tag: "approved", approverID: "approver", decidedAt: 1, expiresAt: 1 + 86_400_000 },
      required: ["_tag", "approverID", "decidedAt", "expiresAt"],
    },
    {
      schema: SelfImprovementLifecycle.ApprovalRejected,
      input: { _tag: "rejected", approverID: "approver", decidedAt: 1, reason: "approval-rejected" },
      required: ["_tag", "approverID", "decidedAt", "reason"],
    },
    {
      schema: SelfImprovementLifecycle.Approval,
      input: {
        id: SelfImprovementLifecycle.ApprovalID.create(),
        requestID: SelfImprovementLifecycle.ApprovalRequestID.create(),
        locationID,
        binding,
        decision: { _tag: "approved", approverID: "approver", decidedAt: 1, expiresAt: 1 + 86_400_000 },
      },
      required: ["id", "requestID", "locationID", "binding", "decision"],
    },
    {
      schema: SelfImprovementLifecycle.Rollback,
      input: {
        id: SelfImprovementLifecycle.RollbackID.create(),
        locationID,
        artifactID: SelfImprovementLifecycle.ArtifactID.create(),
        candidateVersionID: SelfImprovementLifecycle.ArtifactVersionID.create(),
        retainedActiveVersionID: SelfImprovementLifecycle.ArtifactVersionID.create(),
        canaryRunID: SelfImprovementLifecycle.EvaluationRunID.create(),
        reason: "canary-regression",
        rewardEventID: SelfImprovementLifecycle.RewardEventID.create(),
        timestamp: 1,
      },
      required: [
        "id",
        "locationID",
        "artifactID",
        "candidateVersionID",
        "retainedActiveVersionID",
        "canaryRunID",
        "reason",
        "rewardEventID",
        "timestamp",
      ],
    },
    {
      schema: SelfImprovementLifecycle.Tombstone,
      input: tombstone,
      required: ["actorID", "reason", "timestamp"],
    },
  ]

  for (const fixture of fixtures) {
    expect(decode(fixture.schema, fixture.input)).toEqual(fixture.input)
    expect(() => decode(fixture.schema, { ...fixture.input, unmodeled: true })).toThrow()
    for (const field of fixture.required) {
      const missing = { ...fixture.input }
      delete missing[field]
      expect(() => decode(fixture.schema, missing)).toThrow()
    }
  }

  const artifact = {
    id: SelfImprovementLifecycle.ArtifactID.create(),
    key,
    status: "tombstoned",
    createdBy: "principal",
    createdAt: 1,
    revision: 1,
    tombstone,
  }
  expect(decode(SelfImprovementLifecycle.Artifact, artifact)).toEqual(artifact)

  expect(() => decode(SelfImprovementLifecycle.ArtifactVersion, { ...artifactVersionInput, locationID })).toThrow()
})

test("approval decisions keep approved and rejected fields disjoint", () => {
  const approvalRequest = {
    id: SelfImprovementLifecycle.ApprovalRequestID.create(),
    locationID: "a".repeat(64),
    binding: {
      versionID: SelfImprovementLifecycle.ArtifactVersionID.create(),
      versionDigest: "b".repeat(64),
      suiteID: SelfImprovementLifecycle.SuiteID.create(),
      suiteRevision: 1,
      evaluationRunID: SelfImprovementLifecycle.EvaluationRunID.create(),
      shadowEvidenceDigest: "c".repeat(64),
    },
    creatorID: "creator-1",
    requestedAt: 1,
  }
  expect(decode(SelfImprovementLifecycle.ApprovalRequest, approvalRequest)).toEqual(approvalRequest)
  const rejected = {
    _tag: "rejected",
    approverID: "location-approver",
    decidedAt: 1,
    reason: "approval-rejected",
  }
  expect(decode(SelfImprovementLifecycle.ApprovalDecision, rejected)).toEqual(rejected)
  expect(() => decode(SelfImprovementLifecycle.ApprovalDecision, { ...rejected, expiresAt: 2 })).toThrow()
  const approved = {
    _tag: "approved",
    approverID: "location-approver",
    decidedAt: 1,
    expiresAt: 1 + 86_400_000,
  }
  const approvedEncoded: unknown = approved
  const decoded = Schema.decodeUnknownSync(SelfImprovementLifecycle.ApprovalGranted)(approvedEncoded, {
    errors: "all",
    onExcessProperty: "error",
  })
  expect(decode(SelfImprovementLifecycle.ApprovalGranted, approved)).toEqual(approved)
  expect(decoded).toBeInstanceOf(SelfImprovementLifecycle.ApprovalGranted)
  expect(new SelfImprovementLifecycle.ApprovalGranted(decoded)).toBeInstanceOf(SelfImprovementLifecycle.ApprovalGranted)
  for (const invalid of [
    { ...approved, expiresAt: approved.expiresAt - 1 },
    { ...approved, expiresAt: approved.expiresAt + 1 },
    { ...approved, consumedAt: approved.decidedAt - 1 },
    { ...approved, consumedAt: approved.expiresAt + 1 },
  ]) {
    expect(() => decode(SelfImprovementLifecycle.ApprovalGranted, invalid)).toThrow()
  }
  expect(
    () =>
      new SelfImprovementLifecycle.ApprovalGranted({
        approverID: decoded.approverID,
        decidedAt: decoded.decidedAt,
        expiresAt: SelfImprovementLifecycle.TimestampMillis.make(decoded.expiresAt - 1),
      }),
  ).toThrow()
  for (const consumedAt of [approved.decidedAt, approved.expiresAt]) {
    expect(decode(SelfImprovementLifecycle.ApprovalGranted, { ...approved, consumedAt })).toEqual({
      ...approved,
      consumedAt,
    })
  }
  expect(() =>
    decode(SelfImprovementLifecycle.ApprovalDecision, { ...approved, reason: "approval-rejected" }),
  ).toThrow()
})

test("artifact and version source metadata states remain consistent", () => {
  const artifact = {
    id: SelfImprovementLifecycle.ArtifactID.create(),
    key: { locationID: "a".repeat(64), kind: "skill" as const, name: "reviewer" },
    createdBy: "principal",
    createdAt: 1,
    revision: 0,
  }
  const tombstone = { actorID: "principal", reason: "retired", timestamp: 1 }
  const generated = {
    generationLeaseID: SelfImprovementLifecycle.GenerationLeaseID.create(),
    strategyPullID: SelfImprovementLifecycle.PullEventID.create(),
    originatingTaskIDDigest: "a".repeat(64),
    modelRequestDigest: "b".repeat(64),
    modelOutputDigest: "c".repeat(64),
    retentionDeadline: 1,
  }
  const version = {
    id: SelfImprovementLifecycle.ArtifactVersionID.create(),
    artifactID: artifact.id,
    versionNumber: 1,
    behaviorClass: "instruction-only" as const,
    proposal: {
      kind: "skill" as const,
      name: "reviewer",
      definition: { description: "review", content: "Review changes" },
      references: [],
    },
    canonicalJson: "{}",
    proposalDigest: "a".repeat(64),
    inputSnapshotDigest: "a".repeat(64),
    versionDigest: "a".repeat(64),
    capabilityManifest: {
      toolIDs: [],
      filesystemScopeIDs: [],
      networkOriginIDs: [],
      modelRoutes: [],
      childAgentTargets: [],
      artifactReferences: [],
      denies: [],
    },
    capabilityManifestDigest: "a".repeat(64),
    creatorID: "principal",
    createdAt: 1,
  }

  expect(() => decode(SelfImprovementLifecycle.Artifact, { ...artifact, status: "live", tombstone })).toThrow()
  expect(() => decode(SelfImprovementLifecycle.Artifact, { ...artifact, status: "tombstoned" })).toThrow()
  expect(() => decode(SelfImprovementLifecycle.ArtifactVersion, { ...version, source: "human", generated })).toThrow()
  expect(() => decode(SelfImprovementLifecycle.ArtifactVersion, { ...version, source: "generated" })).toThrow()
})

test("every exported lifecycle schema has a stable unique identifier", () => {
  const schemas = [
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
    SelfImprovementLifecycle.Principal,
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
  ]
  const identifiers = schemas.map((schema) => schema.ast.annotations?.identifier)
  const expected = [
    "SelfImprovementLifecycle.LocationID",
    "SelfImprovementLifecycle.PrincipalID",
    "SelfImprovementLifecycle.ArtifactID",
    "SelfImprovementLifecycle.ArtifactVersionID",
    "SelfImprovementLifecycle.StageTransitionID",
    "SelfImprovementLifecycle.ApprovalID",
    "SelfImprovementLifecycle.ApprovalRequestID",
    "SelfImprovementLifecycle.RollbackID",
    "SelfImprovementLifecycle.SuiteID",
    "SelfImprovementLifecycle.BaselineID",
    "SelfImprovementLifecycle.EvaluationRunID",
    "SelfImprovementLifecycle.MetricSampleID",
    "SelfImprovementLifecycle.GateFindingID",
    "SelfImprovementLifecycle.ObservationID",
    "SelfImprovementLifecycle.GenerationLeaseID",
    "SelfImprovementLifecycle.PullEventID",
    "SelfImprovementLifecycle.RewardEventID",
    "SelfImprovementLifecycle.GenerationStrategyArmID",
    "SelfImprovementLifecycle.ModelRouteArmID",
    "SelfImprovementLifecycle.RoutingDecisionID",
    "SelfImprovementLifecycle.ContextSelectionEvidenceID",
    "SelfImprovementLifecycle.ContextOutboxID",
    "SelfImprovementLifecycle.AuditEntryID",
    "SelfImprovementLifecycle.IdempotencyRecordID",
    "SelfImprovementLifecycle.Revision",
    "SelfImprovementLifecycle.TimestampMillis",
    "SelfImprovementLifecycle.GlossaryTerm",
    "SelfImprovementLifecycle.ArtifactSource",
    "SelfImprovementLifecycle.BehaviorClass",
    "SelfImprovementLifecycle.ArtifactStage",
    "SelfImprovementLifecycle.ArtifactStatus",
    "SelfImprovementLifecycle.PrincipalKind",
    "SelfImprovementLifecycle.Operation",
    "SelfImprovementLifecycle.LifecycleEvent",
    "SelfImprovementLifecycle.LifecycleReason",
    "SelfImprovementLifecycle.ArtifactKey",
    "SelfImprovementLifecycle.TypedArtifactReference",
    "SelfImprovementLifecycle.Principal",
    "SelfImprovementLifecycle.CapabilityDeny",
    "SelfImprovementLifecycle.CapabilityManifest",
    "SelfImprovementLifecycle.GeneratedContentMetadata",
    "SelfImprovementLifecycle.Artifact",
    "SelfImprovementLifecycle.ArtifactVersion",
    "SelfImprovementLifecycle.StageTransition",
    "SelfImprovementLifecycle.ApprovalBinding",
    "SelfImprovementLifecycle.ApprovalRejectionReason",
    "SelfImprovementLifecycle.ApprovalRequest",
    "SelfImprovementLifecycle.ApprovalGranted",
    "SelfImprovementLifecycle.ApprovalRejected",
    "SelfImprovementLifecycle.ApprovalDecision",
    "SelfImprovementLifecycle.Approval",
    "SelfImprovementLifecycle.Rollback",
    "SelfImprovementLifecycle.Tombstone",
  ]

  expect(schemas.every(Schema.isSchema)).toBe(true)
  expect(identifiers).toEqual(expected)
  expect(new Set(identifiers).size).toBe(expected.length)
})
