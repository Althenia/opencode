export * as SelfImprovementGeneration from "./generation"

import { LLM, LLMClient } from "@opencode-ai/llm"
import { Clock, Context, Duration, Effect, Layer, Schema } from "effect"
import {
  SelfImprovement,
  SelfImprovementEvaluation,
  SelfImprovementLearning,
  SelfImprovementLifecycle,
} from "@opencode-ai/schema"
import { Catalog } from "../catalog"
import { makeLocationNode } from "../effect/app-node"
import { llmClient } from "../effect/app-node-platform"
import { Integration } from "../integration"
import { PluginV2 } from "../plugin"
import { PluginInternal } from "../plugin/internal"
import { SessionRunnerModel } from "../session/runner/model"
import { Hash } from "../util/hash"
import { SelfImprovementAdmission } from "./admission"
import { SelfImprovementArtifactStore } from "./artifact-store"
import { SelfImprovementAuthorization } from "./authorization"
import { VariantPluginID } from "./contracts"
import { SelfImprovementGenerationStore } from "./generation-store"
import { SelfImprovementLearningStore } from "./learning-store"
import { SelfImprovementProposal } from "./proposal"

export interface Pattern {
  readonly patternDigest: SelfImprovement.Digest
  readonly workload: SelfImprovementEvaluation.Workload
  readonly workloadRevision: SelfImprovementLifecycle.Revision
  readonly errorClass: string
  readonly orderedToolSymbolDigest: SelfImprovement.Digest
  readonly outcomeClass: SelfImprovementLearning.ObservationOutcomeClass
}

export interface Interface {
  readonly generate: (input: {
    readonly principal: SelfImprovementLifecycle.Principal
    readonly pattern: Pattern
    readonly now: SelfImprovementLifecycle.TimestampMillis
  }) => Effect.Effect<
    SelfImprovementLearning.GenerationLease,
    | SelfImprovementGenerationStore.NotEligible
    | SelfImprovementAuthorization.Forbidden
    | ModelUnavailable
    | AdmissionRejected
  >
}
export class Service extends Context.Service<Service, Interface>()("@opencode/SelfImprovementGeneration") {}

export class ModelUnavailable extends Schema.TaggedErrorClass<ModelUnavailable>()(
  "SelfImprovementGeneration.ModelUnavailable",
  {
    message: Schema.String,
  },
) {}

export class AdmissionRejected extends Schema.TaggedErrorClass<AdmissionRejected>()(
  "SelfImprovementGeneration.AdmissionRejected",
  {
    message: Schema.String,
  },
) {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const admission = yield* SelfImprovementAdmission.Service
    const artifacts = yield* SelfImprovementArtifactStore.Service
    const catalog = yield* Catalog.Service
    const generation = yield* SelfImprovementGenerationStore.Service
    const learning = yield* SelfImprovementLearningStore.Service
    const llm = yield* LLMClient.Service
    const integrations = yield* Integration.Service
    const plugins = yield* PluginV2.Service
    const generate = Effect.fn("SelfImprovementGeneration.generate")(function* (input: {
      readonly principal: SelfImprovementLifecycle.Principal
      readonly pattern: Pattern
      readonly now: SelfImprovementLifecycle.TimestampMillis
    }) {
      yield* SelfImprovementAuthorization.authorize(input.principal, "generation.execute", input.principal.locationID)
      yield* plugins.wait(VariantPluginID)
      const defaultModel = yield* catalog.model.default()
      const preflight = yield* Effect.gen(function* () {
        const smallModel = defaultModel === undefined ? undefined : yield* catalog.model.small(defaultModel.providerID)
        if (smallModel === undefined) return undefined
        const provider = yield* catalog.provider.get(smallModel.providerID)
        const connection = yield* integrations.connection.active(
          provider?.integrationID ?? Integration.ID.make(smallModel.providerID),
        )
        const credential = connection ? yield* integrations.connection.resolve(connection) : undefined
        return {
          model: smallModel,
          resolved: yield* SessionRunnerModel.fromCatalogModel(smallModel, credential),
        }
      }).pipe(
        Effect.map((right) => ({ _tag: "Right" as const, right })),
        Effect.catch((left) => Effect.succeed({ _tag: "Left" as const, left })),
      )
      const patternMetadata = {
        derivationRevision: 1,
        digest: input.pattern.patternDigest,
        workload: input.pattern.workload,
        workloadRevision: input.pattern.workloadRevision,
        errorClass: input.pattern.errorClass,
        orderedToolSymbolDigest: input.pattern.orderedToolSymbolDigest,
        outcomeClass: input.pattern.outcomeClass,
      }
      const baseRequestDigest = SelfImprovement.Digest.make(
        Hash.sha256(
          JSON.stringify({
            model:
              preflight._tag === "Right" && preflight.right !== undefined
                ? { id: preflight.right.model.id, providerID: preflight.right.model.providerID }
                : undefined,
            pattern: patternMetadata,
          }),
        ),
      )
      const leaseTokenDigest = SelfImprovement.Digest.make(Hash.sha256(crypto.randomUUID()))
      if (preflight._tag === "Left" || preflight.right === undefined) {
        const lease = yield* generation.acquire({
          locationID: input.principal.locationID,
          ownerID: input.principal.id,
          patternDigest: input.pattern.patternDigest,
          requestDigest: baseRequestDigest,
          leaseTokenDigest,
          now: input.now,
        })
        if (lease === undefined)
          return yield* new SelfImprovementGenerationStore.NotEligible({ message: "Generation lease is active" })
        if (lease.output !== undefined) {
          if (lease.pullEventID !== undefined) return yield* admit(lease, lease.output, lease.pullEventID)
          yield* generation.finish({
            leaseID: lease.id,
            leaseTokenDigest: lease.leaseTokenDigest,
            now: input.now,
            outcome: "hard-rejected",
          })
          return yield* new AdmissionRejected({ message: "Persisted generated output is missing its strategy pull" })
        }
        yield* generation.finish({
          leaseID: lease.id,
          leaseTokenDigest: lease.leaseTokenDigest,
          now: input.now,
          outcome: "model-failed",
        })
        return yield* new ModelUnavailable({ message: "No supported small model is available" })
      }

      const model = preflight.right
      const arms = yield* learning.listGenerationArms(input.principal.locationID)
      const allowlistRevision = arms[0]?.allowlistRevision
      const eligibleArmIDs = arms.filter((arm) => arm.allowlistRevision === allowlistRevision).map((arm) => arm.id)
      const selected =
        allowlistRevision === undefined
          ? undefined
          : yield* learning.select({
              locationID: input.principal.locationID,
              actionDomain: "generation-strategy",
              derivationRevision: SelfImprovementLifecycle.Revision.make(1),
              allowlistRevision,
              eligibleArmIDs,
              buckets: [input.pattern.patternDigest],
            })
      const strategy = selected === undefined ? undefined : arms.find((arm) => arm.id === selected.selectedArmID)
      const modelRequestDigest = SelfImprovement.Digest.make(
        Hash.sha256(
          JSON.stringify({
            model: { id: model.model.id, providerID: model.model.providerID },
            pattern: patternMetadata,
            strategy: strategy === undefined ? undefined : { id: strategy.id, strategyID: strategy.strategyID },
          }),
        ),
      )
      const pull =
        selected === undefined || allowlistRevision === undefined
          ? undefined
          : SelfImprovementLearning.PullEvent.make({
              id: SelfImprovementLifecycle.PullEventID.make(
                `si_pul_${Hash.sha256(
                  JSON.stringify({
                    allowlistRevision,
                    bucketDigest: selected.bucketDigest,
                    locationID: input.principal.locationID,
                    selectedArmID: selected.selectedArmID,
                    timestamp: input.now,
                  }),
                )}`,
              ),
              locationID: input.principal.locationID,
              actionDomain: "generation-strategy",
              bucketDigest: selected.bucketDigest,
              derivationRevision: SelfImprovementLifecycle.Revision.make(1),
              allowlistRevision,
              orderedEligibleArmIDs: [...eligibleArmIDs].toSorted(),
              selectedArmID: selected.selectedArmID,
              timestamp: input.now,
            })
      const lease = yield* generation.acquire({
        locationID: input.principal.locationID,
        ownerID: input.principal.id,
        patternDigest: input.pattern.patternDigest,
        requestDigest: modelRequestDigest,
        leaseTokenDigest,
        now: input.now,
        selectedPull: pull,
      })
      if (lease === undefined)
        return yield* new SelfImprovementGenerationStore.NotEligible({ message: "Generation lease is active" })
      if (lease.output !== undefined) {
        if (lease.pullEventID === undefined) {
          yield* generation.finish({
            leaseID: lease.id,
            leaseTokenDigest: lease.leaseTokenDigest,
            now: input.now,
            outcome: "hard-rejected",
          })
          return yield* new AdmissionRejected({ message: "Persisted generated output is missing its strategy pull" })
        }
        return yield* admit(lease, lease.output, lease.pullEventID)
      }
      if (pull === undefined) {
        yield* generation.finish({
          leaseID: lease.id,
          leaseTokenDigest: lease.leaseTokenDigest,
          now: input.now,
          outcome: "model-failed",
        })
        return (yield* generation.get(lease.id))?.lease ?? lease.lease
      }

      const request = LLM.request({
        model: model.resolved,
        system:
          "Return exactly one SkillProposal JSON object. Do not include prose, markdown, or any other proposal kind.",
        prompt: JSON.stringify({
          pattern: patternMetadata,
          strategy: strategy === undefined ? undefined : { id: strategy.id, strategyID: strategy.strategyID },
        }),
      })
      const response = yield* Effect.raceFirst(
        llm.generate(request).pipe(
          Effect.map((right) => ({ _tag: "Right" as const, right })),
          Effect.catch((left) => Effect.succeed({ _tag: "Left" as const, left })),
        ),
        Effect.gen(function* () {
          while (true) {
            yield* Effect.sleep(Duration.minutes(5))
            const renewed = yield* generation.renew({
              leaseID: lease.id,
              leaseTokenDigest: lease.leaseTokenDigest,
              now: SelfImprovementLifecycle.TimestampMillis.make(yield* Clock.currentTimeMillis),
            })
            if (!renewed) return yield* Effect.die("Generation lease ownership lost")
          }
        }),
      )
      if (response._tag === "Left") {
        yield* generation.finish({
          leaseID: lease.id,
          leaseTokenDigest: lease.leaseTokenDigest,
          now: input.now,
          outcome: "model-failed",
        })
        yield* recordReward(lease.pullEventID, "no-reward-model-failure", undefined, lease.modelRequestDigest)
        return yield* new ModelUnavailable({ message: "Model generation failed" })
      }
      const output = new TextEncoder().encode(response.right.text)
      if (
        !(yield* generation.recordOutput({
          leaseID: lease.id,
          leaseTokenDigest: lease.leaseTokenDigest,
          output,
          now: input.now,
        }))
      )
        return (yield* generation.get(lease.id))?.lease ?? lease.lease
      return yield* admit(lease, output, pull.id)

      function* admit(
        current: SelfImprovementGenerationStore.LeaseDetails,
        output: Uint8Array,
        strategyPullID: SelfImprovementLifecycle.PullEventID,
      ) {
        const parsed = SelfImprovementProposal.parse(output)
        if (parsed._tag === "rejected" || parsed.proposal.kind !== "skill" || parsed.proposal.references.length > 0) {
          yield* generation.finish({
            leaseID: current.id,
            leaseTokenDigest: current.leaseTokenDigest,
            now: input.now,
            outcome: "output-rejected",
          })
          yield* recordReward(
            strategyPullID,
            "invalid-model-output",
            -1,
            SelfImprovementProposal.rejectedByteDigest(output),
          )
          return yield* new AdmissionRejected({ message: "Generated output is not an unreferenced skill proposal" })
        }
        const outputDigest = SelfImprovement.Digest.make(Hash.sha256(Buffer.from(output)))
        const key = new SelfImprovementLifecycle.ArtifactKey({
          locationID: input.principal.locationID,
          kind: parsed.proposal.kind,
          name: parsed.proposal.name,
        })
        const existing = yield* artifacts.getArtifactByKey({ key })
        const active = existing?.status === "live" ? yield* artifacts.getActiveArtifactVersionByKey({ key }) : undefined
        if (existing !== undefined && active === undefined) {
          yield* generation.finish({
            leaseID: current.id,
            leaseTokenDigest: current.leaseTokenDigest,
            now: input.now,
            outcome: "hard-rejected",
          })
          return yield* new AdmissionRejected({ message: "Generated skill name does not have a live active lineage" })
        }
        if (active !== undefined && active.version.source !== "generated") {
          yield* generation.finish({
            leaseID: current.id,
            leaseTokenDigest: current.leaseTokenDigest,
            now: input.now,
            outcome: "hard-rejected",
          })
          return yield* new AdmissionRejected({ message: "Generated skill cannot append to a non-generated lineage" })
        }
        const admissionResult = yield* admission
          .admit({
            locationID: input.principal.locationID,
            proposalBytes: output,
            principal: input.principal,
            source: "generated",
            behaviorClass: active?.version.behaviorClass ?? "instruction-only",
            capabilityManifest: emptyManifest(),
            generated: new SelfImprovementLifecycle.GeneratedContentMetadata({
              generationLeaseID: current.id,
              strategyPullID,
              originatingTaskIDDigest: current.originatingTaskIDDigest,
              modelRequestDigest: current.modelRequestDigest,
              modelOutputDigest: outputDigest,
              retentionDeadline: SelfImprovementLifecycle.TimestampMillis.make(input.now + 180 * 86_400_000),
            }),
            ...(active === undefined
              ? {}
              : { append: { artifactID: active.artifact.id, expectedRevision: active.artifact.revision } }),
            idempotencyKey: SelfImprovementLearning.IdempotencyKey.make(`generation:${current.id}`),
            operation: "artifact.create",
            policy: {
              known: { tools: [], filesystemScopes: [], networkOrigins: [], childAgents: [], modelRoutes: [] },
              grant: emptyManifest(),
              baseline: emptyManifest(),
              taskEnvelope: emptyManifest(),
              references: { common: "pass", typed: "pass", cycle: "pass", models: "pass" },
              resolve: () => [],
            },
            now: input.now,
          })
          .pipe(
            Effect.as({ _tag: "Right" as const }),
            Effect.catch((left) => Effect.succeed({ _tag: "Left" as const, left })),
          )
        if (admissionResult._tag === "Left") {
          yield* generation.finish({
            leaseID: current.id,
            leaseTokenDigest: current.leaseTokenDigest,
            now: input.now,
            outcome: "hard-rejected",
          })
          yield* recordReward(strategyPullID, "no-reward-hard-rejection", undefined, outputDigest)
          return yield* new AdmissionRejected({ message: admissionResult.left.message })
        }
        yield* generation.finish({
          leaseID: current.id,
          leaseTokenDigest: current.leaseTokenDigest,
          now: input.now,
          outcome: "admitted",
        })
        return (yield* generation.get(current.id))?.lease ?? current.lease
      }

      function emptyManifest() {
        return new SelfImprovementLifecycle.CapabilityManifest({
          toolIDs: [],
          filesystemScopeIDs: [],
          networkOriginIDs: [],
          modelRoutes: [],
          childAgentTargets: [],
          artifactReferences: [],
          denies: [],
        })
      }

      function recordReward(
        pullEventID: SelfImprovementLifecycle.PullEventID | undefined,
        outcomeClass: SelfImprovementLearning.RewardOutcomeClass,
        numericReward: -1 | undefined,
        evidenceDigest: SelfImprovement.Digest,
      ) {
        if (pullEventID === undefined) return Effect.void
        return learning
          .appendReward(
            new SelfImprovementLearning.RewardEvent({
              id: SelfImprovementLifecycle.RewardEventID.create(),
              locationID: input.principal.locationID,
              pullEventID,
              outcomeClass,
              ...(numericReward === undefined ? {} : { numericReward }),
              evidenceDigest,
              timestamp: input.now,
            }),
          )
          .pipe(Effect.orDie)
      }
    })
    return Service.of({ generate })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [
    SelfImprovementAdmission.node,
    SelfImprovementArtifactStore.node,
    Catalog.node,
    SelfImprovementGenerationStore.node,
    SelfImprovementLearningStore.node,
    Integration.node,
    PluginV2.node,
    PluginInternal.node,
    llmClient,
  ],
})
