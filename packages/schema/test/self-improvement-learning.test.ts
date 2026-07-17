import { expect, test } from "bun:test"
import { Exit, Schema } from "effect"
import { SelfImprovementLearning } from "../src/self-improvement-learning"
import { SelfImprovementLifecycle } from "../src/self-improvement-lifecycle"

const decode = (schema: Schema.Decoder<unknown>, input: unknown): unknown => {
  const result = Schema.decodeUnknownExit(schema, { errors: "all", onExcessProperty: "error" })(input)
  if (Exit.isFailure(result)) throw new Error("schema decode failed")
  return result.value
}

const digest = "a".repeat(64)
const locationID = "e".repeat(64)
const route = { providerID: "opencode", id: "gpt-5", variant: "default" }
const observationInput = {
  id: "si_obs_00000000000000000000000000",
  locationID,
  patternDigest: digest,
  identityDigest: "b".repeat(64),
  workload: "typescript",
  workloadRevision: 1,
  errorClass: "type-error",
  orderedToolSymbolDigest: "c".repeat(64),
  outcomeClass: "failure",
  taskIDDigest: "d".repeat(64),
  producerID: "runtime-evidence",
  occurredAt: 1,
  expiresAt: 2,
}

test("pins learning, reward, routing, context, and cohort vocabularies", () => {
  expect(SelfImprovementLearning.RoutingPrecedence).toEqual([
    "session-user",
    "role",
    "active-recommendation",
    "catalog-default",
    "catalog-fallback",
  ])
  for (const [schema, values] of [
    [SelfImprovementLearning.ActionDomain, ["generation-strategy", "model-route"]],
    [SelfImprovementLearning.ObservationOutcomeClass, ["success", "failure", "cancelled"]],
    [
      SelfImprovementLearning.GenerationOutcome,
      ["pending", "model-failed", "output-rejected", "hard-rejected", "admitted"],
    ],
    [
      SelfImprovementLearning.RewardOutcomeClass,
      [
        "no-reward-model-failure",
        "invalid-model-output",
        "no-reward-hard-rejection",
        "no-reward-insufficient-evidence",
        "shadow-failure",
        "canary-regression",
        "no-reward-approval",
        "passing-evidence",
      ],
    ],
    [SelfImprovementLearning.RoutingPrecedenceSource, SelfImprovementLearning.RoutingPrecedence],
    [SelfImprovementLearning.ContextOutboxStatus, ["pending", "applying", "applied", "superseded", "blocked"]],
    [SelfImprovementLearning.ContextCohortResult, ["shadow-isolated", "canary-in", "canary-out", "active"]],
  ] as const) {
    for (const value of values) expect(decode(schema, value)).toBe(value)
  }
})

test("observation accepts only redacted stable identifiers and digests", () => {
  expect(decode(SelfImprovementLearning.Observation, observationInput)).toEqual(observationInput)
  for (const invalid of [
    { ...observationInput, transcript: "raw" },
    { ...observationInput, providerSettings: {} },
    { ...observationInput, locationID: undefined },
    { ...observationInput, patternDigest: "not-a-digest" },
  ]) {
    expect(() => decode(SelfImprovementLearning.Observation, invalid)).toThrow()
  }
})

test("generation leases and arms preserve Location-owned immutable selection inputs", () => {
  const lease = {
    id: SelfImprovementLifecycle.GenerationLeaseID.create(),
    locationID,
    patternDigest: digest,
    ownerID: "coordinator",
    leaseTokenDigest: "b".repeat(64),
    attemptNumber: 1,
    acquiredAt: 1,
    expiresAt: 2,
    modelRequestDigest: "c".repeat(64),
    outcome: "pending",
  }
  expect(decode(SelfImprovementLearning.GenerationLease, lease)).toEqual(lease)
  for (const invalid of [
    { ...lease, attemptNumber: 0 },
    { ...lease, locationID: undefined },
    { ...lease, patternDigest: undefined },
    { ...lease, modelRequestDigest: undefined },
    { ...lease, modelOutputDigest: "raw-output" },
  ]) {
    expect(() => decode(SelfImprovementLearning.GenerationLease, invalid)).toThrow()
  }

  const strategyArm = {
    id: SelfImprovementLifecycle.GenerationStrategyArmID.create(),
    locationID,
    strategyID: "redacted-json-skill",
    allowlistRevision: 1,
    active: true,
  }
  const routeArm = {
    id: SelfImprovementLifecycle.ModelRouteArmID.create(),
    locationID,
    route,
    allowlistRevision: 1,
    active: true,
  }
  expect(decode(SelfImprovementLearning.GenerationStrategyArm, strategyArm)).toEqual(strategyArm)
  expect(decode(SelfImprovementLearning.ModelRouteArm, routeArm)).toEqual(routeArm)
  expect(decode(SelfImprovementLearning.BanditArmID, strategyArm.id)).toBe(strategyArm.id)
  expect(decode(SelfImprovementLearning.BanditArmID, routeArm.id)).toBe(routeArm.id)
  expect(() => decode(SelfImprovementLearning.ModelRouteArm, { ...routeArm, locationID: undefined })).toThrow()
})

test("pull events require a unique eligible domain-matched arm list containing the selection", () => {
  const strategyArmID = SelfImprovementLifecycle.GenerationStrategyArmID.create()
  const pull = {
    id: SelfImprovementLifecycle.PullEventID.create(),
    locationID,
    actionDomain: "generation-strategy",
    bucketDigest: digest,
    derivationRevision: 1,
    allowlistRevision: 1,
    orderedEligibleArmIDs: [strategyArmID],
    selectedArmID: strategyArmID,
    timestamp: 1,
  }
  expect(decode(SelfImprovementLearning.PullEvent, pull)).toEqual(pull)
  const otherStrategyArmID = SelfImprovementLifecycle.GenerationStrategyArmID.create()
  const routeArmID = SelfImprovementLifecycle.ModelRouteArmID.create()
  for (const invalid of [
    { ...pull, locationID: undefined },
    { ...pull, orderedEligibleArmIDs: [strategyArmID, strategyArmID] },
    { ...pull, selectedArmID: otherStrategyArmID },
    { ...pull, orderedEligibleArmIDs: [routeArmID], selectedArmID: routeArmID },
  ]) {
    expect(() => decode(SelfImprovementLearning.PullEvent, invalid)).toThrow()
  }
})

test("reward events bound optional numeric rewards and bandit state keeps derivation identity", () => {
  const pullEventID = SelfImprovementLifecycle.PullEventID.create()
  const reward = {
    id: SelfImprovementLifecycle.RewardEventID.create(),
    locationID,
    pullEventID,
    outcomeClass: "canary-regression",
    numericReward: -1,
    evidenceDigest: digest,
    timestamp: 1,
  }
  expect(decode(SelfImprovementLearning.RewardEvent, reward)).toEqual(reward)
  const rewardWithoutNumeric = {
    id: reward.id,
    locationID,
    pullEventID,
    outcomeClass: reward.outcomeClass,
    evidenceDigest: digest,
    timestamp: 1,
  }
  expect(decode(SelfImprovementLearning.RewardEvent, rewardWithoutNumeric)).toEqual(rewardWithoutNumeric)
  expect(() => decode(SelfImprovementLearning.RewardEvent, { ...reward, numericReward: 1.01 })).toThrow()
  expect(() => decode(SelfImprovementLearning.RewardEvent, { ...reward, numericReward: -1.01 })).toThrow()

  const state = {
    locationID,
    actionDomain: "model-route",
    bucketDigest: digest,
    derivationRevision: 2,
    allowlistRevision: 1,
    armID: SelfImprovementLifecycle.ModelRouteArmID.create(),
    pullTotal: 1,
    rewardedPullTotal: 0,
    cumulativeReward: 0,
    meanReward: 0,
    active: true,
    latestPullEventID: pullEventID,
  }
  expect(decode(SelfImprovementLearning.BanditState, state)).toEqual(state)
  expect(() =>
    decode(SelfImprovementLearning.BanditState, {
      ...state,
      armID: SelfImprovementLifecycle.GenerationStrategyArmID.create(),
    }),
  ).toThrow()
  expect(() => decode(SelfImprovementLearning.BanditState, { ...state, derivationRevision: undefined })).toThrow()
})

test("routing decisions preserve live route identity, precedence, snapshots, and ordered arms", () => {
  const routeArm = {
    id: SelfImprovementLifecycle.ModelRouteArmID.create(),
    locationID,
    route,
    allowlistRevision: 1,
    active: true,
  }
  const decision = {
    id: SelfImprovementLifecycle.RoutingDecisionID.create(),
    locationID,
    sessionDigest: digest,
    workload: "typescript",
    workloadRevision: 1,
    roleDigest: "b".repeat(64),
    precedenceSource: "active-recommendation",
    policySnapshotDigest: "c".repeat(64),
    catalogSnapshotDigest: "d".repeat(64),
    variantSnapshotDigest: "f".repeat(64),
    orderedEligibleArms: [routeArm],
    selectedRoute: route,
    reasonCode: "eligible-active-recommendation",
    pullEventID: SelfImprovementLifecycle.PullEventID.create(),
    timestamp: 1,
  }
  expect(decode(SelfImprovementLearning.RoutingDecision, decision)).toEqual(decision)
  for (const field of [
    "locationID",
    "sessionDigest",
    "workloadRevision",
    "roleDigest",
    "precedenceSource",
    "policySnapshotDigest",
    "catalogSnapshotDigest",
    "variantSnapshotDigest",
    "orderedEligibleArms",
    "selectedRoute",
    "reasonCode",
  ] as const) {
    expect(() => decode(SelfImprovementLearning.RoutingDecision, { ...decision, [field]: undefined })).toThrow()
  }
})

test("desired context and retention unions reject partial states", () => {
  const versionID = SelfImprovementLifecycle.ArtifactVersionID.create()
  const present = { state: "present", versionID, versionDigest: digest, stage: "canary" }
  expect(decode(SelfImprovementLearning.ContextDesiredTarget, present)).toEqual(present)
  expect(decode(SelfImprovementLearning.ContextDesiredTarget, { state: "absent" })).toEqual({ state: "absent" })
  expect(() => decode(SelfImprovementLearning.ContextDesiredTarget, { state: "present", versionID })).toThrow()
  expect(() => decode(SelfImprovementLearning.ContextDesiredTarget, { state: "absent", versionID })).toThrow()
  expect(() =>
    decode(SelfImprovementLearning.RetentionMetadata, { _tag: "observation-30d", createdAt: 1 }),
  ).toThrow()
  expect(() =>
    decode(SelfImprovementLearning.RetentionMetadata, {
      _tag: "evidence-180d",
      createdAt: 1,
      expiresAt: 1 + 179 * 86_400_000,
    }),
  ).toThrow()
  expect(
    decode(SelfImprovementLearning.RetentionMetadata, {
      _tag: "observation-30d",
      createdAt: 1,
      expiresAt: 1 + 30 * 86_400_000,
    }),
  ).toEqual({ _tag: "observation-30d", createdAt: 1, expiresAt: 1 + 30 * 86_400_000 })
  expect(
    decode(SelfImprovementLearning.RetentionMetadata, {
      _tag: "evidence-180d",
      createdAt: 1,
      expiresAt: 1 + 180 * 86_400_000,
    }),
  ).toEqual({ _tag: "evidence-180d", createdAt: 1, expiresAt: 1 + 180 * 86_400_000 })
  expect(decode(SelfImprovementLearning.RetentionMetadata, { _tag: "governed-metadata", createdAt: 1 })).toEqual({
    _tag: "governed-metadata",
    createdAt: 1,
  })
})

test("context records preserve desired revision, exact transition intent, outbox, and selection evidence", () => {
  const artifactID = SelfImprovementLifecycle.ArtifactID.create()
  const versionID = SelfImprovementLifecycle.ArtifactVersionID.create()
  const intent = {
    versionID,
    previousStage: "shadow",
    nextStage: "canary",
    event: "approval-consumed",
    reason: "gates-passed",
    actorID: "coordinator",
    evaluationRunID: SelfImprovementLifecycle.EvaluationRunID.create(),
    approvalID: SelfImprovementLifecycle.ApprovalID.create(),
    idempotencyRecordID: SelfImprovementLifecycle.IdempotencyRecordID.create(),
    idempotencyDigest: "f".repeat(64),
  }
  expect(decode(SelfImprovementLearning.PendingTransitionIntent, intent)).toEqual(intent)
  for (const field of [
    "versionID",
    "previousStage",
    "nextStage",
    "event",
    "reason",
    "actorID",
    "idempotencyRecordID",
    "idempotencyDigest",
  ] as const) {
    expect(() => decode(SelfImprovementLearning.PendingTransitionIntent, { ...intent, [field]: undefined })).toThrow()
  }

  const desired = {
    locationID,
    artifactID,
    rolloutSlot: "canary",
    desired: { state: "present", versionID, versionDigest: digest, stage: "canary" },
    desiredRevision: 2,
  }
  expect(decode(SelfImprovementLearning.ContextDesiredState, desired)).toEqual(desired)
  const outboxID = SelfImprovementLifecycle.ContextOutboxID.create()
  const outbox = {
    id: outboxID,
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
  expect(decode(SelfImprovementLearning.ContextOutbox, outbox)).toEqual(outbox)
  expect(() => decode(SelfImprovementLearning.ContextOutbox, { ...outbox, locationID: undefined })).toThrow()
  expect(() => decode(SelfImprovementLearning.ContextOutbox, { ...outbox, attempts: -1 })).toThrow()

  const selection = {
    id: SelfImprovementLifecycle.ContextSelectionEvidenceID.create(),
    artifactID,
    versionID,
    versionDigest: digest,
    locationID,
    stage: "canary",
    contextEpoch: 2,
    sessionDigest: "b".repeat(64),
    cohortResult: "canary-in",
    outboxID,
  }
  expect(decode(SelfImprovementLearning.ContextSelectionEvidence, selection)).toEqual(selection)
  for (const field of Object.keys(selection)) {
    expect(() => decode(SelfImprovementLearning.ContextSelectionEvidence, { ...selection, [field]: undefined })).toThrow()
  }
})

test("audit and idempotency records keep Location identity, redacted links, and optional omission", () => {
  const payload = {
    artifactID: SelfImprovementLifecycle.ArtifactID.create(),
    linkedDigests: [digest],
    rejectedFieldNames: ["transcript"],
  }
  expect(decode(SelfImprovementLearning.AuditPayload, payload)).toEqual(payload)
  expect(() => decode(SelfImprovementLearning.AuditPayload, { ...payload, linkedDigests: [digest, digest] })).toThrow()
  expect(() =>
    decode(SelfImprovementLearning.AuditPayload, { ...payload, rejectedFieldNames: ["transcript", "transcript"] }),
  ).toThrow()

  const audit = {
    id: SelfImprovementLifecycle.AuditEntryID.create(),
    locationID,
    eventType: "observation-accepted",
    actorID: "runtime-evidence",
    payload,
    timestamp: 1,
    retention: { _tag: "evidence-180d", createdAt: 1, expiresAt: 1 + 180 * 86_400_000 },
  }
  expect(decode(SelfImprovementLearning.AuditEntry, audit)).toEqual(audit)
  expect(() => decode(SelfImprovementLearning.AuditEntry, { ...audit, locationID: undefined })).toThrow()

  const identity = {
    principalID: "coordinator",
    locationID,
    operation: "context.reconcile",
    key: "request-1",
  }
  expect(decode(SelfImprovementLearning.IdempotencyIdentity, identity)).toEqual(identity)
  for (const field of Object.keys(identity)) {
    expect(() => decode(SelfImprovementLearning.IdempotencyIdentity, { ...identity, [field]: undefined })).toThrow()
  }
  expect(() => decode(SelfImprovementLearning.IdempotencyKey, "")).toThrow()
})

test("every exported learning schema has a stable unique identifier", () => {
  const schemas = [
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
    SelfImprovementLearning.ObservationRetention,
    SelfImprovementLearning.EvidenceRetention,
    SelfImprovementLearning.GovernedMetadataRetention,
    SelfImprovementLearning.RetentionMetadata,
    SelfImprovementLearning.IdempotencyIdentity,
  ]
  const identifiers = schemas.map((schema) => schema.ast.annotations?.identifier)
  const expected = [
    "SelfImprovementLearning.IdempotencyKey",
    "SelfImprovementLearning.ActionDomain",
    "SelfImprovementLearning.ObservationOutcomeClass",
    "SelfImprovementLearning.GenerationOutcome",
    "SelfImprovementLearning.RewardOutcomeClass",
    "SelfImprovementLearning.RoutingPrecedenceSource",
    "SelfImprovementLearning.ContextOutboxStatus",
    "SelfImprovementLearning.ContextCohortResult",
    "SelfImprovementLearning.Observation",
    "SelfImprovementLearning.GenerationLease",
    "SelfImprovementLearning.GenerationStrategyArm",
    "SelfImprovementLearning.ModelRouteArm",
    "SelfImprovementLearning.BanditArmID",
    "SelfImprovementLearning.PullEvent",
    "SelfImprovementLearning.RewardEvent",
    "SelfImprovementLearning.BanditState",
    "SelfImprovementLearning.RoutingDecision",
    "SelfImprovementLearning.ContextDesiredTarget",
    "SelfImprovementLearning.ContextDesiredState",
    "SelfImprovementLearning.PendingTransitionIntent",
    "SelfImprovementLearning.ContextOutbox",
    "SelfImprovementLearning.ContextSelectionEvidence",
    "SelfImprovementLearning.AuditPayload",
    "SelfImprovementLearning.AuditEntry",
    "SelfImprovementLearning.ObservationRetention",
    "SelfImprovementLearning.EvidenceRetention",
    "SelfImprovementLearning.GovernedMetadataRetention",
    "SelfImprovementLearning.RetentionMetadata",
    "SelfImprovementLearning.IdempotencyIdentity",
  ]
  expect(identifiers).toEqual(expected)
  expect(new Set(identifiers).size).toBe(expected.length)
})
