export * as SelfImprovementSessionObserver from "./session-observer"

import { and, asc, eq, ne } from "drizzle-orm"
import { Cause, Context, DateTime, Effect, Exit, Layer, Schema } from "effect"
import {
  SelfImprovement,
  SelfImprovementApi,
  SelfImprovementEvaluation,
  SelfImprovementLearning,
  SelfImprovementLifecycle,
} from "@opencode-ai/schema"
import { Database } from "../database/database"
import { makeLocationNode } from "../effect/app-node"
import { Location } from "../location"
import { SessionHistory } from "../session/history"
import { SessionMessage } from "../session/message"
import { SessionSchema } from "../session/schema"
import { Hash } from "../util/hash"
import { SelfImprovementContracts } from "./contracts"
import { SelfImprovementEvaluationStore } from "./evaluation-store"
import { SelfImprovementMetrics } from "./metrics"
import { SelfImprovementPrivateEvidenceCommand } from "./private-evidence-command"
import { SelfImprovementPrivateQuery } from "./private-query"
import { SelfImprovementSessionEvidenceTable } from "./session-evidence.sql"

export interface Evidence {
  readonly taskIDDigest: SelfImprovement.Digest
  readonly sampleIDDigest: SelfImprovement.Digest
  readonly requestDigest: SelfImprovement.Digest
  readonly workload: SelfImprovementEvaluation.Workload
  readonly workloadRevision: SelfImprovementLifecycle.Revision
  readonly producerID: SelfImprovementLifecycle.PrincipalID
  readonly outcomeClass: SelfImprovementLearning.ObservationOutcomeClass
  readonly outcome: SelfImprovementEvaluation.TaskOutcome
  readonly errorClass: string
  readonly orderedToolSymbolIDs: ReadonlyArray<string>
  readonly metrics: SelfImprovementEvaluation.MetricComponents
  readonly startedAt: SelfImprovementLifecycle.TimestampMillis
  readonly terminalAt: SelfImprovementLifecycle.TimestampMillis
}

export interface Dependencies {
  readonly loadMessages: (sessionID: SessionSchema.ID) => Effect.Effect<ReadonlyArray<SessionMessage.Info>>
  readonly insertEvidence: (evidence: Evidence) => Effect.Effect<boolean>
  readonly listControlEvidence: (input: {
    readonly workload: SelfImprovementEvaluation.Workload
    readonly workloadRevision: SelfImprovementLifecycle.Revision
    readonly limit: number
  }) => Effect.Effect<ReadonlyArray<Evidence>>
  readonly listBaselines: (input: {
    readonly workload: SelfImprovementEvaluation.Workload
    readonly workloadRevision: SelfImprovementLifecycle.Revision
  }) => Effect.Effect<ReadonlyArray<SelfImprovementEvaluation.Baseline>>
  readonly putSuiteRevision: (suite: SelfImprovementEvaluation.SuiteRevision) => Effect.Effect<void, unknown>
  readonly bootstrapBaseline: (baseline: SelfImprovementEvaluation.Baseline) => Effect.Effect<void, unknown>
  readonly listOpenRuns: (input: {
    readonly workload: SelfImprovementEvaluation.Workload
    readonly workloadRevision: SelfImprovementLifecycle.Revision
    readonly terminalAt: SelfImprovementLifecycle.TimestampMillis
  }) => Effect.Effect<ReadonlyArray<SelfImprovementEvaluation.EvaluationRun>>
  readonly recordObservation: (evidence: Evidence) => Effect.Effect<void, unknown>
  readonly appendSample: (input: {
    readonly run: SelfImprovementEvaluation.EvaluationRun
    readonly evidence: Evidence
  }) => Effect.Effect<void, unknown>
}

export interface Interface {
  readonly record: (input: {
    readonly sessionID: SessionSchema.ID
    readonly exit: Exit.Exit<void, unknown>
  }) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SelfImprovementSessionObserver") {}

export const dependencies = (value: Dependencies): Dependencies => value

export function make(input: {
  readonly locationID: SelfImprovementLifecycle.LocationID
  readonly settings: {
    readonly enabled: boolean
    readonly producerID?: SelfImprovementLifecycle.PrincipalID
  }
  readonly dependencies: Dependencies
}): Interface {
  const persist = Effect.fnUntraced(function* (request: {
    readonly sessionID: SessionSchema.ID
    readonly exit: Exit.Exit<void, unknown>
  }) {
    if (!input.settings.enabled) return
    const messages = yield* input.dependencies.loadMessages(request.sessionID)
    const evidence = summarize(
      input.locationID,
      input.settings.producerID ?? SelfImprovementLifecycle.PrincipalID.make("self-improvement-runtime-evidence"),
      messages,
      request.exit,
    )
    if (evidence === undefined) return
    if (!(yield* input.dependencies.insertEvidence(evidence))) return
    yield* input.dependencies.recordObservation(evidence).pipe(Effect.catchCause(Effect.logWarning))
    if (evidence.outcomeClass === "cancelled") return

    const baselines = yield* input.dependencies.listBaselines({
      workload: evidence.workload,
      workloadRevision: evidence.workloadRevision,
    })
    if (baselines.length === 0) {
      const control = yield* input.dependencies.listControlEvidence({
        workload: evidence.workload,
        workloadRevision: evidence.workloadRevision,
        limit: 20,
      })
      if (control.length === 20) yield* bootstrap(input.locationID, control, input.dependencies)
    }

    const runs = yield* input.dependencies.listOpenRuns({
      workload: evidence.workload,
      workloadRevision: evidence.workloadRevision,
      terminalAt: evidence.terminalAt,
    })
    yield* Effect.forEach(runs, (run) =>
      input.dependencies.appendSample({ run, evidence }).pipe(Effect.catchCause(Effect.logWarning)),
    )
  })
  const record = Effect.fn("SelfImprovementSessionObserver.record")(
    (request: { readonly sessionID: SessionSchema.ID; readonly exit: Exit.Exit<void, unknown> }) =>
      persist(request).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("self-improvement session observation failed", { cause: Cause.pretty(cause) }),
        ),
      ),
  )
  return { record }
}

const MetricsJson = Schema.fromJsonString(SelfImprovementEvaluation.MetricComponents)
const encodeMetrics = Schema.encodeSync(MetricsJson)
const decodeMetrics = Schema.decodeUnknownSync(MetricsJson)

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const db = (yield* Database.Service).db
    const location = yield* Location.Service
    const evaluation = yield* SelfImprovementEvaluationStore.Service
    const command = yield* SelfImprovementPrivateEvidenceCommand.Service
    const query = yield* SelfImprovementPrivateQuery.Service
    const locationID = SelfImprovementContracts.locationID(
      Location.Ref.make({
        directory: location.directory,
        ...(location.workspaceID === undefined ? {} : { workspaceID: location.workspaceID }),
      }),
    )
    const producerID = "self-improvement-runtime-evidence"
    const principal = new SelfImprovementLifecycle.Principal({
      id: SelfImprovementLifecycle.PrincipalID.make(producerID),
      kind: "runtime-evidence-service",
      locationID,
    })

    const service = make({
      locationID,
      settings: {
        // Capture privacy-safe learning evidence for every Session; `automatic` gates mutation, not observation.
        enabled: true,
        producerID: principal.id,
      },
      dependencies: dependencies({
        loadMessages: (sessionID) => SessionHistory.load(db, sessionID).pipe(Effect.orDie),
        insertEvidence: (evidence) =>
          db
            .insert(SelfImprovementSessionEvidenceTable)
            .values({
              id: `si_evd_${evidence.taskIDDigest}`,
              location_id: locationID,
              task_id_digest: evidence.taskIDDigest,
              sample_id_digest: evidence.sampleIDDigest,
              request_digest: evidence.requestDigest,
              workload: evidence.workload,
              workload_revision: evidence.workloadRevision,
              producer_id: evidence.producerID,
              outcome_class: evidence.outcomeClass,
              outcome: evidence.outcome,
              metrics_json: encodeMetrics(evidence.metrics),
              started_at: evidence.startedAt,
              terminal_at: evidence.terminalAt,
              created_at: evidence.terminalAt,
            })
            .onConflictDoNothing()
            .returning({ id: SelfImprovementSessionEvidenceTable.id })
            .get()
            .pipe(
              Effect.orDie,
              Effect.map((row) => row !== undefined),
            ),
        listControlEvidence: (input) =>
          db
            .select()
            .from(SelfImprovementSessionEvidenceTable)
            .where(
              and(
                eq(SelfImprovementSessionEvidenceTable.location_id, locationID),
                eq(SelfImprovementSessionEvidenceTable.workload, input.workload),
                eq(SelfImprovementSessionEvidenceTable.workload_revision, input.workloadRevision),
                ne(SelfImprovementSessionEvidenceTable.outcome_class, "cancelled"),
              ),
            )
            .orderBy(asc(SelfImprovementSessionEvidenceTable.started_at), asc(SelfImprovementSessionEvidenceTable.id))
            .limit(input.limit)
            .all()
            .pipe(
              Effect.orDie,
              Effect.map((rows) =>
                rows.map((row) => ({
                  taskIDDigest: row.task_id_digest,
                  sampleIDDigest: row.sample_id_digest,
                  requestDigest: row.request_digest,
                  workload: row.workload,
                  workloadRevision: row.workload_revision,
                  producerID: row.producer_id,
                  outcomeClass: row.outcome_class,
                  outcome: row.outcome,
                  errorClass: row.outcome_class === "success" ? "none" : "session.failed",
                  orderedToolSymbolIDs: [],
                  metrics: decodeMetrics(row.metrics_json),
                  startedAt: row.started_at,
                  terminalAt: row.terminal_at,
                })),
              ),
            ),
        listBaselines: (input) =>
          query
            .listBaselines({ locationID, workload: input.workload, limit: 100 })
            .pipe(
              Effect.map((page) =>
                page.items.filter((baseline) => baseline.workloadRevision === input.workloadRevision),
              ),
            ),
        putSuiteRevision: (suite) =>
          evaluation
            .putSuiteRevision(suite)
            .pipe(
              Effect.catchTag("SelfImprovementEvaluationStore.Conflict", (error) =>
                error.message === "Suite revision already exists" ? Effect.void : Effect.fail(error),
              ),
            ),
        bootstrapBaseline: (baseline) =>
          evaluation
            .bootstrapBaseline(baseline)
            .pipe(
              Effect.catchTag("SelfImprovementEvaluationStore.Conflict", (error) =>
                error.message === "Baseline already exists" ? Effect.void : Effect.fail(error),
              ),
            ),
        listOpenRuns: (input) =>
          query
            .listMetricRuns({ locationID, state: "open", includeSamples: false, limit: 100 })
            .pipe(
              Effect.map((page) =>
                page.items
                  .map((item) => item.run)
                  .filter(
                    (run) =>
                      (run.stage === "shadow" || run.stage === "canary") &&
                      run.workload === input.workload &&
                      run.workloadRevision === input.workloadRevision &&
                      run.acceptanceStart <= input.terminalAt &&
                      input.terminalAt <= run.acceptanceEnd,
                  ),
              ),
            ),
        recordObservation: (evidence) =>
          command
            .createObservation(
              {
                principal,
                locationID,
                now: evidence.terminalAt,
                idempotencyKey: SelfImprovementLearning.IdempotencyKey.make(
                  `session-observation:${evidence.taskIDDigest}`,
                ),
              },
              new SelfImprovementApi.CreateObservationRequest({
                workload: evidence.workload,
                workloadRevision: evidence.workloadRevision,
                errorClass: evidence.errorClass,
                orderedToolSymbolIDs: evidence.orderedToolSymbolIDs,
                outcomeClass: evidence.outcomeClass,
                taskIDDigest: evidence.taskIDDigest,
              }),
            )
            .pipe(Effect.asVoid),
        appendSample: ({ run, evidence }) =>
          command
            .addMetricSample(
              {
                principal,
                locationID,
                now: evidence.terminalAt,
                idempotencyKey: SelfImprovementLearning.IdempotencyKey.make(
                  `session-sample:${run.id}:${evidence.taskIDDigest}`,
                ),
              },
              new SelfImprovementApi.AddMetricSampleRequest({
                runID: run.id,
                sampleIDDigest: evidence.sampleIDDigest,
                taskIDDigest: evidence.taskIDDigest,
                metrics: evidence.metrics,
                outcome: evidence.outcome,
                startedAt: evidence.startedAt,
                terminalAt: evidence.terminalAt,
                requestDigest: SelfImprovement.Digest.make(
                  Hash.sha256(`session-sample/v1\0${run.id}\0${evidence.requestDigest}`),
                ),
              }),
            )
            .pipe(Effect.asVoid),
      }),
    })
    return Service.of(service)
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [
    Database.node,
    Location.node,
    SelfImprovementEvaluationStore.node,
    SelfImprovementPrivateEvidenceCommand.node,
    SelfImprovementPrivateQuery.node,
  ],
})

function bootstrap(
  locationID: SelfImprovementLifecycle.LocationID,
  values: ReadonlyArray<Evidence>,
  dependencies: Dependencies,
) {
  const control = values.toSorted((left, right) => left.startedAt - right.startedAt)
  const first = control[0]
  const last = control.at(-1)
  if (first === undefined || last === undefined) return Effect.void
  const key = Hash.sha256(`${locationID}\0${first.workload}\0${first.workloadRevision}`)
  const suiteID = SelfImprovementLifecycle.SuiteID.make(`si_sui_auto_${key}`)
  const baselineID = SelfImprovementLifecycle.BaselineID.make(`si_bas_auto_${key}`)
  const runID = SelfImprovementLifecycle.EvaluationRunID.make(`si_run_control_${key}`)
  const revision = SelfImprovementLifecycle.Revision.make(1)
  const samples = control.map(
    (evidence) =>
      new SelfImprovementEvaluation.MetricSample({
        id: SelfImprovementLifecycle.MetricSampleID.make(`si_sam_${evidence.sampleIDDigest}`),
        runID,
        sampleIDDigest: evidence.sampleIDDigest,
        taskIDDigest: evidence.taskIDDigest,
        producerID: evidence.producerID,
        requestDigest: evidence.requestDigest,
        metrics: evidence.metrics,
        outcome: evidence.outcome,
        startedAt: evidence.startedAt,
        terminalAt: evidence.terminalAt,
      }),
  )
  const metrics = SelfImprovementMetrics.aggregate(samples)
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
  const suite = new SelfImprovementEvaluation.SuiteRevision({
    locationID,
    suiteID,
    revision,
    workload: first.workload,
    workloadRevision: first.workloadRevision,
    artifactKinds: ["skill"],
    orderedGates: SelfImprovementEvaluation.GateIDs,
    thresholds,
    shadowMinimumSamples: 10,
    canaryMinimumSamples: 20,
    creatorID: first.producerID,
    createdAt: last.terminalAt,
  })
  const baseline = new SelfImprovementEvaluation.Baseline({
    id: baselineID,
    locationID,
    workload: first.workload,
    workloadRevision: first.workloadRevision,
    suiteID,
    suiteRevision: revision,
    producerAllowlistRevision: revision,
    controlSource: "automatic-session-control",
    acceptanceStart: first.startedAt,
    acceptanceEnd: last.terminalAt,
    cutoffAt: last.terminalAt,
    uniqueSampleCount: control.length,
    orderedSampleIDDigest: metrics.orderedSampleIDDigest,
    metricTotals: metrics.totals,
    aggregates: metrics.aggregates,
    createdAt: last.terminalAt,
    evaluatorSignatureDigest: SelfImprovement.Digest.make(
      Hash.sha256(`automatic-baseline/v1\0${locationID}\0${suiteID}\0${metrics.orderedSampleIDDigest}`),
    ),
    bootstrapAuthorityID: first.producerID,
  })
  return dependencies.putSuiteRevision(suite).pipe(Effect.andThen(dependencies.bootstrapBaseline(baseline)))
}

function summarize(
  locationID: SelfImprovementLifecycle.LocationID,
  producerID: SelfImprovementLifecycle.PrincipalID,
  messages: ReadonlyArray<SessionMessage.Info>,
  exit: Exit.Exit<void, unknown>,
): Evidence | undefined {
  const userIndex = messages.findLastIndex((message) => message.type === "user")
  if (userIndex === -1) return undefined
  const user = messages[userIndex]
  if (user.type !== "user") return undefined
  const assistants = messages
    .slice(userIndex + 1)
    .filter((message): message is SessionMessage.Assistant => message.type === "assistant")
  const previousAssistants = messages
    .slice(0, userIndex)
    .filter((message): message is SessionMessage.Assistant => message.type === "assistant")
  const tools = assistants.flatMap((message) =>
    message.content.filter((part): part is SessionMessage.AssistantTool => part.type === "tool"),
  )
  const previousToolNames = new Set(
    previousAssistants.flatMap((message) =>
      message.content.flatMap((part) => (part.type === "tool" ? [part.name] : [])),
    ),
  )
  const orderedToolSymbolIDs = Array.from(new Set(tools.map((tool) => tool.name)))
  const finalTools = tools.filter(
    (tool, index) => tools.findLastIndex((candidate) => candidate.name === tool.name) === index,
  )
  const failedTool = finalTools.find((tool) => tool.state.status === "error")
  const failedAssistant = assistants.find((message) => message.error !== undefined)
  const interrupted = Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause)
  const failedSession = Exit.isFailure(exit)
  const noOutput = assistants.length === 0
  const failure = failedTool !== undefined || failedAssistant !== undefined || failedSession || noOutput
  const taskOutcomeClass: SelfImprovementLearning.ObservationOutcomeClass = interrupted
    ? "cancelled"
    : failure
      ? "failure"
      : "success"
  const correction =
    taskOutcomeClass === "success" &&
    (tools.some((tool) => previousToolNames.has(tool.name)) ||
      tools.some(
        (tool, index) =>
          tool.state.status === "error" &&
          tools
            .slice(index + 1)
            .some((candidate) => candidate.name === tool.name && candidate.state.status === "completed"),
      ))
  const outcomeClass: SelfImprovementLearning.ObservationOutcomeClass = correction ? "failure" : taskOutcomeClass
  const outcome: SelfImprovementEvaluation.TaskOutcome = taskOutcomeClass === "success" ? "success" : "failure"
  const startedAt = SelfImprovementLifecycle.TimestampMillis.make(DateTime.toEpochMillis(user.time.created))
  const terminalAt = SelfImprovementLifecycle.TimestampMillis.make(
    assistants.reduce(
      (latest, message) => Math.max(latest, DateTime.toEpochMillis(message.time.completed ?? message.time.created)),
      Number(startedAt),
    ),
  )
  const tokens = assistants.reduce(
    (total, message) => ({
      input: total.input + (message.tokens?.input ?? 0),
      output: total.output + (message.tokens?.output ?? 0),
      cacheRead: total.cacheRead + (message.tokens?.cache.read ?? 0),
    }),
    { input: 0, output: 0, cacheRead: 0 },
  )
  const completedTools = tools.filter((tool) => tool.state.status === "completed").length
  const successful = outcome === "success" ? 1 : 0
  const metrics = new SelfImprovementEvaluation.MetricComponents({
    taskQuality: { earnedAllowlistedPoints: successful, possibleAllowlistedPoints: 1 },
    correctness: { passedRequiredChecks: successful, requiredChecks: 1 },
    repeatFixRate: { repeatedTasks: correction ? 1 : 0, completedTasks: 1 },
    precision: { acceptedRelevantItems: completedTools, assessedItems: tools.length },
    latencyMs: Math.max(0, terminalAt - startedAt),
    tokensPerSuccess: new SelfImprovementEvaluation.TokensPerSuccessMetric({
      inputTokens: tokens.input,
      outputTokens: tokens.output,
      successfulTasks: successful,
    }),
    cacheHitRatio: {
      cacheReadTokens: tokens.cacheRead,
      cacheEligibleTokens: tokens.input + tokens.cacheRead,
    },
  })
  const agent = assistants.at(-1)?.agent ?? "default"
  const workload = SelfImprovementEvaluation.Workload.make(`agent:${agent}`)
  const workloadRevision = SelfImprovementLifecycle.Revision.make(1)
  const taskIDDigest = SelfImprovement.Digest.make(Hash.sha256(`${locationID}\0${user.id}`))
  const errorClass = interrupted
    ? "session.interrupted"
    : correction
      ? "session.correction"
      : failedTool
        ? `tool.${failedTool.name}.failed`
        : failedAssistant || failedSession
          ? "session.failed"
          : noOutput
            ? "session.no-output"
            : "none"
  const sampleIDDigest = SelfImprovement.Digest.make(
    Hash.sha256(`${taskIDDigest}\0${JSON.stringify(metrics)}\0${outcome}`),
  )
  return {
    taskIDDigest,
    sampleIDDigest,
    requestDigest: SelfImprovement.Digest.make(Hash.sha256(`session-evidence/v1\0${sampleIDDigest}`)),
    workload,
    workloadRevision,
    producerID,
    outcomeClass,
    outcome,
    errorClass,
    orderedToolSymbolIDs,
    metrics,
    startedAt,
    terminalAt,
  }
}
