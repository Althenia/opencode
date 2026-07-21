export * as SelfImprovementApprovalStore from "./approval-store"

import { and, eq, gte, isNull } from "drizzle-orm"
import { Context, Effect, Layer, Schema } from "effect"
import { SelfImprovementLifecycle } from "@opencode-ai/schema"
import type { EffectDrizzleSqlite } from "@opencode-ai/effect-drizzle-sqlite"
import { Database } from "../database/database"
import { makeLocationNode } from "../effect/app-node"
import { SelfImprovementArtifactTable, SelfImprovementArtifactVersionTable } from "./artifact.sql"
import {
  SelfImprovementApprovalRequestTable,
  SelfImprovementApprovalTable,
  SelfImprovementRollbackTable,
} from "./approval-rollback.sql"

type DatabaseClient = EffectDrizzleSqlite.EffectSQLiteDatabase
export type Transaction = Parameters<Parameters<DatabaseClient["transaction"]>[0]>[0]

export class InvalidInput extends Schema.TaggedErrorClass<InvalidInput>()("SelfImprovementApprovalStore.InvalidInput", {
  message: Schema.String,
}) {}

export class Conflict extends Schema.TaggedErrorClass<Conflict>()("SelfImprovementApprovalStore.Conflict", {
  message: Schema.String,
}) {}

export interface Interface {
  readonly request: (
    request: SelfImprovementLifecycle.ApprovalRequest,
    tx?: Transaction,
  ) => Effect.Effect<void, Conflict>
  readonly decide: (
    approval: SelfImprovementLifecycle.Approval,
    tx?: Transaction,
  ) => Effect.Effect<SelfImprovementLifecycle.Approval, InvalidInput | Conflict>
  readonly get: (
    input: {
      readonly locationID: SelfImprovementLifecycle.LocationID
      readonly approvalID: SelfImprovementLifecycle.ApprovalID
    },
    tx?: Transaction,
  ) => Effect.Effect<SelfImprovementLifecycle.Approval | undefined>
  readonly requestForBinding: (input: {
    readonly locationID: SelfImprovementLifecycle.LocationID
    readonly binding: SelfImprovementLifecycle.ApprovalBinding
  }) => Effect.Effect<SelfImprovementLifecycle.ApprovalRequest | undefined>
  readonly consumable: (
    locationID: SelfImprovementLifecycle.LocationID,
    requestID: SelfImprovementLifecycle.ApprovalRequestID,
    binding: SelfImprovementLifecycle.ApprovalBinding,
    at: SelfImprovementLifecycle.TimestampMillis,
  ) => Effect.Effect<SelfImprovementLifecycle.ApprovalGranted | undefined>
  readonly approved: (
    input: {
      readonly locationID: SelfImprovementLifecycle.LocationID
      readonly approvalID: SelfImprovementLifecycle.ApprovalID
      readonly binding: SelfImprovementLifecycle.ApprovalBinding
      readonly at: SelfImprovementLifecycle.TimestampMillis
    },
    tx?: Transaction,
  ) => Effect.Effect<SelfImprovementLifecycle.Approval | undefined>
  readonly approvedForBinding: (
    input: {
      readonly locationID: SelfImprovementLifecycle.LocationID
      readonly binding: SelfImprovementLifecycle.ApprovalBinding
      readonly at: SelfImprovementLifecycle.TimestampMillis
    },
    tx?: Transaction,
  ) => Effect.Effect<SelfImprovementLifecycle.Approval | undefined>
  readonly consume: (
    locationID: SelfImprovementLifecycle.LocationID,
    approvalID: SelfImprovementLifecycle.ApprovalID,
    appliedAt: SelfImprovementLifecycle.TimestampMillis,
    tx?: Transaction,
  ) => Effect.Effect<boolean, Conflict>
  readonly appendRollback: (
    rollback: SelfImprovementLifecycle.Rollback,
    tx?: Transaction,
  ) => Effect.Effect<void, Conflict>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SelfImprovementApprovalStore") {}

const sameBinding = (left: SelfImprovementLifecycle.ApprovalBinding, right: SelfImprovementLifecycle.ApprovalBinding) =>
  left.versionID === right.versionID &&
  left.versionDigest === right.versionDigest &&
  left.suiteID === right.suiteID &&
  left.suiteRevision === right.suiteRevision &&
  left.evaluationRunID === right.evaluationRunID &&
  left.shadowEvidenceDigest === right.shadowEvidenceDigest

const fromApprovalRow = (row: typeof SelfImprovementApprovalTable.$inferSelect) => {
  const binding = new SelfImprovementLifecycle.ApprovalBinding({
    versionID: row.version_id,
    versionDigest: row.version_digest,
    suiteID: row.suite_id,
    suiteRevision: row.suite_revision,
    evaluationRunID: row.evaluation_run_id,
    shadowEvidenceDigest: row.shadow_evidence_digest,
  })
  if (row.decision === "rejected")
    return new SelfImprovementLifecycle.Approval({
      id: row.id,
      requestID: row.request_id,
      locationID: row.location_id,
      binding,
      decision: new SelfImprovementLifecycle.ApprovalRejected({
        approverID: row.approver_id,
        decidedAt: row.decided_at,
        reason: "approval-rejected",
      }),
    })
  if (row.expires_at === null) throw new Error("Invalid approved approval row")
  return new SelfImprovementLifecycle.Approval({
    id: row.id,
    requestID: row.request_id,
    locationID: row.location_id,
    binding,
    decision: new SelfImprovementLifecycle.ApprovalGranted({
      approverID: row.approver_id,
      decidedAt: row.decided_at,
      expiresAt: row.expires_at,
      ...(row.consumed_at === null ? {} : { consumedAt: row.consumed_at }),
    }),
  })
}

const fromApprovalRequest = (row: typeof SelfImprovementApprovalRequestTable.$inferSelect) =>
  new SelfImprovementLifecycle.ApprovalRequest({
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

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const db = (yield* Database.Service).db

    const request = Effect.fn("SelfImprovementApprovalStore.request")(function* (
      input: SelfImprovementLifecycle.ApprovalRequest,
      tx?: Transaction,
    ) {
      const client = tx ?? db
      const version = yield* client
        .select({
          id: SelfImprovementArtifactVersionTable.id,
          digest: SelfImprovementArtifactVersionTable.version_digest,
        })
        .from(SelfImprovementArtifactVersionTable)
        .innerJoin(
          SelfImprovementArtifactTable,
          and(
            eq(SelfImprovementArtifactVersionTable.artifact_id, SelfImprovementArtifactTable.id),
            eq(SelfImprovementArtifactTable.location_id, input.locationID),
          ),
        )
        .where(eq(SelfImprovementArtifactVersionTable.id, input.binding.versionID))
        .get()
        .pipe(Effect.orDie)
      if (version === undefined) return yield* new Conflict({ message: "Approval version does not belong to Location" })
      if (version.digest !== input.binding.versionDigest)
        return yield* new Conflict({ message: "Approval version digest does not match stored version" })

      const stored = yield* client
        .insert(SelfImprovementApprovalRequestTable)
        .values({
          id: input.id,
          location_id: input.locationID,
          version_id: input.binding.versionID,
          version_digest: input.binding.versionDigest,
          suite_id: input.binding.suiteID,
          suite_revision: input.binding.suiteRevision,
          evaluation_run_id: input.binding.evaluationRunID,
          shadow_evidence_digest: input.binding.shadowEvidenceDigest,
          creator_id: input.creatorID,
          requested_at: input.requestedAt,
          shadow_evidence_expires_at: SelfImprovementLifecycle.TimestampMillis.make(
            input.requestedAt + 180 * 86_400_000,
          ),
        })
        .onConflictDoNothing()
        .returning({ id: SelfImprovementApprovalRequestTable.id })
        .get()
        .pipe(Effect.orDie)
      if (stored === undefined) return yield* new Conflict({ message: "Approval request already exists" })
      return undefined
    })

    const decide = Effect.fn("SelfImprovementApprovalStore.decide")(function* (
      input: SelfImprovementLifecycle.Approval,
      tx?: Transaction,
    ) {
      const client = tx ?? db
      const request = yield* client
        .select()
        .from(SelfImprovementApprovalRequestTable)
        .where(eq(SelfImprovementApprovalRequestTable.id, input.requestID))
        .get()
        .pipe(Effect.orDie)
      if (request === undefined) return yield* new InvalidInput({ message: "Approval request does not exist" })
      if (request.location_id !== input.locationID)
        return yield* new InvalidInput({ message: "Approval Location does not match request" })
      if (input.decision._tag === "approved" && input.decision.expiresAt !== input.decision.decidedAt + 86_400_000)
        return yield* new InvalidInput({ message: "Approval expiry must be exactly 24 hours after decision" })
      if (input.decision._tag === "approved" && input.decision.consumedAt !== undefined)
        return yield* new InvalidInput({ message: "Approval decision cannot already be consumed" })
      if (input.decision.decidedAt > request.shadow_evidence_expires_at)
        return yield* new InvalidInput({ message: "Approval shadow evidence has expired" })

      const requestBinding = new SelfImprovementLifecycle.ApprovalBinding({
        versionID: request.version_id,
        versionDigest: request.version_digest,
        suiteID: request.suite_id,
        suiteRevision: request.suite_revision,
        evaluationRunID: request.evaluation_run_id,
        shadowEvidenceDigest: request.shadow_evidence_digest,
      })
      if (!sameBinding(requestBinding, input.binding))
        return yield* new InvalidInput({ message: "Approval binding does not match request" })
      if (request.creator_id === input.decision.approverID)
        return yield* new InvalidInput({ message: "Approval creator cannot decide their own request" })

      const stored = yield* client
        .insert(SelfImprovementApprovalTable)
        .values({
          id: input.id,
          request_id: input.requestID,
          location_id: input.locationID,
          version_id: input.binding.versionID,
          version_digest: input.binding.versionDigest,
          suite_id: input.binding.suiteID,
          suite_revision: input.binding.suiteRevision,
          evaluation_run_id: input.binding.evaluationRunID,
          shadow_evidence_digest: input.binding.shadowEvidenceDigest,
          decision: input.decision._tag,
          approver_id: input.decision.approverID,
          decided_at: input.decision.decidedAt,
          expires_at: input.decision._tag === "approved" ? input.decision.expiresAt : null,
          shadow_evidence_expires_at: request.shadow_evidence_expires_at,
          consumed_at: null,
        })
        .onConflictDoNothing()
        .returning({ id: SelfImprovementApprovalTable.id })
        .get()
        .pipe(Effect.orDie)
      if (stored === undefined) return yield* new Conflict({ message: "Approval request is already decided" })
      return input
    })

    const get = Effect.fn("SelfImprovementApprovalStore.get")(function* (
      input: {
        readonly locationID: SelfImprovementLifecycle.LocationID
        readonly approvalID: SelfImprovementLifecycle.ApprovalID
      },
      tx?: Transaction,
    ) {
      const row = yield* (tx ?? db)
        .select()
        .from(SelfImprovementApprovalTable)
        .where(
          and(
            eq(SelfImprovementApprovalTable.id, input.approvalID),
            eq(SelfImprovementApprovalTable.location_id, input.locationID),
          ),
        )
        .get()
        .pipe(Effect.orDie)
      return row === undefined ? undefined : fromApprovalRow(row)
    })

    const requestForBinding = Effect.fn("SelfImprovementApprovalStore.requestForBinding")(function* (input: {
      readonly locationID: SelfImprovementLifecycle.LocationID
      readonly binding: SelfImprovementLifecycle.ApprovalBinding
    }) {
      const row = yield* db
        .select()
        .from(SelfImprovementApprovalRequestTable)
        .where(
          and(
            eq(SelfImprovementApprovalRequestTable.location_id, input.locationID),
            eq(SelfImprovementApprovalRequestTable.version_id, input.binding.versionID),
            eq(SelfImprovementApprovalRequestTable.version_digest, input.binding.versionDigest),
            eq(SelfImprovementApprovalRequestTable.suite_id, input.binding.suiteID),
            eq(SelfImprovementApprovalRequestTable.suite_revision, input.binding.suiteRevision),
            eq(SelfImprovementApprovalRequestTable.evaluation_run_id, input.binding.evaluationRunID),
            eq(SelfImprovementApprovalRequestTable.shadow_evidence_digest, input.binding.shadowEvidenceDigest),
          ),
        )
        .get()
        .pipe(Effect.orDie)
      return row === undefined ? undefined : fromApprovalRequest(row)
    })

    const consumable = Effect.fn("SelfImprovementApprovalStore.consumable")(function* (
      locationID: SelfImprovementLifecycle.LocationID,
      requestID: SelfImprovementLifecycle.ApprovalRequestID,
      binding: SelfImprovementLifecycle.ApprovalBinding,
      at: SelfImprovementLifecycle.TimestampMillis,
    ) {
      const approval = yield* db
        .select()
        .from(SelfImprovementApprovalTable)
        .where(
          and(
            eq(SelfImprovementApprovalTable.location_id, locationID),
            eq(SelfImprovementApprovalTable.request_id, requestID),
            eq(SelfImprovementApprovalTable.version_id, binding.versionID),
            eq(SelfImprovementApprovalTable.version_digest, binding.versionDigest),
            eq(SelfImprovementApprovalTable.suite_id, binding.suiteID),
            eq(SelfImprovementApprovalTable.suite_revision, binding.suiteRevision),
            eq(SelfImprovementApprovalTable.evaluation_run_id, binding.evaluationRunID),
            eq(SelfImprovementApprovalTable.shadow_evidence_digest, binding.shadowEvidenceDigest),
            eq(SelfImprovementApprovalTable.decision, "approved"),
            isNull(SelfImprovementApprovalTable.consumed_at),
            gte(SelfImprovementApprovalTable.expires_at, at),
            gte(SelfImprovementApprovalTable.shadow_evidence_expires_at, at),
          ),
        )
        .get()
        .pipe(Effect.orDie)
      if (approval === undefined || approval.expires_at === null) return undefined
      return new SelfImprovementLifecycle.ApprovalGranted({
        approverID: approval.approver_id,
        decidedAt: approval.decided_at,
        expiresAt: approval.expires_at,
      })
    })

    const approved = Effect.fn("SelfImprovementApprovalStore.approved")(function* (
      input: {
        readonly locationID: SelfImprovementLifecycle.LocationID
        readonly approvalID: SelfImprovementLifecycle.ApprovalID
        readonly binding: SelfImprovementLifecycle.ApprovalBinding
        readonly at: SelfImprovementLifecycle.TimestampMillis
      },
      tx?: Transaction,
    ) {
      const client = tx ?? db
      const row = yield* client
        .select()
        .from(SelfImprovementApprovalTable)
        .where(
          and(
            eq(SelfImprovementApprovalTable.id, input.approvalID),
            eq(SelfImprovementApprovalTable.location_id, input.locationID),
            eq(SelfImprovementApprovalTable.version_id, input.binding.versionID),
            eq(SelfImprovementApprovalTable.version_digest, input.binding.versionDigest),
            eq(SelfImprovementApprovalTable.suite_id, input.binding.suiteID),
            eq(SelfImprovementApprovalTable.suite_revision, input.binding.suiteRevision),
            eq(SelfImprovementApprovalTable.evaluation_run_id, input.binding.evaluationRunID),
            eq(SelfImprovementApprovalTable.shadow_evidence_digest, input.binding.shadowEvidenceDigest),
            eq(SelfImprovementApprovalTable.decision, "approved"),
            isNull(SelfImprovementApprovalTable.consumed_at),
            gte(SelfImprovementApprovalTable.expires_at, input.at),
            gte(SelfImprovementApprovalTable.shadow_evidence_expires_at, input.at),
          ),
        )
        .get()
        .pipe(Effect.orDie)
      return row === undefined ? undefined : fromApprovalRow(row)
    })

    const approvedForBinding = Effect.fn("SelfImprovementApprovalStore.approvedForBinding")(function* (
      input: {
        readonly locationID: SelfImprovementLifecycle.LocationID
        readonly binding: SelfImprovementLifecycle.ApprovalBinding
        readonly at: SelfImprovementLifecycle.TimestampMillis
      },
      tx?: Transaction,
    ) {
      const client = tx ?? db
      const row = yield* client
        .select()
        .from(SelfImprovementApprovalTable)
        .where(
          and(
            eq(SelfImprovementApprovalTable.location_id, input.locationID),
            eq(SelfImprovementApprovalTable.version_id, input.binding.versionID),
            eq(SelfImprovementApprovalTable.version_digest, input.binding.versionDigest),
            eq(SelfImprovementApprovalTable.suite_id, input.binding.suiteID),
            eq(SelfImprovementApprovalTable.suite_revision, input.binding.suiteRevision),
            eq(SelfImprovementApprovalTable.evaluation_run_id, input.binding.evaluationRunID),
            eq(SelfImprovementApprovalTable.shadow_evidence_digest, input.binding.shadowEvidenceDigest),
            eq(SelfImprovementApprovalTable.decision, "approved"),
            isNull(SelfImprovementApprovalTable.consumed_at),
            gte(SelfImprovementApprovalTable.expires_at, input.at),
            gte(SelfImprovementApprovalTable.shadow_evidence_expires_at, input.at),
          ),
        )
        .get()
        .pipe(Effect.orDie)
      return row === undefined ? undefined : fromApprovalRow(row)
    })

    const consume = Effect.fn("SelfImprovementApprovalStore.consume")(function* (
      locationID: SelfImprovementLifecycle.LocationID,
      approvalID: SelfImprovementLifecycle.ApprovalID,
      appliedAt: SelfImprovementLifecycle.TimestampMillis,
      tx?: Transaction,
    ) {
      const update = (client: Transaction) =>
        client
          .update(SelfImprovementApprovalTable)
          .set({ consumed_at: appliedAt })
          .where(
            and(
              eq(SelfImprovementApprovalTable.id, approvalID),
              eq(SelfImprovementApprovalTable.location_id, locationID),
              eq(SelfImprovementApprovalTable.decision, "approved"),
              isNull(SelfImprovementApprovalTable.consumed_at),
              gte(SelfImprovementApprovalTable.expires_at, appliedAt),
              gte(SelfImprovementApprovalTable.shadow_evidence_expires_at, appliedAt),
            ),
          )
          .returning({ id: SelfImprovementApprovalTable.id })
          .get()
          .pipe(
            Effect.orDie,
            Effect.map((approval) => approval !== undefined),
          )

      if (tx) return yield* update(tx)
      return yield* db.transaction(update).pipe(Effect.catchTag("SqlError", Effect.die))
    })

    const appendRollback = Effect.fn("SelfImprovementApprovalStore.appendRollback")(function* (
      rollback: SelfImprovementLifecycle.Rollback,
      tx?: Transaction,
    ) {
      const append = (client: Transaction) =>
        Effect.gen(function* () {
          if (rollback.candidateVersionID === rollback.retainedActiveVersionID)
            return yield* new Conflict({ message: "Rollback candidate cannot be the retained active version" })
          if (rollback.reason !== "canary-regression")
            return yield* new Conflict({ message: "Rollback reason must be canary-regression" })

          const versions = yield* client
            .select({
              id: SelfImprovementArtifactVersionTable.id,
              artifactID: SelfImprovementArtifactVersionTable.artifact_id,
            })
            .from(SelfImprovementArtifactVersionTable)
            .innerJoin(
              SelfImprovementArtifactTable,
              and(
                eq(SelfImprovementArtifactVersionTable.artifact_id, SelfImprovementArtifactTable.id),
                eq(SelfImprovementArtifactTable.location_id, rollback.locationID),
              ),
            )
            .where(
              and(
                eq(SelfImprovementArtifactVersionTable.artifact_id, rollback.artifactID),
                eq(SelfImprovementArtifactTable.id, rollback.artifactID),
              ),
            )
            .all()
            .pipe(Effect.orDie)
          if (!versions.some((version) => version.id === rollback.candidateVersionID))
            return yield* new Conflict({ message: "Rollback candidate version does not belong to artifact" })
          if (!versions.some((version) => version.id === rollback.retainedActiveVersionID))
            return yield* new Conflict({ message: "Rollback retained active version does not belong to artifact" })

          const stored = yield* client
            .insert(SelfImprovementRollbackTable)
            .values({
              id: rollback.id,
              location_id: rollback.locationID,
              artifact_id: rollback.artifactID,
              candidate_version_id: rollback.candidateVersionID,
              retained_active_version_id: rollback.retainedActiveVersionID,
              canary_run_id: rollback.canaryRunID,
              reason: rollback.reason,
              reward_event_id: rollback.rewardEventID,
              timestamp: rollback.timestamp,
            })
            .onConflictDoNothing()
            .returning({ id: SelfImprovementRollbackTable.id })
            .get()
            .pipe(Effect.orDie)
          if (stored === undefined) return yield* new Conflict({ message: "Canary rollback already exists" })
          return undefined
        })

      if (tx) return yield* append(tx)
      return yield* db.transaction(append).pipe(Effect.catchTag("SqlError", Effect.die))
    })

    return Service.of({
      request,
      decide,
      get,
      requestForBinding,
      consumable,
      approved,
      approvedForBinding,
      consume,
      appendRollback,
    })
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [Database.node] })
