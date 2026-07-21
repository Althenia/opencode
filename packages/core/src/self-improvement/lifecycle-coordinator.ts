export * as SelfImprovementLifecycleCoordinator from "./lifecycle-coordinator"

import { Context, Effect, Layer, Schema } from "effect"
import {
  SelfImprovementApi,
  SelfImprovementEvaluation,
  SelfImprovementLearning,
  SelfImprovementLifecycle,
} from "@opencode-ai/schema"
import { Database } from "../database/database"
import { makeLocationNode } from "../effect/app-node"
import { KeyedMutex } from "../effect/keyed-mutex"
import { SelfImprovementArtifactStore } from "./artifact-store"
import { SelfImprovementAuditStore } from "./audit-store"
import { SelfImprovementContextReconciler } from "./context-reconciler"
import { SelfImprovementContextStore, type Transaction } from "./context-store"
import { SelfImprovementIdempotencyStore } from "./idempotency-store"
import { SelfImprovementMutationStore } from "./mutation-store"
import { SelfImprovementTransitionStore } from "./transition-store"

export class IllegalStage extends Schema.TaggedErrorClass<IllegalStage>()(
  "SelfImprovementLifecycleCoordinator.IllegalStage",
  { message: Schema.String },
) {}

export class Conflict extends Schema.TaggedErrorClass<Conflict>()("SelfImprovementLifecycleCoordinator.Conflict", {
  message: Schema.String,
}) {}

export interface LifecycleCommand {
  readonly locationID: SelfImprovementLifecycle.LocationID
  readonly artifactID: SelfImprovementLifecycle.ArtifactID
  readonly expectedRevision: SelfImprovementLifecycle.Revision
  readonly currentStage: SelfImprovementLifecycle.ArtifactStage | null
  readonly event: SelfImprovementLifecycle.LifecycleEvent
  readonly transition: SelfImprovementLifecycle.StageTransition
  readonly audit: SelfImprovementLearning.AuditEntry
  readonly idempotency: SelfImprovementApi.IdempotencyRecord
  readonly evaluationDecision?: SelfImprovementEvaluation.EvaluationDecision
  readonly atCutoff?: boolean
  readonly context?: {
    readonly desired: SelfImprovementLearning.ContextDesiredState
    readonly outbox: SelfImprovementLearning.ContextOutbox
  }
}

export type ArchiveCommand = Omit<LifecycleCommand, "event">
export interface TombstoneCommand {
  readonly locationID: SelfImprovementLifecycle.LocationID
  readonly artifactID: SelfImprovementLifecycle.ArtifactID
  readonly expectedRevision: SelfImprovementLifecycle.Revision
  readonly tombstone: SelfImprovementLifecycle.Tombstone
  readonly transitions: ReadonlyArray<SelfImprovementLifecycle.StageTransition>
  readonly removals: ReadonlyArray<{
    readonly desired: SelfImprovementLearning.ContextDesiredState
    readonly outbox: SelfImprovementLearning.ContextOutbox
  }>
  readonly audit: SelfImprovementLearning.AuditEntry
  readonly idempotency: SelfImprovementApi.IdempotencyRecord
}
export type ExpireCommand = Omit<LifecycleCommand, "event">

export interface LifecycleResult {
  readonly stage?: SelfImprovementLifecycle.ArtifactStage
  readonly pendingContext: boolean
}

export interface Interface {
  readonly transition: (
    command: LifecycleCommand,
    tx?: Transaction,
  ) => Effect.Effect<LifecycleResult, IllegalStage | Conflict>
  readonly archive: (command: ArchiveCommand) => Effect.Effect<LifecycleResult, IllegalStage | Conflict>
  readonly tombstone: (command: TombstoneCommand) => Effect.Effect<LifecycleResult, Conflict>
  readonly expireEphemeral: (
    command: ExpireCommand,
    tx?: Transaction,
  ) => Effect.Effect<LifecycleResult, IllegalStage | Conflict>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SelfImprovementLifecycleCoordinator") {}

export const LifecyclePolicy = {
  requiresContext(event: SelfImprovementLifecycle.LifecycleEvent) {
    return event === "approval-consumed" || event === "canary-regressed"
  },
  allowsMutation(finalizationBlocked: boolean) {
    return !finalizationBlocked
  },
  allowsTombstone(_finalizationBlocked: boolean) {
    return true
  },
  matchesArchiveTransitions(
    versionIDs: ReadonlyArray<string>,
    transitions: ReadonlyArray<{
      readonly versionID: string
      readonly event: SelfImprovementLifecycle.LifecycleEvent
      readonly nextStage: SelfImprovementLifecycle.ArtifactStage
    }>,
  ) {
    return (
      versionIDs.length === transitions.length &&
      new Set(versionIDs).size === versionIDs.length &&
      new Set(transitions.map((transition) => transition.versionID)).size === transitions.length &&
      transitions.every(
        (transition) =>
          versionIDs.includes(transition.versionID) &&
          transition.event === "artifact-tombstoned" &&
          transition.nextStage === "archived",
      )
    )
  },
  visibleStage(
    current: SelfImprovementLifecycle.ArtifactStage | null,
    next: SelfImprovementLifecycle.ArtifactStage,
    pendingContext: boolean,
  ): SelfImprovementLifecycle.ArtifactStage {
    return pendingContext ? (current ?? next) : next
  },
  matchesApprovalIntent(
    approvalID: SelfImprovementLifecycle.ApprovalID | string,
    intentApprovalID: SelfImprovementLifecycle.ApprovalID | string | undefined,
  ) {
    return intentApprovalID !== undefined && approvalID === intentApprovalID
  },
  matchesApprovalBinding(
    left: SelfImprovementLifecycle.ApprovalBinding,
    right: SelfImprovementLifecycle.ApprovalBinding,
  ) {
    return (
      left.versionID === right.versionID &&
      left.versionDigest === right.versionDigest &&
      left.suiteID === right.suiteID &&
      left.suiteRevision === right.suiteRevision &&
      left.evaluationRunID === right.evaluationRunID &&
      left.shadowEvidenceDigest === right.shadowEvidenceDigest
    )
  },
  matchesDesiredVersion(
    desiredVersionID: string,
    desiredVersionDigest: string,
    versionID: string,
    versionDigest: string,
  ) {
    return desiredVersionID === versionID && desiredVersionDigest === versionDigest
  },
  isCanaryRemoval(
    event: SelfImprovementLifecycle.LifecycleEvent,
    rolloutSlot: "shadow" | "canary" | "active",
    desiredState: "present" | "absent",
  ) {
    return event === "canary-regressed" && rolloutSlot === "canary" && desiredState === "absent"
  },
  isTerminalRemovalIntent(
    event: SelfImprovementLifecycle.LifecycleEvent,
    nextStage: SelfImprovementLifecycle.ArtifactStage,
    desiredState: "present" | "absent",
  ) {
    return event === "artifact-tombstoned" && nextStage === "archived" && desiredState === "absent"
  },
  nextStage(
    current: SelfImprovementLifecycle.ArtifactStage | null,
    event: SelfImprovementLifecycle.LifecycleEvent,
    options: { readonly decision?: "passed" | "failed"; readonly atCutoff?: boolean } = {},
  ): SelfImprovementLifecycle.ArtifactStage | undefined {
    if (current === "archived") return undefined
    if (event === "ephemeral-expired") return "archived"
    if (current === null && event === "version-admitted") return "draft"
    if (current === "draft" && event === "static-passed") return "experimental"
    if (current === "experimental" && event === "offline-passed") return "candidate"
    if (current === "candidate" && event === "shadow-started") return "shadow"
    if (current === "shadow" && event === "shadow-evidence-passed") {
      if (options.decision === "failed") return options.atCutoff ? "deprecated" : "shadow"
      return "canary"
    }
    if (current === "shadow" && event === "approval-consumed") return "canary"
    if (current === "canary" && event === "canary-passed") return "active"
    if (current === "canary" && event === "canary-regressed") return "deprecated"
    if (current === "active" && event === "version-superseded") return "deprecated"
    if (current === "deprecated" && event === "retention-archive") return "archived"
    return undefined
  },
}

const asConflict = (error: unknown) =>
  new Conflict({ message: error instanceof Error ? error.message : "Lifecycle mutation conflict" })

const matchesTransition = (
  left: SelfImprovementLifecycle.StageTransition,
  right: SelfImprovementLifecycle.StageTransition,
) =>
  left.id === right.id &&
  left.versionID === right.versionID &&
  left.previousStage === right.previousStage &&
  left.nextStage === right.nextStage &&
  left.event === right.event &&
  left.reason === right.reason &&
  left.actorID === right.actorID &&
  left.timestamp === right.timestamp &&
  left.evaluationRunID === right.evaluationRunID &&
  left.approvalID === right.approvalID &&
  left.rollbackID === right.rollbackID &&
  left.contextOutboxID === right.contextOutboxID &&
  left.idempotencyRecordID === right.idempotencyRecordID &&
  left.idempotencyDigest === right.idempotencyDigest

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const db = (yield* Database.Service).db
    const artifacts = yield* SelfImprovementArtifactStore.Service
    const audit = yield* SelfImprovementAuditStore.Service
    const context = yield* SelfImprovementContextStore.Service
    const idempotency = yield* SelfImprovementIdempotencyStore.Service
    const mutations = yield* SelfImprovementMutationStore.Service
    const transitions = yield* SelfImprovementTransitionStore.Service
    const mutex = KeyedMutex.makeUnsafe<SelfImprovementLifecycle.ArtifactID>()

    const transition = Effect.fn("SelfImprovementLifecycleCoordinator.transition")(function* (
      command: LifecycleCommand,
      tx?: Transaction,
    ) {
      return yield* mutex.withLock(command.artifactID)(
        Effect.gen(function* () {
          if (
            !LifecyclePolicy.allowsMutation(
              yield* context.hasBlockedForArtifact({ locationID: command.locationID, artifactID: command.artifactID }),
            )
          )
            return yield* new Conflict({ message: "Artifact finalization is blocked" })
          const artifact = yield* artifacts.getArtifact({
            locationID: command.locationID,
            artifactID: command.artifactID,
          })
          if (artifact === undefined) return yield* new Conflict({ message: "Artifact does not exist" })
          if (artifact.status === "tombstoned") return yield* new Conflict({ message: "Artifact is tombstoned" })
          const version = yield* artifacts.getVersion({
            locationID: command.locationID,
            versionID: command.transition.versionID,
          })
          if (version?.artifactID !== command.artifactID)
            return yield* new Conflict({ message: "Artifact version does not belong to artifact" })
          if (
            command.event === "ephemeral-expired" &&
            (version === undefined ||
              version.source !== "generated" ||
              version.behaviorClass !== "instruction-only" ||
              version.generated === undefined ||
              command.currentStage === "active")
          )
            return yield* new IllegalStage({
              message: "Only unpromoted generated instruction-only versions may expire",
            })
          const next = LifecyclePolicy.nextStage(command.currentStage, command.event, {
            decision: command.evaluationDecision?.decision,
            atCutoff: command.atCutoff,
          })
          if (next === undefined)
            return yield* new IllegalStage({ message: "Lifecycle event is not valid for the current stage" })
          if (next !== command.transition.nextStage || command.transition.previousStage !== command.currentStage)
            return yield* new IllegalStage({ message: "Transition does not match lifecycle policy" })

          const contextRequest = command.context
          if (LifecyclePolicy.requiresContext(command.event) && contextRequest === undefined)
            return yield* new Conflict({ message: "Lifecycle event requires reconciliation context" })
          const apply = (tx: Transaction) =>
            Effect.gen(function* () {
              const validRevision = yield* mutations.validateRevision(
                {
                  locationID: command.locationID,
                  artifactID: command.artifactID,
                  expectedRevision: command.expectedRevision,
                },
                tx,
              )
              if (!validRevision) return yield* new Conflict({ message: "Artifact revision changed" })
              if (
                !LifecyclePolicy.allowsMutation(
                  yield* context.hasBlockedForArtifact(
                    { locationID: command.locationID, artifactID: command.artifactID },
                    tx,
                  ),
                )
              )
                return yield* new Conflict({ message: "Artifact finalization is blocked" })
              const current = yield* transitions.currentStage(
                { locationID: command.locationID, versionID: command.transition.versionID },
                tx,
              )
              if ((current ?? null) !== command.currentStage)
                return yield* new Conflict({ message: "Artifact stage changed" })
              if (contextRequest) {
                if (
                  contextRequest.outbox.expectedArtifactRevision !== command.expectedRevision ||
                  contextRequest.outbox.expectedStage !== command.currentStage ||
                  contextRequest.outbox.intent.versionID !== command.transition.versionID ||
                  contextRequest.outbox.intent.previousStage !== command.transition.previousStage ||
                  contextRequest.outbox.intent.nextStage !== command.transition.nextStage ||
                  contextRequest.outbox.intent.event !== command.transition.event
                )
                  return yield* new Conflict({ message: "Context intent does not match transition" })
                if (
                  contextRequest.desired.desired.state === "present" &&
                  !LifecyclePolicy.matchesDesiredVersion(
                    contextRequest.desired.desired.versionID,
                    contextRequest.desired.desired.versionDigest,
                    version.id,
                    version.versionDigest,
                  )
                )
                  return yield* new Conflict({ message: "Context desired version does not match transition" })
                if (
                  command.event === "approval-consumed" &&
                  (command.transition.approvalID === undefined ||
                    command.transition.evaluationRunID === undefined ||
                    contextRequest.desired.rolloutSlot !== "canary" ||
                    contextRequest.desired.desired.state !== "present" ||
                    !LifecyclePolicy.matchesDesiredVersion(
                      contextRequest.desired.desired.versionID,
                      contextRequest.desired.desired.versionDigest,
                      version.id,
                      version.versionDigest,
                    ) ||
                    contextRequest.outbox.intent.approvalBinding === undefined ||
                    command.evaluationDecision?.approvalBinding === undefined ||
                    contextRequest.outbox.intent.evaluationRunID !== command.transition.evaluationRunID ||
                    contextRequest.outbox.intent.approvalBinding.evaluationRunID !==
                      command.transition.evaluationRunID ||
                    command.evaluationDecision.runID !== command.transition.evaluationRunID ||
                    !LifecyclePolicy.matchesApprovalIntent(
                      command.transition.approvalID,
                      contextRequest.outbox.intent.approvalID,
                    ) ||
                    !LifecyclePolicy.matchesApprovalBinding(
                      contextRequest.outbox.intent.approvalBinding,
                      command.evaluationDecision.approvalBinding,
                    ))
                )
                  return yield* new Conflict({ message: "Approval consumption requires its pending context intent" })
                if (command.event === "canary-regressed") {
                  const rollback = contextRequest.outbox.intent.rollback
                  const reward = contextRequest.outbox.intent.reward
                  if (
                    rollback === undefined ||
                    reward === undefined ||
                    rollback.locationID !== command.locationID ||
                    rollback.artifactID !== command.artifactID ||
                    rollback.candidateVersionID !== command.transition.versionID ||
                    rollback.canaryRunID !== command.transition.evaluationRunID ||
                    rollback.id !== command.transition.rollbackID ||
                    reward.id !== rollback.rewardEventID ||
                    reward.locationID !== command.locationID ||
                    reward.numericReward !== -1 ||
                    !LifecyclePolicy.isCanaryRemoval(
                      command.event,
                      contextRequest.desired.rolloutSlot,
                      contextRequest.desired.desired.state,
                    )
                  )
                    return yield* new Conflict({ message: "Canary regression requires a candidate-only rollback" })
                  const active = yield* context.desired(
                    { locationID: command.locationID, artifactID: command.artifactID, rolloutSlot: "active" },
                    tx,
                  )
                  if (
                    active?.desired.state !== "present" ||
                    active.desired.versionID !== rollback.retainedActiveVersionID
                  )
                    return yield* new Conflict({
                      message: "Canary rollback retained active version does not match context",
                    })
                }
                yield* idempotency.put({ locationID: command.locationID, record: command.idempotency }, tx)
                yield* context.request(contextRequest.desired, contextRequest.outbox, tx)
                yield* audit.append({ locationID: command.locationID, entry: command.audit }, tx)
                return {
                  stage: LifecyclePolicy.visibleStage(command.currentStage, next, true),
                  pendingContext: true,
                }
              }
              const revised = yield* mutations.compareAndSetRevision(
                {
                  locationID: command.locationID,
                  artifactID: command.artifactID,
                  expectedRevision: command.expectedRevision,
                  nextRevision: SelfImprovementLifecycle.Revision.make(command.expectedRevision + 1),
                },
                tx,
              )
              if (!revised) return yield* new Conflict({ message: "Artifact revision changed" })
              yield* idempotency.put({ locationID: command.locationID, record: command.idempotency }, tx)
              yield* transitions.append({ locationID: command.locationID, transition: command.transition }, tx)
              yield* audit.append({ locationID: command.locationID, entry: command.audit }, tx)
              return { stage: next, pendingContext: false }
            })
          return yield* (tx ? apply(tx) : db.transaction(apply)).pipe(Effect.mapError(asConflict))
        }),
      )
    })

    const archive = Effect.fn("SelfImprovementLifecycleCoordinator.archive")(function* (command: ArchiveCommand) {
      return yield* transition({ ...command, event: "retention-archive" })
    })

    const expireEphemeral = Effect.fn("SelfImprovementLifecycleCoordinator.expireEphemeral")(function* (
      command: ExpireCommand,
      tx?: Transaction,
    ) {
      return yield* transition({ ...command, event: "ephemeral-expired" }, tx)
    })

    const tombstone = Effect.fn("SelfImprovementLifecycleCoordinator.tombstone")(function* (command: TombstoneCommand) {
      return yield* mutex.withLock(command.artifactID)(
        Effect.gen(function* () {
          const artifact = yield* artifacts.getArtifact({
            locationID: command.locationID,
            artifactID: command.artifactID,
          })
          if (artifact === undefined) return yield* new Conflict({ message: "Artifact does not exist" })
          const versions = yield* artifacts.listVersions({
            locationID: command.locationID,
            artifactID: command.artifactID,
          })
          if (
            !LifecyclePolicy.matchesArchiveTransitions(
              versions.map((version) => version.id),
              command.transitions,
            )
          )
            return yield* new Conflict({ message: "Tombstone must archive every artifact version exactly once" })
          return yield* db
            .transaction((tx) =>
              Effect.gen(function* () {
                yield* context.supersedeForArtifact(
                  { locationID: command.locationID, artifactID: command.artifactID },
                  tx,
                )
                const updated = yield* mutations.tombstone(
                  {
                    locationID: command.locationID,
                    artifactID: command.artifactID,
                    expectedRevision: command.expectedRevision,
                    tombstone: command.tombstone,
                  },
                  tx,
                )
                if (updated === undefined) return yield* new Conflict({ message: "Artifact revision changed" })
                const transitionsByVersion = new Map(
                  command.transitions.map((transition) => [transition.versionID, transition]),
                )
                for (const transition of command.transitions) {
                  const current = yield* transitions.currentStage(
                    { locationID: command.locationID, versionID: transition.versionID },
                    tx,
                  )
                  if ((current ?? null) !== transition.previousStage)
                    return yield* new Conflict({ message: "Artifact version stage changed" })
                }
                if (updated.slots.length === 0) {
                  if (command.removals.length !== 0)
                    return yield* new Conflict({ message: "Tombstone without slots cannot request removals" })
                  for (const transition of command.transitions)
                    yield* transitions.append({ locationID: command.locationID, transition }, tx)
                  if (
                    !(yield* mutations.clearTombstonedSlots(
                      {
                        locationID: command.locationID,
                        artifactID: command.artifactID,
                        expectedRevision: updated.revision,
                      },
                      tx,
                    ))
                  )
                    return yield* new Conflict({ message: "Tombstoned artifact revision changed" })
                  yield* idempotency.put({ locationID: command.locationID, record: command.idempotency }, tx)
                  yield* audit.append({ locationID: command.locationID, entry: command.audit }, tx)
                  return { stage: "archived" as const, pendingContext: false }
                }
                if (command.removals.length !== updated.slots.length)
                  return yield* new Conflict({ message: "Tombstone removals do not match captured slots" })
                const removalBySlot = new Map(command.removals.map((removal) => [removal.desired.rolloutSlot, removal]))
                if (removalBySlot.size !== updated.slots.length)
                  return yield* new Conflict({ message: "Tombstone removals do not match captured slots" })
                const terminalGroup = command.removals[0]?.outbox.intent.terminalGroup
                if (
                  terminalGroup === undefined ||
                  terminalGroup.removalOutboxIDs.length !== command.removals.length ||
                  new Set(terminalGroup.removalOutboxIDs).size !== command.removals.length ||
                  !LifecyclePolicy.matchesArchiveTransitions(
                    command.transitions.map((transition) => transition.versionID),
                    terminalGroup.archiveTransitions,
                  ) ||
                  terminalGroup.archiveTransitions.some((transition, index) => {
                    const commandTransition = command.transitions[index]
                    return commandTransition === undefined || !matchesTransition(transition, commandTransition)
                  }) ||
                  terminalGroup.removals?.length !== command.removals.length
                )
                  return yield* new Conflict({ message: "Tombstone terminal group does not match command" })
                for (const slot of updated.slots) {
                  const removal = removalBySlot.get(slot.slot)
                  const version = versions.find((version) => version.id === slot.versionID)
                  const transition = transitionsByVersion.get(slot.versionID)
                  const snapshot = terminalGroup.removals?.find((snapshot) => snapshot.outboxID === removal?.outbox.id)
                  if (
                    removal === undefined ||
                    version === undefined ||
                    transition === undefined ||
                    snapshot === undefined ||
                    removal.desired.locationID !== command.locationID ||
                    removal.desired.artifactID !== command.artifactID ||
                    removal.desired.rolloutSlot !== slot.slot ||
                    removal.desired.desired.state !== "absent" ||
                    removal.desired.desiredRevision !== updated.revision ||
                    removal.outbox.locationID !== command.locationID ||
                    removal.outbox.artifactID !== command.artifactID ||
                    removal.outbox.expectedArtifactRevision !== updated.revision ||
                    removal.outbox.expectedStage !== transition.previousStage ||
                    removal.outbox.intent.versionID !== slot.versionID ||
                    removal.outbox.intent.previousStage !== transition.previousStage ||
                    removal.outbox.intent.nextStage !== "archived" ||
                    removal.outbox.intent.event !== "artifact-tombstoned" ||
                    removal.outbox.intent.idempotencyRecordID !== command.idempotency.id ||
                    removal.outbox.intent.idempotencyDigest !== command.idempotency.requestDigest ||
                    transition.contextOutboxID !== removal.outbox.id ||
                    transition.idempotencyRecordID !== command.idempotency.id ||
                    transition.idempotencyDigest !== command.idempotency.requestDigest ||
                    removal.outbox.intent.terminalGroup === undefined ||
                    removal.outbox.intent.terminalGroup.removalOutboxIDs.join(",") !==
                      terminalGroup.removalOutboxIDs.join(",") ||
                    snapshot.rolloutSlot !== slot.slot ||
                    snapshot.versionDigest !== version.versionDigest ||
                    snapshot.slotRevision !== slot.artifactRevision
                  )
                    return yield* new Conflict({ message: "Tombstone removal intent does not match captured slot" })
                }
                if (
                  !command.removals.every((removal) => terminalGroup.removalOutboxIDs.includes(removal.outbox.id)) ||
                  !command.removals.every((removal) => {
                    const group = removal.outbox.intent.terminalGroup
                    return (
                      group !== undefined &&
                      group.removalOutboxIDs.join(",") === terminalGroup.removalOutboxIDs.join(",") &&
                      group.archiveTransitions.length === command.transitions.length &&
                      group.archiveTransitions.every((transition, index) => {
                        const commandTransition = command.transitions[index]
                        return commandTransition !== undefined && matchesTransition(transition, commandTransition)
                      }) &&
                      group.removals?.length === terminalGroup.removals?.length &&
                      group.removals?.every(
                        (snapshot, index) =>
                          snapshot.outboxID === terminalGroup.removals?.[index]?.outboxID &&
                          snapshot.rolloutSlot === terminalGroup.removals?.[index]?.rolloutSlot &&
                          snapshot.versionDigest === terminalGroup.removals?.[index]?.versionDigest &&
                          snapshot.slotRevision === terminalGroup.removals?.[index]?.slotRevision,
                      )
                    )
                  })
                )
                  return yield* new Conflict({ message: "Tombstone terminal group peers do not match" })
                for (const removal of command.removals) yield* context.request(removal.desired, removal.outbox, tx)
                yield* idempotency.put({ locationID: command.locationID, record: command.idempotency }, tx)
                yield* audit.append({ locationID: command.locationID, entry: command.audit }, tx)
                return { pendingContext: true }
              }),
            )
            .pipe(Effect.mapError(asConflict))
        }),
      )
    })

    return Service.of({ transition, archive, tombstone, expireEphemeral })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [
    Database.node,
    SelfImprovementArtifactStore.node,
    SelfImprovementAuditStore.node,
    SelfImprovementContextStore.node,
    SelfImprovementIdempotencyStore.node,
    SelfImprovementMutationStore.node,
    SelfImprovementTransitionStore.node,
    SelfImprovementContextReconciler.node,
  ],
})
