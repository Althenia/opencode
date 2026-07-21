import { expect, test } from "bun:test"
import { SqliteClient } from "@effect/sql-sqlite-bun"
import { EffectDrizzleSqlite } from "@opencode-ai/effect-drizzle-sqlite"
import { SelfImprovement, SelfImprovementEvaluation, SelfImprovementLifecycle } from "@opencode-ai/schema"
import { Database } from "@opencode-ai/core/database/database"
import { SelfImprovementEvaluationStore } from "@opencode-ai/core/self-improvement/evaluation-store"
import { Effect, Layer, Schema } from "effect"
import { sql } from "drizzle-orm"
import { Hash } from "@opencode-ai/core/util/hash"

const makeDb = EffectDrizzleSqlite.makeWithDefaults()
const locationID = SelfImprovementLifecycle.LocationID.make("a".repeat(64))
const otherLocationID = SelfImprovementLifecycle.LocationID.make("b".repeat(64))
const suiteID = SelfImprovementLifecycle.SuiteID.make("si_sui_1")
const baselineID = SelfImprovementLifecycle.BaselineID.make("si_bas_1")
const runID = SelfImprovementLifecycle.EvaluationRunID.make("si_run_1")
const digest = (value: string) => SelfImprovement.Digest.make(Hash.sha256(value))

const thresholds = new SelfImprovementEvaluation.MetricThresholds({
  taskQuality: new SelfImprovementEvaluation.HigherIsBetterNonRegression({ minimumDelta: 0 }),
  correctness: new SelfImprovementEvaluation.HigherIsBetterNonRegression({ minimumDelta: 0 }),
  repeatFixRate: new SelfImprovementEvaluation.LowerIsBetterNonRegression({ maximumDelta: 0 }),
  precision: new SelfImprovementEvaluation.HigherIsBetterNonRegression({ minimumDelta: 0 }),
  latency: new SelfImprovementEvaluation.MaximumRatioThreshold({ maximumRatio: 1.1 }),
  tokensPerSuccess: new SelfImprovementEvaluation.MaximumRatioThreshold({ maximumRatio: 1.1 }),
  cacheHitRatio: new SelfImprovementEvaluation.HigherIsBetterNonRegression({ minimumDelta: 0 }),
  aggregateReward: new SelfImprovementEvaluation.PositiveAggregateRewardThreshold({ minimumExclusive: 0 }),
})

const totals = {
  taskQualityEarnedAllowlistedPoints: 20,
  taskQualityPossibleAllowlistedPoints: 20,
  correctnessPassedRequiredChecks: 20,
  correctnessRequiredChecks: 20,
  repeatFixRepeatedTasks: 0,
  repeatFixCompletedTasks: 20,
  precisionAcceptedRelevantItems: 20,
  precisionAssessedItems: 20,
  acceptedLatencySampleCount: 20,
  latencySampleSetDigest: digest("latency"),
  inputTokens: 20,
  outputTokens: 20,
  successfulTasks: 20,
  cacheReadTokens: 20,
  cacheEligibleTokens: 20,
}

const aggregates = new SelfImprovementEvaluation.MetricAggregates({
  taskQuality: 1,
  correctness: 1,
  repeatFixRate: 0,
  precision: 1,
  latencyP95Ms: 1,
  tokensPerSuccess: 2,
  cacheHitRatio: 1,
})

const suite = new SelfImprovementEvaluation.SuiteRevision({
  locationID,
  suiteID,
  revision: SelfImprovementLifecycle.Revision.make(1),
  workload: SelfImprovementEvaluation.Workload.make("test"),
  workloadRevision: SelfImprovementLifecycle.Revision.make(1),
  artifactKinds: ["skill"],
  orderedGates: SelfImprovementEvaluation.GateIDs,
  thresholds,
  shadowMinimumSamples: 10,
  canaryMinimumSamples: 20,
  creatorID: SelfImprovementLifecycle.PrincipalID.make("creator"),
  createdAt: SelfImprovementLifecycle.TimestampMillis.make(1),
})

const baseline = () =>
  new SelfImprovementEvaluation.Baseline({
    id: baselineID,
    locationID,
    workload: suite.workload,
    workloadRevision: suite.workloadRevision,
    suiteID,
    suiteRevision: suite.revision,
    producerAllowlistRevision: SelfImprovementLifecycle.Revision.make(1),
    controlSource: "control",
    acceptanceStart: SelfImprovementLifecycle.TimestampMillis.make(1),
    acceptanceEnd: SelfImprovementLifecycle.TimestampMillis.make(2),
    cutoffAt: SelfImprovementLifecycle.TimestampMillis.make(3),
    uniqueSampleCount: 20,
    orderedSampleIDDigest: digest("samples"),
    metricTotals: totals,
    aggregates,
    createdAt: SelfImprovementLifecycle.TimestampMillis.make(4),
    evaluatorSignatureDigest: digest("signature"),
    bootstrapAuthorityID: SelfImprovementLifecycle.PrincipalID.make("approver"),
  })

const run = new SelfImprovementEvaluation.EvaluationRun({
  id: runID,
  locationID,
  versionID: SelfImprovementLifecycle.ArtifactVersionID.make("si_ver_1"),
  stage: "shadow",
  workload: suite.workload,
  workloadRevision: suite.workloadRevision,
  suiteID,
  suiteRevision: suite.revision,
  baselineID,
  state: "open",
  trustedProducerIDs: [SelfImprovementLifecycle.PrincipalID.make("producer")],
  acceptanceStart: SelfImprovementLifecycle.TimestampMillis.make(1),
  acceptanceEnd: SelfImprovementLifecycle.TimestampMillis.make(10),
  cutoffAt: SelfImprovementLifecycle.TimestampMillis.make(11),
  requestDigest: digest("run"),
  createdAt: SelfImprovementLifecycle.TimestampMillis.make(1),
})

const cancelledRun = new SelfImprovementEvaluation.EvaluationRun({
  id: SelfImprovementLifecycle.EvaluationRunID.make("si_run_2"),
  locationID,
  versionID: run.versionID,
  stage: run.stage,
  workload: run.workload,
  workloadRevision: run.workloadRevision,
  suiteID: run.suiteID,
  suiteRevision: run.suiteRevision,
  baselineID: run.baselineID,
  state: "open",
  trustedProducerIDs: run.trustedProducerIDs,
  acceptanceStart: run.acceptanceStart,
  acceptanceEnd: run.acceptanceEnd,
  cutoffAt: run.cutoffAt,
  requestDigest: digest("run-cancelled"),
  createdAt: run.createdAt,
})

const raceRun = new SelfImprovementEvaluation.EvaluationRun({
  id: SelfImprovementLifecycle.EvaluationRunID.make("si_run_3"),
  locationID,
  versionID: run.versionID,
  stage: run.stage,
  workload: run.workload,
  workloadRevision: run.workloadRevision,
  suiteID: run.suiteID,
  suiteRevision: run.suiteRevision,
  baselineID: run.baselineID,
  state: "open",
  trustedProducerIDs: run.trustedProducerIDs,
  acceptanceStart: run.acceptanceStart,
  acceptanceEnd: run.acceptanceEnd,
  cutoffAt: run.cutoffAt,
  requestDigest: digest("run-race"),
  createdAt: run.createdAt,
})

const sample = (id = "si_sam_1", requestDigest = digest("sample"), sampleRunID = runID) =>
  new SelfImprovementEvaluation.MetricSample({
    id: SelfImprovementLifecycle.MetricSampleID.make(id),
    runID: sampleRunID,
    sampleIDDigest: digest(`${id}-sample`),
    taskIDDigest: digest(`${id}-task`),
    producerID: run.trustedProducerIDs[0],
    requestDigest,
    metrics: new SelfImprovementEvaluation.MetricComponents({
      taskQuality: { earnedAllowlistedPoints: 1, possibleAllowlistedPoints: 1 },
      correctness: { passedRequiredChecks: 1, requiredChecks: 1 },
      repeatFixRate: { repeatedTasks: 0, completedTasks: 1 },
      precision: { acceptedRelevantItems: 1, assessedItems: 1 },
      latencyMs: 1,
      tokensPerSuccess: new SelfImprovementEvaluation.TokensPerSuccessMetric({
        inputTokens: 1,
        outputTokens: 1,
        successfulTasks: 1,
      }),
      cacheHitRatio: { cacheReadTokens: 1, cacheEligibleTokens: 1 },
    }),
    outcome: "success",
    startedAt: SelfImprovementLifecycle.TimestampMillis.make(1),
    terminalAt: SelfImprovementLifecycle.TimestampMillis.make(2),
  })

const decision = (cutoffSampleSetDigest: SelfImprovement.Digest) =>
  new SelfImprovementEvaluation.EvaluationDecision({
    runID,
    cutoffSampleSetDigest,
    findings: SelfImprovementEvaluation.GateIDs.map((gateID, index) =>
      Schema.decodeUnknownSync(SelfImprovementEvaluation.GateFinding)({
        id: SelfImprovementLifecycle.GateFindingID.make(`si_gat_${index + 1}`),
        evaluationRunID: runID,
        order: index + 1,
        gateID,
        result: "pass",
        code: "passed",
      }),
    ),
    metricTotals: totals,
    aggregates,
    aggregateReward: 0.1,
    decision: "passed",
    decidedAt: SelfImprovementLifecycle.TimestampMillis.make(12),
  })

const setup = Effect.gen(function* () {
  const db = yield* makeDb
  yield* db.run(sql`
    CREATE TABLE self_improvement_evaluation_suite_revision (
      location_id TEXT NOT NULL,
      suite_id TEXT NOT NULL,
      revision INTEGER NOT NULL,
      suite_json TEXT NOT NULL,
      UNIQUE (location_id, suite_id, revision)
    )
  `)
  yield* db.run(sql`
    CREATE TABLE self_improvement_evaluation_baseline (
      id TEXT PRIMARY KEY,
      location_id TEXT NOT NULL,
      workload TEXT NOT NULL,
      workload_revision INTEGER NOT NULL,
      suite_id TEXT NOT NULL,
      suite_revision INTEGER NOT NULL,
      baseline_json TEXT NOT NULL,
      UNIQUE (location_id, workload, workload_revision, suite_id, suite_revision)
    )
  `)
  yield* db.run(sql`
    CREATE TABLE self_improvement_evaluation_run (
      id TEXT PRIMARY KEY,
      location_id TEXT NOT NULL,
      request_digest TEXT NOT NULL,
      state TEXT NOT NULL,
      cutoff_sample_set_digest TEXT,
      decided_at INTEGER,
      run_json TEXT NOT NULL
    )
  `)
  yield* db.run(sql`
    CREATE TABLE self_improvement_evaluation_sample (
      id TEXT PRIMARY KEY,
      location_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      sample_id_digest TEXT NOT NULL,
      task_id_digest TEXT NOT NULL,
      request_digest TEXT NOT NULL,
      sample_json TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      UNIQUE (location_id, run_id, sample_id_digest),
      UNIQUE (location_id, run_id, task_id_digest)
    )
  `)
  yield* db.run(sql`
    CREATE TABLE self_improvement_evaluation_decision (
      run_id TEXT PRIMARY KEY,
      location_id TEXT NOT NULL,
      decision_json TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    )
  `)
  yield* db.run(sql`
    CREATE TABLE self_improvement_evaluation_finding (
      id TEXT PRIMARY KEY,
      location_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      finding_order INTEGER NOT NULL,
      finding_json TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      UNIQUE (run_id, finding_order)
    )
  `)
  return yield* SelfImprovementEvaluationStore.Service.use((store) =>
    Effect.gen(function* () {
      const invalid = yield* store
        .bootstrapBaseline(Object.assign(baseline(), { uniqueSampleCount: 19 }))
        .pipe(Effect.flip)
      expect(invalid._tag).toBe("SelfImprovementEvaluationStore.InvalidInput")

      yield* store.putSuiteRevision(suite)
      yield* store.bootstrapBaseline(baseline())
      yield* store.createRun(run)
      expect(yield* store.appendSample(locationID, sample())).toEqual({ sample: sample(), replayed: false })
      expect(yield* store.appendSample(locationID, sample())).toEqual({ sample: sample(), replayed: true })
      const conflict = yield* store.appendSample(locationID, sample("si_sam_1", digest("changed"))).pipe(Effect.flip)
      expect(conflict._tag).toBe("SelfImprovementEvaluationStore.Conflict")

      const crossLocation = yield* store
        .createRun(
          new SelfImprovementEvaluation.EvaluationRun({
            id: run.id,
            locationID: otherLocationID,
            versionID: run.versionID,
            stage: run.stage,
            workload: run.workload,
            workloadRevision: run.workloadRevision,
            suiteID: run.suiteID,
            suiteRevision: run.suiteRevision,
            baselineID: run.baselineID,
            state: run.state,
            trustedProducerIDs: run.trustedProducerIDs,
            acceptanceStart: run.acceptanceStart,
            acceptanceEnd: run.acceptanceEnd,
            cutoffAt: run.cutoffAt,
            requestDigest: run.requestDigest,
            createdAt: run.createdAt,
          }),
        )
        .pipe(Effect.flip)
      expect(crossLocation._tag).toBe("SelfImprovementEvaluationStore.Conflict")

      const cutoffSampleSetDigest = digest("cutoff")
      expect(yield* store.beginDecision(locationID, runID, cutoffSampleSetDigest)).toBe(true)
      expect(yield* store.appendSample(locationID, sample())).toEqual({ sample: sample(), replayed: true })
      const deciding = yield* store.appendSample(locationID, sample("si_sam_2")).pipe(Effect.flip)
      expect(deciding._tag).toBe("SelfImprovementEvaluationStore.Conflict")
      const decidingMismatch = yield* store
        .appendSample(locationID, sample("si_sam_1", digest("deciding-mismatch")))
        .pipe(Effect.flip)
      expect(decidingMismatch._tag).toBe("SelfImprovementEvaluationStore.Conflict")

      const decided = decision(cutoffSampleSetDigest)
      expect(yield* store.finishDecision(locationID, decided)).toBe(true)
      expect(yield* store.finishDecision(locationID, decided)).toBe(false)
      expect(yield* store.appendSample(locationID, sample())).toEqual({ sample: sample(), replayed: true })
      expect(yield* store.cancelRun(locationID, runID)).toBe(false)
      expect(yield* store.listAcceptedSamples(locationID, runID)).toEqual([sample()])

      yield* store.createRun(cancelledRun)
      expect(yield* store.appendSample(locationID, sample("si_sam_3", digest("cancelled"), cancelledRun.id))).toEqual({
        sample: sample("si_sam_3", digest("cancelled"), cancelledRun.id),
        replayed: false,
      })
      expect(yield* store.cancelRun(locationID, cancelledRun.id)).toBe(true)
      expect(yield* store.appendSample(locationID, sample("si_sam_3", digest("cancelled"), cancelledRun.id))).toEqual({
        sample: sample("si_sam_3", digest("cancelled"), cancelledRun.id),
        replayed: true,
      })
      const cancelledMismatch = yield* store
        .appendSample(locationID, sample("si_sam_3", digest("cancelled-mismatch"), cancelledRun.id))
        .pipe(Effect.flip)
      expect(cancelledMismatch._tag).toBe("SelfImprovementEvaluationStore.Conflict")

      yield* store.createRun(raceRun)
      const [begun, append] = yield* Effect.all(
        [
          store.beginDecision(locationID, raceRun.id, digest("race-cutoff")),
          Effect.yieldNow.pipe(
            Effect.andThen(() => store.appendSample(locationID, sample("si_sam_4", digest("race"), raceRun.id))),
            Effect.exit,
          ),
        ],
        { concurrency: "unbounded" },
      )
      expect(begun).toBe(true)
      expect(append._tag).toBe("Failure")
      expect(yield* store.listAcceptedSamples(locationID, raceRun.id)).toEqual([])

      const storedRun = yield* db.get<{ run_json: string }>(sql`
        SELECT run_json FROM self_improvement_evaluation_run WHERE id = ${runID}
      `)
      if (storedRun === undefined) throw new Error("Evaluation run was not stored")
      expect(JSON.parse(storedRun.run_json).cutoffSampleSetDigest).toBe(cutoffSampleSetDigest)
      const findings = yield* db.all<{ finding_order: number; expires_at: number }>(sql`
        SELECT finding_order, expires_at FROM self_improvement_evaluation_finding WHERE run_id = ${runID} ORDER BY finding_order
      `)
      const storedDecision = yield* db.get<{ expires_at: number }>(sql`
        SELECT expires_at FROM self_improvement_evaluation_decision WHERE run_id = ${runID}
      `)
      if (storedDecision === undefined) throw new Error("Evaluation decision was not stored")
      expect(findings).toHaveLength(SelfImprovementEvaluation.GateIDs.length)
      expect(findings.map((finding) => finding.finding_order)).toEqual(
        SelfImprovementEvaluation.GateIDs.map((_, index) => index + 1),
      )
      expect(findings.every((finding) => finding.expires_at === 12 + 180 * 86_400_000)).toBe(true)
      expect(storedDecision.expires_at).toBe(12 + 180 * 86_400_000)
    }),
  ).pipe(Effect.provide(SelfImprovementEvaluationStore.layer), Effect.provide(Layer.succeed(Database.Service, { db })))
})

test("stores immutable baselines and replays matching samples", async () => {
  await Effect.runPromise(
    setup.pipe(Effect.provide(SqliteClient.layer({ filename: ":memory:", disableWAL: true })), Effect.scoped),
  )
})
