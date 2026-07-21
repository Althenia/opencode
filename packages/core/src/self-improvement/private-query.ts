export * as SelfImprovementPrivateQuery from "./private-query"

import { and, asc, desc, eq, gt, like, lt, or } from "drizzle-orm"
import { Context, Effect, Layer, Schema } from "effect"
import type { EffectDrizzleSqlite } from "@opencode-ai/effect-drizzle-sqlite"
import {
  SelfImprovement,
  SelfImprovementApi,
  SelfImprovementEvaluation,
  SelfImprovementLearning,
  SelfImprovementLifecycle,
} from "@opencode-ai/schema"
import { Database } from "../database/database"
import { makeLocationNode } from "../effect/app-node"
import { SelfImprovementApprovalRequestTable, SelfImprovementApprovalTable } from "./approval-rollback.sql"
import { SelfImprovementArtifactTable, SelfImprovementArtifactVersionTable } from "./artifact.sql"
import { SelfImprovementAuditStore } from "./audit-store"
import { SelfImprovementContextOutboxTable, SelfImprovementContextSelectionEvidenceTable } from "./context.sql"
import {
  SelfImprovementEvaluationBaselineTable,
  SelfImprovementEvaluationDecisionTable,
  SelfImprovementEvaluationFindingTable,
  SelfImprovementEvaluationRunTable,
  SelfImprovementEvaluationSampleTable,
} from "./evaluation.sql"
import { SelfImprovementRoutingDecisionTable } from "./learning.sql"
import { SelfImprovementArtifactSlotTable } from "./projection.sql"
import { SelfImprovementStageTransitionTable } from "./transition.sql"

export type Cursor = readonly [SelfImprovementLifecycle.TimestampMillis, string]
export interface Page<A, C extends ReadonlyArray<unknown> = Cursor> {
  readonly items: ReadonlyArray<A>
  readonly nextCursor?: C
}

type LocationInput = { readonly locationID: SelfImprovementLifecycle.LocationID }
type DatabaseClient = EffectDrizzleSqlite.EffectSQLiteDatabase

const ArtifactJson = Schema.fromJsonString(SelfImprovementLifecycle.Artifact)
const VersionJson = Schema.fromJsonString(SelfImprovementLifecycle.ArtifactVersion)
const BaselineJson = Schema.fromJsonString(SelfImprovementEvaluation.Baseline)
const RunJson = Schema.fromJsonString(SelfImprovementEvaluation.EvaluationRun)
const SampleJson = Schema.fromJsonString(SelfImprovementEvaluation.MetricSample)
const DecisionJson = Schema.fromJsonString(SelfImprovementEvaluation.EvaluationDecision)
const FindingJson = Schema.fromJsonString(SelfImprovementEvaluation.GateFinding)
const RouteJson = Schema.fromJsonString(SelfImprovementLearning.RoutingDecision)
const decodeArtifact = Schema.decodeUnknownSync(ArtifactJson)
const decodeVersion = Schema.decodeUnknownSync(VersionJson)
const decodeBaseline = Schema.decodeUnknownSync(BaselineJson)
const decodeRun = Schema.decodeUnknownSync(RunJson)
const decodeSample = Schema.decodeUnknownSync(SampleJson)
const decodeDecision = Schema.decodeUnknownSync(DecisionJson)
const decodeFinding = Schema.decodeUnknownSync(FindingJson)
const decodeRoute = Schema.decodeUnknownSync(RouteJson)

export interface Interface {
  readonly listArtifacts: (
    input: LocationInput &
      Omit<SelfImprovementApi.ListArtifactsRequest, "cursor"> & { readonly cursor?: ArtifactCursor },
  ) => Effect.Effect<Page<SelfImprovementLifecycle.Artifact, ArtifactCursor>>
  readonly getArtifact: (
    input: LocationInput & SelfImprovementApi.GetArtifactRequest,
  ) => Effect.Effect<SelfImprovementApi.GetArtifactResponse | undefined>
  readonly listVersions: (
    input: LocationInput & Omit<SelfImprovementApi.ListVersionsRequest, "cursor"> & { readonly cursor?: VersionCursor },
  ) => Effect.Effect<Page<SelfImprovementLifecycle.ArtifactVersion, VersionCursor>>
  readonly getVersion: (
    input: LocationInput & SelfImprovementApi.GetVersionRequest,
  ) => Effect.Effect<SelfImprovementApi.GetVersionResponse | undefined>
  readonly listBaselines: (
    input: LocationInput & Omit<SelfImprovementApi.ListBaselinesRequest, "cursor"> & { readonly cursor?: Cursor },
  ) => Effect.Effect<Page<SelfImprovementEvaluation.Baseline>>
  readonly listMetricRuns: (
    input: LocationInput & Omit<SelfImprovementApi.ListMetricRunsRequest, "cursor"> & { readonly cursor?: Cursor },
  ) => Effect.Effect<Page<SelfImprovementApi.MetricRunView>>
  readonly getRun: (
    input: LocationInput & { readonly runID: SelfImprovementLifecycle.EvaluationRunID },
  ) => Effect.Effect<SelfImprovementEvaluation.EvaluationRun | undefined>
  readonly listEvaluations: (
    input: LocationInput & Omit<SelfImprovementApi.ListEvaluationsRequest, "cursor"> & { readonly cursor?: Cursor },
  ) => Effect.Effect<Page<SelfImprovementApi.EvaluationView>>
  readonly listTransitions: (
    input: LocationInput & Omit<SelfImprovementApi.ListTransitionsRequest, "cursor"> & { readonly cursor?: Cursor },
  ) => Effect.Effect<Page<SelfImprovementLifecycle.StageTransition>>
  readonly listApprovals: (
    input: LocationInput & Omit<SelfImprovementApi.ListApprovalsRequest, "cursor"> & { readonly cursor?: Cursor },
  ) => Effect.Effect<Page<SelfImprovementLifecycle.Approval>>
  readonly getApprovalRequest: (input: {
    readonly locationID: SelfImprovementLifecycle.LocationID
    readonly requestID: SelfImprovementLifecycle.ApprovalRequestID
  }) => Effect.Effect<SelfImprovementLifecycle.ApprovalRequest | undefined>
  readonly listContextEvidence: (
    input: LocationInput & Omit<SelfImprovementApi.ListContextEvidenceRequest, "cursor"> & { readonly cursor?: Cursor },
  ) => Effect.Effect<Page<SelfImprovementApi.ContextEvidenceView>>
  readonly listRoutingDecisions: (
    input: LocationInput &
      Omit<SelfImprovementApi.ListRoutingDecisionsRequest, "cursor"> & { readonly cursor?: Cursor },
  ) => Effect.Effect<Page<SelfImprovementLearning.RoutingDecision>>
  readonly listAudit: (
    input: LocationInput & Omit<SelfImprovementApi.ListAuditRequest, "cursor"> & { readonly cursor?: Cursor },
  ) => Effect.Effect<Page<SelfImprovementLearning.AuditEntry>>
  readonly appendAuditAccess: (input: {
    readonly locationID: SelfImprovementLifecycle.LocationID
    readonly entry: SelfImprovementLearning.AuditEntry
  }) => Effect.Effect<void, SelfImprovementAuditStore.InvalidInput | SelfImprovementAuditStore.Conflict>
}

export type ArtifactCursor = readonly [
  SelfImprovement.ArtifactKind,
  SelfImprovement.CandidateName,
  SelfImprovementLifecycle.ArtifactID,
]
export type VersionCursor = readonly [number, SelfImprovementLifecycle.ArtifactVersionID]
export class Service extends Context.Service<Service, Interface>()("@opencode/SelfImprovementPrivateQuery") {}

const limit = (value: number) => Math.min(100, Math.max(1, value))
const page = <A, C extends ReadonlyArray<unknown>>(
  items: ReadonlyArray<A>,
  requested: number,
  cursor: C | undefined,
): Page<A, C> => (items.length <= requested ? { items } : { items: items.slice(0, requested), nextCursor: cursor })
const afterCursor = (timestamp: number, id: string, cursor: Cursor | undefined) =>
  cursor === undefined || timestamp < cursor[0] || (timestamp === cursor[0] && id < cursor[1])

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const db = (yield* Database.Service).db
    const audit = yield* SelfImprovementAuditStore.Service

    const listArtifacts = Effect.fn("SelfImprovementPrivateQuery.listArtifacts")(function* (
      input: Parameters<Interface["listArtifacts"]>[0],
    ) {
      const rows = yield* db
        .select()
        .from(SelfImprovementArtifactTable)
        .where(
          and(
            eq(SelfImprovementArtifactTable.location_id, input.locationID),
            ...(input.kind ? [eq(SelfImprovementArtifactTable.kind, input.kind)] : []),
            ...(input.status ? [eq(SelfImprovementArtifactTable.status, input.status)] : []),
            ...(input.namePrefix ? [like(SelfImprovementArtifactTable.name, `${input.namePrefix}%`)] : []),
            ...(input.cursor
              ? [
                  or(
                    gt(SelfImprovementArtifactTable.kind, input.cursor[0]),
                    and(
                      eq(SelfImprovementArtifactTable.kind, input.cursor[0]),
                      gt(SelfImprovementArtifactTable.name, input.cursor[1]),
                    ),
                    and(
                      eq(SelfImprovementArtifactTable.kind, input.cursor[0]),
                      eq(SelfImprovementArtifactTable.name, input.cursor[1]),
                      gt(SelfImprovementArtifactTable.id, input.cursor[2]),
                    ),
                  ),
                ]
              : []),
          ),
        )
        .orderBy(
          asc(SelfImprovementArtifactTable.kind),
          asc(SelfImprovementArtifactTable.name),
          asc(SelfImprovementArtifactTable.id),
        )
        .limit(limit(input.limit) + 1)
        .all()
        .pipe(Effect.orDie)
      const items = rows.map(fromArtifact)
      const last = items[limit(input.limit) - 1]
      return page<SelfImprovementLifecycle.Artifact, ArtifactCursor>(
        items,
        limit(input.limit),
        last ? [last.key.kind, last.key.name, last.id] : undefined,
      )
    })

    const getArtifact = Effect.fn("SelfImprovementPrivateQuery.getArtifact")(function* (
      input: Parameters<Interface["getArtifact"]>[0],
    ) {
      const artifact = yield* db
        .select()
        .from(SelfImprovementArtifactTable)
        .where(
          and(
            eq(SelfImprovementArtifactTable.location_id, input.locationID),
            eq(SelfImprovementArtifactTable.id, input.artifactID),
          ),
        )
        .get()
        .pipe(Effect.orDie)
      if (!artifact) return undefined
      const slots = yield* db
        .select()
        .from(SelfImprovementArtifactSlotTable)
        .where(
          and(
            eq(SelfImprovementArtifactSlotTable.location_id, input.locationID),
            eq(SelfImprovementArtifactSlotTable.artifact_id, input.artifactID),
          ),
        )
        .all()
        .pipe(Effect.orDie)
      const projection = (slot: "active" | "shadow" | "canary") => slots.find((item) => item.slot === slot)
      const view = (slot: "active" | "shadow" | "canary") => {
        const item = projection(slot)
        return item
          ? new SelfImprovementApi.ArtifactRolloutProjection({
              versionID: item.version_id,
              versionDigest: SelfImprovement.Digest.make("0".repeat(64)),
              transitionID: SelfImprovementLifecycle.StageTransitionID.make("si_trn_unavailable"),
            })
          : undefined
      }
      return new SelfImprovementApi.GetArtifactResponse({
        artifact: fromArtifact(artifact),
        ...(view("active") ? { activeProjection: view("active") } : {}),
        ...(view("shadow") ? { shadowProjection: view("shadow") } : {}),
        ...(view("canary") ? { canaryProjection: view("canary") } : {}),
      })
    })

    const listVersions = Effect.fn("SelfImprovementPrivateQuery.listVersions")(function* (
      input: Parameters<Interface["listVersions"]>[0],
    ) {
      const parent = yield* db
        .select({ id: SelfImprovementArtifactTable.id })
        .from(SelfImprovementArtifactTable)
        .where(
          and(
            eq(SelfImprovementArtifactTable.location_id, input.locationID),
            eq(SelfImprovementArtifactTable.id, input.artifactID),
          ),
        )
        .get()
        .pipe(Effect.orDie)
      if (!parent) return { items: [] }
      const rows = yield* db
        .select()
        .from(SelfImprovementArtifactVersionTable)
        .where(
          and(
            eq(SelfImprovementArtifactVersionTable.artifact_id, input.artifactID),
            ...(input.cursor
              ? [
                  or(
                    lt(SelfImprovementArtifactVersionTable.version_number, input.cursor[0]),
                    and(
                      eq(SelfImprovementArtifactVersionTable.version_number, input.cursor[0]),
                      lt(SelfImprovementArtifactVersionTable.id, input.cursor[1]),
                    ),
                  ),
                ]
              : []),
          ),
        )
        .orderBy(desc(SelfImprovementArtifactVersionTable.version_number), desc(SelfImprovementArtifactVersionTable.id))
        .limit(limit(input.limit) + 1)
        .all()
        .pipe(Effect.orDie)
      const items = rows.map(fromVersion)
      const last = items[limit(input.limit) - 1]
      return page<SelfImprovementLifecycle.ArtifactVersion, VersionCursor>(
        items,
        limit(input.limit),
        last ? [last.versionNumber, last.id] : undefined,
      )
    })

    const getVersion = Effect.fn("SelfImprovementPrivateQuery.getVersion")(function* (
      input: Parameters<Interface["getVersion"]>[0],
    ) {
      const row = yield* db
        .select({ version: SelfImprovementArtifactVersionTable, stage: SelfImprovementStageTransitionTable.next_stage })
        .from(SelfImprovementArtifactVersionTable)
        .innerJoin(
          SelfImprovementArtifactTable,
          eq(SelfImprovementArtifactVersionTable.artifact_id, SelfImprovementArtifactTable.id),
        )
        .leftJoin(
          SelfImprovementStageTransitionTable,
          eq(SelfImprovementArtifactVersionTable.id, SelfImprovementStageTransitionTable.version_id),
        )
        .where(
          and(
            eq(SelfImprovementArtifactTable.location_id, input.locationID),
            eq(SelfImprovementArtifactTable.id, input.artifactID),
            eq(SelfImprovementArtifactVersionTable.id, input.versionID),
          ),
        )
        .orderBy(desc(SelfImprovementStageTransitionTable.timestamp), desc(SelfImprovementStageTransitionTable.id))
        .get()
        .pipe(Effect.orDie)
      return row
        ? new SelfImprovementApi.GetVersionResponse({
            version: fromVersion(row.version),
            stage: row.stage ?? "draft",
            capabilityManifest: fromVersion(row.version).capabilityManifest,
          })
        : undefined
    })

    const listBaselines = Effect.fn("SelfImprovementPrivateQuery.listBaselines")(function* (
      input: Parameters<Interface["listBaselines"]>[0],
    ) {
      const rows = yield* db
        .select()
        .from(SelfImprovementEvaluationBaselineTable)
        .where(
          and(
            eq(SelfImprovementEvaluationBaselineTable.location_id, input.locationID),
            ...(input.workload ? [eq(SelfImprovementEvaluationBaselineTable.workload, input.workload)] : []),
            ...(input.suiteRevision
              ? [eq(SelfImprovementEvaluationBaselineTable.suite_revision, input.suiteRevision)]
              : []),
          ),
        )
        .all()
        .pipe(Effect.orDie)
      const items = rows
        .map((row) => decodeBaseline(row.baseline_json))
        .filter((baseline) => afterCursor(baseline.createdAt, baseline.id, input.cursor))
        .sort((left, right) => right.createdAt - left.createdAt || (left.id < right.id ? 1 : -1))
        .slice(0, limit(input.limit) + 1)
      const last = items[limit(input.limit) - 1]
      return page<SelfImprovementEvaluation.Baseline, Cursor>(
        items,
        limit(input.limit),
        last ? [last.createdAt, last.id] : undefined,
      )
    })

    const listMetricRuns = Effect.fn("SelfImprovementPrivateQuery.listMetricRuns")(function* (
      input: Parameters<Interface["listMetricRuns"]>[0],
    ) {
      const rows = yield* db
        .select()
        .from(SelfImprovementEvaluationRunTable)
        .where(
          and(
            eq(SelfImprovementEvaluationRunTable.location_id, input.locationID),
            ...(input.state ? [eq(SelfImprovementEvaluationRunTable.state, input.state)] : []),
          ),
        )
        .all()
        .pipe(Effect.orDie)
      const runs = rows
        .map((row) => decodeRun(row.run_json))
        .filter(
          (run) =>
            (input.versionID === undefined || run.versionID === input.versionID) &&
            (input.stage === undefined || run.stage === input.stage) &&
            afterCursor(run.createdAt, run.id, input.cursor),
        )
        .sort((left, right) => right.createdAt - left.createdAt || (left.id < right.id ? 1 : -1))
        .slice(0, limit(input.limit) + 1)
      const items = yield* Effect.forEach(runs, (run) => metricRunView(db, input.locationID, run, input.includeSamples))
      const last = runs[limit(input.limit) - 1]
      return page<SelfImprovementApi.MetricRunView, Cursor>(
        items,
        limit(input.limit),
        last ? [last.createdAt, last.id] : undefined,
      )
    })

    const getRun = Effect.fn("SelfImprovementPrivateQuery.getRun")(function* (
      input: Parameters<Interface["getRun"]>[0],
    ) {
      const row = yield* db
        .select({ run: SelfImprovementEvaluationRunTable.run_json })
        .from(SelfImprovementEvaluationRunTable)
        .where(
          and(
            eq(SelfImprovementEvaluationRunTable.location_id, input.locationID),
            eq(SelfImprovementEvaluationRunTable.id, input.runID),
          ),
        )
        .get()
        .pipe(Effect.orDie)
      return row ? decodeRun(row.run) : undefined
    })

    const listEvaluations = Effect.fn("SelfImprovementPrivateQuery.listEvaluations")(function* (
      input: Parameters<Interface["listEvaluations"]>[0],
    ) {
      const versionIDs = input.artifactID
        ? yield* db
            .select({ id: SelfImprovementArtifactVersionTable.id })
            .from(SelfImprovementArtifactVersionTable)
            .innerJoin(
              SelfImprovementArtifactTable,
              and(
                eq(SelfImprovementArtifactVersionTable.artifact_id, SelfImprovementArtifactTable.id),
                eq(SelfImprovementArtifactTable.location_id, input.locationID),
                eq(SelfImprovementArtifactTable.id, input.artifactID),
              ),
            )
            .all()
            .pipe(Effect.orDie)
        : undefined
      const rows = yield* db
        .select({
          run: SelfImprovementEvaluationRunTable.run_json,
          decision: SelfImprovementEvaluationDecisionTable.decision_json,
        })
        .from(SelfImprovementEvaluationRunTable)
        .innerJoin(
          SelfImprovementEvaluationDecisionTable,
          and(
            eq(SelfImprovementEvaluationDecisionTable.run_id, SelfImprovementEvaluationRunTable.id),
            eq(SelfImprovementEvaluationDecisionTable.location_id, input.locationID),
          ),
        )
        .where(and(eq(SelfImprovementEvaluationRunTable.location_id, input.locationID)))
        .all()
        .pipe(Effect.orDie)
      const evaluations = rows
        .map((row) => ({ run: decodeRun(row.run), decision: decodeDecision(row.decision) }))
        .filter(
          (row) =>
            (versionIDs === undefined || versionIDs.some((version) => version.id === row.run.versionID)) &&
            (input.versionID === undefined || row.run.versionID === input.versionID) &&
            (input.stage === undefined || row.run.stage === input.stage) &&
            afterCursor(row.decision.decidedAt, row.run.id, input.cursor),
        )
        .sort(
          (left, right) => right.decision.decidedAt - left.decision.decidedAt || (left.run.id < right.run.id ? 1 : -1),
        )
        .slice(0, limit(input.limit) + 1)
      const items = yield* Effect.forEach(evaluations, (row) =>
        evaluationView(db, input.locationID, row.run, row.decision),
      )
      const last = evaluations[limit(input.limit) - 1]
      return page<SelfImprovementApi.EvaluationView, Cursor>(
        items,
        limit(input.limit),
        last ? [last.decision.decidedAt, last.run.id] : undefined,
      )
    })

    const listTransitions = Effect.fn("SelfImprovementPrivateQuery.listTransitions")(function* (
      input: Parameters<Interface["listTransitions"]>[0],
    ) {
      const rows = yield* db
        .select({ transition: SelfImprovementStageTransitionTable })
        .from(SelfImprovementStageTransitionTable)
        .innerJoin(
          SelfImprovementArtifactVersionTable,
          eq(SelfImprovementStageTransitionTable.version_id, SelfImprovementArtifactVersionTable.id),
        )
        .innerJoin(
          SelfImprovementArtifactTable,
          and(
            eq(SelfImprovementArtifactVersionTable.artifact_id, SelfImprovementArtifactTable.id),
            eq(SelfImprovementArtifactTable.location_id, input.locationID),
          ),
        )
        .where(
          and(
            ...(input.artifactID ? [eq(SelfImprovementArtifactTable.id, input.artifactID)] : []),
            ...(input.versionID ? [eq(SelfImprovementStageTransitionTable.version_id, input.versionID)] : []),
            ...(input.event ? [eq(SelfImprovementStageTransitionTable.event, input.event)] : []),
            ...(input.cursor
              ? [
                  or(
                    lt(SelfImprovementStageTransitionTable.timestamp, input.cursor[0]),
                    and(
                      eq(SelfImprovementStageTransitionTable.timestamp, input.cursor[0]),
                      lt(SelfImprovementStageTransitionTable.id, input.cursor[1] as never),
                    ),
                  ),
                ]
              : []),
          ),
        )
        .orderBy(desc(SelfImprovementStageTransitionTable.timestamp), desc(SelfImprovementStageTransitionTable.id))
        .limit(limit(input.limit) + 1)
        .all()
        .pipe(Effect.orDie)
      const items = rows.map((row) => fromTransition(row.transition))
      const last = items[limit(input.limit) - 1]
      return page<SelfImprovementLifecycle.StageTransition, Cursor>(
        items,
        limit(input.limit),
        last ? [last.timestamp, last.id] : undefined,
      )
    })

    const listApprovals = Effect.fn("SelfImprovementPrivateQuery.listApprovals")(function* (
      input: Parameters<Interface["listApprovals"]>[0],
    ) {
      const rows = yield* db
        .select()
        .from(SelfImprovementApprovalTable)
        .innerJoin(
          SelfImprovementArtifactVersionTable,
          eq(SelfImprovementApprovalTable.version_id, SelfImprovementArtifactVersionTable.id),
        )
        .innerJoin(
          SelfImprovementArtifactTable,
          and(
            eq(SelfImprovementArtifactVersionTable.artifact_id, SelfImprovementArtifactTable.id),
            eq(SelfImprovementArtifactTable.location_id, input.locationID),
          ),
        )
        .where(
          and(
            eq(SelfImprovementApprovalTable.location_id, input.locationID),
            ...(input.artifactID ? [eq(SelfImprovementArtifactTable.id, input.artifactID)] : []),
            ...(input.versionID ? [eq(SelfImprovementApprovalTable.version_id, input.versionID)] : []),
            ...(input.approverID ? [eq(SelfImprovementApprovalTable.approver_id, input.approverID)] : []),
            ...(input.cursor
              ? [
                  or(
                    lt(SelfImprovementApprovalTable.decided_at, input.cursor[0]),
                    and(
                      eq(SelfImprovementApprovalTable.decided_at, input.cursor[0]),
                      lt(SelfImprovementApprovalTable.id, input.cursor[1] as never),
                    ),
                  ),
                ]
              : []),
          ),
        )
        .orderBy(desc(SelfImprovementApprovalTable.decided_at), desc(SelfImprovementApprovalTable.id))
        .limit(limit(input.limit) + 1)
        .all()
        .pipe(Effect.orDie)
      const items = rows.map((row) => fromApproval(row.self_improvement_approval))
      const last = rows[limit(input.limit) - 1]?.self_improvement_approval
      return page<SelfImprovementLifecycle.Approval, Cursor>(
        items,
        limit(input.limit),
        last ? [last.decided_at, last.id] : undefined,
      )
    })

    const getApprovalRequest = Effect.fn("SelfImprovementPrivateQuery.getApprovalRequest")(function* (input: {
      readonly locationID: SelfImprovementLifecycle.LocationID
      readonly requestID: SelfImprovementLifecycle.ApprovalRequestID
    }) {
      const row = yield* db
        .select()
        .from(SelfImprovementApprovalRequestTable)
        .where(
          and(
            eq(SelfImprovementApprovalRequestTable.location_id, input.locationID),
            eq(SelfImprovementApprovalRequestTable.id, input.requestID),
          ),
        )
        .get()
        .pipe(Effect.orDie)
      return row ? fromApprovalRequest(row) : undefined
    })

    const listContextEvidence = Effect.fn("SelfImprovementPrivateQuery.listContextEvidence")(function* (
      input: Parameters<Interface["listContextEvidence"]>[0],
    ) {
      const rows = yield* db
        .select()
        .from(SelfImprovementContextSelectionEvidenceTable)
        .where(
          and(
            eq(SelfImprovementContextSelectionEvidenceTable.location_id, input.locationID),
            ...(input.artifactID
              ? [eq(SelfImprovementContextSelectionEvidenceTable.artifact_id, input.artifactID)]
              : []),
            ...(input.versionID ? [eq(SelfImprovementContextSelectionEvidenceTable.version_id, input.versionID)] : []),
            ...(input.cursor
              ? [
                  or(
                    lt(SelfImprovementContextSelectionEvidenceTable.created_at, input.cursor[0]),
                    and(
                      eq(SelfImprovementContextSelectionEvidenceTable.created_at, input.cursor[0]),
                      lt(SelfImprovementContextSelectionEvidenceTable.id, input.cursor[1] as never),
                    ),
                  ),
                ]
              : []),
          ),
        )
        .orderBy(
          desc(SelfImprovementContextSelectionEvidenceTable.created_at),
          desc(SelfImprovementContextSelectionEvidenceTable.id),
        )
        .limit(limit(input.limit) + 1)
        .all()
        .pipe(Effect.orDie)
      const items = rows.map(
        (row) =>
          new SelfImprovementApi.ContextEvidenceView({
            cursorID: row.id,
            createdAt: row.created_at,
            evidence: {
              type: "selection",
              value: new SelfImprovementLearning.ContextSelectionEvidence({
                id: row.id,
                artifactID: row.artifact_id,
                versionID: row.version_id,
                versionDigest: row.version_digest,
                locationID: row.location_id,
                stage: row.stage,
                contextEpoch: row.context_epoch,
                sessionDigest: row.session_digest,
                cohortResult: row.cohort_result,
                outboxID: row.outbox_id,
              }),
            },
          }),
      )
      const last = rows[limit(input.limit) - 1]
      return page<SelfImprovementApi.ContextEvidenceView, Cursor>(
        items,
        limit(input.limit),
        last ? [last.created_at, last.id] : undefined,
      )
    })

    const listRoutingDecisions = Effect.fn("SelfImprovementPrivateQuery.listRoutingDecisions")(function* (
      input: Parameters<Interface["listRoutingDecisions"]>[0],
    ) {
      const rows = yield* db
        .select()
        .from(SelfImprovementRoutingDecisionTable)
        .where(
          and(
            eq(SelfImprovementRoutingDecisionTable.location_id, input.locationID),
            ...(input.sessionDigest
              ? [eq(SelfImprovementRoutingDecisionTable.session_digest, input.sessionDigest)]
              : []),
            ...(input.workload ? [eq(SelfImprovementRoutingDecisionTable.workload, input.workload)] : []),
            ...(input.cursor
              ? [
                  or(
                    lt(SelfImprovementRoutingDecisionTable.timestamp, input.cursor[0]),
                    and(
                      eq(SelfImprovementRoutingDecisionTable.timestamp, input.cursor[0]),
                      lt(SelfImprovementRoutingDecisionTable.id, input.cursor[1] as never),
                    ),
                  ),
                ]
              : []),
          ),
        )
        .orderBy(desc(SelfImprovementRoutingDecisionTable.timestamp), desc(SelfImprovementRoutingDecisionTable.id))
        .limit(limit(input.limit) + 1)
        .all()
        .pipe(Effect.orDie)
      const items = rows.map(fromRoute)
      const last = rows[limit(input.limit) - 1]
      return page<SelfImprovementLearning.RoutingDecision, Cursor>(
        items,
        limit(input.limit),
        last ? [last.timestamp, last.id] : undefined,
      )
    })

    const listAudit = Effect.fn("SelfImprovementPrivateQuery.listAudit")(function* (
      input: Parameters<Interface["listAudit"]>[0],
    ) {
      const listed = yield* audit.list({
        locationID: input.locationID,
        ...(input.eventType ? { eventType: input.eventType } : {}),
      })
      const entries = listed
        .filter(
          (entry) =>
            (!input.artifactID || entry.payload.artifactID === input.artifactID) &&
            (!input.from || entry.timestamp >= input.from) &&
            (!input.to || entry.timestamp <= input.to) &&
            afterCursor(entry.timestamp, entry.id, input.cursor),
        )
        .sort((left, right) => right.timestamp - left.timestamp || (left.id < right.id ? 1 : -1))
        .slice(0, limit(input.limit) + 1)
      const last = entries[limit(input.limit) - 1]
      return page<SelfImprovementLearning.AuditEntry, Cursor>(
        entries,
        limit(input.limit),
        last ? [last.timestamp, last.id] : undefined,
      )
    })

    const appendAuditAccess = Effect.fn("SelfImprovementPrivateQuery.appendAuditAccess")(function* (
      input: Parameters<Interface["appendAuditAccess"]>[0],
    ) {
      return yield* audit.append(input)
    })

    return Service.of({
      listArtifacts,
      getArtifact,
      listVersions,
      getVersion,
      listBaselines,
      listMetricRuns,
      getRun,
      listEvaluations,
      listTransitions,
      listApprovals,
      getApprovalRequest,
      listContextEvidence,
      listRoutingDecisions,
      listAudit,
      appendAuditAccess,
    })
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [Database.node, SelfImprovementAuditStore.node] })

function fromArtifact(row: typeof SelfImprovementArtifactTable.$inferSelect) {
  return new SelfImprovementLifecycle.Artifact({
    id: row.id,
    key: new SelfImprovementLifecycle.ArtifactKey({ locationID: row.location_id, kind: row.kind, name: row.name }),
    status: row.status,
    createdBy: row.created_by,
    createdAt: row.created_at,
    revision: row.revision,
    ...(row.tombstone_actor_id !== null && row.tombstone_reason !== null && row.tombstone_at !== null
      ? {
          tombstone: new SelfImprovementLifecycle.Tombstone({
            actorID: row.tombstone_actor_id,
            reason: row.tombstone_reason,
            timestamp: row.tombstone_at,
          }),
        }
      : {}),
  })
}
function fromVersion(row: typeof SelfImprovementArtifactVersionTable.$inferSelect) {
  return decodeVersion(
    JSON.stringify({
      id: row.id,
      artifactID: row.artifact_id,
      versionNumber: row.version_number,
      source: row.source,
      behaviorClass: row.behavior_class,
      proposal: JSON.parse(row.proposal_json),
      canonicalJson: row.canonical_json,
      proposalDigest: row.proposal_digest,
      inputSnapshotDigest: row.input_snapshot_digest,
      versionDigest: row.version_digest,
      capabilityManifest: JSON.parse(row.capability_manifest_json),
      capabilityManifestDigest: row.capability_manifest_digest,
      creatorID: row.creator_id,
      createdAt: row.created_at,
      ...(row.generation_lease_id
        ? {
            generated: {
              generationLeaseID: row.generation_lease_id,
              strategyPullID: row.strategy_pull_id,
              originatingTaskIDDigest: row.originating_task_id_digest,
              modelRequestDigest: row.model_request_digest,
              modelOutputDigest: row.model_output_digest,
              retentionDeadline: row.retention_deadline,
            },
          }
        : {}),
    }),
  )
}
function fromTransition(row: typeof SelfImprovementStageTransitionTable.$inferSelect) {
  return new SelfImprovementLifecycle.StageTransition({
    id: row.id,
    versionID: row.version_id,
    previousStage: row.previous_stage,
    nextStage: row.next_stage,
    event: row.event,
    reason: row.reason,
    actorID: row.actor_id,
    timestamp: row.timestamp,
    idempotencyRecordID: required(row.idempotency_record_id, "Invalid stage transition row"),
    idempotencyDigest: row.idempotency_digest,
  })
}
function fromApproval(row: typeof SelfImprovementApprovalTable.$inferSelect) {
  return new SelfImprovementLifecycle.Approval({
    id: row.id,
    requestID: row.request_id,
    locationID: row.location_id,
    binding: new SelfImprovementLifecycle.ApprovalBinding({
      versionID: row.version_id,
      versionDigest: row.version_digest,
      suiteID: row.suite_id,
      suiteRevision: row.suite_revision,
      evaluationRunID: row.evaluation_run_id,
      shadowEvidenceDigest: row.shadow_evidence_digest,
    }),
    decision:
      row.decision === "approved"
        ? new SelfImprovementLifecycle.ApprovalGranted({
            approverID: row.approver_id,
            decidedAt: row.decided_at,
            expiresAt: required(row.expires_at, "Invalid approved row"),
          })
        : new SelfImprovementLifecycle.ApprovalRejected({
            approverID: row.approver_id,
            decidedAt: row.decided_at,
            reason: "approval-rejected",
          }),
  })
}
function fromApprovalRequest(row: typeof SelfImprovementApprovalRequestTable.$inferSelect) {
  return new SelfImprovementLifecycle.ApprovalRequest({
    id: row.id,
    locationID: row.location_id,
    binding: new SelfImprovementLifecycle.ApprovalBinding({
      versionID: row.version_id,
      versionDigest: row.version_digest,
      suiteID: row.suite_id,
      suiteRevision: row.suite_revision,
      evaluationRunID: row.evaluation_run_id,
      shadowEvidenceDigest: row.shadow_evidence_digest,
    }),
    creatorID: row.creator_id,
    requestedAt: row.requested_at,
  })
}
function fromRoute(row: typeof SelfImprovementRoutingDecisionTable.$inferSelect) {
  return decodeRoute(
    JSON.stringify({
      id: row.id,
      locationID: row.location_id,
      sessionDigest: row.session_digest,
      workload: row.workload,
      workloadRevision: row.workload_revision,
      roleDigest: row.role_digest,
      precedenceSource: row.precedence_source,
      policySnapshotDigest: row.policy_snapshot_digest,
      catalogSnapshotDigest: row.catalog_snapshot_digest,
      variantSnapshotDigest: row.variant_snapshot_digest,
      orderedEligibleArms: JSON.parse(row.ordered_eligible_arms_json),
      selectedRoute: JSON.parse(row.selected_route_json),
      reasonCode: row.reason_code,
      ...(row.pull_event_id ? { pullEventID: row.pull_event_id } : {}),
      timestamp: row.timestamp,
    }),
  )
}
function metricRunView(
  db: DatabaseClient,
  locationID: SelfImprovementLifecycle.LocationID,
  run: SelfImprovementEvaluation.EvaluationRun,
  includeSamples: boolean,
) {
  return Effect.gen(function* () {
    const samples = yield* db
      .select({ sample: SelfImprovementEvaluationSampleTable.sample_json })
      .from(SelfImprovementEvaluationSampleTable)
      .where(
        and(
          eq(SelfImprovementEvaluationSampleTable.location_id, locationID),
          eq(SelfImprovementEvaluationSampleTable.run_id, run.id),
        ),
      )
      .all()
      .pipe(Effect.orDie)
    return new SelfImprovementApi.MetricRunView({
      run,
      sampleCount: samples.length,
      ...(includeSamples ? { samples: samples.map((sample) => decodeSample(sample.sample)) } : {}),
    })
  })
}
function evaluationView(
  db: DatabaseClient,
  locationID: SelfImprovementLifecycle.LocationID,
  run: SelfImprovementEvaluation.EvaluationRun,
  decision: SelfImprovementEvaluation.EvaluationDecision,
) {
  return Effect.gen(function* () {
    const findings = yield* db
      .select({ finding: SelfImprovementEvaluationFindingTable.finding_json })
      .from(SelfImprovementEvaluationFindingTable)
      .where(
        and(
          eq(SelfImprovementEvaluationFindingTable.location_id, locationID),
          eq(SelfImprovementEvaluationFindingTable.run_id, run.id),
        ),
      )
      .orderBy(asc(SelfImprovementEvaluationFindingTable.finding_order))
      .all()
      .pipe(Effect.orDie)
    return new SelfImprovementApi.EvaluationView({
      run,
      decision,
      orderedFindings: findings.map((item) => decodeFinding(item.finding)),
    })
  })
}

function required<A>(value: A | null, message: string): A {
  if (value === null) throw new Error(message)
  return value
}
