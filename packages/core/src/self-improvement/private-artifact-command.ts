export * as SelfImprovementPrivateArtifactCommand from "./private-artifact-command"

import { and, eq } from "drizzle-orm"
import { Context, Effect, Layer, Schema } from "effect"
import {
  SelfImprovement,
  SelfImprovementApi,
  SelfImprovementLearning,
  SelfImprovementLifecycle,
} from "@opencode-ai/schema"
import { Database } from "../database/database"
import { makeLocationNode } from "../effect/app-node"
import { Hash } from "../util/hash"
import { SelfImprovementAdmission } from "./admission"
import { SelfImprovementApprovalRequestTable } from "./approval-rollback.sql"
import { SelfImprovementApprovalStore } from "./approval-store"
import { SelfImprovementArtifactStore } from "./artifact-store"
import { SelfImprovementAuditStore } from "./audit-store"
import { SelfImprovementAuthorization } from "./authorization"
import { SelfImprovementIdempotencyStore } from "./idempotency-store"
import { SelfImprovementLifecycleCoordinator } from "./lifecycle-coordinator"
import { SelfImprovementMutationStore } from "./mutation-store"
import { SelfImprovementLifecycleWorkflow } from "./lifecycle-workflow"
import { SelfImprovementTransitionStore } from "./transition-store"

const retentionMs = 30 * 86_400_000
const emptyManifest = new SelfImprovementLifecycle.CapabilityManifest({
  toolIDs: [],
  filesystemScopeIDs: [],
  networkOriginIDs: [],
  modelRoutes: [],
  childAgentTargets: [],
  artifactReferences: [],
  denies: [],
})

export interface AdmissionPolicy {
  readonly resolve: (input: {
    readonly locationID: SelfImprovementLifecycle.LocationID
    readonly principal: SelfImprovementLifecycle.Principal
    readonly manifest: SelfImprovementLifecycle.CapabilityManifest
  }) => Effect.Effect<SelfImprovementAdmission.TrustedAdmissionPolicy, SelfImprovementAdmission.Rejected>
}

export class AdmissionPolicyService extends Context.Service<AdmissionPolicyService, AdmissionPolicy>()(
  "@opencode/SelfImprovementPrivateArtifactCommand/AdmissionPolicy",
) {}

export const admissionPolicyLayer = Layer.succeed(AdmissionPolicyService, {
  resolve: (input) =>
    input.manifest.toolIDs.length === 0 &&
    input.manifest.filesystemScopeIDs.length === 0 &&
    input.manifest.networkOriginIDs.length === 0 &&
    input.manifest.modelRoutes.length === 0 &&
    input.manifest.childAgentTargets.length === 0 &&
    input.manifest.artifactReferences.length === 0 &&
    input.manifest.denies.length === 0
      ? Effect.succeed({
          known: { tools: [], filesystemScopes: [], networkOrigins: [], childAgents: [], modelRoutes: [] },
          grant: emptyManifest,
          references: { common: "pass", typed: "pass", cycle: "pass", models: "pass" },
          resolve: () => [],
        })
      : new SelfImprovementAdmission.Rejected({ message: "No admission policy grants requested capabilities" }),
})

export interface CommandInput<Request> {
  readonly locationID: SelfImprovementLifecycle.LocationID
  readonly principal: SelfImprovementLifecycle.Principal
  readonly request: Request
  readonly idempotencyKey: SelfImprovementLearning.IdempotencyKey
  readonly now: SelfImprovementLifecycle.TimestampMillis
}

export interface ApprovalInput<Request> {
  readonly locationID: SelfImprovementLifecycle.LocationID
  readonly principal: SelfImprovementLifecycle.Principal
  readonly request: Request
  readonly idempotencyKey: SelfImprovementLearning.IdempotencyKey
  readonly now: SelfImprovementLifecycle.TimestampMillis
}

export class Failure extends Schema.TaggedErrorClass<Failure>()("SelfImprovementPrivateArtifactCommand.Failure", {
  response: SelfImprovementApi.StoredResponse,
}) {}

export interface Interface {
  readonly createArtifact: (
    input: CommandInput<SelfImprovementApi.CreateArtifactRequest>,
  ) => Effect.Effect<{ readonly response: SelfImprovementApi.StoredResponse; readonly replayed: boolean }, Failure>
  readonly createVersion: (
    input: CommandInput<SelfImprovementApi.CreateVersionRequest>,
  ) => Effect.Effect<{ readonly response: SelfImprovementApi.StoredResponse; readonly replayed: boolean }, Failure>
  readonly archiveVersion: (
    input: CommandInput<SelfImprovementApi.ArchiveVersionRequest>,
  ) => Effect.Effect<{ readonly response: SelfImprovementApi.StoredResponse; readonly replayed: boolean }, Failure>
  readonly tombstoneArtifact: (
    input: CommandInput<SelfImprovementApi.TombstoneArtifactRequest>,
  ) => Effect.Effect<{ readonly response: SelfImprovementApi.StoredResponse; readonly replayed: boolean }, Failure>
  readonly approve: (
    input: ApprovalInput<SelfImprovementApi.ApproveRequest>,
  ) => Effect.Effect<{ readonly response: SelfImprovementApi.StoredResponse; readonly replayed: boolean }, Failure>
  readonly reject: (
    input: ApprovalInput<SelfImprovementApi.RejectRequest>,
  ) => Effect.Effect<{ readonly response: SelfImprovementApi.StoredResponse; readonly replayed: boolean }, Failure>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SelfImprovementPrivateArtifactCommand") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const admission = yield* SelfImprovementAdmission.Service
    const approvals = yield* SelfImprovementApprovalStore.Service
    const artifacts = yield* SelfImprovementArtifactStore.Service
    yield* SelfImprovementAuditStore.Service
    const idempotency = yield* SelfImprovementIdempotencyStore.Service
    const lifecycle = yield* SelfImprovementLifecycleCoordinator.Service
    const mutations = yield* SelfImprovementMutationStore.Service
    const workflow = yield* SelfImprovementLifecycleWorkflow.Service
    const policy = yield* AdmissionPolicyService
    const transitions = yield* SelfImprovementTransitionStore.Service
    const db = (yield* Database.Service).db

    const createArtifact = Effect.fn("SelfImprovementPrivateArtifactCommand.createArtifact")(function* (
      input: CommandInput<SelfImprovementApi.CreateArtifactRequest>,
    ) {
      yield* SelfImprovementAuthorization.authorize(input.principal, "artifact.create", input.locationID).pipe(
        mapForbidden,
      )
      const trustedPolicy = yield* policy
        .resolve({
          locationID: input.locationID,
          principal: input.principal,
          manifest: input.request.capabilityManifest,
        })
        .pipe(Effect.mapError((cause) => new Failure({ response: error("admission-rejected", cause.message) })))
      const admitted = yield* admission
        .admit({
          locationID: input.locationID,
          proposalBytes: input.request.proposalBytes,
          principal: input.principal,
          source: "human",
          behaviorClass: input.request.behaviorClass,
          capabilityManifest: input.request.capabilityManifest,
          idempotencyKey: input.idempotencyKey,
          operation: "artifact.create",
          policy: trustedPolicy,
          now: input.now,
        })
        .pipe(
          Effect.mapError(
            (cause) =>
              new Failure({
                response: error(
                  cause._tag === "SelfImprovementAdmission.Conflict" ? "idempotency-mismatch" : "admission-rejected",
                  cause.message,
                ),
              }),
          ),
        )
      return {
        response: {
          status: 201 as const,
          body: new SelfImprovementApi.CreateArtifactResponse({
            artifact: admitted.artifact,
            version: admitted.version,
            revision: admitted.artifact.revision,
          }),
        },
        replayed: admitted.replayed,
      }
    })

    const createVersion = Effect.fn("SelfImprovementPrivateArtifactCommand.createVersion")(function* (
      input: CommandInput<SelfImprovementApi.CreateVersionRequest>,
    ) {
      yield* SelfImprovementAuthorization.authorize(input.principal, "artifact.create", input.locationID).pipe(
        mapForbidden,
      )
      const trustedPolicy = yield* policy
        .resolve({
          locationID: input.locationID,
          principal: input.principal,
          manifest: input.request.capabilityManifest,
        })
        .pipe(Effect.mapError((cause) => new Failure({ response: error("admission-rejected", cause.message) })))
      const admitted = yield* admission
        .admit({
          locationID: input.locationID,
          proposalBytes: input.request.proposalBytes,
          principal: input.principal,
          source: "human",
          behaviorClass: input.request.behaviorClass,
          capabilityManifest: input.request.capabilityManifest,
          append: { artifactID: input.request.artifactID, expectedRevision: input.request.expectedRevision },
          idempotencyKey: input.idempotencyKey,
          operation: "artifact.create",
          policy: trustedPolicy,
          now: input.now,
        })
        .pipe(Effect.mapError((cause) => new Failure({ response: error("admission-rejected", cause.message) })))
      return {
        response: {
          status: 201 as const,
          body: new SelfImprovementApi.CreateVersionResponse({
            version: admitted.version,
            revision: admitted.artifact.revision,
          }),
        },
        replayed: admitted.replayed,
      }
    })

    const archiveVersion = Effect.fn("SelfImprovementPrivateArtifactCommand.archiveVersion")(function* (
      input: CommandInput<SelfImprovementApi.ArchiveVersionRequest>,
    ) {
      yield* SelfImprovementAuthorization.authorize(input.principal, "artifact.archive", input.locationID).pipe(
        mapForbidden,
      )
      const identity = identityFor(input, "artifact.archive")
      const replay = yield* idempotency.get({ locationID: input.locationID, identity })
      if (replay) return yield* replayResponse(replay, requestDigest("archive", input.request))
      const artifact = yield* artifacts.getArtifact({
        locationID: input.locationID,
        artifactID: input.request.artifactID,
      })
      if (artifact === undefined) return yield* missing("artifact-not-found", "Artifact was not found")
      const version = yield* artifacts.getVersion({ locationID: input.locationID, versionID: input.request.versionID })
      if (version?.artifactID !== artifact.id)
        return yield* missing("artifact-or-version-not-found", "Artifact version was not found")
      const currentStage =
        (yield* transitions.currentStage({ locationID: input.locationID, versionID: version.id })) ?? null
      const digest = requestDigest("archive", input.request)
      const record = idempotencyRecord(
        identity,
        digest,
        {
          status: 202,
          body: pendingResult(
            artifact.revision,
            pending(
              artifact.revision,
              input.locationID,
              artifact.id,
              version,
              currentStage,
              "retention-archive",
              input,
            ),
          ),
        },
        input.now,
      )
      const transition = stageTransition(
        version.id,
        currentStage,
        "archived",
        "retention-archive",
        input.request.reason,
        input,
        record,
      )
      const outbox = pending(
        artifact.revision,
        input.locationID,
        artifact.id,
        version,
        currentStage,
        "retention-archive",
        input,
        transition,
      )
      const result = yield* lifecycle
        .archive({
          locationID: input.locationID,
          artifactID: artifact.id,
          expectedRevision: input.request.expectedRevision,
          currentStage,
          transition,
          context: removalContext(
            input.locationID,
            artifact.id,
            artifact.revision,
            currentStage,
            version,
            transition,
            record,
            input.now,
          ),
          audit: auditEntry("artifact.archived", input, artifact.id, version.id),
          idempotency: { ...record, storedResponse: { status: 202, body: pendingResult(artifact.revision, outbox) } },
        })
        .pipe(Effect.mapError((cause) => new Failure({ response: error("revision-conflict", cause.message) })))
      return {
        response: result.pendingContext
          ? { status: 202 as const, body: pendingResult(artifact.revision, outbox) }
          : { status: 200 as const, body: completed(artifact.revision, transition) },
        replayed: false,
      }
    })

    const tombstoneArtifact = Effect.fn("SelfImprovementPrivateArtifactCommand.tombstoneArtifact")(function* (
      input: CommandInput<SelfImprovementApi.TombstoneArtifactRequest>,
    ) {
      yield* SelfImprovementAuthorization.authorize(input.principal, "artifact.tombstone", input.locationID).pipe(
        mapForbidden,
      )
      const identity = identityFor(input, "artifact.tombstone")
      const replay = yield* idempotency.get({ locationID: input.locationID, identity })
      if (replay) return yield* replayResponse(replay, requestDigest("tombstone", input.request))
      const artifact = yield* artifacts.getArtifact({
        locationID: input.locationID,
        artifactID: input.request.artifactID,
      })
      if (artifact === undefined) return yield* missing("artifact-not-found", "Artifact was not found")
      const versions = yield* artifacts.listVersions({ locationID: input.locationID, artifactID: artifact.id })
      const digest = requestDigest("tombstone", input.request)
      const record = idempotencyRecord(
        identity,
        digest,
        { status: 200, body: completed(artifact.revision, terminal(versions[0], null, input, digest)) },
        input.now,
      )
      const stages = yield* Effect.forEach(versions, (version) =>
        transitions
          .currentStage({ locationID: input.locationID, versionID: version.id })
          .pipe(Effect.map((stage) => ({ version, stage: stage ?? null }))),
      )
      const transitionsForVersions = stages.map(({ version, stage }) =>
        stageTransition(version.id, stage, "archived", "artifact-tombstoned", "artifact-tombstoned", input, record),
      )
      const removals = (yield* mutations.listSlots({ locationID: input.locationID, artifactID: artifact.id })).map(
        (slot) => {
          const version = versions.find((version) => version.id === slot.versionID)
          const transition = transitionsForVersions.find((transition) => transition.versionID === slot.versionID)
          if (version === undefined || transition === undefined) throw new Error("Artifact projection has no version")
          return removalContext(
            input.locationID,
            artifact.id,
            artifact.revision,
            transition.previousStage,
            version,
            transition,
            record,
            input.now,
            slot.slot,
          )
        },
      )
      const result = yield* lifecycle
        .tombstone({
          locationID: input.locationID,
          artifactID: artifact.id,
          expectedRevision: input.request.expectedRevision,
          tombstone: new SelfImprovementLifecycle.Tombstone({
            actorID: input.principal.id,
            reason: input.request.reason,
            timestamp: input.now,
          }),
          transitions: transitionsForVersions,
          removals,
          audit: auditEntry("artifact.tombstoned", input, artifact.id),
          idempotency: record,
        })
        .pipe(Effect.mapError((cause) => new Failure({ response: error("revision-conflict", cause.message) })))
      return {
        response: result.pendingContext
          ? record.storedResponse
          : { status: 200 as const, body: completed(artifact.revision, transitionsForVersions[0]) },
        replayed: false,
      }
    })

    const decide = (approved: boolean) =>
      Effect.fn("SelfImprovementPrivateArtifactCommand.decide")(function* (
        input: ApprovalInput<SelfImprovementApi.ApproveRequest | SelfImprovementApi.RejectRequest>,
      ) {
        yield* SelfImprovementAuthorization.authorize(input.principal, "approval.decide", input.locationID).pipe(
          mapForbidden,
        )
        const identity = new SelfImprovementLearning.IdempotencyIdentity({
          principalID: input.principal.id,
          locationID: input.locationID,
          operation: "approval.decide",
          key: input.idempotencyKey,
        })
        const digest = requestDigest(approved ? "approve" : "reject", input.request)
        const replay = yield* idempotency.get({ locationID: input.locationID, identity })
        if (replay) return yield* replayResponse(replay, digest)
        const request = yield* db
          .select()
          .from(SelfImprovementApprovalRequestTable)
          .where(
            and(
              eq(SelfImprovementApprovalRequestTable.id, input.request.approvalRequestID),
              eq(SelfImprovementApprovalRequestTable.location_id, input.locationID),
            ),
          )
          .get()
          .pipe(Effect.orDie)
        if (request === undefined) return yield* missing("approval-request-not-found", "Approval request was not found")
        const approval = new SelfImprovementLifecycle.Approval({
          id: SelfImprovementLifecycle.ApprovalID.create(),
          requestID: input.request.approvalRequestID,
          locationID: input.locationID,
          binding: input.request.binding,
          decision: approved
            ? new SelfImprovementLifecycle.ApprovalGranted({
                approverID: input.principal.id,
                decidedAt: input.now,
                expiresAt: SelfImprovementLifecycle.TimestampMillis.make(input.now + 86_400_000),
              })
            : new SelfImprovementLifecycle.ApprovalRejected({
                approverID: input.principal.id,
                decidedAt: input.now,
                reason: "approval-rejected",
              }),
        })
        const response: SelfImprovementApi.StoredResponse = {
          status: 200,
          body: approved
            ? new SelfImprovementApi.ApproveResponse({ approval })
            : new SelfImprovementApi.RejectResponse({ approval }),
        }
        const record = idempotencyRecord(identity, digest, response, input.now)
        yield* db
          .transaction((tx) =>
            Effect.gen(function* () {
              yield* approvals
                .decide(approval, tx)
                .pipe(Effect.mapError((cause) => new Failure({ response: error("already-decided", cause.message) })))
              if (approved)
                yield* workflow
                  .consumeApproval(
                    {
                      locationID: input.locationID,
                      principal: input.principal,
                      approvalID: approval.id,
                      now: input.now,
                      idempotencyKey: input.idempotencyKey,
                    },
                    tx,
                  )
                  .pipe(Effect.mapError((cause) => new Failure({ response: error("binding-invalid", cause.message) })))
              if (!approved)
                yield* workflow
                  .rejectApproval(
                    {
                      locationID: input.locationID,
                      principal: input.principal,
                      approvalID: approval.id,
                      now: input.now,
                      idempotencyKey: input.idempotencyKey,
                    },
                    tx,
                  )
                  .pipe(Effect.mapError((cause) => new Failure({ response: error("binding-invalid", cause.message) })))
              yield* idempotency.put({ locationID: input.locationID, record }, tx).pipe(
                Effect.mapError(
                  () =>
                    new Failure({
                      response: error("idempotency-mismatch", "Idempotency key was reused with a different request"),
                    }),
                ),
              )
            }),
          )
          .pipe(Effect.catchTag("SqlError", Effect.die))
        return { response, replayed: false }
      })

    const approve: Interface["approve"] = (input) => decide(true)(input)
    const reject: Interface["reject"] = (input) => decide(false)(input)
    return Service.of({ createArtifact, createVersion, archiveVersion, tombstoneArtifact, approve, reject })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer: layer.pipe(Layer.provide(admissionPolicyLayer)),
  deps: [
    Database.node,
    SelfImprovementAdmission.node,
    SelfImprovementApprovalStore.node,
    SelfImprovementArtifactStore.node,
    SelfImprovementAuditStore.node,
    SelfImprovementIdempotencyStore.node,
    SelfImprovementLifecycleCoordinator.node,
    SelfImprovementLifecycleWorkflow.node,
    SelfImprovementMutationStore.node,
    SelfImprovementTransitionStore.node,
  ],
})

function identityFor(input: CommandInput<unknown>, operation: "artifact.archive" | "artifact.tombstone") {
  return new SelfImprovementLearning.IdempotencyIdentity({
    principalID: input.principal.id,
    locationID: input.locationID,
    operation,
    key: input.idempotencyKey,
  })
}

function requestDigest(domain: string, request: unknown) {
  return SelfImprovement.Digest.make(Hash.sha256(`${domain}\0${JSON.stringify(request)}`))
}

function idempotencyRecord(
  identity: SelfImprovementLearning.IdempotencyIdentity,
  requestDigest: SelfImprovement.Digest,
  storedResponse: SelfImprovementApi.StoredResponse,
  now: SelfImprovementLifecycle.TimestampMillis,
) {
  return {
    id: SelfImprovementLifecycle.IdempotencyRecordID.create(),
    identity,
    requestDigest,
    storedBodyDigest: SelfImprovement.Digest.make(Hash.sha256(JSON.stringify(storedResponse))),
    storedResponse,
    createdAt: now,
    expiresAt: SelfImprovementLifecycle.TimestampMillis.make(now + retentionMs),
  }
}

function stageTransition(
  versionID: SelfImprovementLifecycle.ArtifactVersionID,
  previousStage: SelfImprovementLifecycle.ArtifactStage | null,
  nextStage: SelfImprovementLifecycle.ArtifactStage,
  event: SelfImprovementLifecycle.LifecycleEvent,
  reason: SelfImprovementLifecycle.LifecycleReason,
  input: CommandInput<unknown>,
  record: SelfImprovementApi.IdempotencyRecord,
) {
  return new SelfImprovementLifecycle.StageTransition({
    id: SelfImprovementLifecycle.StageTransitionID.create(),
    versionID,
    previousStage,
    nextStage,
    event,
    reason,
    actorID: input.principal.id,
    timestamp: input.now,
    idempotencyRecordID: record.id,
    idempotencyDigest: record.requestDigest,
  })
}

function terminal(
  version: SelfImprovementLifecycle.ArtifactVersion | undefined,
  stage: SelfImprovementLifecycle.ArtifactStage | null,
  input: CommandInput<unknown>,
  digest: SelfImprovement.Digest,
) {
  if (version === undefined) throw new Error("Artifact has no version")
  return new SelfImprovementLifecycle.StageTransition({
    id: SelfImprovementLifecycle.StageTransitionID.create(),
    versionID: version.id,
    previousStage: stage,
    nextStage: "archived",
    event: "version-archived",
    reason: "artifact-tombstoned",
    actorID: input.principal.id,
    timestamp: input.now,
    idempotencyRecordID: SelfImprovementLifecycle.IdempotencyRecordID.create(),
    idempotencyDigest: digest,
  })
}

function pending(
  revision: SelfImprovementLifecycle.Revision,
  locationID: SelfImprovementLifecycle.LocationID,
  artifactID: SelfImprovementLifecycle.ArtifactID,
  version: SelfImprovementLifecycle.ArtifactVersion,
  stage: SelfImprovementLifecycle.ArtifactStage | null,
  event: SelfImprovementLifecycle.LifecycleEvent,
  input: CommandInput<unknown>,
  transition?: SelfImprovementLifecycle.StageTransition,
) {
  const actual =
    transition ??
    new SelfImprovementLifecycle.StageTransition({
      id: SelfImprovementLifecycle.StageTransitionID.create(),
      versionID: version.id,
      previousStage: stage,
      nextStage: "archived",
      event,
      reason: "user-archive",
      actorID: input.principal.id,
      timestamp: input.now,
      idempotencyRecordID: SelfImprovementLifecycle.IdempotencyRecordID.create(),
      idempotencyDigest: SelfImprovement.Digest.make("0".repeat(64)),
    })
  return new SelfImprovementLearning.ContextOutbox({
    id: SelfImprovementLifecycle.ContextOutboxID.create(),
    locationID,
    artifactID,
    expectedArtifactRevision: revision,
    expectedStage: stage ?? "draft",
    desiredStateRevision: SelfImprovementLifecycle.Revision.make(revision + 1),
    intent: new SelfImprovementLearning.PendingTransitionIntent({
      versionID: version.id,
      previousStage: stage ?? "draft",
      nextStage: "archived",
      event,
      reason: actual.reason,
      actorID: input.principal.id,
      idempotencyRecordID: actual.idempotencyRecordID,
      idempotencyDigest: actual.idempotencyDigest,
    }),
    status: "pending",
    attempts: 0,
    nextRetryAt: input.now,
    createdAt: input.now,
  })
}

function pendingResult(revision: SelfImprovementLifecycle.Revision, outbox: SelfImprovementLearning.ContextOutbox) {
  return {
    status: "reconciliation-pending" as const,
    artifactRevision: SelfImprovementLifecycle.Revision.make(revision + 1),
    outbox,
  }
}

function removalContext(
  locationID: SelfImprovementLifecycle.LocationID,
  artifactID: SelfImprovementLifecycle.ArtifactID,
  revision: SelfImprovementLifecycle.Revision,
  stage: SelfImprovementLifecycle.ArtifactStage | null,
  version: SelfImprovementLifecycle.ArtifactVersion,
  transition: SelfImprovementLifecycle.StageTransition,
  record: SelfImprovementApi.IdempotencyRecord,
  now: SelfImprovementLifecycle.TimestampMillis,
  rolloutSlot: "shadow" | "canary" | "active" = "active",
) {
  const outbox = pending(
    revision,
    locationID,
    artifactID,
    version,
    stage,
    transition.event,
    {
      locationID,
      principal: new SelfImprovementLifecycle.Principal({
        id: transition.actorID,
        kind: "first-party-user",
        locationID,
      }),
      request: {},
      idempotencyKey: record.identity.key,
      now,
    },
    transition,
  )
  return {
    desired: new SelfImprovementLearning.ContextDesiredState({
      locationID,
      artifactID,
      rolloutSlot,
      desired: { state: "absent" },
      desiredRevision: outbox.desiredStateRevision,
    }),
    outbox,
  }
}

function auditEntry(
  eventType: string,
  input: CommandInput<unknown>,
  artifactID: SelfImprovementLifecycle.ArtifactID,
  versionID?: SelfImprovementLifecycle.ArtifactVersionID,
) {
  return new SelfImprovementLearning.AuditEntry({
    id: SelfImprovementLifecycle.AuditEntryID.create(),
    locationID: input.locationID,
    eventType,
    actorID: input.principal.id,
    payload: new SelfImprovementLearning.AuditPayload({
      artifactID,
      ...(versionID === undefined ? {} : { versionID }),
      linkedDigests: [],
      rejectedFieldNames: [],
    }),
    timestamp: input.now,
    retention: new SelfImprovementLearning.GovernedMetadataRetention({ createdAt: input.now }),
  })
}

function completed(revision: SelfImprovementLifecycle.Revision, transition: SelfImprovementLifecycle.StageTransition) {
  return {
    status: "completed" as const,
    artifactRevision: SelfImprovementLifecycle.Revision.make(revision + 1),
    transition,
  }
}
function replayResponse(record: SelfImprovementApi.IdempotencyRecord, digest: SelfImprovement.Digest) {
  return record.requestDigest === digest
    ? Effect.succeed({ response: record.storedResponse, replayed: true })
    : new Failure({ response: error("idempotency-mismatch", "Idempotency key was reused with a different request") })
}
function error(code: SelfImprovementApi.ApiErrorCode, message: string): SelfImprovementApi.StoredResponse {
  const body = new SelfImprovementApi.ApiError({
    code,
    message,
    requestID: "private-artifact-command",
    details: new SelfImprovementApi.ApiErrorDetails({}),
  })
  if (code === "forbidden" || code === "creator-self-approval") return { status: 403, body }
  if (
    code === "artifact-not-found" ||
    code === "artifact-or-version-not-found" ||
    code === "approval-request-not-found" ||
    code === "version-or-baseline-not-found" ||
    code === "run-not-found"
  )
    return { status: 404, body }
  return { status: 409, body }
}
function missing(
  code: "artifact-not-found" | "artifact-or-version-not-found" | "approval-request-not-found",
  message: string,
) {
  return new Failure({ response: error(code, message) })
}
function mapForbidden<A>(effect: Effect.Effect<A, SelfImprovementAuthorization.Forbidden>) {
  return effect.pipe(Effect.mapError(() => new Failure({ response: error("forbidden", "Forbidden") })))
}
