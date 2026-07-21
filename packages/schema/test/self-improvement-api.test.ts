import { expect, test } from "bun:test"
import { Schema } from "effect"
import { SelfImprovementApi } from "../src/self-improvement-api.js"
import { SelfImprovementEvaluation } from "../src/self-improvement-evaluation.js"
import { SelfImprovementLifecycle } from "../src/self-improvement-lifecycle.js"

const decode = <S extends Schema.Decoder<unknown>>(schema: S, input: unknown) =>
  Schema.decodeUnknownSync(schema, { errors: "all", onExcessProperty: "error" })(input)

const digest = "a".repeat(64)
const locationID = "b".repeat(64)
const artifactID = SelfImprovementLifecycle.ArtifactID.create()
const versionID = SelfImprovementLifecycle.ArtifactVersionID.create()
const runID = SelfImprovementLifecycle.EvaluationRunID.create()
const suiteID = SelfImprovementLifecycle.SuiteID.create()
const baselineID = SelfImprovementLifecycle.BaselineID.create()
const manifest = {
  toolIDs: [],
  filesystemScopeIDs: [],
  networkOriginIDs: [],
  modelRoutes: [],
  childAgentTargets: [],
  artifactReferences: [],
  denies: [],
}
const proposal = {
  kind: "skill",
  name: "reviewer",
  definition: { description: "review", content: "Review changes" },
  references: [],
}
const artifact = {
  id: artifactID,
  key: { locationID, kind: "skill", name: "reviewer" },
  status: "live",
  createdBy: "principal",
  createdAt: 1,
  revision: 1,
}
const version = {
  id: versionID,
  artifactID,
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
const transition = {
  id: SelfImprovementLifecycle.StageTransitionID.create(),
  versionID,
  previousStage: null,
  nextStage: "draft",
  event: "version-admitted",
  reason: "admission-accepted",
  actorID: "principal",
  timestamp: 1,
  idempotencyRecordID: SelfImprovementLifecycle.IdempotencyRecordID.create(),
  idempotencyDigest: digest,
}
const binding = {
  versionID,
  versionDigest: digest,
  suiteID,
  suiteRevision: 1,
  evaluationRunID: runID,
  shadowEvidenceDigest: digest,
}
const approval = {
  id: SelfImprovementLifecycle.ApprovalID.create(),
  requestID: SelfImprovementLifecycle.ApprovalRequestID.create(),
  locationID,
  binding,
  decision: { _tag: "approved", approverID: "approver", decidedAt: 1, expiresAt: 1 + 86_400_000 },
}
const rejectedApproval = {
  ...approval,
  id: SelfImprovementLifecycle.ApprovalID.create(),
  decision: { _tag: "rejected", approverID: "approver", decidedAt: 1, reason: "approval-rejected" },
}
const observation = {
  id: SelfImprovementLifecycle.ObservationID.create(),
  locationID,
  patternDigest: digest,
  identityDigest: digest,
  workload: "typescript",
  workloadRevision: 1,
  errorClass: "type-error",
  orderedToolSymbolDigest: digest,
  outcomeClass: "failure",
  taskIDDigest: digest,
  producerID: "runtime-evidence",
  occurredAt: 1,
  expiresAt: 1 + 30 * 86_400_000,
}
const metrics = {
  taskQuality: { earnedAllowlistedPoints: 0, possibleAllowlistedPoints: 0 },
  correctness: { passedRequiredChecks: 0, requiredChecks: 0 },
  repeatFixRate: { repeatedTasks: 0, completedTasks: 0 },
  precision: { acceptedRelevantItems: 0, assessedItems: 0 },
  latencyMs: 0,
  tokensPerSuccess: { inputTokens: 0, outputTokens: 0, successfulTasks: 0 },
  cacheHitRatio: { cacheReadTokens: 0, cacheEligibleTokens: 0 },
} as const
const totals = {
  taskQualityEarnedAllowlistedPoints: 0,
  taskQualityPossibleAllowlistedPoints: 0,
  correctnessPassedRequiredChecks: 0,
  correctnessRequiredChecks: 0,
  repeatFixRepeatedTasks: 0,
  repeatFixCompletedTasks: 0,
  precisionAcceptedRelevantItems: 0,
  precisionAssessedItems: 0,
  acceptedLatencySampleCount: 0,
  latencySampleSetDigest: digest,
  inputTokens: 0,
  outputTokens: 0,
  successfulTasks: 0,
  cacheReadTokens: 0,
  cacheEligibleTokens: 0,
}
const aggregates = {
  taskQuality: 0,
  correctness: 0,
  repeatFixRate: 0,
  precision: 0,
  latencyP95Ms: 0,
  tokensPerSuccess: 0,
  cacheHitRatio: 0,
}
const run = {
  id: runID,
  locationID,
  versionID,
  stage: "shadow",
  workload: "typescript",
  workloadRevision: 1,
  suiteID,
  suiteRevision: 1,
  baselineID,
  state: "open",
  trustedProducerIDs: ["runtime-evidence"],
  acceptanceStart: 1,
  acceptanceEnd: 2,
  cutoffAt: 3,
  requestDigest: digest,
  createdAt: 1,
}
const sample = {
  id: SelfImprovementLifecycle.MetricSampleID.create(),
  runID,
  sampleIDDigest: digest,
  taskIDDigest: digest,
  producerID: "runtime-evidence",
  requestDigest: digest,
  metrics,
  outcome: "success",
  startedAt: 1,
  terminalAt: 2,
}
const findings = SelfImprovementEvaluation.GateIDs.map((gateID, index) => ({
  id: SelfImprovementLifecycle.GateFindingID.create(),
  evaluationRunID: runID,
  order: index + 1,
  gateID,
  result: "pass" as const,
  code: "ok",
}))
const decision = {
  runID,
  cutoffSampleSetDigest: digest,
  findings,
  metricTotals: totals,
  aggregates,
  aggregateReward: 0,
  decision: "failed",
  decidedAt: 4,
}
const decidedRun = { ...run, state: "decided", cutoffSampleSetDigest: digest, decidedAt: decision.decidedAt }
const baseline = {
  id: baselineID,
  locationID,
  workload: "typescript",
  workloadRevision: 1,
  suiteID,
  suiteRevision: 1,
  producerAllowlistRevision: 1,
  controlSource: "active-version",
  acceptanceStart: 1,
  acceptanceEnd: 2,
  cutoffAt: 3,
  uniqueSampleCount: 20,
  orderedSampleIDDigest: digest,
  metricTotals: totals,
  aggregates,
  createdAt: 4,
  evaluatorSignatureDigest: digest,
  bootstrapAuthorityID: "approver",
}
const intent = {
  versionID,
  previousStage: "shadow",
  nextStage: "canary",
  event: "approval-consumed",
  reason: "gates-passed",
  actorID: "coordinator",
  evaluationRunID: runID,
  approvalID: approval.id,
  approvalBinding: binding,
  idempotencyRecordID: transition.idempotencyRecordID,
  idempotencyDigest: digest,
}
const outbox = {
  id: SelfImprovementLifecycle.ContextOutboxID.create(),
  locationID,
  artifactID,
  expectedArtifactRevision: 1,
  expectedStage: "shadow",
  desiredStateRevision: 2,
  intent,
  status: "pending",
  attempts: 0,
  nextRetryAt: 1,
  createdAt: 1,
}
const desiredState = {
  locationID,
  artifactID,
  rolloutSlot: "canary",
  desired: { state: "present", versionID, versionDigest: digest, stage: "canary" },
  desiredRevision: 2,
}
const selection = {
  id: SelfImprovementLifecycle.ContextSelectionEvidenceID.create(),
  artifactID,
  versionID,
  versionDigest: digest,
  locationID,
  stage: "canary",
  contextEpoch: 2,
  sessionDigest: digest,
  cohortResult: "canary-in",
  outboxID: outbox.id,
}
const route = { providerID: "opencode", id: "gpt-5", variant: "default" }
const routeArm = {
  id: SelfImprovementLifecycle.ModelRouteArmID.create(),
  locationID,
  route,
  allowlistRevision: 1,
  active: true,
}
const routingDecision = {
  id: SelfImprovementLifecycle.RoutingDecisionID.create(),
  locationID,
  sessionDigest: digest,
  workload: "typescript",
  workloadRevision: 1,
  roleDigest: digest,
  precedenceSource: "active-recommendation",
  policySnapshotDigest: digest,
  catalogSnapshotDigest: digest,
  variantSnapshotDigest: digest,
  orderedEligibleArms: [routeArm],
  selectedRoute: route,
  reasonCode: "eligible-active-recommendation",
  pullEventID: SelfImprovementLifecycle.PullEventID.create(),
  timestamp: 1,
}
const auditEntry = {
  id: SelfImprovementLifecycle.AuditEntryID.create(),
  locationID,
  eventType: "observation-accepted",
  actorID: "runtime-evidence",
  payload: { artifactID, linkedDigests: [digest], rejectedFieldNames: [] },
  timestamp: 1,
  retention: { _tag: "evidence-180d", createdAt: 1, expiresAt: 1 + 180 * 86_400_000 },
}

const completed = { status: "completed", artifactRevision: 2, transition } as const
const page = <T>(...items: ReadonlyArray<T>) => ({ items })
const operationContracts = [
  {
    name: "listArtifacts",
    request: { schema: SelfImprovementApi.ListArtifactsRequest, input: { kind: "skill", limit: "10", cursor: "a" } },
    response: { schema: SelfImprovementApi.ListArtifactsResponse, input: page(artifact) },
  },
  {
    name: "createArtifact",
    request: {
      schema: SelfImprovementApi.CreateArtifactRequest,
      input: { proposalBytes: "AQID", behaviorClass: "instruction-only", capabilityManifest: manifest },
    },
    response: { schema: SelfImprovementApi.CreateArtifactResponse, input: { artifact, version, revision: 1 } },
  },
  {
    name: "getArtifact",
    request: { schema: SelfImprovementApi.GetArtifactRequest, input: { artifactID } },
    response: {
      schema: SelfImprovementApi.GetArtifactResponse,
      input: {
        artifact,
        activeProjection: { versionID, versionDigest: digest, transitionID: transition.id },
        shadowProjection: { versionID, versionDigest: digest, transitionID: transition.id },
        canaryProjection: { versionID, versionDigest: digest, transitionID: transition.id },
      },
    },
  },
  {
    name: "listVersions",
    request: { schema: SelfImprovementApi.ListVersionsRequest, input: { artifactID, limit: "10", cursor: "a" } },
    response: { schema: SelfImprovementApi.ListVersionsResponse, input: page(version) },
  },
  {
    name: "createVersion",
    request: {
      schema: SelfImprovementApi.CreateVersionRequest,
      input: {
        artifactID,
        proposalBytes: "AQID",
        behaviorClass: "instruction-only",
        capabilityManifest: manifest,
        expectedRevision: 1,
      },
    },
    response: { schema: SelfImprovementApi.CreateVersionResponse, input: { version, revision: 1 } },
  },
  {
    name: "getVersion",
    request: { schema: SelfImprovementApi.GetVersionRequest, input: { artifactID, versionID } },
    response: {
      schema: SelfImprovementApi.GetVersionResponse,
      input: { version, stage: "draft", capabilityManifest: manifest },
    },
  },
  {
    name: "archiveVersion",
    request: {
      schema: SelfImprovementApi.ArchiveVersionRequest,
      input: { artifactID, versionID, reason: "superseded", expectedRevision: 1 },
    },
    response: { schema: SelfImprovementApi.ArchiveVersionResponse, input: completed },
  },
  {
    name: "tombstoneArtifact",
    request: {
      schema: SelfImprovementApi.TombstoneArtifactRequest,
      input: { artifactID, reason: "retired", expectedRevision: 1 },
    },
    response: { schema: SelfImprovementApi.TombstoneArtifactResponse, input: completed },
  },
  {
    name: "approve",
    request: { schema: SelfImprovementApi.ApproveRequest, input: { approvalRequestID: approval.requestID, binding } },
    response: { schema: SelfImprovementApi.ApproveResponse, input: { approval } },
  },
  {
    name: "reject",
    request: {
      schema: SelfImprovementApi.RejectRequest,
      input: { approvalRequestID: approval.requestID, binding, reason: "approval-rejected" },
    },
    response: { schema: SelfImprovementApi.RejectResponse, input: { approval } },
  },
  {
    name: "createObservation",
    request: {
      schema: SelfImprovementApi.CreateObservationRequest,
      input: {
        workload: "typescript",
        workloadRevision: 1,
        errorClass: "type-error",
        orderedToolSymbolIDs: ["tool-a", "symbol-b"],
        outcomeClass: "failure",
        taskIDDigest: digest,
      },
    },
    response: {
      schema: SelfImprovementApi.CreateObservationResponse,
      input: { observation, matchingCount: 1, generationEligible: true },
    },
  },
  {
    name: "createMetricRun",
    request: {
      schema: SelfImprovementApi.CreateMetricRunRequest,
      input: {
        versionID,
        stage: "shadow",
        suiteID,
        suiteRevision: 1,
        workload: "typescript",
        workloadRevision: 1,
        baselineID,
        acceptanceStart: 1,
        acceptanceEnd: 2,
        cutoffAt: 3,
        requestDigest: digest,
      },
    },
    response: { schema: SelfImprovementApi.CreateMetricRunResponse, input: { run } },
  },
  {
    name: "addMetricSample",
    request: {
      schema: SelfImprovementApi.AddMetricSampleRequest,
      input: {
        runID,
        sampleIDDigest: digest,
        taskIDDigest: digest,
        metrics,
        outcome: "success",
        startedAt: 1,
        terminalAt: 2,
        requestDigest: digest,
      },
    },
    response: { schema: SelfImprovementApi.AddMetricSampleResponse, input: { sample, replayed: false } },
  },
  {
    name: "decideMetricRun",
    request: {
      schema: SelfImprovementApi.DecideMetricRunRequest,
      input: { runID, cutoffSampleSetDigest: digest },
    },
    response: {
      schema: SelfImprovementApi.DecideMetricRunResponse,
      input: { decision, findings, replayed: false },
    },
  },
  {
    name: "listBaselines",
    request: {
      schema: SelfImprovementApi.ListBaselinesRequest,
      input: { workload: "typescript", suiteRevision: "1", limit: "10", cursor: "a" },
    },
    response: { schema: SelfImprovementApi.ListBaselinesResponse, input: page(baseline) },
  },
  {
    name: "listMetricRuns",
    request: {
      schema: SelfImprovementApi.ListMetricRunsRequest,
      input: { versionID, stage: "shadow", state: "open", includeSamples: "false", limit: "10", cursor: "a" },
    },
    response: {
      schema: SelfImprovementApi.ListMetricRunsResponse,
      input: page({ run, aggregates, sampleCount: 1 }),
    },
  },
  {
    name: "listEvaluations",
    request: {
      schema: SelfImprovementApi.ListEvaluationsRequest,
      input: { artifactID, versionID, stage: "shadow", limit: "10", cursor: "a" },
    },
    response: {
      schema: SelfImprovementApi.ListEvaluationsResponse,
      input: page({ run: decidedRun, decision, orderedFindings: findings }),
    },
  },
  {
    name: "listTransitions",
    request: {
      schema: SelfImprovementApi.ListTransitionsRequest,
      input: { artifactID, versionID, event: "version-admitted", limit: "10", cursor: "a" },
    },
    response: { schema: SelfImprovementApi.ListTransitionsResponse, input: page(transition) },
  },
  {
    name: "listApprovals",
    request: {
      schema: SelfImprovementApi.ListApprovalsRequest,
      input: { artifactID, versionID, approverID: "approver", limit: "10", cursor: "a" },
    },
    response: { schema: SelfImprovementApi.ListApprovalsResponse, input: page(approval) },
  },
  {
    name: "listContextEvidence",
    request: {
      schema: SelfImprovementApi.ListContextEvidenceRequest,
      input: { artifactID, versionID, status: "pending", limit: "10", cursor: "a" },
    },
    response: {
      schema: SelfImprovementApi.ListContextEvidenceResponse,
      input: page(
        { cursorID: "a", createdAt: 1, evidence: { type: "desired-state", value: desiredState } },
        { cursorID: "b", createdAt: 2, evidence: { type: "outbox", value: outbox } },
        { cursorID: "c", createdAt: 3, evidence: { type: "selection", value: selection } },
      ),
    },
  },
  {
    name: "listRoutingDecisions",
    request: {
      schema: SelfImprovementApi.ListRoutingDecisionsRequest,
      input: { sessionDigest: digest, workload: "typescript", limit: "10", cursor: "a" },
    },
    response: { schema: SelfImprovementApi.ListRoutingDecisionsResponse, input: page(routingDecision) },
  },
  {
    name: "listAudit",
    request: {
      schema: SelfImprovementApi.ListAuditRequest,
      input: { eventType: "observation-accepted", artifactID, from: "1", to: "2", limit: "10", cursor: "a" },
    },
    response: { schema: SelfImprovementApi.ListAuditResponse, input: page(auditEntry) },
  },
] as const

test("strictly decodes and encodes every operation request and response", () => {
  expect(Object.keys(SelfImprovementApi.PrivateApiOperations)).toEqual(operationContracts.map(({ name }) => name))
  for (const contract of operationContracts) {
    const requestSchema = contract.request.schema as Schema.Codec<unknown, unknown, never, never>
    const responseSchema = contract.response.schema as Schema.Codec<unknown, unknown, never, never>
    const request = decode(requestSchema, contract.request.input)
    expect(Schema.encodeUnknownSync(requestSchema)(request)).toEqual(contract.request.input)
    const response = decode(responseSchema, contract.response.input)
    expect(Schema.encodeUnknownSync(responseSchema)(response)).toEqual(contract.response.input)
    expect(() => decode(requestSchema, { ...contract.request.input, unexpected: true })).toThrow()
    expect(() => decode(responseSchema, { ...contract.response.input, unexpected: true })).toThrow()
  }
})

test("strictly decodes and encodes all three header schemas", () => {
  const contracts = [
    [SelfImprovementApi.LocationHeaders, { "X-OpenCode-Location-ID": locationID }],
    [SelfImprovementApi.MutationHeaders, { "X-OpenCode-Location-ID": locationID, "Idempotency-Key": "retry-1" }],
    [
      SelfImprovementApi.ArtifactMutationHeaders,
      { "X-OpenCode-Location-ID": locationID, "Idempotency-Key": "retry-1", "If-Match": "7" },
    ],
  ] as const

  for (const [schema, input] of contracts) {
    const decoded = decode(schema, input)
    expect(Schema.encodeUnknownSync(schema)(decoded)).toEqual(input)
    expect(() => decode(schema, { ...input, unexpected: true })).toThrow()
  }
})

test("defines exactly the 22 app-private operations", () => {
  expect(Object.values(SelfImprovementApi.PrivateApiOperations).map(({ method, path }) => `${method} ${path}`)).toEqual(
    [
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
    ],
  )
  expect(Object.keys(SelfImprovementApi.PrivateApiOperations).some((key) => key.toLowerCase().includes("stage"))).toBe(
    false,
  )
  expect(
    Object.values(SelfImprovementApi.PrivateApiOperations).every(
      (operation) =>
        ["GET", "POST"].includes(operation.method) && operation.path.startsWith("/private/self-improvement"),
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

test("numeric HTTP values reject non-canonical unsigned decimal strings", () => {
  const invalid = ["", " 1", "1 ", "+1", "1e0", "0x1", "-1", "01"]
  for (const value of invalid) {
    expect(() => decode(SelfImprovementApi.PageRequest, { limit: value })).toThrow()
    expect(() =>
      decode(SelfImprovementApi.ArtifactMutationHeaders, {
        "X-OpenCode-Location-ID": locationID,
        "Idempotency-Key": "retry-1",
        "If-Match": value,
      }),
    ).toThrow()
    expect(() => decode(SelfImprovementApi.ListBaselinesRequest, { suiteRevision: value })).toThrow()
    expect(() => decode(SelfImprovementApi.ListAuditRequest, { from: value })).toThrow()
    expect(() => decode(SelfImprovementApi.ListAuditRequest, { to: value })).toThrow()
  }

  expect(
    Number(
      decode(SelfImprovementApi.ArtifactMutationHeaders, {
        "X-OpenCode-Location-ID": locationID,
        "Idempotency-Key": "retry-1",
        "If-Match": "0",
      })["If-Match"],
    ),
  ).toBe(0)
  expect(Number(decode(SelfImprovementApi.ListBaselinesRequest, { suiteRevision: "0" }).suiteRevision)).toBe(0)
  expect(Number(decode(SelfImprovementApi.ListAuditRequest, { from: "0", to: "0" }).from)).toBe(0)
})

test("numeric HTTP identities round-trip safe integers and reject unsafe decimals", () => {
  const maximum = String(Number.MAX_SAFE_INTEGER)
  const unsafe = String(Number.MAX_SAFE_INTEGER + 1)
  const ifMatch = decode(SelfImprovementApi.IfMatchRevision, maximum)
  const baselines = decode(SelfImprovementApi.ListBaselinesRequest, { suiteRevision: maximum })
  const audit = decode(SelfImprovementApi.ListAuditRequest, { from: maximum, to: maximum })

  expect(Schema.encodeUnknownSync(SelfImprovementApi.IfMatchRevision)(ifMatch)).toBe(maximum)
  expect(Schema.encodeUnknownSync(SelfImprovementApi.ListBaselinesRequest)(baselines).suiteRevision).toBe(maximum)
  expect(Schema.encodeUnknownSync(SelfImprovementApi.ListAuditRequest)(audit)).toMatchObject({
    from: maximum,
    to: maximum,
  })

  expect(() => decode(SelfImprovementApi.IfMatchRevision, unsafe)).toThrow()
  expect(() => decode(SelfImprovementApi.ListBaselinesRequest, { suiteRevision: unsafe })).toThrow()
  expect(() => decode(SelfImprovementApi.ListAuditRequest, { from: unsafe })).toThrow()
  expect(() => decode(SelfImprovementApi.ListAuditRequest, { to: unsafe })).toThrow()
})

test("exposes stable identifiers on public filtered schemas", () => {
  expect([
    SelfImprovementApi.PageLimit.ast.annotations?.identifier,
    SelfImprovementApi.Cursor.ast.annotations?.identifier,
    SelfImprovementApi.IdempotencyRecord.ast.annotations?.identifier,
  ]).toEqual(["SelfImprovementApi.PageLimit", "SelfImprovementApi.Cursor", "SelfImprovementApi.IdempotencyRecord"])
})

test("exposes the If-Match revision transport identifier", () => {
  expect(SelfImprovementApi.IfMatchRevision.ast.annotations?.identifier).toBe("SelfImprovementApi.IfMatchRevision")
})

test("decodes and re-encodes includeSamples HTTP query strings", () => {
  const included = decode(SelfImprovementApi.ListMetricRunsRequest, { includeSamples: "true" })
  const excluded = decode(SelfImprovementApi.ListMetricRunsRequest, { includeSamples: "false" })
  expect(included).toEqual({
    includeSamples: true,
    limit: 50,
  })
  expect(excluded).toEqual({
    includeSamples: false,
    limit: 50,
  })
  expect(decode(SelfImprovementApi.ListMetricRunsRequest, {})).toEqual({ includeSamples: false, limit: 50 })
  expect(() => decode(SelfImprovementApi.ListMetricRunsRequest, { includeSamples: "yes" })).toThrow()
  expect(Schema.encodeUnknownSync(SelfImprovementApi.ListMetricRunsRequest)(included)).toEqual({
    includeSamples: "true",
    limit: "50",
  })
  expect(Schema.encodeUnknownSync(SelfImprovementApi.ListMetricRunsRequest)(excluded)).toEqual({
    includeSamples: "false",
    limit: "50",
  })
})

test("decodes branded numeric HTTP query values only from decimal strings", () => {
  const baselineQuery = decode(SelfImprovementApi.ListBaselinesRequest, { suiteRevision: "7" })
  expect(Number(baselineQuery.suiteRevision)).toBe(7)
  expect(baselineQuery.limit).toBe(50)
  expect(Schema.encodeUnknownSync(SelfImprovementApi.ListBaselinesRequest)(baselineQuery)).toEqual({
    suiteRevision: "7",
    limit: "50",
  })
  const baselineQueryWithoutRevision = decode(SelfImprovementApi.ListBaselinesRequest, {})
  expect(baselineQueryWithoutRevision).toEqual({ limit: 50 })
  expect(Schema.encodeUnknownSync(SelfImprovementApi.ListBaselinesRequest)(baselineQueryWithoutRevision)).toEqual({
    limit: "50",
  })
  expect(() => decode(SelfImprovementApi.ListBaselinesRequest, { suiteRevision: 7 })).toThrow()

  const auditQuery = decode(SelfImprovementApi.ListAuditRequest, { from: "100", to: "200" })
  expect(Number(auditQuery.from)).toBe(100)
  expect(Number(auditQuery.to)).toBe(200)
  expect(auditQuery.limit).toBe(50)
  expect(Schema.encodeUnknownSync(SelfImprovementApi.ListAuditRequest)(auditQuery)).toEqual({
    from: "100",
    to: "200",
    limit: "50",
  })
  const auditQueryWithoutRange = decode(SelfImprovementApi.ListAuditRequest, {})
  expect(auditQueryWithoutRange).toEqual({ limit: 50 })
  expect(Schema.encodeUnknownSync(SelfImprovementApi.ListAuditRequest)(auditQueryWithoutRange)).toEqual({ limit: "50" })
  expect(() => decode(SelfImprovementApi.ListAuditRequest, { from: 100 })).toThrow()
  expect(() => decode(SelfImprovementApi.ListAuditRequest, { to: 200 })).toThrow()
})

test("metric run views correlate included samples and sample count", () => {
  expect(
    decode(SelfImprovementApi.MetricRunView, { run, aggregates, sampleCount: 1, samples: [sample] }) as unknown,
  ).toEqual({
    run,
    aggregates,
    sampleCount: 1,
    samples: [sample],
  })
  expect(decode(SelfImprovementApi.MetricRunView, { run, aggregates, sampleCount: 1 }) as unknown).toEqual({
    run,
    aggregates,
    sampleCount: 1,
  })
  expect(() =>
    decode(SelfImprovementApi.MetricRunView, {
      run,
      aggregates,
      sampleCount: 1,
      samples: [{ ...sample, runID: SelfImprovementLifecycle.EvaluationRunID.create() }],
    }),
  ).toThrow()
  expect(() =>
    decode(SelfImprovementApi.MetricRunView, { run, aggregates, sampleCount: 0, samples: [sample] }),
  ).toThrow()
})

test("rejects public evaluation envelopes with divergent decision, finding, or run identity", () => {
  const divergent = findings.with(0, {
    ...findings[0],
    id: SelfImprovementLifecycle.GateFindingID.create(),
  })
  const crossRun = findings.with(0, {
    ...findings[0],
    evaluationRunID: SelfImprovementLifecycle.EvaluationRunID.create(),
  })
  for (const invalidFindings of [divergent, crossRun, findings.slice(1), findings.toReversed()]) {
    expect(() =>
      decode(SelfImprovementApi.DecideMetricRunResponse, {
        decision,
        findings: invalidFindings,
        replayed: false,
      }),
    ).toThrow()
    expect(() =>
      decode(SelfImprovementApi.EvaluationView, { run: decidedRun, decision, orderedFindings: invalidFindings }),
    ).toThrow()
  }

  expect(() =>
    decode(SelfImprovementApi.EvaluationView, {
      run: { ...decidedRun, id: SelfImprovementLifecycle.EvaluationRunID.create() },
      decision,
      orderedFindings: findings,
    }),
  ).toThrow()
  expect(() => decode(SelfImprovementApi.EvaluationView, { run, decision, orderedFindings: findings })).toThrow()
  expect(() =>
    decode(SelfImprovementApi.EvaluationView, {
      run: { ...decidedRun, cutoffSampleSetDigest: "b".repeat(64) },
      decision,
      orderedFindings: findings,
    }),
  ).toThrow()
  expect(() =>
    decode(SelfImprovementApi.EvaluationView, {
      run: { ...decidedRun, decidedAt: decision.decidedAt + 1 },
      decision,
      orderedFindings: findings,
    }),
  ).toThrow()
})

test("private API wire contracts are closed and preserve HTTP encodings", () => {
  const headers = {
    "X-OpenCode-Location-ID": locationID,
    "Idempotency-Key": "retry-1",
    "If-Match": "7",
  }
  const decodedHeaders: { readonly "If-Match": number } = decode(SelfImprovementApi.ArtifactMutationHeaders, headers)
  expect(decodedHeaders["If-Match"]).toBe(7)
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

test("stored errors decode only at their required status", () => {
  const statuses = [200, 201, 202, 400, 403, 404, 409, 503] as const
  for (const error of Object.values(SelfImprovementApi.ApiErrors)) {
    const body = { code: error.code, message: error.code, requestID: "req-1", details: {} }
    const input = { status: error.status, body }
    const decoded = decode(SelfImprovementApi.StoredResponse, input)
    expect(decoded as unknown).toEqual(input)
    expect(Schema.encodeUnknownSync(SelfImprovementApi.StoredResponse)(decoded) as unknown).toEqual(input)
    for (const status of statuses) {
      if (status === error.status) continue
      expect(() => decode(SelfImprovementApi.StoredResponse, { status, body })).toThrow()
    }
  }
})

test("stored successes preserve exact replay status and body pairings", () => {
  const statuses = [200, 201, 202, 400, 403, 404, 409, 503] as const
  const successes = [
    { allowed: [200], body: completed },
    { allowed: [200], body: { approval } },
    { allowed: [200], body: { approval: rejectedApproval } },
    { allowed: [200, 201], body: { observation, matchingCount: 1, generationEligible: true } },
    { allowed: [201], body: { artifact, version, revision: 1 } },
    { allowed: [201], body: { version, revision: 1 } },
    { allowed: [201], body: { run } },
    { allowed: [201], body: { sample, replayed: false } },
    { allowed: [201], body: { decision, findings, replayed: false } },
    { allowed: [202], body: { status: "reconciliation-pending", artifactRevision: 2, outbox } },
  ] as const

  for (const success of successes) {
    for (const status of success.allowed) {
      const input = { status, body: success.body }
      const decoded = decode(SelfImprovementApi.StoredResponse, input)
      expect(decoded as unknown).toEqual(input)
      expect(Schema.encodeUnknownSync(SelfImprovementApi.StoredResponse)(decoded) as unknown).toEqual(input)
    }
    for (const status of statuses) {
      if (success.allowed.some((allowed) => allowed === status)) continue
      expect(() => decode(SelfImprovementApi.StoredResponse, { status, body: success.body })).toThrow()
    }
  }

  expect(decode(SelfImprovementApi.StoredResponse, { status: 200, body: completed }) as unknown).toEqual({
    status: 200,
    body: completed,
  })
  expect(
    decode(SelfImprovementApi.StoredResponse, {
      status: 202,
      body: { status: "reconciliation-pending", artifactRevision: 2, outbox },
    }) as unknown,
  ).toEqual({ status: 202, body: { status: "reconciliation-pending", artifactRevision: 2, outbox } })
})

test("pins the complete metadata contract for all 22 operations", () => {
  expect(
    Object.entries(SelfImprovementApi.PrivateApiOperations).map(([name, operation]) => [
      name,
      operation.method,
      operation.path,
      operation.operation,
      operation.locationSource,
      operation.principals,
      operation.authorizationRules,
      operation.errors,
      operation.successStatuses,
      "ordering" in operation ? operation.ordering : null,
      operation.sideEffects,
      operation.mutation,
      operation.headers.ast.annotations?.identifier,
      operation.request.ast.annotations?.identifier,
      operation.response.ast.annotations?.identifier,
    ]),
  ).toEqual([
    [
      "listArtifacts",
      "GET",
      "/private/self-improvement/artifacts",
      "artifact.read",
      "header-grant",
      ["first-party-user", "coordinator", "audit-reader"],
      [],
      [
        { code: "invalid-page", status: 400 },
        { code: "forbidden", status: 403 },
      ],
      [200],
      "kind-name-id-asc",
      ["none"],
      false,
      "SelfImprovementApi.LocationHeaders",
      "SelfImprovementApi.ListArtifactsRequest",
      "SelfImprovementApi.ListArtifactsResponse",
    ],
    [
      "createArtifact",
      "POST",
      "/private/self-improvement/artifacts",
      "artifact.create",
      "header-grant",
      ["first-party-user", "coordinator"],
      [{ type: "coordinator-generated-only", principal: "coordinator", condition: "generated-output" }],
      [
        { code: "admission-rejected", status: 400 },
        { code: "forbidden", status: 403 },
        { code: "name-reserved", status: 409 },
        { code: "idempotency-mismatch", status: 409 },
      ],
      [201],
      null,
      ["artifact-created", "draft-version-created", "transition-appended", "audit-appended"],
      true,
      "SelfImprovementApi.MutationHeaders",
      "SelfImprovementApi.CreateArtifactRequest",
      "SelfImprovementApi.CreateArtifactResponse",
    ],
    [
      "getArtifact",
      "GET",
      "/private/self-improvement/artifacts/{artifactID}",
      "artifact.read",
      "artifact-header-grant",
      ["first-party-user", "coordinator", "audit-reader"],
      [],
      [
        { code: "forbidden", status: 403 },
        { code: "artifact-not-found", status: 404 },
      ],
      [200],
      null,
      ["none"],
      false,
      "SelfImprovementApi.LocationHeaders",
      "SelfImprovementApi.GetArtifactRequest",
      "SelfImprovementApi.GetArtifactResponse",
    ],
    [
      "listVersions",
      "GET",
      "/private/self-improvement/artifacts/{artifactID}/versions",
      "artifact.read",
      "artifact-header-grant",
      ["first-party-user", "coordinator", "audit-reader"],
      [],
      [
        { code: "invalid-page", status: 400 },
        { code: "forbidden", status: 403 },
        { code: "artifact-not-found", status: 404 },
      ],
      [200],
      "version-number-id-desc",
      ["none"],
      false,
      "SelfImprovementApi.LocationHeaders",
      "SelfImprovementApi.ListVersionsRequest",
      "SelfImprovementApi.ListVersionsResponse",
    ],
    [
      "createVersion",
      "POST",
      "/private/self-improvement/artifacts/{artifactID}/versions",
      "artifact.create",
      "artifact-header-grant",
      ["first-party-user", "coordinator"],
      [{ type: "coordinator-generated-only", principal: "coordinator", condition: "generated-output" }],
      [
        { code: "admission-rejected", status: 400 },
        { code: "forbidden", status: 403 },
        { code: "artifact-not-found", status: 404 },
        { code: "revision-conflict", status: 409 },
        { code: "idempotency-mismatch", status: 409 },
        { code: "tombstoned", status: 409 },
      ],
      [201],
      null,
      ["draft-version-created", "audit-appended"],
      true,
      "SelfImprovementApi.ArtifactMutationHeaders",
      "SelfImprovementApi.CreateVersionRequest",
      "SelfImprovementApi.CreateVersionResponse",
    ],
    [
      "getVersion",
      "GET",
      "/private/self-improvement/artifacts/{artifactID}/versions/{versionID}",
      "artifact.read",
      "artifact-header-grant",
      ["first-party-user", "coordinator", "audit-reader"],
      [],
      [
        { code: "forbidden", status: 403 },
        { code: "artifact-or-version-not-found", status: 404 },
      ],
      [200],
      null,
      ["none"],
      false,
      "SelfImprovementApi.LocationHeaders",
      "SelfImprovementApi.GetVersionRequest",
      "SelfImprovementApi.GetVersionResponse",
    ],
    [
      "archiveVersion",
      "POST",
      "/private/self-improvement/artifacts/{artifactID}/versions/{versionID}/archive",
      "artifact.archive",
      "artifact-header-grant",
      ["first-party-user", "coordinator"],
      [{ type: "coordinator-policy-terminal-only", principal: "coordinator", condition: "policy-terminal-action" }],
      [
        { code: "forbidden", status: 403 },
        { code: "artifact-or-version-not-found", status: 404 },
        { code: "revision-conflict", status: 409 },
        { code: "stage-illegal", status: 409 },
        { code: "idempotency-mismatch", status: 409 },
        { code: "context-unavailable", status: 503 },
      ],
      [200, 202],
      null,
      ["terminal-intent-recorded", "context-removal-requested", "transition-appended", "audit-appended"],
      true,
      "SelfImprovementApi.ArtifactMutationHeaders",
      "SelfImprovementApi.ArchiveVersionRequest",
      "SelfImprovementApi.ArchiveVersionResponse",
    ],
    [
      "tombstoneArtifact",
      "POST",
      "/private/self-improvement/artifacts/{artifactID}/tombstone",
      "artifact.tombstone",
      "artifact-header-grant",
      ["first-party-user", "coordinator"],
      [{ type: "coordinator-policy-terminal-only", principal: "coordinator", condition: "policy-terminal-action" }],
      [
        { code: "forbidden", status: 403 },
        { code: "artifact-not-found", status: 404 },
        { code: "revision-conflict", status: 409 },
        { code: "idempotency-mismatch", status: 409 },
        { code: "context-unavailable", status: 503 },
      ],
      [200, 202],
      null,
      [
        "pending-work-cancelled",
        "terminal-intent-recorded",
        "context-removal-requested",
        "versions-archived",
        "recommendations-removed",
        "transition-appended",
        "audit-appended",
      ],
      true,
      "SelfImprovementApi.ArtifactMutationHeaders",
      "SelfImprovementApi.TombstoneArtifactRequest",
      "SelfImprovementApi.TombstoneArtifactResponse",
    ],
    [
      "approve",
      "POST",
      "/private/self-improvement/approvals/{approvalRequestID}/approve",
      "approval.decide",
      "approval-binding-header-grant",
      ["location-approver"],
      [{ type: "dedicated-approver-not-creator", principal: "location-approver" }],
      [
        { code: "forbidden", status: 403 },
        { code: "creator-self-approval", status: 403 },
        { code: "approval-request-not-found", status: 404 },
        { code: "binding-mismatch", status: 409 },
        { code: "expired", status: 409 },
        { code: "already-decided", status: 409 },
        { code: "idempotency-mismatch", status: 409 },
      ],
      [200],
      null,
      ["approval-recorded"],
      true,
      "SelfImprovementApi.MutationHeaders",
      "SelfImprovementApi.ApproveRequest",
      "SelfImprovementApi.ApproveResponse",
    ],
    [
      "reject",
      "POST",
      "/private/self-improvement/approvals/{approvalRequestID}/reject",
      "approval.decide",
      "approval-binding-header-grant",
      ["location-approver"],
      [{ type: "dedicated-approver-not-creator", principal: "location-approver" }],
      [
        { code: "forbidden", status: 403 },
        { code: "creator-self-approval", status: 403 },
        { code: "approval-request-not-found", status: 404 },
        { code: "binding-mismatch", status: 409 },
        { code: "expired", status: 409 },
        { code: "already-decided", status: 409 },
        { code: "idempotency-mismatch", status: 409 },
      ],
      [200],
      null,
      ["rejection-recorded", "terminal-intent-recorded"],
      true,
      "SelfImprovementApi.MutationHeaders",
      "SelfImprovementApi.RejectRequest",
      "SelfImprovementApi.RejectResponse",
    ],
    [
      "createObservation",
      "POST",
      "/private/self-improvement/observations",
      "evidence.ingest",
      "header-grant",
      ["runtime-evidence-service"],
      [],
      [
        { code: "redaction-rejected", status: 400 },
        { code: "forbidden", status: 403 },
        { code: "idempotency-mismatch", status: 409 },
      ],
      [200, 201],
      null,
      ["observation-recorded", "generation-eligibility-updated", "audit-appended"],
      true,
      "SelfImprovementApi.MutationHeaders",
      "SelfImprovementApi.CreateObservationRequest",
      "SelfImprovementApi.CreateObservationResponse",
    ],
    [
      "createMetricRun",
      "POST",
      "/private/self-improvement/metric-runs",
      "evidence.ingest",
      "header-grant",
      ["runtime-evidence-service"],
      [],
      [
        { code: "binding-invalid", status: 400 },
        { code: "forbidden", status: 403 },
        { code: "version-or-baseline-not-found", status: 404 },
        { code: "idempotency-mismatch", status: 409 },
        { code: "run-conflict", status: 409 },
      ],
      [201],
      null,
      ["run-opened"],
      true,
      "SelfImprovementApi.MutationHeaders",
      "SelfImprovementApi.CreateMetricRunRequest",
      "SelfImprovementApi.CreateMetricRunResponse",
    ],
    [
      "addMetricSample",
      "POST",
      "/private/self-improvement/metric-runs/{runID}/samples",
      "evidence.ingest",
      "run-header-grant",
      ["runtime-evidence-service"],
      [],
      [
        { code: "sample-invalid", status: 400 },
        { code: "forbidden", status: 403 },
        { code: "run-not-found", status: 404 },
        { code: "duplicate-different", status: 409 },
        { code: "late", status: 409 },
        { code: "out-of-stage", status: 409 },
        { code: "idempotency-mismatch", status: 409 },
      ],
      [201],
      null,
      ["sample-appended"],
      true,
      "SelfImprovementApi.MutationHeaders",
      "SelfImprovementApi.AddMetricSampleRequest",
      "SelfImprovementApi.AddMetricSampleResponse",
    ],
    [
      "decideMetricRun",
      "POST",
      "/private/self-improvement/metric-runs/{runID}/decisions",
      "evaluation.decide",
      "run-header-grant",
      ["evaluator"],
      [],
      [
        { code: "forbidden", status: 403 },
        { code: "run-not-found", status: 404 },
        { code: "already-decided", status: 409 },
        { code: "cutoff-mismatch", status: 409 },
        { code: "idempotency-mismatch", status: 409 },
      ],
      [201],
      null,
      ["decision-recorded", "coordinator-event-emitted"],
      true,
      "SelfImprovementApi.MutationHeaders",
      "SelfImprovementApi.DecideMetricRunRequest",
      "SelfImprovementApi.DecideMetricRunResponse",
    ],
    [
      "listBaselines",
      "GET",
      "/private/self-improvement/baselines",
      "audit.read",
      "header-grant",
      ["audit-reader", "evaluator", "coordinator"],
      [],
      [
        { code: "invalid-page", status: 400 },
        { code: "forbidden", status: 403 },
      ],
      [200],
      "created-id-desc",
      ["none"],
      false,
      "SelfImprovementApi.LocationHeaders",
      "SelfImprovementApi.ListBaselinesRequest",
      "SelfImprovementApi.ListBaselinesResponse",
    ],
    [
      "listMetricRuns",
      "GET",
      "/private/self-improvement/metric-runs",
      "audit.read",
      "header-grant",
      ["audit-reader", "evaluator", "coordinator"],
      [{ type: "include-samples-audit-reader-only", principal: "audit-reader", queryField: "includeSamples" }],
      [
        { code: "invalid-page", status: 400 },
        { code: "forbidden", status: 403 },
      ],
      [200],
      "created-id-desc",
      ["none"],
      false,
      "SelfImprovementApi.LocationHeaders",
      "SelfImprovementApi.ListMetricRunsRequest",
      "SelfImprovementApi.ListMetricRunsResponse",
    ],
    [
      "listEvaluations",
      "GET",
      "/private/self-improvement/evaluations",
      "audit.read",
      "header-grant",
      ["audit-reader", "evaluator", "coordinator"],
      [],
      [
        { code: "invalid-page", status: 400 },
        { code: "forbidden", status: 403 },
      ],
      [200],
      "decided-id-desc",
      ["none"],
      false,
      "SelfImprovementApi.LocationHeaders",
      "SelfImprovementApi.ListEvaluationsRequest",
      "SelfImprovementApi.ListEvaluationsResponse",
    ],
    [
      "listTransitions",
      "GET",
      "/private/self-improvement/transitions",
      "audit.read",
      "header-grant",
      ["audit-reader", "coordinator"],
      [],
      [
        { code: "invalid-page", status: 400 },
        { code: "forbidden", status: 403 },
      ],
      [200],
      "timestamp-id-desc",
      ["none"],
      false,
      "SelfImprovementApi.LocationHeaders",
      "SelfImprovementApi.ListTransitionsRequest",
      "SelfImprovementApi.ListTransitionsResponse",
    ],
    [
      "listApprovals",
      "GET",
      "/private/self-improvement/approvals",
      "audit.read",
      "header-grant",
      ["audit-reader", "location-approver"],
      [{ type: "approver-own-decisions-only", principal: "location-approver" }],
      [
        { code: "invalid-page", status: 400 },
        { code: "forbidden", status: 403 },
      ],
      [200],
      "decided-id-desc",
      ["none"],
      false,
      "SelfImprovementApi.LocationHeaders",
      "SelfImprovementApi.ListApprovalsRequest",
      "SelfImprovementApi.ListApprovalsResponse",
    ],
    [
      "listContextEvidence",
      "GET",
      "/private/self-improvement/context-evidence",
      "audit.read",
      "header-grant",
      ["audit-reader", "coordinator"],
      [],
      [
        { code: "invalid-page", status: 400 },
        { code: "forbidden", status: 403 },
      ],
      [200],
      "created-id-desc",
      ["none"],
      false,
      "SelfImprovementApi.LocationHeaders",
      "SelfImprovementApi.ListContextEvidenceRequest",
      "SelfImprovementApi.ListContextEvidenceResponse",
    ],
    [
      "listRoutingDecisions",
      "GET",
      "/private/self-improvement/routing-decisions",
      "audit.read",
      "header-grant",
      ["audit-reader", "coordinator"],
      [],
      [
        { code: "invalid-page", status: 400 },
        { code: "forbidden", status: 403 },
      ],
      [200],
      "timestamp-id-desc",
      ["none"],
      false,
      "SelfImprovementApi.LocationHeaders",
      "SelfImprovementApi.ListRoutingDecisionsRequest",
      "SelfImprovementApi.ListRoutingDecisionsResponse",
    ],
    [
      "listAudit",
      "GET",
      "/private/self-improvement/audit",
      "audit.read",
      "header-grant",
      ["audit-reader"],
      [{ type: "audit-reader-only-audit", principal: "audit-reader" }],
      [
        { code: "invalid-page", status: 400 },
        { code: "forbidden", status: 403 },
      ],
      [200],
      "timestamp-id-desc",
      ["access-audited"],
      false,
      "SelfImprovementApi.LocationHeaders",
      "SelfImprovementApi.ListAuditRequest",
      "SelfImprovementApi.ListAuditResponse",
    ],
  ])
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
