export * as SelfImprovementAutomation from "./automation"

import { and, asc, desc, eq, gt, isNotNull } from "drizzle-orm"
import { Cause, Clock, Context, Duration, Effect, Layer, Schedule } from "effect"
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
import { SelfImprovementArtifactTable, SelfImprovementArtifactVersionTable } from "./artifact.sql"
import { SelfImprovementContextReconciler } from "./context-reconciler"
import { locationID as makeLocationID } from "./contracts"
import { SelfImprovementGeneration } from "./generation"
import { SelfImprovementGenerationStore } from "./generation-store"
import { SelfImprovementObservationTable } from "./ingress.sql"
import { SelfImprovementLifecycleWorkflow } from "./lifecycle-workflow"
import { SelfImprovementMetrics } from "./metrics"
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
  readonly evaluationWindowMillis: number
}

export interface EligiblePattern {
  readonly patternDigest: SelfImprovement.Digest
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
  readonly listEligiblePatterns: (input: {
    readonly locationID: SelfImprovementLifecycle.LocationID
    readonly now: SelfImprovementLifecycle.TimestampMillis
  }) => Effect.Effect<ReadonlyArray<EligiblePattern>, unknown>
  readonly generate: (input: {
    readonly patternDigest: SelfImprovement.Digest
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

export interface Interface {
  readonly tick: Effect.Effect<TickResult>
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
  readonly dependencies: Dependencies
}): Interface {
  if (!input.settings.enabled) return { tick: Effect.succeed(emptyResult) }

  const tick = Effect.fn("SelfImprovementAutomation.tick")(function* () {
    const now = yield* input.dependencies.now
    const patternsResult = yield* attempt(
      "list eligible patterns",
      input.dependencies.listEligiblePatterns({ locationID: input.locationID, now }),
    )
    const patterns = patternsResult.ok ? patternsResult.value : []
    const generated = yield* Effect.forEach(patterns, (pattern) =>
      attempt("generate candidate", input.dependencies.generate({ patternDigest: pattern.patternDigest, now })),
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
    const reconciliation = yield* attempt("reconcile self-improvement context", input.dependencies.reconcile)

    return {
      eligiblePatterns: patterns.length,
      generated: generatedCount,
      prepared: progressed.reduce((total, result) => total + (result.ok ? result.value.prepared : 0), 0),
      runsCreated: progressed.reduce((total, result) => total + (result.ok ? result.value.runsCreated : 0), 0),
      runsDecided: decisions.filter((result) => result.ok).length,
      reconciled: reconciliation.ok ? reconciliation.value : 0,
      failures:
        (patternsResult.ok ? 0 : 1) +
        generated.filter((result) => !result.ok).length +
        (workResult.ok ? 0 : 1) +
        progressed.filter((result) => !result.ok).length +
        (openRunsResult.ok ? 0 : 1) +
        decisions.filter((result) => !result.ok).length +
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
            cutoffAt: SelfImprovementLifecycle.TimestampMillis.make(at + input.settings.evaluationWindowMillis),
          })
          return { prepared: prepared ? 1 : 0, runsCreated: 1 }
        }),
      )
    }
  })()

  return { tick }
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
    const query = yield* SelfImprovementPrivateQuery.Service
    const workflow = yield* SelfImprovementLifecycleWorkflow.Service
    const evidence = yield* SelfImprovementPrivateEvidenceCommand.Service
    const transitions = yield* SelfImprovementTransitionStore.Service
    const reconciler = yield* SelfImprovementContextReconciler.Service
    const configured = Config.latest(yield* config.entries(), "experimental")?.self_improvement
    const locationRef = Location.Ref.make({
      directory: location.directory,
      ...(location.workspaceID === undefined ? {} : { workspaceID: location.workspaceID }),
    })
    const locationID = makeLocationID(locationRef)
    const coordinator = principal(locationID, "coordinator", "self-improvement-automation-coordinator")
    const evaluator = principal(locationID, "evaluator", "self-improvement-automation-evaluator")
    const runtimeEvidence = principal(
      locationID,
      "runtime-evidence-service",
      configured?.evidence_principal_id ?? "self-improvement-runtime-evidence",
    )
    const settings: Settings = {
      enabled: configured?.automatic === true,
      evaluationWindowMillis: (configured?.evaluation_window_minutes ?? 60) * 60_000,
    }
    const service = make({
      locationID,
      settings,
      dependencies: {
        now: Clock.currentTimeMillis.pipe(Effect.map((now) => SelfImprovementLifecycle.TimestampMillis.make(now))),
        listEligiblePatterns: ({ now }) =>
          db
            .select({
              patternDigest: SelfImprovementObservationTable.pattern_digest,
              identityDigest: SelfImprovementObservationTable.identity_digest,
              occurredAt: SelfImprovementObservationTable.occurred_at,
              id: SelfImprovementObservationTable.id,
            })
            .from(SelfImprovementObservationTable)
            .where(
              and(
                eq(SelfImprovementObservationTable.location_id, locationID),
                gt(SelfImprovementObservationTable.expires_at, now),
              ),
            )
            .orderBy(desc(SelfImprovementObservationTable.occurred_at), asc(SelfImprovementObservationTable.id))
            .all()
            .pipe(
              Effect.orDie,
              Effect.map((rows) => {
                const grouped = new Map<SelfImprovement.Digest, Set<SelfImprovement.Digest>>()
                rows.forEach((row) => {
                  const identities = grouped.get(row.patternDigest) ?? new Set<SelfImprovement.Digest>()
                  identities.add(row.identityDigest)
                  grouped.set(row.patternDigest, identities)
                })
                return Array.from(grouped)
                  .filter(([, identities]) => identities.size >= 3)
                  .map(([patternDigest]) => ({ patternDigest }))
                  .slice(0, 32)
              }),
            ),
        generate: ({ patternDigest, now }) =>
          generation.generate({ principal: coordinator, patternDigest, now }).pipe(
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
        reconcile: reconciler.drain,
      },
    })
    if (settings.enabled) {
      yield* service.tick.pipe(
        Effect.repeat(Schedule.spaced(Duration.seconds(configured?.interval_seconds ?? 60))),
        Effect.forkScoped,
      )
    }
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
    SelfImprovementLifecycleWorkflow.node,
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
