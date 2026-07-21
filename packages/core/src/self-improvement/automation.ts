export * as SelfImprovementAutomation from "./automation"

import { and, asc, desc, eq, gt, isNotNull, isNull } from "drizzle-orm"
import { Cause, Clock, Context, Duration, Effect, Layer } from "effect"
import {
  SelfImprovement,
  SelfImprovementApi,
  SelfImprovementEvaluation,
  SelfImprovementLearning,
  SelfImprovementLifecycle,
} from "@opencode-ai/schema"
import { Config } from "../config"
import { Database } from "../database/database"
import { makeLocationNode } from "../effect/app-node"
import { Location } from "../location"
import { Hash } from "../util/hash"
import { SelfImprovementApprovalRequestTable, SelfImprovementApprovalTable } from "./approval-rollback.sql"
import { SelfImprovementArtifactTable, SelfImprovementArtifactVersionTable } from "./artifact.sql"
import { SelfImprovementContextReconciler } from "./context-reconciler"
import { locationID as makeLocationID } from "./contracts"
import { SelfImprovementGeneration } from "./generation"
import { SelfImprovementGenerationStore } from "./generation-store"
import { SelfImprovementObservationTable } from "./ingress.sql"
import { SelfImprovementLifecycleWorkflow } from "./lifecycle-workflow"
import { SelfImprovementLearningStore } from "./learning-store"
import { SelfImprovementMetrics } from "./metrics"
import { SelfImprovementPrivateArtifactCommand } from "./private-artifact-command"
import { SelfImprovementPrivateEvidenceCommand } from "./private-evidence-command"
import { SelfImprovementPrivateQuery } from "./private-query"
import { SelfImprovementTransitionStore } from "./transition-store"

const generatedStages = new Set<SelfImprovementLifecycle.ArtifactStage>([
  "draft",
  "experimental",
  "candidate",
  "shadow",
  "canary",
])
const preparableStages = new Set<SelfImprovementLifecycle.ArtifactStage>(["draft", "experimental", "candidate"])

export interface Settings {
  readonly enabled: boolean
  readonly autoApprove: boolean
  readonly intervalSeconds: number
  readonly evaluationWindowMillis: number
}

export interface EligiblePattern {
  readonly patternDigest: SelfImprovement.Digest
  readonly workload: SelfImprovementEvaluation.Workload
  readonly workloadRevision: SelfImprovementLifecycle.Revision
  readonly errorClass: string
  readonly orderedToolSymbolDigest: SelfImprovement.Digest
  readonly outcomeClass: SelfImprovementLearning.ObservationOutcomeClass
}

export interface GeneratedWork {
  readonly artifactID: SelfImprovementLifecycle.ArtifactID
  readonly versionID: SelfImprovementLifecycle.ArtifactVersionID
  readonly stage: SelfImprovementLifecycle.ArtifactStage
  readonly workload: SelfImprovementEvaluation.Workload
  readonly workloadRevision: SelfImprovementLifecycle.Revision
}

export interface BaselineBinding {
  readonly id: SelfImprovementLifecycle.BaselineID
  readonly workload: SelfImprovementEvaluation.Workload
  readonly workloadRevision: SelfImprovementLifecycle.Revision
  readonly suiteID: SelfImprovementLifecycle.SuiteID
  readonly suiteRevision: SelfImprovementLifecycle.Revision
}

export interface RunWork {
  readonly id: SelfImprovementLifecycle.EvaluationRunID
  readonly versionID: SelfImprovementLifecycle.ArtifactVersionID
  readonly stage: SelfImprovementLifecycle.ArtifactStage
  readonly state: SelfImprovementEvaluation.RunState
  readonly cutoffAt: SelfImprovementLifecycle.TimestampMillis
  readonly cutoffSampleSetDigest?: SelfImprovement.Digest
}

export interface Dependencies {
  readonly now: Effect.Effect<SelfImprovementLifecycle.TimestampMillis>
  readonly seedGenerationStrategy: Effect.Effect<void, unknown>
  readonly listEligiblePatterns: (input: {
    readonly locationID: SelfImprovementLifecycle.LocationID
    readonly now: SelfImprovementLifecycle.TimestampMillis
  }) => Effect.Effect<ReadonlyArray<EligiblePattern>, unknown>
  readonly generate: (input: {
    readonly pattern: EligiblePattern
    readonly now: SelfImprovementLifecycle.TimestampMillis
  }) => Effect.Effect<"admitted" | "skipped", unknown>
  readonly listGeneratedWork: (input: {
    readonly locationID: SelfImprovementLifecycle.LocationID
    readonly now: SelfImprovementLifecycle.TimestampMillis
  }) => Effect.Effect<ReadonlyArray<GeneratedWork>, unknown>
  readonly listBaselines: (input: GeneratedWork) => Effect.Effect<ReadonlyArray<BaselineBinding>, unknown>
  readonly prepareShadow: (input: {
    readonly work: GeneratedWork
    readonly now: SelfImprovementLifecycle.TimestampMillis
  }) => Effect.Effect<void, unknown>
  readonly listRuns: (input: {
    readonly versionID?: SelfImprovementLifecycle.ArtifactVersionID
    readonly stage?: "shadow" | "canary"
    readonly state?: SelfImprovementEvaluation.RunState
    readonly includeSamples: boolean
  }) => Effect.Effect<ReadonlyArray<RunWork>, unknown>
  readonly createRun: (input: {
    readonly work: GeneratedWork
    readonly stage: "shadow" | "canary"
    readonly baseline: BaselineBinding
    readonly now: SelfImprovementLifecycle.TimestampMillis
    readonly cutoffAt: SelfImprovementLifecycle.TimestampMillis
  }) => Effect.Effect<void, unknown>
  readonly decideRun: (input: {
    readonly run: RunWork & { readonly cutoffSampleSetDigest: SelfImprovement.Digest }
    readonly now: SelfImprovementLifecycle.TimestampMillis
  }) => Effect.Effect<void, unknown>
  readonly listPendingApprovals: () => Effect.Effect<ReadonlyArray<SelfImprovementLifecycle.ApprovalRequest>, unknown>
  readonly approve: (input: {
    readonly request: SelfImprovementLifecycle.ApprovalRequest
    readonly now: SelfImprovementLifecycle.TimestampMillis
  }) => Effect.Effect<void, unknown>
  readonly reconcile: Effect.Effect<number, unknown>
}

export interface TickResult {
  readonly eligiblePatterns: number
  readonly generated: number
  readonly prepared: number
  readonly runsCreated: number
  readonly runsDecided: number
  readonly reconciled: number
  readonly failures: number
}

export interface RuntimeStatus {
  readonly settings: Settings
  readonly running: boolean
  readonly lastStartedAt?: SelfImprovementLifecycle.TimestampMillis
  readonly lastCompletedAt?: SelfImprovementLifecycle.TimestampMillis
  readonly lastResult?: TickResult
}

export interface Interface {
  readonly tick: Effect.Effect<TickResult>
  readonly status: Effect.Effect<RuntimeStatus>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SelfImprovementAutomation") {}

export const emptyResult: TickResult = Object.freeze({
  eligiblePatterns: 0,
  generated: 0,
  prepared: 0,
  runsCreated: 0,
  runsDecided: 0,
  reconciled: 0,
  failures: 0,
})

export const dependencies = (value: Dependencies): Dependencies => value

export function make(input: {
  readonly locationID: SelfImprovementLifecycle.LocationID
  readonly settings: Settings
  readonly loadSettings?: Effect.Effect<Settings>
  readonly dependencies: Dependencies
}): Interface {
  const readSettings = input.loadSettings ?? Effect.succeed(input.settings)
  let runtimeStatus: RuntimeStatus = { settings: input.settings, running: false }
  const status = readSettings.pipe(
    Effect.map((settings) => {
      runtimeStatus = { ...runtimeStatus, settings }
      return runtimeStatus
    }),
  )

  const runTick = Effect.fn("SelfImprovementAutomation.runTick")(function* (settings: Settings) {
    const now = yield* input.dependencies.now
    const seedResult = yield* attempt("seed generation strategy", input.dependencies.seedGenerationStrategy)
    const patternsResult = yield* attempt(
      "list eligible patterns",
      input.dependencies.listEligiblePatterns({ locationID: input.locationID, now }),
    )
    const patterns = (patternsResult.ok ? patternsResult.value : []).filter(
      (pattern) => pattern.outcomeClass === "failure",
    )
    const generated = yield* Effect.forEach(patterns, (pattern) =>
      attempt("generate candidate", input.dependencies.generate({ pattern, now })),
    )
    const generatedCount = generated.filter((result) => result.ok && result.value === "admitted").length
    const workResult = yield* attempt(
      "list generated work",
      input.dependencies.listGeneratedWork({ locationID: input.locationID, now }),
    )
    const work = workResult.ok ? workResult.value : []
    const progressed = yield* Effect.forEach(work, (item) => process(item, now))
    const openRunsResult = yield* attempt(
      "list open evaluation runs",
      input.dependencies.listRuns({ state: "open", includeSamples: true }),
    )
    const openRuns = openRunsResult.ok ? openRunsResult.value : []
    const decisions = yield* Effect.forEach(
      openRuns.filter(
        (run): run is RunWork & { readonly cutoffSampleSetDigest: SelfImprovement.Digest } =>
          run.cutoffAt <= now && run.cutoffSampleSetDigest !== undefined,
      ),
      (run) => attempt("decide evaluation run", input.dependencies.decideRun({ run, now })),
    )
    const approvalsResult = settings.autoApprove
      ? yield* attempt("list pending approvals", input.dependencies.listPendingApprovals())
      : ({ ok: true, value: [] } as const)
    const approvals = yield* Effect.forEach(approvalsResult.ok ? approvalsResult.value : [], (request) =>
      attempt("approve generated candidate", input.dependencies.approve({ request, now })),
    )
    const reconciliation = yield* attempt("reconcile self-improvement context", input.dependencies.reconcile)

    return {
      eligiblePatterns: patterns.length,
      generated: generatedCount,
      prepared: progressed.reduce((total, result) => total + (result.ok ? result.value.prepared : 0), 0),
      runsCreated: progressed.reduce((total, result) => total + (result.ok ? result.value.runsCreated : 0), 0),
      runsDecided: decisions.filter((result) => result.ok).length,
      reconciled: reconciliation.ok ? reconciliation.value : 0,
      failures:
        (seedResult.ok ? 0 : 1) +
        (patternsResult.ok ? 0 : 1) +
        generated.filter((result) => !result.ok).length +
        (workResult.ok ? 0 : 1) +
        progressed.filter((result) => !result.ok).length +
        (openRunsResult.ok ? 0 : 1) +
        decisions.filter((result) => !result.ok).length +
        (approvalsResult.ok ? 0 : 1) +
        approvals.filter((result) => !result.ok).length +
        (reconciliation.ok ? 0 : 1),
    }

    function process(item: GeneratedWork, at: SelfImprovementLifecycle.TimestampMillis) {
      return attempt(
        "advance generated version",
        Effect.gen(function* () {
          const baselines = yield* input.dependencies.listBaselines(item)
          const baseline = baselines.find(
            (candidate) => candidate.workload === item.workload && candidate.workloadRevision === item.workloadRevision,
          )
          if (baseline === undefined) return { prepared: 0, runsCreated: 0 }

          const prepared = preparableStages.has(item.stage)
          if (prepared) yield* input.dependencies.prepareShadow({ work: item, now: at })
          const stage = prepared ? "shadow" : item.stage
          if (stage !== "shadow" && stage !== "canary") return { prepared: prepared ? 1 : 0, runsCreated: 0 }
          const runs = yield* input.dependencies.listRuns({
            versionID: item.versionID,
            stage,
            includeSamples: false,
          })
          if (runs.length > 0) return { prepared: prepared ? 1 : 0, runsCreated: 0 }
          yield* input.dependencies.createRun({
            work: item,
            stage,
            baseline,
            now: at,
            cutoffAt: SelfImprovementLifecycle.TimestampMillis.make(at + settings.evaluationWindowMillis),
          })
          return { prepared: prepared ? 1 : 0, runsCreated: 1 }
        }),
      )
    }
  })

  const tick = Effect.gen(function* () {
    const settings = yield* readSettings
    if (!settings.enabled) {
      runtimeStatus = { ...runtimeStatus, settings, running: false }
      return emptyResult
    }
    const lastStartedAt = yield* input.dependencies.now
    runtimeStatus = { ...runtimeStatus, settings, running: true, lastStartedAt }
    const lastResult = yield* runTick(settings)
    const lastCompletedAt = yield* input.dependencies.now
    runtimeStatus = { settings, running: false, lastStartedAt, lastCompletedAt, lastResult }
    return lastResult
  }).pipe(
    Effect.ensuring(
      Effect.sync(() => {
        if (runtimeStatus.running) runtimeStatus = { ...runtimeStatus, running: false }
      }),
    ),
  )

  return { tick, status }
}

function attempt<A>(label: string, effect: Effect.Effect<A, unknown>) {
  return effect.pipe(
    Effect.map((value) => ({ ok: true as const, value })),
    Effect.catchCause((cause) =>
      Effect.logWarning(`self-improvement automation failed to ${label}`, { cause: Cause.pretty(cause) }).pipe(
        Effect.as({ ok: false as const }),
      ),
    ),
  )
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const location = yield* Location.Service
    const db = (yield* Database.Service).db
    const generation = yield* SelfImprovementGeneration.Service
    const generationStore = yield* SelfImprovementGenerationStore.Service
    const learning = yield* SelfImprovementLearningStore.Service
    const query = yield* SelfImprovementPrivateQuery.Service
    const artifacts = yield* SelfImprovementPrivateArtifactCommand.Service
    const workflow = yield* SelfImprovementLifecycleWorkflow.Service
    const evidence = yield* SelfImprovementPrivateEvidenceCommand.Service
    const transitions = yield* SelfImprovementTransitionStore.Service
    const reconciler = yield* SelfImprovementContextReconciler.Service
    const loadSettings = config.entries().pipe(
      Effect.map((entries) => {
        const configured = Config.latest(entries, "experimental")?.self_improvement
        return {
          enabled: configured?.automatic === true,
          autoApprove: configured?.auto_approve !== false,
          intervalSeconds: configured?.interval_seconds ?? 60,
          evaluationWindowMillis: (configured?.evaluation_window_minutes ?? 60) * 60_000,
        } satisfies Settings
      }),
    )
    const configured = Config.latest(yield* config.entries(), "experimental")?.self_improvement
    const locationRef = Location.Ref.make({
      directory: location.directory,
      ...(location.workspaceID === undefined ? {} : { workspaceID: location.workspaceID }),
    })
    const locationID = makeLocationID(locationRef)
    const coordinator = principal(locationID, "coordinator", "self-improvement-automation-coordinator")
    const evaluator = principal(locationID, "evaluator", "self-improvement-automation-evaluator")
    const approver = principal(locationID, "location-approver", "self-improvement-automatic-approver")
    const runtimeEvidence = principal(
      locationID,
      "runtime-evidence-service",
      configured?.evidence_principal_id ?? "self-improvement-runtime-evidence",
    )
    const settings = yield* loadSettings
    const service = make({
      locationID,
      settings,
      loadSettings,
      dependencies: {
        now: Clock.currentTimeMillis.pipe(Effect.map((now) => SelfImprovementLifecycle.TimestampMillis.make(now))),
        seedGenerationStrategy: learning
          .putGenerationArm(
            new SelfImprovementLearning.GenerationStrategyArm({
              id: SelfImprovementLifecycle.GenerationStrategyArmID.make(`si_gsa_default_${locationID}`),
              locationID,
              strategyID: "generalize-remediation",
              allowlistRevision: SelfImprovementLifecycle.Revision.make(1),
              active: true,
            }),
          )
          .pipe(
            Effect.catchTag("SelfImprovementLearningStore.Conflict", (error) =>
              error.message === "Generation strategy arm already exists" ? Effect.void : Effect.fail(error),
            ),
          ),
        listEligiblePatterns: ({ now }) =>
          db
            .select({
              patternDigest: SelfImprovementObservationTable.pattern_digest,
              identityDigest: SelfImprovementObservationTable.identity_digest,
              workload: SelfImprovementObservationTable.workload,
              workloadRevision: SelfImprovementObservationTable.workload_revision,
              errorClass: SelfImprovementObservationTable.error_class,
              orderedToolSymbolDigest: SelfImprovementObservationTable.ordered_tool_symbol_digest,
              outcomeClass: SelfImprovementObservationTable.outcome_class,
              occurredAt: SelfImprovementObservationTable.occurred_at,
              id: SelfImprovementObservationTable.id,
            })
            .from(SelfImprovementObservationTable)
            .where(
              and(
                eq(SelfImprovementObservationTable.location_id, locationID),
                eq(SelfImprovementObservationTable.outcome_class, "failure"),
                gt(SelfImprovementObservationTable.expires_at, now),
              ),
            )
            .orderBy(desc(SelfImprovementObservationTable.occurred_at), asc(SelfImprovementObservationTable.id))
            .all()
            .pipe(
              Effect.orDie,
              Effect.map((rows) => {
                const grouped = new Map<
                  SelfImprovement.Digest,
                  { readonly representative: (typeof rows)[number]; readonly identities: Set<SelfImprovement.Digest> }
                >()
                rows.forEach((row) => {
                  const current = grouped.get(row.patternDigest)
                  if (current) {
                    current.identities.add(row.identityDigest)
                    return
                  }
                  grouped.set(row.patternDigest, { representative: row, identities: new Set([row.identityDigest]) })
                })
                return Array.from(grouped.values())
                  .filter((entry) => entry.identities.size >= 3)
                  .map(({ representative }) => ({
                    patternDigest: representative.patternDigest,
                    workload: SelfImprovementEvaluation.Workload.make(representative.workload),
                    workloadRevision: representative.workloadRevision,
                    errorClass: representative.errorClass,
                    orderedToolSymbolDigest: representative.orderedToolSymbolDigest,
                    outcomeClass: representative.outcomeClass,
                  }))
                  .slice(0, 32)
              }),
            ),
        generate: ({ pattern, now }) =>
          generation.generate({ principal: coordinator, pattern, now }).pipe(
            Effect.map((lease) => (lease.outcome === "admitted" ? ("admitted" as const) : ("skipped" as const))),
            Effect.catchTag("SelfImprovementGenerationStore.NotEligible", () => Effect.succeed("skipped" as const)),
          ),
        listGeneratedWork: () =>
          db
            .select({
              artifactID: SelfImprovementArtifactVersionTable.artifact_id,
              versionID: SelfImprovementArtifactVersionTable.id,
              generationLeaseID: SelfImprovementArtifactVersionTable.generation_lease_id,
              createdAt: SelfImprovementArtifactVersionTable.created_at,
            })
            .from(SelfImprovementArtifactVersionTable)
            .innerJoin(
              SelfImprovementArtifactTable,
              and(
                eq(SelfImprovementArtifactVersionTable.artifact_id, SelfImprovementArtifactTable.id),
                eq(SelfImprovementArtifactTable.location_id, locationID),
                eq(SelfImprovementArtifactTable.status, "live"),
              ),
            )
            .where(
              and(
                eq(SelfImprovementArtifactVersionTable.source, "generated"),
                isNotNull(SelfImprovementArtifactVersionTable.generation_lease_id),
              ),
            )
            .orderBy(asc(SelfImprovementArtifactVersionTable.created_at), asc(SelfImprovementArtifactVersionTable.id))
            .all()
            .pipe(
              Effect.orDie,
              Effect.flatMap((rows) =>
                Effect.forEach(rows, (row) =>
                  Effect.gen(function* () {
                    if (row.generationLeaseID === null) return undefined
                    const lease = yield* generationStore.get(row.generationLeaseID)
                    if (lease?.outcome !== "admitted") return undefined
                    const stage = (yield* transitions.currentStage({ locationID, versionID: row.versionID })) ?? "draft"
                    if (!generatedStages.has(stage)) return undefined
                    const observation = yield* db
                      .select({
                        workload: SelfImprovementObservationTable.workload,
                        workloadRevision: SelfImprovementObservationTable.workload_revision,
                      })
                      .from(SelfImprovementObservationTable)
                      .where(
                        and(
                          eq(SelfImprovementObservationTable.location_id, locationID),
                          eq(SelfImprovementObservationTable.pattern_digest, lease.patternDigest),
                          eq(SelfImprovementObservationTable.task_id_digest, lease.originatingTaskIDDigest),
                        ),
                      )
                      .orderBy(
                        desc(SelfImprovementObservationTable.occurred_at),
                        asc(SelfImprovementObservationTable.id),
                      )
                      .get()
                      .pipe(Effect.orDie)
                    if (observation === undefined) return undefined
                    return {
                      artifactID: row.artifactID,
                      versionID: row.versionID,
                      stage,
                      workload: SelfImprovementEvaluation.Workload.make(observation.workload),
                      workloadRevision: observation.workloadRevision,
                    } satisfies GeneratedWork
                  }),
                ),
              ),
              Effect.map((items) => items.filter((item): item is GeneratedWork => item !== undefined).slice(0, 100)),
            ),
        listBaselines: (work) =>
          query.listBaselines({ locationID, workload: work.workload, limit: 100 }).pipe(
            Effect.map((page) =>
              page.items
                .filter((baseline) => baseline.workloadRevision === work.workloadRevision)
                .map((baseline) => ({
                  id: baseline.id,
                  workload: baseline.workload,
                  workloadRevision: baseline.workloadRevision,
                  suiteID: baseline.suiteID,
                  suiteRevision: baseline.suiteRevision,
                })),
            ),
          ),
        prepareShadow: ({ work, now }) =>
          workflow
            .prepareShadow({
              locationID,
              principal: coordinator,
              artifactID: work.artifactID,
              versionID: work.versionID,
              now,
              idempotencyKey: key(`automation/prepare-shadow/v1\0${work.versionID}`),
            })
            .pipe(Effect.asVoid),
        listRuns: (input) =>
          query
            .listMetricRuns({
              locationID,
              ...(input.versionID === undefined ? {} : { versionID: input.versionID }),
              ...(input.stage === undefined ? {} : { stage: input.stage }),
              ...(input.state === undefined ? {} : { state: input.state }),
              includeSamples: input.includeSamples,
              limit: 100,
            })
            .pipe(
              Effect.map((page) =>
                page.items.map((item) => ({
                  id: item.run.id,
                  versionID: item.run.versionID,
                  stage: item.run.stage,
                  state: item.run.state,
                  cutoffAt: item.run.cutoffAt,
                  ...(item.samples === undefined || item.samples.length === 0
                    ? {}
                    : { cutoffSampleSetDigest: SelfImprovementMetrics.aggregate(item.samples).orderedSampleIDDigest }),
                })),
              ),
            ),
        createRun: ({ work, stage, baseline, now, cutoffAt }) =>
          evidence
            .createMetricRun(
              {
                principal: runtimeEvidence,
                locationID,
                now,
                idempotencyKey: key(`automation/run/v1\0${work.versionID}\0${stage}\0${baseline.id}`),
              },
              new SelfImprovementApi.CreateMetricRunRequest({
                versionID: work.versionID,
                stage,
                workload: baseline.workload,
                workloadRevision: baseline.workloadRevision,
                suiteID: baseline.suiteID,
                suiteRevision: baseline.suiteRevision,
                baselineID: baseline.id,
                acceptanceStart: now,
                acceptanceEnd: cutoffAt,
                cutoffAt,
                requestDigest: digest(`automation/run/v1\0${work.versionID}\0${stage}\0${baseline.id}`),
              }),
            )
            .pipe(Effect.asVoid),
        decideRun: ({ run, now }) =>
          evidence
            .decideMetricRun(
              {
                principal: evaluator,
                locationID,
                now,
                idempotencyKey: key(`automation/decision/v1\0${run.id}\0${run.cutoffSampleSetDigest}`),
              },
              new SelfImprovementApi.DecideMetricRunRequest({
                runID: run.id,
                cutoffSampleSetDigest: run.cutoffSampleSetDigest,
              }),
            )
            .pipe(Effect.asVoid),
        listPendingApprovals: () =>
          db
            .select({
              id: SelfImprovementApprovalRequestTable.id,
              versionID: SelfImprovementApprovalRequestTable.version_id,
              versionDigest: SelfImprovementApprovalRequestTable.version_digest,
              suiteID: SelfImprovementApprovalRequestTable.suite_id,
              suiteRevision: SelfImprovementApprovalRequestTable.suite_revision,
              evaluationRunID: SelfImprovementApprovalRequestTable.evaluation_run_id,
              shadowEvidenceDigest: SelfImprovementApprovalRequestTable.shadow_evidence_digest,
              creatorID: SelfImprovementApprovalRequestTable.creator_id,
              requestedAt: SelfImprovementApprovalRequestTable.requested_at,
            })
            .from(SelfImprovementApprovalRequestTable)
            .leftJoin(
              SelfImprovementApprovalTable,
              eq(SelfImprovementApprovalTable.request_id, SelfImprovementApprovalRequestTable.id),
            )
            .where(
              and(
                eq(SelfImprovementApprovalRequestTable.location_id, locationID),
                isNull(SelfImprovementApprovalTable.id),
              ),
            )
            .orderBy(
              asc(SelfImprovementApprovalRequestTable.requested_at),
              asc(SelfImprovementApprovalRequestTable.id),
            )
            .limit(100)
            .all()
            .pipe(
              Effect.orDie,
              Effect.map((rows) =>
                rows.map(
                  (row) =>
                    new SelfImprovementLifecycle.ApprovalRequest({
                      id: row.id,
                      locationID,
                      binding: new SelfImprovementLifecycle.ApprovalBinding({
                        versionID: row.versionID,
                        versionDigest: row.versionDigest,
                        suiteID: row.suiteID,
                        suiteRevision: row.suiteRevision,
                        evaluationRunID: row.evaluationRunID,
                        shadowEvidenceDigest: row.shadowEvidenceDigest,
                      }),
                      creatorID: row.creatorID,
                      requestedAt: row.requestedAt,
                    }),
                ),
              ),
            ),
        approve: ({ request, now }) =>
          artifacts
            .approve({
              locationID,
              principal: approver,
              request: new SelfImprovementApi.ApproveRequest({
                approvalRequestID: request.id,
                binding: request.binding,
              }),
              idempotencyKey: key(`automation/approve/v1\0${request.id}\0${request.binding.shadowEvidenceDigest}`),
              now,
            })
            .pipe(Effect.asVoid),
        reconcile: reconciler.drain,
      },
    })
    yield* Effect.gen(function* () {
      const current = yield* service.status
      if (current.settings.enabled) yield* service.tick
      const next = yield* service.status
      yield* Effect.sleep(Duration.seconds(next.settings.enabled ? next.settings.intervalSeconds : 1))
    }).pipe(Effect.forever, Effect.forkScoped({ startImmediately: true }))
    return Service.of(service)
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [
    Config.node,
    Database.node,
    Location.node,
    SelfImprovementContextReconciler.node,
    SelfImprovementGeneration.node,
    SelfImprovementGenerationStore.node,
    SelfImprovementLearningStore.node,
    SelfImprovementLifecycleWorkflow.node,
    SelfImprovementPrivateArtifactCommand.node,
    SelfImprovementPrivateEvidenceCommand.node,
    SelfImprovementPrivateQuery.node,
    SelfImprovementTransitionStore.node,
  ],
})

function principal(
  locationID: SelfImprovementLifecycle.LocationID,
  kind: SelfImprovementLifecycle.PrincipalKind,
  id: string,
) {
  return new SelfImprovementLifecycle.Principal({
    id: SelfImprovementLifecycle.PrincipalID.make(id),
    kind,
    locationID,
  })
}

function digest(value: string) {
  return SelfImprovement.Digest.make(Hash.sha256(value))
}

function key(value: string) {
  return SelfImprovementLearning.IdempotencyKey.make(Hash.sha256(value))
}
