import { expect, test } from "bun:test"
import {
  SelfImprovement,
  SelfImprovementApi,
  SelfImprovementEvaluation,
  SelfImprovementLifecycle,
} from "@opencode-ai/schema"
import { Database } from "@opencode-ai/core/database/database"
import { Effect, Schema } from "effect"
import { SelfImprovementIngressStore } from "@opencode-ai/core/self-improvement/ingress-store"
import { SelfImprovementKeyring } from "@opencode-ai/core/self-improvement/keyring"

const locationID = SelfImprovementLifecycle.LocationID.make("a".repeat(64))
const otherLocationID = SelfImprovementLifecycle.LocationID.make("b".repeat(64))
const fields = {
  workload: SelfImprovementEvaluation.Workload.make("typescript"),
  workloadRevision: SelfImprovementLifecycle.Revision.make(1),
  errorClass: "type-error",
  orderedToolSymbolIDs: ["tool-a", "symbol-b"],
  outcomeClass: "failure" as const,
  taskIDDigest: SelfImprovement.Digest.make("a".repeat(64)),
}

test("computes Location-keyed observation digests from allowlisted fields", async () => {
  const keyring = SelfImprovementKeyring.make("test-key")
  const first = await Effect.runPromise(keyring.digestObservation(locationID, fields))
  const same = await Effect.runPromise(keyring.digestObservation(locationID, fields))
  const other = await Effect.runPromise(keyring.digestObservation(otherLocationID, fields))

  expect(first).toEqual(same)
  expect(first.patternDigest).not.toBe(other.patternDigest)
  expect(first.identityDigest).not.toBe(other.identityDigest)
  expect(first.patternDigest).toHaveLength(64)
  expect(first.identityDigest).toHaveLength(64)
})

test("changes digests for every allowlisted field and rejects extra input fields", async () => {
  const keyring = SelfImprovementKeyring.make("test-key")
  const baseline = await Effect.runPromise(keyring.digestObservation(locationID, fields))
  const changed = [
    { ...fields, workload: SelfImprovementEvaluation.Workload.make("go") },
    { ...fields, workloadRevision: SelfImprovementLifecycle.Revision.make(2) },
    { ...fields, errorClass: "runtime-error" },
    { ...fields, orderedToolSymbolIDs: ["tool-a", "symbol-c"] },
    { ...fields, outcomeClass: "success" as const },
    { ...fields, taskIDDigest: SelfImprovement.Digest.make("b".repeat(64)) },
  ]

  for (const value of changed) {
    const digest = await Effect.runPromise(keyring.digestObservation(locationID, value))
    expect(digest.identityDigest).not.toBe(baseline.identityDigest)
  }
  const decoded = Schema.decodeUnknownSync(SelfImprovementApi.CreateObservationRequest)({
    ...fields,
    transcript: "raw",
  })
  expect(decoded).not.toHaveProperty("transcript")
})

const principal = new SelfImprovementLifecycle.Principal({
  id: SelfImprovementLifecycle.PrincipalID.make("runtime-evidence"),
  kind: "runtime-evidence-service",
  locationID,
})
test("rejects a principal that is not granted to the authoritative target Location", async () => {
  const denied = await Effect.runPromise(
    SelfImprovementIngressStore.Service.use((ingress) =>
      ingress
        .recordObservation(principal, otherLocationID, fields, SelfImprovementLifecycle.TimestampMillis.make(1))
        .pipe(Effect.flip),
    ).pipe(
      Effect.provide(SelfImprovementIngressStore.layer),
      Effect.provideService(SelfImprovementIngressStore.EvaluationEvidence, {
        createRun: Effect.succeed,
        appendSample: (locationID, sample) => Effect.succeed({ sample, replayed: false }),
      }),
      Effect.provideService(SelfImprovementKeyring.Service, SelfImprovementKeyring.make("test-key")),
      Effect.provide(Database.layerFromPath(":memory:")),
    ),
  )
  expect(denied._tag).toBe("SelfImprovementAuthorization.Forbidden")
})

test("replays a live identity, expires it after thirty days, and never returns raw identifiers", async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* SelfImprovementIngressStore.Service.use((ingress) =>
        Effect.gen(function* () {
          const first = yield* ingress.recordObservation(
            principal,
            locationID,
            fields,
            SelfImprovementLifecycle.TimestampMillis.make(1),
          )
          const replay = yield* ingress.recordObservation(
            principal,
            locationID,
            fields,
            SelfImprovementLifecycle.TimestampMillis.make(2),
          )
          const afterExpiry = yield* ingress.recordObservation(
            principal,
            locationID,
            fields,
            SelfImprovementLifecycle.TimestampMillis.make(1 + 30 * 86_400_000),
          )
          return { first, replay, afterExpiry }
        }),
      )
    }).pipe(
      Effect.provide(SelfImprovementIngressStore.layer),
      Effect.provideService(SelfImprovementIngressStore.EvaluationEvidence, {
        createRun: Effect.succeed,
        appendSample: (locationID, sample) => Effect.succeed({ sample, replayed: false }),
      }),
      Effect.provideService(SelfImprovementKeyring.Service, SelfImprovementKeyring.make("test-key")),
      Effect.provide(Database.layerFromPath(":memory:")),
    ),
  )

  expect(result.replay.observation.id).toBe(result.first.observation.id)
  expect(result.afterExpiry.observation.id).not.toBe(result.first.observation.id)
  expect(result.first.observation).not.toHaveProperty("orderedToolSymbolIDs")
  expect(result.first.observation.orderedToolSymbolDigest).toHaveLength(64)
})

test("rejects future terminal time before delegating a sample", async () => {
  let appended = false
  const denied = await Effect.runPromise(
    SelfImprovementIngressStore.Service.use((ingress) =>
      ingress
        .appendMetricSample(
          principal,
          locationID,
          {
            runID: SelfImprovementLifecycle.EvaluationRunID.create(),
            sampleIDDigest: SelfImprovement.Digest.make("b".repeat(64)),
            taskIDDigest: SelfImprovement.Digest.make("c".repeat(64)),
            metrics: {
              taskQuality: { earnedAllowlistedPoints: 0, possibleAllowlistedPoints: 0 },
              correctness: { passedRequiredChecks: 0, requiredChecks: 0 },
              repeatFixRate: { repeatedTasks: 0, completedTasks: 0 },
              precision: { acceptedRelevantItems: 0, assessedItems: 0 },
              latencyMs: 0,
              tokensPerSuccess: { inputTokens: 0, outputTokens: 0, successfulTasks: 0 },
              cacheHitRatio: { cacheReadTokens: 0, cacheEligibleTokens: 0 },
            },
            outcome: "failure",
            startedAt: SelfImprovementLifecycle.TimestampMillis.make(1),
            terminalAt: SelfImprovementLifecycle.TimestampMillis.make(2),
            requestDigest: SelfImprovement.Digest.make("d".repeat(64)),
          },
          SelfImprovementLifecycle.TimestampMillis.make(1),
        )
        .pipe(Effect.flip),
    ).pipe(
      Effect.provide(SelfImprovementIngressStore.layer),
      Effect.provideService(SelfImprovementIngressStore.EvaluationEvidence, {
        createRun: Effect.succeed,
        appendSample: (locationID, sample) => {
          appended = true
          return Effect.succeed({ sample, replayed: false })
        },
      }),
      Effect.provideService(SelfImprovementKeyring.Service, SelfImprovementKeyring.make("test-key")),
      Effect.provide(Database.layerFromPath(":memory:")),
    ),
  )
  expect(denied._tag).toBe("SelfImprovementIngressStore.InvalidInput")
  expect(appended).toBe(false)
})

test("propagates EvaluationEvidence rejection without a successful sample result", async () => {
  const rejected = await Effect.runPromise(
    SelfImprovementIngressStore.Service.use((ingress) =>
      ingress
        .appendMetricSample(
          principal,
          locationID,
          {
            runID: SelfImprovementLifecycle.EvaluationRunID.create(),
            sampleIDDigest: SelfImprovement.Digest.make("e".repeat(64)),
            taskIDDigest: SelfImprovement.Digest.make("f".repeat(64)),
            metrics: {
              taskQuality: { earnedAllowlistedPoints: 0, possibleAllowlistedPoints: 0 },
              correctness: { passedRequiredChecks: 0, requiredChecks: 0 },
              repeatFixRate: { repeatedTasks: 0, completedTasks: 0 },
              precision: { acceptedRelevantItems: 0, assessedItems: 0 },
              latencyMs: 0,
              tokensPerSuccess: { inputTokens: 0, outputTokens: 0, successfulTasks: 0 },
              cacheHitRatio: { cacheReadTokens: 0, cacheEligibleTokens: 0 },
            },
            outcome: "failure",
            startedAt: SelfImprovementLifecycle.TimestampMillis.make(1),
            terminalAt: SelfImprovementLifecycle.TimestampMillis.make(1),
            requestDigest: SelfImprovement.Digest.make("0".repeat(64)),
          },
          SelfImprovementLifecycle.TimestampMillis.make(1),
        )
        .pipe(Effect.flip),
    ).pipe(
      Effect.provide(SelfImprovementIngressStore.layer),
      Effect.provideService(SelfImprovementIngressStore.EvaluationEvidence, {
        createRun: Effect.succeed,
        appendSample: () => Effect.fail(new SelfImprovementIngressStore.InvalidInput({ message: "late" })),
      }),
      Effect.provideService(SelfImprovementKeyring.Service, SelfImprovementKeyring.make("test-key")),
      Effect.provide(Database.layerFromPath(":memory:")),
    ),
  )
  expect(rejected).toMatchObject({ _tag: "SelfImprovementIngressStore.InvalidInput", message: "late" })
})
