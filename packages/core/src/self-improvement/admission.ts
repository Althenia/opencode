export * as SelfImprovementAdmission from "./admission"

import { Context, Effect, Layer, Schema } from "effect"
import {
  SelfImprovement,
  SelfImprovementApi,
  SelfImprovementEvaluation,
  SelfImprovementLearning,
  SelfImprovementLifecycle,
} from "@opencode-ai/schema"
import { Database } from "../database/database"
import { makeLocationNode } from "../effect/app-node"
import { Hash } from "../util/hash"
import { SelfImprovementArtifactStore } from "./artifact-store"
import { SelfImprovementAuditStore } from "./audit-store"
import { SelfImprovementAuthorization } from "./authorization"
import { SelfImprovementCapability } from "./capability"
import { SelfImprovementContent } from "./content"
import { SelfImprovementEvaluator } from "./evaluator"
import { SelfImprovementIdempotencyStore } from "./idempotency-store"
import { SelfImprovementProposal } from "./proposal"
import { SelfImprovementTransitionStore } from "./transition-store"

const retentionMs = 30 * 86_400_000
const StoredResponseJson = Schema.fromJsonString(SelfImprovementApi.StoredResponse)
const encodeStoredResponse = Schema.encodeSync(StoredResponseJson)

export class Rejected extends Schema.TaggedErrorClass<Rejected>()("SelfImprovementAdmission.Rejected", {
  message: Schema.String,
  digest: SelfImprovement.Digest.pipe(Schema.optional),
}) {}

export class Conflict extends Schema.TaggedErrorClass<Conflict>()("SelfImprovementAdmission.Conflict", {
  message: Schema.String,
  digest: SelfImprovement.Digest.pipe(Schema.optional),
}) {}

/** Trusted internal admission facts; this is not a public request policy. */
export interface TrustedAdmissionPolicy {
  readonly known: Parameters<typeof SelfImprovementCapability.validateCapabilities>[0]["known"]
  readonly grant: SelfImprovementLifecycle.CapabilityManifest
  readonly baseline?: SelfImprovementLifecycle.CapabilityManifest
  readonly taskEnvelope?: SelfImprovementLifecycle.CapabilityManifest
  readonly references: {
    readonly common: "pass" | "fail" | "not-applicable"
    readonly typed: "pass" | "fail" | "not-applicable"
    readonly cycle: "pass" | "fail" | "not-applicable"
    readonly models: "pass" | "fail" | "not-applicable"
  }
  readonly resolve: Parameters<typeof SelfImprovementCapability.validateCapabilities>[0]["resolve"]
}

export interface AdmissionInput {
  readonly locationID: SelfImprovementLifecycle.LocationID
  readonly proposalBytes: Uint8Array
  readonly principal: SelfImprovementLifecycle.Principal
  readonly source: SelfImprovementLifecycle.ArtifactSource
  readonly behaviorClass: SelfImprovementLifecycle.BehaviorClass
  readonly capabilityManifest: SelfImprovementLifecycle.CapabilityManifest
  readonly generated?: SelfImprovementLifecycle.GeneratedContentMetadata
  readonly append?: {
    readonly artifactID: SelfImprovementLifecycle.ArtifactID
    readonly expectedRevision: SelfImprovementLifecycle.Revision
  }
  readonly idempotencyKey: SelfImprovementLearning.IdempotencyKey
  readonly operation: "artifact.create"
  readonly policy: TrustedAdmissionPolicy
  readonly now: SelfImprovementLifecycle.TimestampMillis
}

export interface Accepted {
  readonly _tag: "accepted"
  readonly artifact: SelfImprovementLifecycle.Artifact
  readonly version: SelfImprovementLifecycle.ArtifactVersion
  readonly replayed: boolean
}

export interface Interface {
  readonly admit: (
    input: AdmissionInput,
  ) => Effect.Effect<Accepted, Rejected | Conflict | SelfImprovementAuthorization.Forbidden>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SelfImprovementAdmission") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const artifacts = yield* SelfImprovementArtifactStore.Service
    const transitions = yield* SelfImprovementTransitionStore.Service
    const audit = yield* SelfImprovementAuditStore.Service
    const idempotency = yield* SelfImprovementIdempotencyStore.Service

    const admit = Effect.fn("SelfImprovementAdmission.admit")(
      function* (input: AdmissionInput) {
        const parsed = SelfImprovementProposal.parse(input.proposalBytes)
        if (parsed._tag === "rejected")
          return yield* new Rejected({
            message: `Proposal rejected: ${parsed.failure.code}`,
            digest: parsed.rejectedByteDigest,
          })
        if (input.source === "generated" && parsed.proposal.kind !== "skill")
          return yield* new Rejected({ message: "Generated proposals must be skills" })
        if ((input.source === "generated") !== (input.generated !== undefined))
          return yield* new Rejected({ message: "Generated metadata must match proposal source" })

        yield* SelfImprovementAuthorization.authorize(input.principal, "artifact.create", input.locationID)
        const policyDigest = digest("policy/v1", {
          known: input.policy.known,
          grant: canonicalManifest(input.policy.grant),
          baseline: input.policy.baseline && canonicalManifest(input.policy.baseline),
          taskEnvelope: input.policy.taskEnvelope && canonicalManifest(input.policy.taskEnvelope),
          references: input.policy.references,
        })
        const manifestDigest = digest("capability-manifest/v1", canonicalManifest(input.capabilityManifest))
        const requestDigest = digest("admission/request/v1", {
          append: input.append,
          behaviorClass: input.behaviorClass,
          canonicalJson: parsed.canonicalJson,
          generated: input.generated,
          manifest: canonicalManifest(input.capabilityManifest),
          operation: input.operation,
          policyDigest,
          source: input.source,
        })
        const identity = new SelfImprovementLearning.IdempotencyIdentity({
          principalID: input.principal.id,
          locationID: input.locationID,
          operation: input.operation,
          key: input.idempotencyKey,
        })
        const replay = (record: SelfImprovementApi.IdempotencyRecord) =>
          Effect.gen(function* () {
            if (record.requestDigest !== requestDigest)
              return yield* new Conflict({
                message: "Idempotency key was used with a different request",
                digest: record.requestDigest,
              })
            const body = record.storedResponse.body
            if (body instanceof SelfImprovementApi.CreateArtifactResponse)
              return { _tag: "accepted" as const, artifact: body.artifact, version: body.version, replayed: true }
            if (body instanceof SelfImprovementApi.CreateVersionResponse) {
              const artifact = yield* artifacts.getArtifact({
                locationID: input.locationID,
                artifactID: body.version.artifactID,
              })
              if (artifact === undefined)
                return yield* new Conflict({ message: "Idempotency record references a missing admission result" })
              return {
                _tag: "accepted" as const,
                artifact: new SelfImprovementLifecycle.Artifact({
                  id: artifact.id,
                  key: artifact.key,
                  status: "live",
                  createdBy: artifact.createdBy,
                  createdAt: artifact.createdAt,
                  revision: body.revision,
                }),
                version: body.version,
                replayed: true,
              }
            }
            return yield* new Conflict({ message: "Idempotency record does not contain an admission result" })
          })
        const existing = yield* idempotency.get({ locationID: input.locationID, identity })
        if (existing) return yield* replay(existing)

        const runID = SelfImprovementLifecycle.EvaluationRunID.create()
        const contentFailures =
          input.source === "generated" && parsed.proposal.kind === "skill"
            ? yield* SelfImprovementContent.validateGeneratedSkill(parsed.proposal.definition.content, runID)
            : []
        const content =
          input.source === "generated"
            ? contentFailures.length > 0
              ? contentFailures
              : [
                  SelfImprovementEvaluation.GateFinding.make({
                    id: SelfImprovementLifecycle.GateFindingID.create(),
                    evaluationRunID: runID,
                    order: SelfImprovementEvaluation.GateOrder["generated-content-safe"],
                    gateID: "generated-content-safe",
                    result: "pass",
                    code: "generated-content-safe",
                  }),
                ]
            : []
        const capabilities = yield* SelfImprovementCapability.validateCapabilities({
          runID,
          manifest: input.capabilityManifest,
          locationID: input.locationID,
          known: input.policy.known,
          grant: input.policy.grant,
          baseline: input.policy.baseline,
          taskEnvelope: input.policy.taskEnvelope,
          generated: input.source === "generated",
          adhoc: input.source === "generated" && input.behaviorClass === "instruction-only",
          resolve: input.policy.resolve,
        })
        const decision = yield* SelfImprovementEvaluator.evaluate({
          runID,
          cutoffSampleSetDigest: digest("admission/static-evaluation/v1", requestDigest),
          stage: "draft",
          source: input.source,
          behaviorClass: input.behaviorClass,
          totals: totals(),
          aggregates: aggregates(),
          baseline: { totals: totals(), aggregates: aggregates(), locationMatches: true, suiteMatches: true },
          requiredSuitePassed: true,
          references: {
            nameAvailable: true,
            common: input.policy.references.common,
            typed: input.policy.references.typed,
            cycle: input.policy.references.cycle,
            models: input.policy.references.models,
          },
          capabilities,
          content,
          approvalPresent: false,
          decidedAt: input.now,
        })
        if (decision.decision === "failed") return yield* new Rejected({ message: "Required admission gate failed" })

        const existingArtifact = input.append
          ? yield* artifacts.getArtifact({ locationID: input.locationID, artifactID: input.append.artifactID })
          : undefined
        const createdArtifact =
          existingArtifact ??
          new SelfImprovementLifecycle.Artifact({
            id: SelfImprovementLifecycle.ArtifactID.create(),
            key: new SelfImprovementLifecycle.ArtifactKey({
              locationID: input.locationID,
              kind: parsed.proposal.kind,
              name: parsed.proposal.name,
            }),
            status: "live",
            createdBy: input.principal.id,
            createdAt: input.now,
            revision: SelfImprovementLifecycle.Revision.make(0),
          })
        const versionNumber = input.append
          ? (yield* artifacts.listVersions({ locationID: input.locationID, artifactID: createdArtifact.id })).length + 1
          : 1
        const version = new SelfImprovementLifecycle.ArtifactVersion({
          id: SelfImprovementLifecycle.ArtifactVersionID.create(),
          artifactID: createdArtifact.id,
          versionNumber,
          source: input.source,
          behaviorClass: input.behaviorClass,
          proposal: parsed.proposal,
          canonicalJson: parsed.canonicalJson,
          proposalDigest: digest("proposal/v1", parsed.canonicalJson),
          inputSnapshotDigest: parsed.inputSnapshotDigest,
          versionDigest: digest("version/v1", {
            canonicalJson: parsed.canonicalJson,
            manifestDigest,
            source: input.source,
            behaviorClass: input.behaviorClass,
            generated: input.generated,
          }),
          capabilityManifest: new SelfImprovementLifecycle.CapabilityManifest(
            canonicalManifest(input.capabilityManifest),
          ),
          capabilityManifestDigest: manifestDigest,
          creatorID: input.principal.id,
          createdAt: input.now,
          ...(input.generated === undefined ? {} : { generated: input.generated }),
        })
        const updatedArtifact = input.append
          ? new SelfImprovementLifecycle.Artifact({
              id: createdArtifact.id,
              key: createdArtifact.key,
              status: "live",
              createdBy: createdArtifact.createdBy,
              createdAt: createdArtifact.createdAt,
              revision: SelfImprovementLifecycle.Revision.make(Number(input.append.expectedRevision) + 1),
            })
          : createdArtifact
        const response = {
          status: 201 as const,
          body: input.append
            ? new SelfImprovementApi.CreateVersionResponse({ version, revision: updatedArtifact.revision })
            : new SelfImprovementApi.CreateArtifactResponse({
                artifact: createdArtifact,
                version,
                revision: createdArtifact.revision,
              }),
        }
        const record = {
          id: SelfImprovementLifecycle.IdempotencyRecordID.create(),
          identity,
          requestDigest,
          storedBodyDigest: digest("admission/response/v1", JSON.parse(encodeStoredResponse(response))),
          storedResponse: response,
          createdAt: input.now,
          expiresAt: SelfImprovementLifecycle.TimestampMillis.make(Number(input.now) + retentionMs),
        }
        const replayConflict = (error: { readonly message: string }) =>
          idempotency
            .get({ locationID: input.locationID, identity })
            .pipe(
              Effect.flatMap((record) =>
                record === undefined ? new Conflict({ message: error.message }) : replay(record),
              ),
            )

        return yield* database.db
          .transaction((tx) =>
            Effect.gen(function* () {
              yield* idempotency.put({ locationID: input.locationID, record }, tx)
              const byKey = yield* artifacts.getArtifactByKey(
                {
                  key: new SelfImprovementLifecycle.ArtifactKey({
                    locationID: input.locationID,
                    kind: parsed.proposal.kind,
                    name: parsed.proposal.name,
                  }),
                },
                tx,
              )
              const artifact = input.append ? (byKey?.id === input.append.artifactID ? byKey : undefined) : byKey
              if (input.append && artifact === undefined)
                return yield* new Conflict({ message: "Artifact, Location, or key does not match append request" })
              if (!input.append && artifact !== undefined)
                return yield* new Conflict({ message: "Artifact name is reserved" })
              if (input.append) {
                const appended = yield* artifacts.appendVersion(
                  {
                    locationID: input.locationID,
                    artifactID: createdArtifact.id,
                    expectedRevision: input.append.expectedRevision,
                    version,
                  },
                  tx,
                )
                if (!appended) return yield* new Conflict({ message: "Artifact revision conflict" })
              } else yield* artifacts.create({ locationID: input.locationID, artifact: createdArtifact, version }, tx)
              yield* transitions.append(
                {
                  locationID: input.locationID,
                  transition: new SelfImprovementLifecycle.StageTransition({
                    id: SelfImprovementLifecycle.StageTransitionID.create(),
                    versionID: version.id,
                    previousStage: null,
                    nextStage: "draft",
                    event: "version-admitted",
                    reason: "admission-accepted",
                    actorID: input.principal.id,
                    timestamp: input.now,
                    evaluationRunID: runID,
                    idempotencyRecordID: record.id,
                    idempotencyDigest: requestDigest,
                  }),
                },
                tx,
              )
              yield* audit.append(
                {
                  locationID: input.locationID,
                  entry: new SelfImprovementLearning.AuditEntry({
                    id: SelfImprovementLifecycle.AuditEntryID.create(),
                    locationID: input.locationID,
                    eventType: "artifact.admitted",
                    actorID: input.principal.id,
                    payload: new SelfImprovementLearning.AuditPayload({
                      artifactID: createdArtifact.id,
                      versionID: version.id,
                      evaluationRunID: runID,
                      linkedDigests: [requestDigest, version.versionDigest],
                      rejectedFieldNames: [],
                    }),
                    timestamp: input.now,
                    retention: new SelfImprovementLearning.GovernedMetadataRetention({ createdAt: input.now }),
                  }),
                },
                tx,
              )
              return { _tag: "accepted" as const, artifact: updatedArtifact, version, replayed: false }
            }),
          )
          .pipe(
            Effect.catchTags({
              "SelfImprovementAdmission.Conflict": replayConflict,
              "SelfImprovementArtifactStore.Conflict": replayConflict,
              "SelfImprovementArtifactStore.InvalidInput": (error) => new Rejected({ message: error.message }),
              "SelfImprovementTransitionStore.Conflict": replayConflict,
              "SelfImprovementTransitionStore.InvalidInput": (error) => new Rejected({ message: error.message }),
              "SelfImprovementAuditStore.Conflict": replayConflict,
              "SelfImprovementAuditStore.InvalidInput": (error) => new Rejected({ message: error.message }),
              "SelfImprovementIdempotencyStore.Conflict": replayConflict,
              "SelfImprovementIdempotencyStore.InvalidInput": (error) => new Rejected({ message: error.message }),
            }),
          )
      },
      Effect.catchTag("SelfImprovementEvaluator.InvalidEvidence", (error) => new Rejected({ message: error.message })),
      Effect.catchTag("SqlError", Effect.die),
    )
    return Service.of({ admit })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [
    Database.node,
    SelfImprovementArtifactStore.node,
    SelfImprovementTransitionStore.node,
    SelfImprovementAuditStore.node,
    SelfImprovementIdempotencyStore.node,
  ],
})

function digest(domain: string, value: unknown): SelfImprovement.Digest {
  return SelfImprovement.Digest.make(Hash.sha256(`${domain}\0${canonical(value)}`))
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([left], [right]) => compare(left, right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`
  return JSON.stringify(value)
}

function canonicalManifest(manifest: SelfImprovementLifecycle.CapabilityManifest) {
  return {
    toolIDs: [...manifest.toolIDs].sort(),
    filesystemScopeIDs: [...manifest.filesystemScopeIDs].sort(),
    networkOriginIDs: [...manifest.networkOriginIDs].sort(),
    modelRoutes: [...manifest.modelRoutes].sort((left, right) => compare(canonical(left), canonical(right))),
    childAgentTargets: [...manifest.childAgentTargets].sort(),
    artifactReferences: [...manifest.artifactReferences].sort((left, right) =>
      compare(canonical(left), canonical(right)),
    ),
    denies: [...manifest.denies].sort((left, right) => compare(canonical(left), canonical(right))),
  }
}

function totals(): SelfImprovementEvaluation.MetricTotals {
  return {
    taskQualityEarnedAllowlistedPoints: 0,
    taskQualityPossibleAllowlistedPoints: 0,
    correctnessPassedRequiredChecks: 0,
    correctnessRequiredChecks: 0,
    repeatFixRepeatedTasks: 0,
    repeatFixCompletedTasks: 0,
    precisionAcceptedRelevantItems: 0,
    precisionAssessedItems: 0,
    acceptedLatencySampleCount: 0,
    latencySampleSetDigest: SelfImprovement.Digest.make("0".repeat(64)),
    inputTokens: 0,
    outputTokens: 0,
    successfulTasks: 0,
    cacheReadTokens: 0,
    cacheEligibleTokens: 0,
  }
}
function aggregates(): SelfImprovementEvaluation.MetricAggregates {
  return new SelfImprovementEvaluation.MetricAggregates({
    taskQuality: 0,
    correctness: 0,
    repeatFixRate: 0,
    precision: 0,
    latencyP95Ms: 0,
    tokensPerSuccess: 0,
    cacheHitRatio: 0,
  })
}
function compare(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0
}
