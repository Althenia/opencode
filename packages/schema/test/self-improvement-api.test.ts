import { expect, test } from "bun:test"
import { Schema } from "effect"
import { SelfImprovementApi } from "../src/self-improvement-api"
import { SelfImprovementLifecycle } from "../src/self-improvement-lifecycle"

const decode = <S extends Schema.Decoder<unknown>>(schema: S, input: unknown) =>
  Schema.decodeUnknownSync(schema, { errors: "all", onExcessProperty: "error" })(input)

const digest = "a".repeat(64)
const locationID = "b".repeat(64)
const artifactID = SelfImprovementLifecycle.ArtifactID.create()

test("defines exactly the 22 app-private operations", () => {
  expect(Object.values(SelfImprovementApi.PrivateApiOperations).map(({ method, path }) => `${method} ${path}`)).toEqual([
    "GET /private/self-improvement/artifacts",
    "POST /private/self-improvement/artifacts",
    "GET /private/self-improvement/artifacts/{artifactID}",
    "GET /private/self-improvement/artifacts/{artifactID}/versions",
    "POST /private/self-improvement/artifacts/{artifactID}/versions",
    "GET /private/self-improvement/artifacts/{artifactID}/versions/{versionID}",
    "POST /private/self-improvement/artifacts/{artifactID}/versions/{versionID}/archive",
    "POST /private/self-improvement/artifacts/{artifactID}/tombstone",
    "POST /private/self-improvement/approvals/{approvalRequestID}/approve",
    "POST /private/self-improvement/approvals/{approvalRequestID}/reject",
    "POST /private/self-improvement/observations",
    "POST /private/self-improvement/metric-runs",
    "POST /private/self-improvement/metric-runs/{runID}/samples",
    "POST /private/self-improvement/metric-runs/{runID}/decisions",
    "GET /private/self-improvement/baselines",
    "GET /private/self-improvement/metric-runs",
    "GET /private/self-improvement/evaluations",
    "GET /private/self-improvement/transitions",
    "GET /private/self-improvement/approvals",
    "GET /private/self-improvement/context-evidence",
    "GET /private/self-improvement/routing-decisions",
    "GET /private/self-improvement/audit",
  ])
  expect(Object.keys(SelfImprovementApi.PrivateApiOperations).some((key) => key.toLowerCase().includes("stage"))).toBe(
    false,
  )
  expect(
    Object.values(SelfImprovementApi.PrivateApiOperations).every(
      (operation) => ["GET", "POST"].includes(operation.method) && operation.path.startsWith("/private/self-improvement"),
    ),
  ).toBe(true)
})

test("page limits decode HTTP query strings from 1 through 100 with default 50", () => {
  expect(decode(SelfImprovementApi.PageRequest, {})).toEqual({ limit: 50 })
  expect(decode(SelfImprovementApi.ListArtifactsRequest, {})).toEqual({ limit: 50 })
  expect(decode(SelfImprovementApi.ListArtifactsRequest, { limit: "1" })).toEqual({ limit: 1 })
  expect(decode(SelfImprovementApi.ListArtifactsRequest, { limit: "100" })).toEqual({ limit: 100 })
  expect(() => decode(SelfImprovementApi.ListArtifactsRequest, { limit: "0" })).toThrow()
  expect(() => decode(SelfImprovementApi.ListArtifactsRequest, { limit: "101" })).toThrow()
  expect(() => decode(SelfImprovementApi.ListArtifactsRequest, { limit: 1 })).toThrow()
  expect(decode(SelfImprovementApi.ListVersionsRequest, { artifactID })).toEqual({ artifactID, limit: 50 })
})

test("private API wire contracts are closed and preserve HTTP encodings", () => {
  const headers = {
    "X-OpenCode-Location-ID": locationID,
    "Idempotency-Key": "retry-1",
    "If-Match": "7",
  }
  expect(Number(decode(SelfImprovementApi.ArtifactMutationHeaders, headers)["If-Match"])).toBe(7)
  expect(() => decode(SelfImprovementApi.ArtifactMutationHeaders, { ...headers, "If-Match": "-1" })).toThrow()

  const error = { code: "artifact-not-found", message: "not found", requestID: "req-1", details: {} } as const
  expect(decode(SelfImprovementApi.ApiError, error)).toEqual(error)
  expect(() => decode(SelfImprovementApi.ApiError, { ...error, transcript: "raw" })).toThrow()
  expect(() => decode(SelfImprovementApi.ApiErrorDetails, { providerSettings: {} })).toThrow()
  expect(decode(SelfImprovementApi.StoredResponse, { status: 404, body: error })).toEqual({ status: 404, body: error })
  expect(() => decode(SelfImprovementApi.StoredResponse, { status: 400, body: error })).toThrow()
  expect(() => decode(SelfImprovementApi.CommandResult, { status: "completed", artifactRevision: 1 })).toThrow()

  const manifest = {
    toolIDs: [],
    filesystemScopeIDs: [],
    networkOriginIDs: [],
    modelRoutes: [],
    childAgentTargets: [],
    artifactReferences: [],
    denies: [],
  }
  const request = { proposalBytes: "AQID", behaviorClass: "instruction-only", capabilityManifest: manifest } as const
  const decoded = decode(SelfImprovementApi.CreateArtifactRequest, request)
  expect(Array.from(decoded.proposalBytes)).toEqual([1, 2, 3])
  expect(Schema.encodeUnknownSync(SelfImprovementApi.CreateArtifactRequest)(decoded)).toEqual(request)
  for (const field of ["source", "stage", "providerSettings", "sideEffects"]) {
    expect(() => decode(SelfImprovementApi.CreateArtifactRequest, { ...request, [field]: "caller-supplied" })).toThrow()
  }
})

test("pins every error code to its exact HTTP status", () => {
  expect(SelfImprovementApi.ApiErrors).toEqual({
    invalidPage: { code: "invalid-page", status: 400 },
    admissionRejected: { code: "admission-rejected", status: 400 },
    redactionRejected: { code: "redaction-rejected", status: 400 },
    bindingInvalid: { code: "binding-invalid", status: 400 },
    sampleInvalid: { code: "sample-invalid", status: 400 },
    forbidden: { code: "forbidden", status: 403 },
    creatorSelfApproval: { code: "creator-self-approval", status: 403 },
    artifactNotFound: { code: "artifact-not-found", status: 404 },
    artifactOrVersionNotFound: { code: "artifact-or-version-not-found", status: 404 },
    approvalRequestNotFound: { code: "approval-request-not-found", status: 404 },
    versionOrBaselineNotFound: { code: "version-or-baseline-not-found", status: 404 },
    runNotFound: { code: "run-not-found", status: 404 },
    nameReserved: { code: "name-reserved", status: 409 },
    revisionConflict: { code: "revision-conflict", status: 409 },
    idempotencyMismatch: { code: "idempotency-mismatch", status: 409 },
    tombstoned: { code: "tombstoned", status: 409 },
    stageIllegal: { code: "stage-illegal", status: 409 },
    bindingMismatch: { code: "binding-mismatch", status: 409 },
    expired: { code: "expired", status: 409 },
    alreadyDecided: { code: "already-decided", status: 409 },
    runConflict: { code: "run-conflict", status: 409 },
    duplicateDifferent: { code: "duplicate-different", status: 409 },
    late: { code: "late", status: 409 },
    outOfStage: { code: "out-of-stage", status: 409 },
    cutoffMismatch: { code: "cutoff-mismatch", status: 409 },
    contextUnavailable: { code: "context-unavailable", status: 503 },
  })
})

test("binds all operations to named request and response schemas", () => {
  expect(
    Object.values(SelfImprovementApi.PrivateApiOperations).map(({ request, response }) => [
      request.ast.annotations?.identifier,
      response.ast.annotations?.identifier,
    ]),
  ).toEqual([
    ["SelfImprovementApi.ListArtifactsRequest", "SelfImprovementApi.ListArtifactsResponse"],
    ["SelfImprovementApi.CreateArtifactRequest", "SelfImprovementApi.CreateArtifactResponse"],
    ["SelfImprovementApi.GetArtifactRequest", "SelfImprovementApi.GetArtifactResponse"],
    ["SelfImprovementApi.ListVersionsRequest", "SelfImprovementApi.ListVersionsResponse"],
    ["SelfImprovementApi.CreateVersionRequest", "SelfImprovementApi.CreateVersionResponse"],
    ["SelfImprovementApi.GetVersionRequest", "SelfImprovementApi.GetVersionResponse"],
    ["SelfImprovementApi.ArchiveVersionRequest", "SelfImprovementApi.ArchiveVersionResponse"],
    ["SelfImprovementApi.TombstoneArtifactRequest", "SelfImprovementApi.TombstoneArtifactResponse"],
    ["SelfImprovementApi.ApproveRequest", "SelfImprovementApi.ApproveResponse"],
    ["SelfImprovementApi.RejectRequest", "SelfImprovementApi.RejectResponse"],
    ["SelfImprovementApi.CreateObservationRequest", "SelfImprovementApi.CreateObservationResponse"],
    ["SelfImprovementApi.CreateMetricRunRequest", "SelfImprovementApi.CreateMetricRunResponse"],
    ["SelfImprovementApi.AddMetricSampleRequest", "SelfImprovementApi.AddMetricSampleResponse"],
    ["SelfImprovementApi.DecideMetricRunRequest", "SelfImprovementApi.DecideMetricRunResponse"],
    ["SelfImprovementApi.ListBaselinesRequest", "SelfImprovementApi.ListBaselinesResponse"],
    ["SelfImprovementApi.ListMetricRunsRequest", "SelfImprovementApi.ListMetricRunsResponse"],
    ["SelfImprovementApi.ListEvaluationsRequest", "SelfImprovementApi.ListEvaluationsResponse"],
    ["SelfImprovementApi.ListTransitionsRequest", "SelfImprovementApi.ListTransitionsResponse"],
    ["SelfImprovementApi.ListApprovalsRequest", "SelfImprovementApi.ListApprovalsResponse"],
    ["SelfImprovementApi.ListContextEvidenceRequest", "SelfImprovementApi.ListContextEvidenceResponse"],
    ["SelfImprovementApi.ListRoutingDecisionsRequest", "SelfImprovementApi.ListRoutingDecisionsResponse"],
    ["SelfImprovementApi.ListAuditRequest", "SelfImprovementApi.ListAuditResponse"],
  ])
})

test("pins conditional authorization, location sources, ordering, mutations, and side effects", () => {
  expect(SelfImprovementApi.PrivateApiOperations.createArtifact.authorizationRules).toEqual([
    { type: "coordinator-generated-only", principal: "coordinator", condition: "generated-output" },
  ])
  expect(SelfImprovementApi.PrivateApiOperations.archiveVersion.authorizationRules).toEqual([
    { type: "coordinator-policy-terminal-only", principal: "coordinator", condition: "policy-terminal-action" },
  ])
  expect(SelfImprovementApi.PrivateApiOperations.approve.authorizationRules).toEqual([
    { type: "dedicated-approver-not-creator", principal: "location-approver" },
  ])
  expect(SelfImprovementApi.PrivateApiOperations.listMetricRuns.authorizationRules).toEqual([
    { type: "include-samples-audit-reader-only", principal: "audit-reader", queryField: "includeSamples" },
  ])
  expect(SelfImprovementApi.PrivateApiOperations.listApprovals.authorizationRules).toEqual([
    { type: "approver-own-decisions-only", principal: "location-approver" },
  ])
  expect(SelfImprovementApi.PrivateApiOperations.listAudit.authorizationRules).toEqual([
    { type: "audit-reader-only-audit", principal: "audit-reader" },
  ])
  expect(SelfImprovementApi.PrivateApiOperations.getArtifact.locationSource).toBe("artifact-header-grant")
  expect(SelfImprovementApi.PrivateApiOperations.addMetricSample.locationSource).toBe("run-header-grant")
  expect(SelfImprovementApi.PrivateApiOperations.approve.locationSource).toBe("approval-binding-header-grant")
  expect(SelfImprovementApi.PrivateApiOperations.listAudit.operation).toBe("audit.read")
  expect(SelfImprovementApi.PrivateApiOperations.listAudit.sideEffects).toEqual(["access-audited"])
  expect(SelfImprovementApi.PrivateApiOperations.tombstoneArtifact.sideEffects).toEqual([
    "pending-work-cancelled",
    "terminal-intent-recorded",
    "context-removal-requested",
    "versions-archived",
    "recommendations-removed",
    "transition-appended",
    "audit-appended",
  ])
  expect(Object.values(SelfImprovementApi.PrivateApiOperations).filter(({ mutation }) => mutation)).toHaveLength(10)
  expect(
    Object.values(SelfImprovementApi.PrivateApiOperations)
      .filter(({ mutation }) => !mutation)
      .every(({ sideEffects }) => sideEffects.length === 1),
  ).toBe(true)
})

test("idempotency records pair status and body and expire after exactly 30 days", () => {
  const record = {
    id: SelfImprovementLifecycle.IdempotencyRecordID.create(),
    identity: {
      principalID: "user-1",
      locationID,
      operation: "artifact.read",
      key: "retry-1",
    },
    requestDigest: digest,
    storedBodyDigest: "c".repeat(64),
    storedResponse: {
      status: 404,
      body: { code: "artifact-not-found", message: "not found", requestID: "req-1", details: {} },
    },
    createdAt: 1,
    expiresAt: 1 + 30 * 86_400_000,
  }
  expect(decode(SelfImprovementApi.IdempotencyRecord, record) as unknown).toEqual(record)
  expect(() => decode(SelfImprovementApi.IdempotencyRecord, { ...record, expiresAt: record.expiresAt - 1 })).toThrow()
})
