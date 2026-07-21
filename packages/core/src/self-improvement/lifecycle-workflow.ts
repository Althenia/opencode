export * as SelfImprovementLifecycleWorkflow from "./lifecycle-workflow"

import { Context, Effect, Layer, Schema } from "effect"
import {
  SelfImprovement,
  SelfImprovementApi,
  SelfImprovementEvaluation,
  SelfImprovementLearning,
  SelfImprovementLifecycle,
} from "@opencode-ai/schema"
import { makeLocationNode } from "../effect/app-node"
import { Hash } from "../util/hash"
import { SelfImprovementArtifactStore } from "./artifact-store"
import { SelfImprovementApprovalStore } from "./approval-store"
import { SelfImprovementAuditStore } from "./audit-store"
import { SelfImprovementContextStore, type Transaction } from "./context-store"
import { SelfImprovementEvaluationStore } from "./evaluation-store"
import { SelfImprovementIdempotencyStore } from "./idempotency-store"
import { SelfImprovementLearningStore } from "./learning-store"
import { SelfImprovementLifecycleCoordinator } from "./lifecycle-coordinator"
import { SelfImprovementTransitionStore } from "./transition-store"

const retentionMs = 30 * 86_400_000

export class Conflict extends Schema.TaggedErrorClass<Conflict>()("SelfImprovementLifecycleWorkflow.Conflict", {
  message: Schema.String,
}) {}

export interface PrepareShadowInput {
  readonly locationID: SelfImprovementLifecycle.LocationID
  readonly principal: SelfImprovementLifecycle.Principal
  readonly artifactID: SelfImprovementLifecycle.ArtifactID
  readonly versionID: SelfImprovementLifecycle.ArtifactVersionID
  readonly now: SelfImprovementLifecycle.TimestampMillis
  readonly idempotencyKey: SelfImprovementLearning.IdempotencyKey
}

export interface ApplyDecisionInput {
  readonly locationID: SelfImprovementLifecycle.LocationID
  readonly principal: SelfImprovementLifecycle.Principal
  readonly runID: SelfImprovementLifecycle.EvaluationRunID
  readonly now: SelfImprovementLifecycle.TimestampMillis
  readonly idempotencyKey: SelfImprovementLearning.IdempotencyKey
}

export interface ApprovalLifecycleInput {
  readonly locationID: SelfImprovementLifecycle.LocationID
  readonly principal: SelfImprovementLifecycle.Principal
  readonly approvalID: SelfImprovementLifecycle.ApprovalID
  readonly now: SelfImprovementLifecycle.TimestampMillis
  readonly idempotencyKey: SelfImprovementLearning.IdempotencyKey
}

export interface Interface {
  readonly prepareShadow: (input: PrepareShadowInput) => Effect.Effect<{ stage: "shadow"; replayed: boolean }, Conflict>
  readonly applyDecision: (input: ApplyDecisionInput, tx?: Transaction) => Effect.Effect<void, Conflict>
  readonly consumeApproval: (
    input: ApprovalLifecycleInput,
    tx?: Transaction,
  ) => Effect.Effect<{ replayed: boolean }, Conflict>
  readonly rejectApproval: (
    input: ApprovalLifecycleInput,
    tx?: Transaction,
  ) => Effect.Effect<{ replayed: boolean }, Conflict>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SelfImprovementLifecycleWorkflow") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const artifacts = yield* SelfImprovementArtifactStore.Service
    const approvals = yield* SelfImprovementApprovalStore.Service
    const context = yield* SelfImprovementContextStore.Service
    const evaluation = yield* SelfImprovementEvaluationStore.Service
    const idempotency = yield* SelfImprovementIdempotencyStore.Service
    const learning = yield* SelfImprovementLearningStore.Service
    const lifecycle = yield* SelfImprovementLifecycleCoordinator.Service
    const transitions = yield* SelfImprovementTransitionStore.Service

    const prepareShadow = Effect.fn("SelfImprovementLifecycleWorkflow.prepareShadow")(function* (
      input: PrepareShadowInput,
    ) {
      if (input.principal.kind !== "coordinator" || input.principal.locationID !== input.locationID)
        return yield* new Conflict({ message: "Prepare shadow requires a coordinator for the target Location" })
      const artifact = yield* artifacts.getArtifact({ locationID: input.locationID, artifactID: input.artifactID })
      if (artifact === undefined)
        return yield* new Conflict({ message: "Artifact does not exist at the target Location" })
      if (artifact.status === "tombstoned") return yield* new Conflict({ message: "Artifact is tombstoned" })
      const version = yield* artifacts.getVersion({ locationID: input.locationID, versionID: input.versionID })
      if (version?.artifactID !== artifact.id)
        return yield* new Conflict({ message: "Artifact version does not belong to artifact at the target Location" })

      const events = ["static-passed", "offline-passed", "shadow-started"] as const
      const stages = ["draft", "experimental", "candidate"] as const
      let revision = artifact.revision
      let replayed = true
      const stage =
        (yield* transitions.currentStage({ locationID: input.locationID, versionID: input.versionID })) ?? null
      if (stage === "shadow") return { stage: "shadow" as const, replayed }
      const start = stages.indexOf(stage as (typeof stages)[number])
      if (start === -1) return yield* new Conflict({ message: "Artifact version is not ready for shadow" })
      for (const [offset, event] of events.slice(start).entries()) {
        const index = start + offset
        const current =
          (yield* transitions.currentStage({ locationID: input.locationID, versionID: input.versionID })) ?? null
        if (current === "shadow") break
        if (current !== stages[index])
          return yield* new Conflict({ message: "Artifact version is not ready for shadow" })
        const key = SelfImprovementLearning.IdempotencyKey.make(
          Hash.sha256(`prepare-shadow/key/v1\0${input.idempotencyKey}\0${event}`),
        )
        const identity = new SelfImprovementLearning.IdempotencyIdentity({
          principalID: input.principal.id,
          locationID: input.locationID,
          operation: "lifecycle.transition",
          key,
        })
        const requestDigest = SelfImprovement.Digest.make(
          Hash.sha256(
            `prepare-shadow/request/v1\0${input.locationID}\0${input.principal.id}\0${input.artifactID}\0${input.versionID}\0${event}`,
          ),
        )
        const existing = yield* idempotency.get({ locationID: input.locationID, identity })
        if (existing !== undefined) {
          if (existing.requestDigest !== requestDigest)
            return yield* new Conflict({ message: "Idempotency key was used with a different prepare-shadow request" })
          continue
        }
        const next = ["experimental", "candidate", "shadow"] as const
        const record = {
          id: SelfImprovementLifecycle.IdempotencyRecordID.create(),
          identity,
          requestDigest,
          storedBodyDigest: SelfImprovement.Digest.make(Hash.sha256(`prepare-shadow/response/v1\0${requestDigest}`)),
          storedResponse: {
            status: 200 as const,
            body: {
              status: "completed" as const,
              artifactRevision: SelfImprovementLifecycle.Revision.make(Number(revision) + 1),
              transition: new SelfImprovementLifecycle.StageTransition({
                id: SelfImprovementLifecycle.StageTransitionID.create(),
                versionID: input.versionID,
                previousStage: current,
                nextStage: next[index],
                event,
                reason: "gates-passed",
                actorID: input.principal.id,
                timestamp: input.now,
                idempotencyRecordID: SelfImprovementLifecycle.IdempotencyRecordID.create(),
                idempotencyDigest: requestDigest,
              }),
            },
          },
          createdAt: input.now,
          expiresAt: SelfImprovementLifecycle.TimestampMillis.make(Number(input.now) + retentionMs),
        } satisfies SelfImprovementApi.IdempotencyRecord
        const transition = new SelfImprovementLifecycle.StageTransition({
          id: record.storedResponse.body.transition.id,
          versionID: input.versionID,
          previousStage: current,
          nextStage: next[index],
          event,
          reason: "gates-passed",
          actorID: input.principal.id,
          timestamp: input.now,
          idempotencyRecordID: record.id,
          idempotencyDigest: requestDigest,
        })
        yield* lifecycle
          .transition({
            locationID: input.locationID,
            artifactID: input.artifactID,
            expectedRevision: revision,
            currentStage: current,
            event,
            transition,
            audit: new SelfImprovementLearning.AuditEntry({
              id: SelfImprovementLifecycle.AuditEntryID.create(),
              locationID: input.locationID,
              eventType: `lifecycle.${event}`,
              actorID: input.principal.id,
              payload: new SelfImprovementLearning.AuditPayload({
                artifactID: input.artifactID,
                versionID: input.versionID,
                linkedDigests: [requestDigest, version.versionDigest],
                rejectedFieldNames: [],
              }),
              timestamp: input.now,
              retention: new SelfImprovementLearning.GovernedMetadataRetention({ createdAt: input.now }),
            }),
            idempotency: record,
          })
          .pipe(Effect.mapError((error) => new Conflict({ message: error.message })))
        revision = SelfImprovementLifecycle.Revision.make(Number(revision) + 1)
        replayed = false
      }
      return { stage: "shadow" as const, replayed }
    })

    const applyDecision = Effect.fn("SelfImprovementLifecycleWorkflow.applyDecision")(function* (
      input: ApplyDecisionInput,
      tx?: Transaction,
    ) {
      if (input.principal.kind !== "evaluator" || input.principal.locationID !== input.locationID)
        return yield* new Conflict({ message: "Apply decision requires an evaluator for the target Location" })
      const run = yield* evaluation.getRun(input.locationID, input.runID, tx)
      const decision = yield* evaluation.getDecision(input.locationID, input.runID, tx)
      if (run?.state !== "decided" || decision === undefined || decision.runID !== input.runID)
        return yield* new Conflict({ message: "Evaluation run does not have a persisted decision" })
      const version = yield* artifacts.getVersion({ locationID: input.locationID, versionID: run.versionID }, tx)
      if (version === undefined)
        return yield* new Conflict({ message: "Evaluation version does not exist at the target Location" })
      const artifact = yield* artifacts.getArtifact(
        { locationID: input.locationID, artifactID: version.artifactID },
        tx,
      )
      if (artifact === undefined || artifact.status === "tombstoned")
        return yield* new Conflict({ message: "Evaluation artifact does not exist at the target Location" })
      const stage = yield* transitions.currentStage({ locationID: input.locationID, versionID: version.id }, tx)
      if (stage !== run.stage)
        return yield* new Conflict({ message: "Evaluation run stage no longer matches the version" })
      if (
        decision.findings.some((finding) => finding.gateID === "minimum-samples-present" && finding.result === "fail")
      )
        return undefined

      const approvalRequired = version.source === "generated" && version.behaviorClass !== "instruction-only"
      const approvalPending =
        stage === "shadow" &&
        approvalRequired &&
        decision.aggregateReward > 0 &&
        decision.findings.some(
          (finding) => finding.gateID === "required-approval-present" && finding.result === "fail",
        ) &&
        decision.findings.every(
          (finding) => finding.gateID === "required-approval-present" || finding.result !== "fail",
        )
      if (approvalPending) {
        yield* approvals
          .request(
            new SelfImprovementLifecycle.ApprovalRequest({
              id: SelfImprovementLifecycle.ApprovalRequestID.create(),
              locationID: input.locationID,
              binding: new SelfImprovementLifecycle.ApprovalBinding({
                versionID: version.id,
                versionDigest: version.versionDigest,
                suiteID: run.suiteID,
                suiteRevision: run.suiteRevision,
                evaluationRunID: run.id,
                shadowEvidenceDigest: decision.cutoffSampleSetDigest,
              }),
              creatorID: input.principal.id,
              requestedAt: input.now,
            }),
            tx,
          )
          .pipe(Effect.mapError((error) => new Conflict({ message: error.message })))
        return undefined
      }
      if (stage === "shadow" && decision.decision === "failed" && input.now < run.cutoffAt) return undefined
      const event =
        stage === "shadow"
          ? "shadow-evidence-passed"
          : stage === "canary"
            ? decision.decision === "passed"
              ? "canary-passed"
              : "canary-regressed"
            : undefined
      if (event === undefined)
        return yield* new Conflict({ message: "Evaluation run stage is not eligible for lifecycle application" })
      const next = SelfImprovementLifecycleWorkflowNextStage(stage, event, decision.decision, input.now >= run.cutoffAt)
      if (next === undefined)
        return yield* new Conflict({ message: "Evaluation decision cannot advance the lifecycle" })
      const pull =
        event === "canary-passed" || event === "canary-regressed"
          ? yield* learning.modelRoutePullForVersion(input.locationID, version.id, tx)
          : undefined
      if ((event === "canary-passed" || event === "canary-regressed") && pull === undefined)
        return yield* new Conflict({ message: "Canary decision has no matching model route pull" })
      const active =
        event === "canary-passed" || event === "canary-regressed"
          ? yield* context.desired({ locationID: input.locationID, artifactID: artifact.id, rolloutSlot: "active" }, tx)
          : undefined
      const activeVersion = active?.desired.state === "present" ? active.desired.versionID : undefined
      if (event === "canary-regressed" && activeVersion === undefined)
        return yield* new Conflict({ message: "Canary regression requires a retained active version" })
      const requestDigest = SelfImprovement.Digest.make(
        Hash.sha256(`apply-decision/v1\0${input.locationID}\0${input.runID}\0${input.idempotencyKey}\0${event}`),
      )
      const record = {
        id: SelfImprovementLifecycle.IdempotencyRecordID.create(),
        identity: new SelfImprovementLearning.IdempotencyIdentity({
          principalID: input.principal.id,
          locationID: input.locationID,
          operation: "lifecycle.transition",
          key: input.idempotencyKey,
        }),
        requestDigest,
        storedBodyDigest: SelfImprovement.Digest.make(Hash.sha256(`apply-decision/response/v1\0${requestDigest}`)),
        storedResponse: {
          status: 200 as const,
          body: {
            status: "completed" as const,
            artifactRevision: SelfImprovementLifecycle.Revision.make(artifact.revision + 1),
            transition: new SelfImprovementLifecycle.StageTransition({
              id: SelfImprovementLifecycle.StageTransitionID.create(),
              versionID: version.id,
              previousStage: stage,
              nextStage: next,
              event,
              reason: decision.decision === "passed" ? "gates-passed" : "gates-failed",
              actorID: input.principal.id,
              timestamp: input.now,
              evaluationRunID: run.id,
              idempotencyRecordID: SelfImprovementLifecycle.IdempotencyRecordID.create(),
              idempotencyDigest: requestDigest,
            }),
          },
        },
        createdAt: input.now,
        expiresAt: SelfImprovementLifecycle.TimestampMillis.make(input.now + retentionMs),
      } satisfies SelfImprovementApi.IdempotencyRecord
      const reward =
        event === "canary-passed" && pull
          ? new SelfImprovementLearning.RewardEvent({
              id: SelfImprovementLifecycle.RewardEventID.create(),
              locationID: input.locationID,
              pullEventID: pull.id,
              outcomeClass: "passing-evidence",
              numericReward: 1,
              evidenceDigest: decision.cutoffSampleSetDigest,
              timestamp: input.now,
            })
          : undefined
      const rollback =
        event === "canary-regressed" && pull && activeVersion
          ? new SelfImprovementLifecycle.Rollback({
              id: SelfImprovementLifecycle.RollbackID.create(),
              locationID: input.locationID,
              artifactID: artifact.id,
              candidateVersionID: version.id,
              retainedActiveVersionID: activeVersion,
              canaryRunID: run.id,
              reason: "canary-regression",
              rewardEventID: SelfImprovementLifecycle.RewardEventID.create(),
              timestamp: input.now,
            })
          : undefined
      const regressionReward =
        rollback && pull
          ? new SelfImprovementLearning.RewardEvent({
              id: rollback.rewardEventID,
              locationID: input.locationID,
              pullEventID: pull.id,
              outcomeClass: "canary-regression",
              numericReward: -1,
              evidenceDigest: decision.cutoffSampleSetDigest,
              timestamp: input.now,
            })
          : undefined
      const contextRequest =
        event === "canary-passed" || event === "canary-regressed"
          ? decisionContext({
              locationID: input.locationID,
              artifactID: artifact.id,
              version,
              artifactRevision: artifact.revision,
              stage,
              event,
              next,
              principal: input.principal,
              runID: run.id,
              record,
              now: input.now,
              ...(event === "canary-passed" && activeVersion !== undefined && activeVersion !== version.id
                ? { supersededVersionID: activeVersion }
                : {}),
              ...(reward ? { reward } : rollback && regressionReward ? { rollback, reward: regressionReward } : {}),
            })
          : undefined
      const transition = new SelfImprovementLifecycle.StageTransition({
        ...record.storedResponse.body.transition,
        idempotencyRecordID: record.id,
        ...(rollback === undefined ? {} : { rollbackID: rollback.id }),
        ...(contextRequest === undefined ? {} : { contextOutboxID: contextRequest.outbox.id }),
      })
      yield* lifecycle
        .transition(
          {
            locationID: input.locationID,
            artifactID: artifact.id,
            expectedRevision: artifact.revision,
            currentStage: stage,
            event,
            transition,
            evaluationDecision: decision,
            atCutoff: input.now >= run.cutoffAt,
            idempotency: record,
            ...(contextRequest === undefined ? {} : { context: contextRequest }),
            audit: new SelfImprovementLearning.AuditEntry({
              id: SelfImprovementLifecycle.AuditEntryID.create(),
              locationID: input.locationID,
              eventType: `lifecycle.${event}`,
              actorID: input.principal.id,
              payload: new SelfImprovementLearning.AuditPayload({
                artifactID: artifact.id,
                versionID: version.id,
                evaluationRunID: run.id,
                ...(pull === undefined ? {} : { pullEventID: pull.id }),
                ...(reward === undefined ? {} : { rewardEventID: reward.id }),
                linkedDigests: [decision.cutoffSampleSetDigest, version.versionDigest],
                rejectedFieldNames: [],
              }),
              timestamp: input.now,
              retention: new SelfImprovementLearning.GovernedMetadataRetention({ createdAt: input.now }),
            }),
          },
          tx,
        )
        .pipe(Effect.mapError((error) => new Conflict({ message: error.message })))
    })

    const consumeApproval = Effect.fn("SelfImprovementLifecycleWorkflow.consumeApproval")(function* (
      input: ApprovalLifecycleInput,
      tx?: Transaction,
    ) {
      if (input.principal.locationID !== input.locationID)
        return yield* new Conflict({ message: "Approval consumption requires a principal for the target Location" })
      const identity = new SelfImprovementLearning.IdempotencyIdentity({
        principalID: input.principal.id,
        locationID: input.locationID,
        operation: "lifecycle.transition",
        key: input.idempotencyKey,
      })
      const requestDigest = SelfImprovement.Digest.make(
        Hash.sha256(`consume-approval/v1\0${input.locationID}\0${input.approvalID}\0${input.idempotencyKey}`),
      )
      const existing = yield* idempotency.get({ locationID: input.locationID, identity })
      if (existing !== undefined) {
        if (existing.requestDigest !== requestDigest)
          return yield* new Conflict({ message: "Idempotency key was used with a different approval consumption" })
        return { replayed: true }
      }
      const approval = yield* approvals.get({ locationID: input.locationID, approvalID: input.approvalID }, tx)
      if (approval === undefined)
        return yield* new Conflict({ message: "Approval does not exist at the target Location" })
      if (approval.decision._tag !== "approved") return yield* new Conflict({ message: "Approval was rejected" })
      if (approval.decision.consumedAt !== undefined)
        return yield* new Conflict({ message: "Approval has already been consumed" })
      if (input.now > approval.decision.expiresAt)
        return yield* new Conflict({
          message: "Approval expired; new shadow evidence and approval request are required",
        })
      const run = yield* evaluation.getRun(input.locationID, approval.binding.evaluationRunID, tx)
      const decision = yield* evaluation.getDecision(input.locationID, approval.binding.evaluationRunID, tx)
      if (
        run?.state !== "decided" ||
        decision?.decision !== "passed" ||
        run.versionID !== approval.binding.versionID ||
        run.suiteID !== approval.binding.suiteID ||
        run.suiteRevision !== approval.binding.suiteRevision ||
        decision.cutoffSampleSetDigest !== approval.binding.shadowEvidenceDigest
      )
        return yield* new Conflict({ message: "Approval no longer matches passed shadow evidence" })
      const version = yield* artifacts.getVersion(
        { locationID: input.locationID, versionID: approval.binding.versionID },
        tx,
      )
      if (version === undefined || version.versionDigest !== approval.binding.versionDigest)
        return yield* new Conflict({ message: "Approval version does not exist at the target Location" })
      const artifact = yield* artifacts.getArtifact(
        { locationID: input.locationID, artifactID: version.artifactID },
        tx,
      )
      if (artifact === undefined || artifact.status === "tombstoned")
        return yield* new Conflict({ message: "Approval artifact does not exist at the target Location" })
      const stage = yield* transitions.currentStage({ locationID: input.locationID, versionID: version.id }, tx)
      if (stage !== "shadow")
        return yield* new Conflict({ message: "Approval version is no longer awaiting shadow approval" })
      const outboxID = SelfImprovementLifecycle.ContextOutboxID.create()
      const transitionID = SelfImprovementLifecycle.StageTransitionID.create()
      const record = {
        id: SelfImprovementLifecycle.IdempotencyRecordID.create(),
        identity,
        requestDigest,
        storedBodyDigest: SelfImprovement.Digest.make(Hash.sha256(`consume-approval/response/v1\0${requestDigest}`)),
        storedResponse: {
          status: 200 as const,
          body: {
            status: "completed" as const,
            artifactRevision: SelfImprovementLifecycle.Revision.make(artifact.revision + 1),
            transition: new SelfImprovementLifecycle.StageTransition({
              id: transitionID,
              versionID: version.id,
              previousStage: stage,
              nextStage: "canary",
              event: "approval-consumed",
              reason: "gates-passed",
              actorID: input.principal.id,
              timestamp: input.now,
              evaluationRunID: run.id,
              approvalID: approval.id,
              contextOutboxID: outboxID,
              idempotencyRecordID: SelfImprovementLifecycle.IdempotencyRecordID.create(),
              idempotencyDigest: requestDigest,
            }),
          },
        },
        createdAt: input.now,
        expiresAt: SelfImprovementLifecycle.TimestampMillis.make(input.now + retentionMs),
      } satisfies SelfImprovementApi.IdempotencyRecord
      const contextRequest = approvalContext({
        locationID: input.locationID,
        artifactID: artifact.id,
        artifactRevision: artifact.revision,
        version,
        principal: input.principal,
        approval,
        record,
        now: input.now,
        outboxID,
      })
      const transition = new SelfImprovementLifecycle.StageTransition({
        ...record.storedResponse.body.transition,
        idempotencyRecordID: record.id,
      })
      yield* lifecycle
        .transition(
          {
            locationID: input.locationID,
            artifactID: artifact.id,
            expectedRevision: artifact.revision,
            currentStage: stage,
            event: "approval-consumed",
            transition,
            evaluationDecision: new SelfImprovementEvaluation.EvaluationDecision({
              ...decision,
              approvalBinding: approval.binding,
            }),
            context: contextRequest,
            idempotency: record,
            audit: new SelfImprovementLearning.AuditEntry({
              id: SelfImprovementLifecycle.AuditEntryID.create(),
              locationID: input.locationID,
              eventType: "lifecycle.approval-consumed",
              actorID: input.principal.id,
              payload: new SelfImprovementLearning.AuditPayload({
                artifactID: artifact.id,
                versionID: version.id,
                evaluationRunID: run.id,
                contextOutboxID: contextRequest.outbox.id,
                linkedDigests: [approval.binding.shadowEvidenceDigest, version.versionDigest],
                rejectedFieldNames: [],
              }),
              timestamp: input.now,
              retention: new SelfImprovementLearning.GovernedMetadataRetention({ createdAt: input.now }),
            }),
          },
          tx,
        )
        .pipe(Effect.mapError((error) => new Conflict({ message: error.message })))
      return { replayed: false }
    })

    const rejectApproval = Effect.fn("SelfImprovementLifecycleWorkflow.rejectApproval")(function* (
      input: ApprovalLifecycleInput,
      tx?: Transaction,
    ) {
      if (input.principal.locationID !== input.locationID)
        return yield* new Conflict({ message: "Approval rejection requires a principal for the target Location" })
      const identity = new SelfImprovementLearning.IdempotencyIdentity({
        principalID: input.principal.id,
        locationID: input.locationID,
        operation: "lifecycle.transition",
        key: input.idempotencyKey,
      })
      const requestDigest = SelfImprovement.Digest.make(
        Hash.sha256(`reject-approval/v1\0${input.locationID}\0${input.approvalID}\0${input.idempotencyKey}`),
      )
      const existing = yield* idempotency.get({ locationID: input.locationID, identity })
      if (existing !== undefined) {
        if (existing.requestDigest !== requestDigest)
          return yield* new Conflict({ message: "Idempotency key was used with a different approval rejection" })
        return { replayed: true }
      }
      const approval = yield* approvals.get({ locationID: input.locationID, approvalID: input.approvalID }, tx)
      if (approval === undefined)
        return yield* new Conflict({ message: "Approval does not exist at the target Location" })
      if (approval.decision._tag !== "rejected") return yield* new Conflict({ message: "Approval was not rejected" })
      const version = yield* artifacts.getVersion(
        { locationID: input.locationID, versionID: approval.binding.versionID },
        tx,
      )
      if (version === undefined || version.versionDigest !== approval.binding.versionDigest)
        return yield* new Conflict({ message: "Approval version does not exist at the target Location" })
      if (version.source !== "generated")
        return yield* new Conflict({ message: "Approval rejection applies only to generated versions" })
      const artifact = yield* artifacts.getArtifact(
        { locationID: input.locationID, artifactID: version.artifactID },
        tx,
      )
      if (artifact === undefined || artifact.status === "tombstoned")
        return yield* new Conflict({ message: "Approval artifact does not exist at the target Location" })
      const stage = yield* transitions.currentStage({ locationID: input.locationID, versionID: version.id }, tx)
      if (stage === null || stage === undefined || stage === "archived")
        return yield* new Conflict({ message: "Approval version is not eligible for rejection policy" })
      const event = version.behaviorClass === "instruction-only" ? "ephemeral-expired" : "shadow-evidence-passed"
      const nextStage = version.behaviorClass === "instruction-only" ? "archived" : "deprecated"
      if (version.behaviorClass !== "instruction-only" && stage !== "shadow")
        return yield* new Conflict({ message: "Generated approval rejection requires the version to remain in shadow" })
      const transitionID = SelfImprovementLifecycle.StageTransitionID.create()
      const record = {
        id: SelfImprovementLifecycle.IdempotencyRecordID.create(),
        identity,
        requestDigest,
        storedBodyDigest: SelfImprovement.Digest.make(Hash.sha256(`reject-approval/response/v1\0${requestDigest}`)),
        storedResponse: {
          status: 200 as const,
          body: {
            status: "completed" as const,
            artifactRevision: SelfImprovementLifecycle.Revision.make(artifact.revision + 1),
            transition: new SelfImprovementLifecycle.StageTransition({
              id: transitionID,
              versionID: version.id,
              previousStage: stage,
              nextStage,
              event,
              reason: "approval-rejected",
              actorID: input.principal.id,
              timestamp: input.now,
              ...(event === "shadow-evidence-passed" ? { evaluationRunID: approval.binding.evaluationRunID } : {}),
              idempotencyRecordID: SelfImprovementLifecycle.IdempotencyRecordID.create(),
              idempotencyDigest: requestDigest,
            }),
          },
        },
        createdAt: input.now,
        expiresAt: SelfImprovementLifecycle.TimestampMillis.make(input.now + retentionMs),
      } satisfies SelfImprovementApi.IdempotencyRecord
      const transition = new SelfImprovementLifecycle.StageTransition({
        ...record.storedResponse.body.transition,
        idempotencyRecordID: record.id,
      })
      const command = {
        locationID: input.locationID,
        artifactID: artifact.id,
        expectedRevision: artifact.revision,
        currentStage: stage,
        transition,
        idempotency: record,
        audit: new SelfImprovementLearning.AuditEntry({
          id: SelfImprovementLifecycle.AuditEntryID.create(),
          locationID: input.locationID,
          eventType: "lifecycle.approval-rejected",
          actorID: input.principal.id,
          payload: new SelfImprovementLearning.AuditPayload({
            artifactID: artifact.id,
            versionID: version.id,
            ...(event === "shadow-evidence-passed" ? { evaluationRunID: approval.binding.evaluationRunID } : {}),
            linkedDigests: [approval.binding.shadowEvidenceDigest, version.versionDigest],
            rejectedFieldNames: [],
          }),
          timestamp: input.now,
          retention: new SelfImprovementLearning.GovernedMetadataRetention({ createdAt: input.now }),
        }),
      }
      if (event === "ephemeral-expired") {
        yield* lifecycle
          .expireEphemeral(command, tx)
          .pipe(Effect.mapError((error) => new Conflict({ message: error.message })))
        return { replayed: false }
      }
      const decision = yield* evaluation.getDecision(input.locationID, approval.binding.evaluationRunID, tx)
      if (decision === undefined)
        return yield* new Conflict({ message: "Approval rejection has no matching shadow decision" })
      yield* lifecycle
        .transition(
          {
            ...command,
            event,
            evaluationDecision: new SelfImprovementEvaluation.EvaluationDecision({
              ...decision,
              decision: "failed",
              approvalBinding: approval.binding,
            }),
            atCutoff: true,
          },
          tx,
        )
        .pipe(Effect.mapError((error) => new Conflict({ message: error.message })))
      return { replayed: false }
    })

    return Service.of({ prepareShadow, applyDecision, consumeApproval, rejectApproval })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [
    SelfImprovementArtifactStore.node,
    SelfImprovementApprovalStore.node,
    SelfImprovementAuditStore.node,
    SelfImprovementContextStore.node,
    SelfImprovementEvaluationStore.node,
    SelfImprovementIdempotencyStore.node,
    SelfImprovementLearningStore.node,
    SelfImprovementLifecycleCoordinator.node,
    SelfImprovementTransitionStore.node,
  ],
})

const SelfImprovementLifecycleWorkflowNextStage = (
  stage: SelfImprovementLifecycle.ArtifactStage,
  event: SelfImprovementLifecycle.LifecycleEvent,
  decision: "passed" | "failed",
  atCutoff: boolean,
) => {
  if (stage === "shadow" && event === "shadow-evidence-passed")
    return decision === "failed" ? (atCutoff ? "deprecated" : "shadow") : "canary"
  if (stage === "canary" && event === "canary-passed") return "active"
  if (stage === "canary" && event === "canary-regressed") return "deprecated"
  return undefined
}

function approvalContext(input: {
  readonly locationID: SelfImprovementLifecycle.LocationID
  readonly artifactID: SelfImprovementLifecycle.ArtifactID
  readonly artifactRevision: SelfImprovementLifecycle.Revision
  readonly version: SelfImprovementLifecycle.ArtifactVersion
  readonly principal: SelfImprovementLifecycle.Principal
  readonly approval: SelfImprovementLifecycle.Approval
  readonly record: SelfImprovementApi.IdempotencyRecord
  readonly now: SelfImprovementLifecycle.TimestampMillis
  readonly outboxID: SelfImprovementLifecycle.ContextOutboxID
}) {
  const outbox = new SelfImprovementLearning.ContextOutbox({
    id: input.outboxID,
    locationID: input.locationID,
    artifactID: input.artifactID,
    expectedArtifactRevision: input.artifactRevision,
    expectedStage: "shadow",
    desiredStateRevision: SelfImprovementLifecycle.Revision.make(input.artifactRevision + 1),
    intent: new SelfImprovementLearning.PendingTransitionIntent({
      versionID: input.version.id,
      previousStage: "shadow",
      nextStage: "canary",
      event: "approval-consumed",
      reason: "gates-passed",
      actorID: input.principal.id,
      evaluationRunID: input.approval.binding.evaluationRunID,
      approvalID: input.approval.id,
      approvalBinding: input.approval.binding,
      idempotencyRecordID: input.record.id,
      idempotencyDigest: input.record.requestDigest,
    }),
    status: "pending",
    attempts: 0,
    nextRetryAt: input.now,
    createdAt: input.now,
  })
  return {
    desired: new SelfImprovementLearning.ContextDesiredState({
      locationID: input.locationID,
      artifactID: input.artifactID,
      rolloutSlot: "canary",
      desired: {
        state: "present",
        versionID: input.version.id,
        versionDigest: input.version.versionDigest,
        stage: "canary",
      },
      desiredRevision: outbox.desiredStateRevision,
    }),
    outbox,
  }
}

function decisionContext(input: {
  readonly locationID: SelfImprovementLifecycle.LocationID
  readonly artifactID: SelfImprovementLifecycle.ArtifactID
  readonly version: SelfImprovementLifecycle.ArtifactVersion
  readonly artifactRevision: SelfImprovementLifecycle.Revision
  readonly stage: SelfImprovementLifecycle.ArtifactStage
  readonly event: "canary-passed" | "canary-regressed"
  readonly next: SelfImprovementLifecycle.ArtifactStage
  readonly principal: SelfImprovementLifecycle.Principal
  readonly runID: SelfImprovementLifecycle.EvaluationRunID
  readonly record: SelfImprovementApi.IdempotencyRecord
  readonly now: SelfImprovementLifecycle.TimestampMillis
  readonly rollback?: SelfImprovementLifecycle.Rollback
  readonly reward?: SelfImprovementLearning.RewardEvent
  readonly supersededVersionID?: SelfImprovementLifecycle.ArtifactVersionID
}) {
  const outbox = new SelfImprovementLearning.ContextOutbox({
    id: SelfImprovementLifecycle.ContextOutboxID.create(),
    locationID: input.locationID,
    artifactID: input.artifactID,
    expectedArtifactRevision: input.artifactRevision,
    expectedStage: input.stage,
    desiredStateRevision: SelfImprovementLifecycle.Revision.make(input.artifactRevision + 1),
    intent: new SelfImprovementLearning.PendingTransitionIntent({
      versionID: input.version.id,
      previousStage: input.stage,
      nextStage: input.next,
      event: input.event,
      reason: input.event === "canary-passed" ? "gates-passed" : "canary-regression",
      actorID: input.principal.id,
      evaluationRunID: input.runID,
      ...(input.rollback === undefined ? {} : { rollbackID: input.rollback.id, rollback: input.rollback }),
      ...(input.reward === undefined ? {} : { reward: input.reward }),
      ...(input.supersededVersionID === undefined ? {} : { supersededVersionID: input.supersededVersionID }),
      idempotencyRecordID: input.record.id,
      idempotencyDigest: input.record.requestDigest,
    }),
    status: "pending",
    attempts: 0,
    nextRetryAt: input.now,
    createdAt: input.now,
  })
  return {
    desired: new SelfImprovementLearning.ContextDesiredState({
      locationID: input.locationID,
      artifactID: input.artifactID,
      rolloutSlot: input.event === "canary-passed" ? "active" : "canary",
      desired:
        input.event === "canary-passed"
          ? {
              state: "present" as const,
              versionID: input.version.id,
              versionDigest: input.version.versionDigest,
              stage: "active",
            }
          : { state: "absent" as const },
      desiredRevision: outbox.desiredStateRevision,
    }),
    outbox,
  }
}
