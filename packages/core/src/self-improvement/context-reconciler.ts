export * as SelfImprovementContextReconciler from "./context-reconciler"

import { Clock, Context, Effect, Layer, Schedule, Schema } from "effect"
import { SqlError } from "effect/unstable/sql/SqlError"
import { SelfImprovement, SelfImprovementLearning, SelfImprovementLifecycle } from "@opencode-ai/schema"
import { Database } from "../database/database"
import { makeLocationNode } from "../effect/app-node"
import { SystemContext } from "../system-context"
import { SystemContextRegistry } from "../system-context/registry"
import { SelfImprovementApprovalStore } from "./approval-store"
import { SelfImprovementArtifactStore } from "./artifact-store"
import { SelfImprovementAuditStore } from "./audit-store"
import { SelfImprovementContextStore } from "./context-store"
import { SelfImprovementIdempotencyStore } from "./idempotency-store"
import { SelfImprovementLearningStore } from "./learning-store"
import { SelfImprovementMutationStore } from "./mutation-store"
import { SelfImprovementTransitionStore } from "./transition-store"
import { Hash } from "../util/hash"
import type { Transaction } from "./context-store"
import { SelfImprovementGeneratedSkill } from "./generated-skill"

export class ContextUnavailable extends Schema.TaggedErrorClass<ContextUnavailable>()(
  "SelfImprovementContextReconciler.ContextUnavailable",
  { message: Schema.String },
) {}

export interface MaterializerInterface {
  readonly materialize: (desired: SelfImprovementLearning.ContextDesiredState) => Effect.Effect<
    {
      readonly key: SystemContext.Key
      readonly context: SystemContext.SystemContext
      readonly digest: SelfImprovement.Digest
    },
    ContextUnavailable
  >
}

export class Materializer extends Context.Service<Materializer, MaterializerInterface>()(
  "@opencode/SelfImprovementContextReconciler.Materializer",
) {}

export interface Interface {
  readonly drain: Effect.Effect<number, ContextUnavailable>
  readonly recover: Effect.Effect<number, ContextUnavailable>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SelfImprovementContextReconciler") {}

const escapeXml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;")

const contextKey = (
  locationID: SelfImprovementLifecycle.LocationID,
  artifactID: SelfImprovementLifecycle.ArtifactID,
  rolloutSlot: "shadow" | "canary" | "active",
) => SystemContext.Key.make(`self-improvement/${Hash.sha256(`${locationID}\0${artifactID}\0${rolloutSlot}`)}`)

export const materializer = (
  artifacts: Pick<SelfImprovementArtifactStore.Interface, "getArtifact" | "getVersion">,
): MaterializerInterface => ({
  materialize: Effect.fn("SelfImprovementContextReconciler.materialize")(function* (desired) {
    if (desired.desired.state === "absent")
      return yield* new ContextUnavailable({ message: "Absent context has no materialized artifact" })
    const artifact = yield* artifacts.getArtifact({ locationID: desired.locationID, artifactID: desired.artifactID })
    const version = yield* artifacts.getVersion({
      locationID: desired.locationID,
      versionID: desired.desired.versionID,
    })
    if (
      artifact?.id !== desired.artifactID ||
      artifact.key.locationID !== desired.locationID ||
      artifact.key.kind !== "skill" ||
      version?.id !== desired.desired.versionID ||
      version.artifactID !== desired.artifactID ||
      version.versionDigest !== desired.desired.versionDigest ||
      version.proposal.kind !== "skill" ||
      version.proposal.name !== artifact.key.name
    )
      return yield* new ContextUnavailable({ message: "Desired context artifact is unavailable" })
    const key = contextKey(desired.locationID, desired.artifactID, desired.rolloutSlot)
    const source = {
      artifactID: artifact.id,
      versionID: version.id,
      versionDigest: version.versionDigest,
      markdown: version.proposal.definition.content,
    }
    const render = (value: typeof source) =>
      `<self-improvement-context trusted="true" untrusted="true" subordinate="true" inert="true" artifact-id="${value.artifactID}" version-id="${value.versionID}" version-digest="${value.versionDigest}">\n${escapeXml(value.markdown)}\n</self-improvement-context>`
    return {
      key,
      digest: desired.desired.versionDigest,
      context: SystemContext.make({
        key,
        codec: Schema.toCodecJson(
          Schema.Struct({
            artifactID: SelfImprovementLifecycle.ArtifactID,
            versionID: SelfImprovementLifecycle.ArtifactVersionID,
            versionDigest: SelfImprovement.Digest,
            markdown: Schema.String,
          }),
        ),
        load: Effect.succeed(source),
        baseline: render,
        update: (_previous, current) => render(current),
      }),
    }
  }),
})

export const materializerLayer = Layer.effect(
  Materializer,
  Effect.gen(function* () {
    return Materializer.of(materializer(yield* SelfImprovementArtifactStore.Service))
  }),
)

export const materializerNode = makeLocationNode({
  service: Materializer,
  layer: materializerLayer,
  deps: [SelfImprovementArtifactStore.node],
})

export interface Dependencies {
  readonly transaction: <A, E, R>(
    work: (tx: Transaction) => Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E | SqlError, R>
  readonly approvals: Pick<SelfImprovementApprovalStore.Interface, "approved" | "consume" | "appendRollback">
  readonly audit: Pick<SelfImprovementAuditStore.Interface, "append">
  readonly context: Pick<
    SelfImprovementContextStore.Interface,
    | "pending"
    | "recoverable"
    | "desired"
    | "markApplying"
    | "markApplied"
    | "reschedule"
    | "supersede"
    | "supersedeForArtifact"
    | "terminalGroup"
    | "blockedForArtifact"
  >
  readonly idempotency: Pick<SelfImprovementIdempotencyStore.Interface, "valid">
  readonly learning: Pick<SelfImprovementLearningStore.Interface, "appendReward" | "canaryRegression">
  readonly materializer: MaterializerInterface
  readonly generatedSkills?: Pick<SelfImprovementGeneratedSkill.Interface, "reconcile">
  readonly mutations: Pick<
    SelfImprovementMutationStore.Interface,
    "validateRevision" | "clearTombstonedSlots" | "upsertSlot" | "removeSlot"
  >
  readonly registry: Pick<SystemContextRegistry.Interface, "compareAndSet">
  readonly transitions: Pick<SelfImprovementTransitionStore.Interface, "currentStage" | "append">
}

const now = Effect.map(Clock.currentTimeMillis, SelfImprovementLifecycle.TimestampMillis.make)

const retryAt = (outbox: SelfImprovementLearning.ContextOutbox, timestamp: SelfImprovementLifecycle.TimestampMillis) =>
  SelfImprovementLifecycle.TimestampMillis.make(
    timestamp +
      Math.min(
        5_000 * 2 ** outbox.attempts +
          outbox.id.split("").reduce((total, char) => (total * 31 + char.charCodeAt(0)) % 1_000, 0),
        300_000,
      ),
  )

const slot = (stage: SelfImprovementLifecycle.ArtifactStage): "shadow" | "canary" | "active" | undefined =>
  stage === "shadow" || stage === "canary" || stage === "active" ? stage : undefined

export const make = (dependencies: Dependencies): Interface => {
  const {
    approvals,
    audit,
    context,
    idempotency,
    learning,
    materializer,
    mutations,
    registry,
    transaction,
    transitions,
  } = dependencies
  const generatedSkills = dependencies.generatedSkills ?? { reconcile: () => Effect.void }

  const supersede = (
    outbox: SelfImprovementLearning.ContextOutbox,
    timestamp: SelfImprovementLifecycle.TimestampMillis,
    tx?: Transaction,
  ) =>
    context.supersede(outbox.id, tx).pipe(
      Effect.flatMap(() =>
        audit.append(
          {
            locationID: outbox.locationID,
            entry: new SelfImprovementLearning.AuditEntry({
              id: SelfImprovementLifecycle.AuditEntryID.make(`si_aud_${outbox.id}_superseded`),
              locationID: outbox.locationID,
              eventType: "context-change-superseded",
              actorID: outbox.intent.actorID,
              payload: new SelfImprovementLearning.AuditPayload({
                artifactID: outbox.artifactID,
                versionID: outbox.intent.versionID,
                contextOutboxID: outbox.id,
                linkedDigests: [],
                rejectedFieldNames: [],
              }),
              timestamp,
              retention: new SelfImprovementLearning.GovernedMetadataRetention({ createdAt: timestamp }),
            }),
          },
          tx,
        ),
      ),
      Effect.orDie,
      Effect.as(false),
    )

  const reschedule = (
    outbox: SelfImprovementLearning.ContextOutbox,
    timestamp: SelfImprovementLifecycle.TimestampMillis,
  ) =>
    audit
      .append({
        locationID: outbox.locationID,
        entry: new SelfImprovementLearning.AuditEntry({
          id: SelfImprovementLifecycle.AuditEntryID.make(`si_aud_${outbox.id}_retry_${outbox.attempts}`),
          locationID: outbox.locationID,
          eventType: "context-change-retry",
          actorID: outbox.intent.actorID,
          payload: new SelfImprovementLearning.AuditPayload({
            artifactID: outbox.artifactID,
            versionID: outbox.intent.versionID,
            contextOutboxID: outbox.id,
            linkedDigests: [],
            rejectedFieldNames: [],
          }),
          timestamp,
          retention: new SelfImprovementLearning.GovernedMetadataRetention({ createdAt: timestamp }),
        }),
      })
      .pipe(Effect.andThen(context.reschedule(outbox.id, retryAt(outbox, timestamp))), Effect.orDie)

  const process = (outbox: SelfImprovementLearning.ContextOutbox) =>
    Effect.gen(function* () {
      const timestamp = yield* now
      const terminal = outbox.intent.terminalGroup !== undefined
      const rolloutSlot =
        outbox.intent.event === "canary-regressed"
          ? "canary"
          : slot(terminal ? outbox.expectedStage : outbox.intent.nextStage)
      if (rolloutSlot === undefined) return yield* supersede(outbox, timestamp)
      const desired = yield* context.desired({
        locationID: outbox.locationID,
        artifactID: outbox.artifactID,
        rolloutSlot,
      })
      if (desired === undefined || desired.desiredRevision !== outbox.desiredStateRevision)
        return yield* supersede(outbox, timestamp)
      if (outbox.status === "pending" && !(yield* context.markApplying(outbox.id))) return false
      const materialized =
        desired.desired.state === "absent"
          ? {
              key: contextKey(outbox.locationID, outbox.artifactID, rolloutSlot),
              context: SystemContext.empty,
              digest: SelfImprovement.Digest.make(
                Hash.sha256(
                  `self-improvement/context/inert/v1\0${outbox.locationID}\0${outbox.artifactID}\0${rolloutSlot}`,
                ),
              ),
            }
          : yield* materializer
              .materialize(desired)
              .pipe(
                Effect.catchTag("SelfImprovementContextReconciler.ContextUnavailable", (error) =>
                  reschedule(outbox, timestamp).pipe(Effect.andThen(Effect.fail(error))),
                ),
              )
      if (outbox.intent.approvalBinding !== undefined) {
        const casTime = yield* now
        const approval =
          outbox.intent.approvalID === undefined
            ? undefined
            : yield* approvals.approved({
                locationID: outbox.locationID,
                approvalID: outbox.intent.approvalID,
                binding: outbox.intent.approvalBinding,
                at: casTime,
              })
        if (
          approval === undefined ||
          approval.id !== outbox.intent.approvalID ||
          desired.desired.state !== "present" ||
          approval.binding.versionID !== desired.desired.versionID ||
          approval.binding.versionDigest !== desired.desired.versionDigest
        )
          return yield* supersede(outbox, timestamp)
      } else if (outbox.intent.approvalID !== undefined) return yield* supersede(outbox, timestamp)
      const cas = yield* registry.compareAndSet({
        key: materialized.key,
        expectedRevision: SelfImprovementLifecycle.Revision.make(desired.desiredRevision - 1),
        next: { revision: desired.desiredRevision, digest: materialized.digest, context: materialized.context },
      })
      if (
        !cas.applied &&
        (cas.current?.revision !== desired.desiredRevision || cas.current.digest !== materialized.digest)
      ) {
        yield* reschedule(outbox, timestamp)
        return false
      }
      if (rolloutSlot === "active") {
        const projected = yield* generatedSkills.reconcile(desired).pipe(
          Effect.as(true),
          Effect.catchTag("SelfImprovementGeneratedSkill.Unavailable", (error) =>
            Effect.logWarning("generated skill projection unavailable", {
              artifactID: outbox.artifactID,
              versionID: outbox.intent.versionID,
              error,
            }).pipe(Effect.andThen(reschedule(outbox, timestamp)), Effect.as(false)),
          ),
        )
        if (!projected) return false
      }
      const appliedAt = yield* now
      return yield* transaction((tx) =>
        Effect.gen(function* () {
          const latest = yield* context.desired(
            { locationID: outbox.locationID, artifactID: outbox.artifactID, rolloutSlot },
            tx,
          )
          const revisionMatches = yield* mutations.validateRevision(
            {
              locationID: outbox.locationID,
              artifactID: outbox.artifactID,
              expectedRevision: outbox.expectedArtifactRevision,
              ...(terminal ? { status: "tombstoned" as const } : {}),
            },
            tx,
          )
          const stage = yield* transitions.currentStage(
            { locationID: outbox.locationID, versionID: outbox.intent.versionID },
            tx,
          )
          const idempotent = yield* idempotency.valid(
            {
              locationID: outbox.locationID,
              recordID: outbox.intent.idempotencyRecordID,
              requestDigest: outbox.intent.idempotencyDigest,
            },
            tx,
          )
          if (
            latest === undefined ||
            latest.desiredRevision !== outbox.desiredStateRevision ||
            !revisionMatches ||
            stage !== outbox.expectedStage ||
            !idempotent
          ) {
            if (!revisionMatches)
              yield* context.supersedeForArtifact({ locationID: outbox.locationID, artifactID: outbox.artifactID }, tx)
            return yield* supersede(outbox, yield* now, tx)
          }
          const approval =
            outbox.intent.approvalBinding === undefined
              ? undefined
              : outbox.intent.approvalID === undefined
                ? undefined
                : yield* approvals.approved(
                    {
                      locationID: outbox.locationID,
                      approvalID: outbox.intent.approvalID,
                      binding: outbox.intent.approvalBinding,
                      at: appliedAt,
                    },
                    tx,
                  )
          if (outbox.intent.approvalBinding !== undefined) {
            if (approval === undefined || approval.id !== outbox.intent.approvalID) return false
            if (!(yield* approvals.consume(outbox.locationID, approval.id, appliedAt, tx).pipe(Effect.orDie)))
              return false
          }
          if (outbox.intent.rollback !== undefined && outbox.intent.reward !== undefined) {
            yield* approvals.appendRollback(outbox.intent.rollback, tx).pipe(Effect.orDie)
            yield* learning
              .canaryRegression(outbox.intent.reward, outbox.intent.rollback.candidateVersionID, tx)
              .pipe(Effect.orDie)
          }
          if (terminal) {
            const group = yield* context.terminalGroup(outbox, tx)
            if (group !== undefined) {
              yield* Effect.forEach(outbox.intent.terminalGroup.archiveTransitions, (transition) =>
                transitions.append({ locationID: outbox.locationID, transition }, tx).pipe(Effect.orDie),
              )
              if (
                !(yield* mutations.clearTombstonedSlots(
                  {
                    locationID: outbox.locationID,
                    artifactID: outbox.artifactID,
                    expectedRevision: outbox.expectedArtifactRevision,
                  },
                  tx,
                ))
              )
                return yield* Effect.die("Tombstoned context projection conflict")
            }
          } else {
            yield* transitions
              .append(
                {
                  locationID: outbox.locationID,
                  transition: new SelfImprovementLifecycle.StageTransition({
                    id: SelfImprovementLifecycle.StageTransitionID.make(`si_trn_${outbox.id}`),
                    versionID: outbox.intent.versionID,
                    previousStage: outbox.intent.previousStage,
                    nextStage: outbox.intent.nextStage,
                    event: outbox.intent.event,
                    reason: outbox.intent.reason,
                    actorID: outbox.intent.actorID,
                    timestamp: appliedAt,
                    ...(outbox.intent.evaluationRunID === undefined
                      ? {}
                      : { evaluationRunID: outbox.intent.evaluationRunID }),
                    ...(approval === undefined ? {} : { approvalID: approval.id }),
                    ...(outbox.intent.rollbackID === undefined ? {} : { rollbackID: outbox.intent.rollbackID }),
                    contextOutboxID: outbox.id,
                    idempotencyRecordID: outbox.intent.idempotencyRecordID,
                    idempotencyDigest: outbox.intent.idempotencyDigest,
                  }),
                },
                tx,
              )
              .pipe(Effect.orDie)
            if (outbox.intent.supersededVersionID !== undefined) {
              const supersededStage = yield* transitions.currentStage(
                { locationID: outbox.locationID, versionID: outbox.intent.supersededVersionID },
                tx,
              )
              if (supersededStage !== "active") return yield* Effect.die("Superseded version is not active")
              yield* transitions
                .append(
                  {
                    locationID: outbox.locationID,
                    transition: new SelfImprovementLifecycle.StageTransition({
                      id: SelfImprovementLifecycle.StageTransitionID.make(`si_trn_${outbox.id}_superseded`),
                      versionID: outbox.intent.supersededVersionID,
                      previousStage: "active",
                      nextStage: "deprecated",
                      event: "version-superseded",
                      reason: "superseded",
                      actorID: outbox.intent.actorID,
                      timestamp: appliedAt,
                      contextOutboxID: outbox.id,
                      idempotencyRecordID: outbox.intent.idempotencyRecordID,
                      idempotencyDigest: outbox.intent.idempotencyDigest,
                    }),
                  },
                  tx,
                )
                .pipe(Effect.orDie)
            }
            const projected =
              latest.desired.state === "present"
                ? yield* mutations.upsertSlot(
                    {
                      locationID: outbox.locationID,
                      artifactID: outbox.artifactID,
                      versionID: latest.desired.versionID,
                      slot: latest.rolloutSlot,
                      expectedArtifactRevision: outbox.expectedArtifactRevision,
                      updatedAt: appliedAt,
                    },
                    tx,
                  )
                : yield* mutations
                    .removeSlot(
                      {
                        locationID: outbox.locationID,
                        artifactID: outbox.artifactID,
                        slot: latest.rolloutSlot,
                        expectedArtifactRevision: outbox.expectedArtifactRevision,
                      },
                      tx,
                    )
                    .pipe(Effect.map((removed) => removed || outbox.intent.event === "canary-regressed"))
            if (!projected) return yield* Effect.die("Context projection conflict")
          }
          yield* audit
            .append(
              {
                locationID: outbox.locationID,
                entry: new SelfImprovementLearning.AuditEntry({
                  id: SelfImprovementLifecycle.AuditEntryID.make(`si_aud_${outbox.id}_applied`),
                  locationID: outbox.locationID,
                  eventType: "context-change-applied",
                  actorID: outbox.intent.actorID,
                  payload: new SelfImprovementLearning.AuditPayload({
                    artifactID: outbox.artifactID,
                    versionID: outbox.intent.versionID,
                    contextOutboxID: outbox.id,
                    linkedDigests: [materialized.digest],
                    rejectedFieldNames: [],
                  }),
                  timestamp: appliedAt,
                  retention: new SelfImprovementLearning.GovernedMetadataRetention({ createdAt: timestamp }),
                }),
              },
              tx,
            )
            .pipe(Effect.orDie)
          if (outbox.intent.event === "canary-passed" && outbox.intent.reward !== undefined)
            yield* learning.appendReward(outbox.intent.reward, tx).pipe(Effect.orDie)
          return yield* context.markApplied(outbox.id, materialized.digest, tx)
        }),
      ).pipe(
        Effect.catchCause(() =>
          transaction((tx) =>
            Effect.gen(function* () {
              const blockedAt = yield* now
              yield* context.blockedForArtifact({ locationID: outbox.locationID, artifactID: outbox.artifactID }, tx)
              yield* audit
                .append(
                  {
                    locationID: outbox.locationID,
                    entry: new SelfImprovementLearning.AuditEntry({
                      id: SelfImprovementLifecycle.AuditEntryID.make(`si_aud_${outbox.id}_blocked`),
                      locationID: outbox.locationID,
                      eventType: "context-finalization-blocked",
                      actorID: outbox.intent.actorID,
                      payload: new SelfImprovementLearning.AuditPayload({
                        artifactID: outbox.artifactID,
                        versionID: outbox.intent.versionID,
                        contextOutboxID: outbox.id,
                        linkedDigests: [materialized.digest],
                        rejectedFieldNames: [],
                      }),
                      timestamp: blockedAt,
                      retention: new SelfImprovementLearning.GovernedMetadataRetention({ createdAt: blockedAt }),
                    }),
                  },
                  tx,
                )
                .pipe(Effect.orDie)
              return false
            }),
          ).pipe(
            Effect.catchCause(() =>
              Effect.fail(new ContextUnavailable({ message: "Context finalization recovery failed" })),
            ),
          ),
        ),
      )
    })

  return {
    drain: now.pipe(
      Effect.flatMap((at) => context.pending(at)),
      Effect.flatMap((outboxes) => Effect.forEach(outboxes, process)),
      Effect.map((x) => x.filter(Boolean).length),
    ),
    recover: now.pipe(
      Effect.flatMap((at) => context.recoverable(at)),
      Effect.flatMap((outboxes) => Effect.forEach(outboxes, process)),
      Effect.map((x) => x.filter(Boolean).length),
    ),
  }
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const db = (yield* Database.Service).db
    const reconciler = make({
      transaction: (work) => db.transaction(work),
      approvals: yield* SelfImprovementApprovalStore.Service,
      audit: yield* SelfImprovementAuditStore.Service,
      context: yield* SelfImprovementContextStore.Service,
      idempotency: yield* SelfImprovementIdempotencyStore.Service,
      learning: yield* SelfImprovementLearningStore.Service,
      materializer: yield* Materializer,
      generatedSkills: yield* SelfImprovementGeneratedSkill.Service,
      mutations: yield* SelfImprovementMutationStore.Service,
      registry: yield* SystemContextRegistry.Service,
      transitions: yield* SelfImprovementTransitionStore.Service,
    })
    yield* reconciler.recover.pipe(Effect.orDie)
    yield* reconciler.drain.pipe(Effect.repeat(Schedule.spaced("1 minute")), Effect.forkScoped)
    return Service.of(reconciler)
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [
    Database.node,
    SelfImprovementApprovalStore.node,
    SelfImprovementAuditStore.node,
    SelfImprovementContextStore.node,
    SelfImprovementIdempotencyStore.node,
    SelfImprovementLearningStore.node,
    materializerNode,
    SelfImprovementGeneratedSkill.node,
    SelfImprovementMutationStore.node,
    SystemContextRegistry.node,
    SelfImprovementTransitionStore.node,
  ],
})
