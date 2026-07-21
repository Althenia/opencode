import { expect, test } from "bun:test"
import { SqliteClient } from "@effect/sql-sqlite-bun"
import { EffectDrizzleSqlite } from "@opencode-ai/effect-drizzle-sqlite"
import { LLMClient, LLMError, LLMEvent, LLMResponse, Message, TransportReason, type LLMRequest } from "@opencode-ai/ai"
import {
  Money,
  SelfImprovement,
  SelfImprovementEvaluation,
  SelfImprovementLearning,
  SelfImprovementLifecycle,
} from "@opencode-ai/schema"
import { Catalog } from "@opencode-ai/core/catalog"
import { Credential } from "@opencode-ai/core/credential"
import { Database } from "@opencode-ai/core/database/database"
import { Integration } from "@opencode-ai/core/integration"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { SelfImprovementAdmission } from "@opencode-ai/core/self-improvement/admission"
import { SelfImprovementArtifactStore } from "@opencode-ai/core/self-improvement/artifact-store"
import { SelfImprovementGenerationStore } from "@opencode-ai/core/self-improvement/generation-store"
import { SelfImprovementGeneration } from "@opencode-ai/core/self-improvement/generation"
import { SelfImprovementLearningStore } from "@opencode-ai/core/self-improvement/learning-store"
import { Cause, Effect, Layer, Schema } from "effect"
import { sql } from "drizzle-orm"

const makeDb = EffectDrizzleSqlite.makeWithDefaults()
const locationID = SelfImprovementLifecycle.LocationID.make("a".repeat(64))
const ownerID = SelfImprovementLifecycle.PrincipalID.make("generator")
const patternDigest = SelfImprovement.Digest.make("1".repeat(64))
const requestDigest = SelfImprovement.Digest.make("2".repeat(64))
const taskIDDigest = SelfImprovement.Digest.make("3".repeat(64))
const patternMetadata = {
  patternDigest,
  workload: SelfImprovementEvaluation.Workload.make("agent:build"),
  workloadRevision: SelfImprovementLifecycle.Revision.make(1),
  errorClass: "tool.bash.failed",
  orderedToolSymbolDigest: SelfImprovement.Digest.make("4".repeat(64)),
  outcomeClass: "failure" as const,
}
const now = SelfImprovementLifecycle.TimestampMillis.make(1_000_000_000)
const token = (value: string) => SelfImprovement.Digest.make(value.repeat(64).slice(0, 64))
const integrationLayer = (connection: Partial<Integration.Interface["connection"]> = {}) =>
  Layer.mock(Integration.Service, {
    connection: {
      active: () => Effect.succeed(undefined),
      resolve: () => Effect.die("unused"),
      key: () => Effect.die("unused"),
      update: () => Effect.die("unused"),
      remove: () => Effect.die("unused"),
      ...connection,
    },
    oauth: {
      connect: () => Effect.die("unused"),
      status: () => Effect.die("unused"),
      complete: () => Effect.die("unused"),
      cancel: () => Effect.die("unused"),
    },
    command: {
      connect: () => Effect.die("unused"),
      status: () => Effect.die("unused"),
      cancel: () => Effect.die("unused"),
    },
  })

test("uses the LLM client rather than a coordinator-local model-call seam", () => {
  expect("ModelCall" in SelfImprovementGeneration).toBe(false)
})

const smallModel = ModelV2.Info.make({
  id: ModelV2.ID.make("small-model"),
  modelID: ModelV2.ID.make("small-api"),
  providerID: ProviderV2.ID.make("test-provider"),
  name: "Small model",
  package: "@opencode-ai/ai/providers/openai",
  capabilities: { tools: false, input: ["text"], output: ["text"] },
  variants: [],
  time: { released: Date.now() },
  cost: [
    {
      input: Money.USDPerMillionTokens.make(1),
      output: Money.USDPerMillionTokens.make(1),
      cache: { read: Money.USDPerMillionTokens.zero, write: Money.USDPerMillionTokens.zero },
    },
  ],
  status: "active",
  enabled: true,
  limit: { context: 1_000, output: 1_000 },
})

const lineageProposal = Schema.decodeUnknownSync(SelfImprovement.SkillProposal)({
  kind: "skill",
  name: "generated",
  definition: { description: "Generated", content: "Use the generated skill" },
  references: [],
})
const lineageManifest = new SelfImprovementLifecycle.CapabilityManifest({
  toolIDs: [],
  filesystemScopeIDs: [],
  networkOriginIDs: [],
  modelRoutes: [],
  childAgentTargets: [],
  artifactReferences: [],
  denies: [],
})
const lineageArtifact = (status: SelfImprovementLifecycle.ArtifactStatus = "live") =>
  new SelfImprovementLifecycle.Artifact({
    id: SelfImprovementLifecycle.ArtifactID.make("si_art_generated"),
    key: new SelfImprovementLifecycle.ArtifactKey({
      locationID,
      kind: "skill",
      name: SelfImprovement.CandidateName.make("generated"),
    }),
    status,
    createdBy: ownerID,
    createdAt: now,
    revision: SelfImprovementLifecycle.Revision.make(4),
    ...(status === "tombstoned"
      ? {
          tombstone: new SelfImprovementLifecycle.Tombstone({
            actorID: ownerID,
            reason: "reserved",
            timestamp: now,
          }),
        }
      : {}),
  })
const lineageVersion = (
  source: SelfImprovementLifecycle.ArtifactSource,
  behaviorClass: SelfImprovementLifecycle.BehaviorClass,
) =>
  new SelfImprovementLifecycle.ArtifactVersion({
    id: SelfImprovementLifecycle.ArtifactVersionID.make(`si_ver_${source}`),
    artifactID: lineageArtifact().id,
    versionNumber: 2,
    source,
    behaviorClass,
    proposal: lineageProposal,
    canonicalJson: SelfImprovement.CanonicalJson.make(
      '{"definition":{"content":"Use the generated skill","description":"Generated"},"kind":"skill","name":"generated","references":[]}',
    ),
    proposalDigest: token("a"),
    inputSnapshotDigest: token("b"),
    versionDigest: token("c"),
    capabilityManifest: lineageManifest,
    capabilityManifestDigest: token("d"),
    creatorID: ownerID,
    createdAt: now,
    ...(source === "generated"
      ? {
          generated: new SelfImprovementLifecycle.GeneratedContentMetadata({
            generationLeaseID: SelfImprovementLifecycle.GenerationLeaseID.make("si_les_lineage"),
            strategyPullID: SelfImprovementLifecycle.PullEventID.make("si_pul_lineage"),
            originatingTaskIDDigest: taskIDDigest,
            modelRequestDigest: requestDigest,
            modelOutputDigest: token("e"),
            retentionDeadline: SelfImprovementLifecycle.TimestampMillis.make(now + 1),
          }),
        }
      : {}),
  })

const lineageArm = new SelfImprovementLearning.GenerationStrategyArm({
  id: SelfImprovementLifecycle.GenerationStrategyArmID.make("si_gsa_lineage"),
  locationID,
  strategyID: "json-skill",
  allowlistRevision: SelfImprovementLifecycle.Revision.make(1),
  active: true,
})
const lineageOutput = JSON.stringify({
  kind: "skill",
  name: "generated",
  definition: { description: "Generated", content: "Use the generated skill" },
  references: [],
})
const lineageDependencies = (admit: SelfImprovementAdmission.Interface["admit"]) =>
  Layer.mergeAll(
    Layer.mock(Catalog.Service, {
      provider: {
        get: () => Effect.succeed(undefined),
        all: () => Effect.die("unused"),
        available: () => Effect.die("unused"),
      },
      model: {
        get: () => Effect.die("unused"),
        all: () => Effect.die("unused"),
        available: () => Effect.die("unused"),
        default: () => Effect.succeed(smallModel),
        small: () => Effect.succeed(smallModel),
      },
    }),
    Layer.mock(SelfImprovementLearningStore.Service, {
      listGenerationArms: () => Effect.succeed([lineageArm]),
      select: () => Effect.succeed({ bucketDigest: patternDigest, selectedArmID: lineageArm.id }),
      appendReward: () => Effect.void,
    }),
    integrationLayer(),
    Layer.mock(LLMClient.Service, {
      generate: () =>
        Effect.succeed(
          new LLMResponse({
            message: Message.assistant(lineageOutput),
            events: [LLMEvent.textDelta({ id: "output", text: lineageOutput })],
            finishReason: "stop",
          }),
        ),
    }),
    Layer.mock(SelfImprovementAdmission.Service, { admit }),
  )

test("reads V2 catalog models directly before generation", async () => {
  await Effect.runPromise(
    program(
      Effect.gen(function* () {
        const calls: string[] = []
        const dependencies = Layer.mergeAll(
          Layer.mock(Catalog.Service, {
            provider: {
              get: () =>
                Effect.sync(() => {
                  calls.push("provider")
                  return undefined
                }),
              all: () => Effect.die("unused"),
              available: () => Effect.die("unused"),
            },
            model: {
              get: () => Effect.die("unused"),
              all: () => Effect.die("unused"),
              available: () => Effect.die("unused"),
              default: () =>
                Effect.sync(() => {
                  calls.push("default")
                  return smallModel
                }),
              small: () =>
                Effect.sync(() => {
                  calls.push("small")
                  return smallModel
                }),
            },
          }),
          Layer.mock(SelfImprovementLearningStore.Service, {
            listGenerationArms: () => Effect.succeed([]),
            select: () => Effect.die("unused"),
            appendReward: () => Effect.die("unused"),
          }),
          integrationLayer(),
          Layer.mock(LLMClient.Service, {
            generate: () => Effect.die("LLM must not run without a selected strategy"),
          }),
          Layer.mock(SelfImprovementAdmission.Service, {
            admit: () => Effect.die("admission must not run without a selected strategy"),
          }),
        )
        const coordinator = SelfImprovementGeneration.layer.pipe(
          Layer.provideMerge(
            Layer.mock(SelfImprovementArtifactStore.Service, {
              getArtifactByKey: () => Effect.succeed(undefined),
              getActiveArtifactVersionByKey: () => Effect.succeed(undefined),
            }),
          ),
          Layer.provideMerge(dependencies),
        )
        const generation = yield* SelfImprovementGeneration.Service.use((service) =>
          service.generate({
            principal: new SelfImprovementLifecycle.Principal({ id: ownerID, kind: "coordinator", locationID }),
            pattern: patternMetadata,
            now,
          }),
        ).pipe(Effect.provide(coordinator))

        expect(generation.outcome).toBe("model-failed")
        expect(calls).toEqual(["default", "small", "provider"])
      }),
    ),
  )
})

test("does not select, reward, or call the LLM when a typed credential preflight fails", async () => {
  await Effect.runPromise(
    program(
      Effect.gen(function* () {
        let selected = 0
        let rewarded = 0
        let generated = 0
        const dependencies = Layer.mergeAll(
          Layer.mock(Catalog.Service, {
            provider: {
              get: () => Effect.succeed(undefined),
              all: () => Effect.die("unused"),
              available: () => Effect.die("unused"),
            },
            model: {
              get: () => Effect.die("unused"),
              all: () => Effect.die("unused"),
              available: () => Effect.die("unused"),
              default: () => Effect.succeed(smallModel),
              small: () => Effect.succeed(smallModel),
            },
          }),
          Layer.mock(SelfImprovementLearningStore.Service, {
            listGenerationArms: () => Effect.die("pull selection must not be reached"),
            select: () =>
              Effect.sync(() => {
                selected += 1
              }).pipe(Effect.andThen(Effect.die("unused"))),
            appendReward: () =>
              Effect.sync(() => {
                rewarded += 1
              }),
          }),
          integrationLayer({
            active: () =>
              Effect.succeed({
                type: "credential",
                id: Credential.ID.make("credential"),
                label: "Credential",
              }),
            resolve: () =>
              Effect.fail(new Integration.AuthorizationError({ cause: new Error("credential unavailable") })),
          }),
          Layer.mock(LLMClient.Service, {
            generate: () =>
              Effect.sync(() => {
                generated += 1
              }).pipe(Effect.andThen(Effect.die("unused"))),
          }),
          Layer.mock(SelfImprovementAdmission.Service, {
            admit: () => Effect.die("admission must not run after preflight failure"),
          }),
        )
        const coordinator = SelfImprovementGeneration.layer.pipe(
          Layer.provideMerge(
            Layer.mock(SelfImprovementArtifactStore.Service, {
              getArtifactByKey: () => Effect.succeed(undefined),
              getActiveArtifactVersionByKey: () => Effect.succeed(undefined),
            }),
          ),
          Layer.provideMerge(dependencies),
        )
        const generation = yield* SelfImprovementGeneration.Service.use((service) =>
          service
            .generate({
              principal: new SelfImprovementLifecycle.Principal({ id: ownerID, kind: "coordinator", locationID }),
              pattern: patternMetadata,
              now,
            })
            .pipe(Effect.exit),
        ).pipe(Effect.provide(coordinator))

        expect(generation).toMatchObject({
          _tag: "Failure",
          cause: { reasons: [{ error: { _tag: "SelfImprovementGeneration.ModelUnavailable" } }] },
        })
        expect(selected).toBe(0)
        expect(rewarded).toBe(0)
        expect(generated).toBe(0)
      }),
    ),
  )
})

test("returns ModelUnavailable after persisting a model preflight failure", async () => {
  await Effect.runPromise(
    program(
      Effect.gen(function* () {
        const dependencies = Layer.mergeAll(
          Layer.mock(Catalog.Service, {
            provider: {
              get: () => Effect.die("unused"),
              all: () => Effect.die("unused"),
              available: () => Effect.die("unused"),
            },
            model: {
              get: () => Effect.die("unused"),
              all: () => Effect.die("unused"),
              available: () => Effect.die("unused"),
              default: () => Effect.succeed(undefined),
              small: () => Effect.die("unused"),
            },
          }),
          Layer.mock(SelfImprovementLearningStore.Service, {
            listGenerationArms: () => Effect.die("unused"),
            select: () => Effect.die("unused"),
            appendReward: () => Effect.die("unused"),
          }),
          integrationLayer({ active: () => Effect.die("unused") }),
          Layer.mock(LLMClient.Service, { generate: () => Effect.die("unused") }),
          Layer.mock(SelfImprovementAdmission.Service, { admit: () => Effect.die("unused") }),
        )
        const coordinator = SelfImprovementGeneration.layer.pipe(
          Layer.provideMerge(
            Layer.mock(SelfImprovementArtifactStore.Service, {
              getArtifactByKey: () => Effect.succeed(undefined),
              getActiveArtifactVersionByKey: () => Effect.succeed(undefined),
            }),
          ),
          Layer.provideMerge(dependencies),
        )
        const service = yield* SelfImprovementGeneration.Service.pipe(Effect.provide(coordinator))
        const result = yield* service
          .generate({
            principal: new SelfImprovementLifecycle.Principal({ id: ownerID, kind: "coordinator", locationID }),
            pattern: patternMetadata,
            now,
          })
          .pipe(Effect.exit)
        expect(result).toMatchObject({
          _tag: "Failure",
          cause: { reasons: [{ error: { _tag: "SelfImprovementGeneration.ModelUnavailable" } }] },
        })
        const db = yield* Database.Service
        expect(
          yield* db.db.get<{ outcome: string }>(
            sql`SELECT outcome FROM self_improvement_generation_lease WHERE location_id = ${locationID}`,
          ),
        ).toEqual({ outcome: "model-failed" })
      }),
    ),
  )
})

test("returns AdmissionRejected after persisting a governed admission rejection", async () => {
  await Effect.runPromise(
    program(
      Effect.gen(function* () {
        const arm = new SelfImprovementLearning.GenerationStrategyArm({
          id: SelfImprovementLifecycle.GenerationStrategyArmID.make("si_gsa_rejected"),
          locationID,
          strategyID: "json-skill",
          allowlistRevision: SelfImprovementLifecycle.Revision.make(1),
          active: true,
        })
        const output = JSON.stringify({
          kind: "skill",
          name: "rejected",
          definition: { description: "Rejected", content: "Use the rejected skill" },
          references: [],
        })
        const dependencies = Layer.mergeAll(
          Layer.mock(Catalog.Service, {
            provider: {
              get: () => Effect.succeed(undefined),
              all: () => Effect.die("unused"),
              available: () => Effect.die("unused"),
            },
            model: {
              get: () => Effect.die("unused"),
              all: () => Effect.die("unused"),
              available: () => Effect.die("unused"),
              default: () => Effect.succeed(smallModel),
              small: () => Effect.succeed(smallModel),
            },
          }),
          Layer.mock(SelfImprovementLearningStore.Service, {
            listGenerationArms: () => Effect.succeed([arm]),
            select: () => Effect.succeed({ bucketDigest: patternDigest, selectedArmID: arm.id }),
            appendReward: () => Effect.void,
          }),
          integrationLayer(),
          Layer.mock(LLMClient.Service, {
            generate: () =>
              Effect.succeed(
                new LLMResponse({
                  message: Message.assistant(output),
                  events: [LLMEvent.textDelta({ id: "output", text: output })],
                  finishReason: "stop",
                }),
              ),
          }),
          Layer.mock(SelfImprovementAdmission.Service, {
            admit: () => Effect.fail(new SelfImprovementAdmission.Rejected({ message: "governed rejection" })),
          }),
        )
        const coordinator = SelfImprovementGeneration.layer.pipe(
          Layer.provideMerge(
            Layer.mock(SelfImprovementArtifactStore.Service, {
              getArtifactByKey: () => Effect.succeed(undefined),
              getActiveArtifactVersionByKey: () => Effect.succeed(undefined),
            }),
          ),
          Layer.provideMerge(dependencies),
        )
        const result = yield* SelfImprovementGeneration.Service.use((service) =>
          service
            .generate({
              principal: new SelfImprovementLifecycle.Principal({ id: ownerID, kind: "coordinator", locationID }),
              pattern: patternMetadata,
              now,
            })
            .pipe(Effect.exit),
        ).pipe(Effect.provide(coordinator))
        expect(result).toMatchObject({
          _tag: "Failure",
          cause: { reasons: [{ error: { _tag: "SelfImprovementGeneration.AdmissionRejected" } }] },
        })
        const db = yield* Database.Service
        expect(
          yield* db.db.get<{ outcome: string }>(
            sql`SELECT outcome FROM self_improvement_generation_lease WHERE location_id = ${locationID}`,
          ),
        ).toEqual({ outcome: "hard-rejected" })
      }),
    ),
  )
})

test("binds the selected generation strategy into the redacted model request and digest", async () => {
  await Effect.runPromise(
    program(
      Effect.gen(function* () {
        const requests: LLMRequest[] = []
        const arm = new SelfImprovementLearning.GenerationStrategyArm({
          id: SelfImprovementLifecycle.GenerationStrategyArmID.make("si_gsa_strategy"),
          locationID,
          strategyID: "json-skill",
          allowlistRevision: SelfImprovementLifecycle.Revision.make(1),
          active: true,
        })
        const failure = new LLMError({
          module: "test",
          method: "generate",
          reason: new TransportReason({ message: "unavailable" }),
        })
        const dependencies = Layer.mergeAll(
          Layer.mock(Catalog.Service, {
            provider: {
              get: () => Effect.succeed(undefined),
              all: () => Effect.die("unused"),
              available: () => Effect.die("unused"),
            },
            model: {
              get: () => Effect.die("unused"),
              all: () => Effect.die("unused"),
              available: () => Effect.die("unused"),
              default: () => Effect.succeed(smallModel),
              small: () => Effect.succeed(smallModel),
            },
          }),
          Layer.mock(SelfImprovementLearningStore.Service, {
            listGenerationArms: () => Effect.succeed([arm]),
            select: () => Effect.succeed({ bucketDigest: patternDigest, selectedArmID: arm.id }),
            appendReward: () => Effect.void,
          }),
          integrationLayer(),
          Layer.mock(LLMClient.Service, {
            generate: (request: LLMRequest) =>
              Effect.sync(() => requests.push(request)).pipe(Effect.andThen(Effect.fail(failure))),
          }),
          Layer.mock(SelfImprovementAdmission.Service, {
            admit: () => Effect.die("admission must not run after model failure"),
          }),
        )
        const coordinator = SelfImprovementGeneration.layer.pipe(
          Layer.provideMerge(
            Layer.mock(SelfImprovementArtifactStore.Service, {
              getArtifactByKey: () => Effect.succeed(undefined),
              getActiveArtifactVersionByKey: () => Effect.succeed(undefined),
            }),
          ),
          Layer.provideMerge(dependencies),
        )
        const generation = yield* SelfImprovementGeneration.Service.use((service) =>
          service
            .generate({
              principal: new SelfImprovementLifecycle.Principal({ id: ownerID, kind: "coordinator", locationID }),
              pattern: patternMetadata,
              now,
            })
            .pipe(Effect.exit),
        ).pipe(Effect.provide(coordinator))

        expect(generation).toMatchObject({
          _tag: "Failure",
          cause: { reasons: [{ error: { _tag: "SelfImprovementGeneration.ModelUnavailable" } }] },
        })
        expect(requests).toHaveLength(1)
        const content = requests[0]!.messages[0]!.content[0]!
        if (content.type !== "text") throw new Error("expected text prompt")
        expect(JSON.parse(content.text)).toMatchObject({
          pattern: {
            derivationRevision: 1,
            digest: patternDigest,
            workload: patternMetadata.workload,
            workloadRevision: patternMetadata.workloadRevision,
            errorClass: patternMetadata.errorClass,
            orderedToolSymbolDigest: patternMetadata.orderedToolSymbolDigest,
            outcomeClass: patternMetadata.outcomeClass,
          },
          strategy: { id: arm.id, strategyID: arm.strategyID },
        })
        expect(content.text).not.toContain("secret prompt")
        expect(content.text).not.toContain("secret tool input")
      }),
    ),
  )
})

test("replays persisted output after admission defects when the model becomes unavailable", async () => {
  await Effect.runPromise(
    program(
      Effect.gen(function* () {
        const arm = new SelfImprovementLearning.GenerationStrategyArm({
          id: SelfImprovementLifecycle.GenerationStrategyArmID.make("si_gsa_replay"),
          locationID,
          strategyID: "json-skill",
          allowlistRevision: SelfImprovementLifecycle.Revision.make(1),
          active: true,
        })
        const output = JSON.stringify({
          kind: "skill",
          name: "generated",
          definition: { description: "Generated", content: "Use the generated skill" },
          references: [],
        })
        let calls = 0
        let admissions = 0
        let selections = 0
        let modelAvailable = true
        let leaseID: SelfImprovementLifecycle.GenerationLeaseID | undefined
        const store = yield* SelfImprovementGenerationStore.Service
        const dependencies = Layer.mergeAll(
          Layer.mock(Catalog.Service, {
            provider: {
              get: () => Effect.succeed(undefined),
              all: () => Effect.die("unused"),
              available: () => Effect.die("unused"),
            },
            model: {
              get: () => Effect.die("unused"),
              all: () => Effect.die("unused"),
              available: () => Effect.die("unused"),
              default: () => Effect.succeed(modelAvailable ? smallModel : undefined),
              small: () => Effect.succeed(modelAvailable ? smallModel : undefined),
            },
          }),
          Layer.mock(SelfImprovementLearningStore.Service, {
            listGenerationArms: () => Effect.succeed([arm]),
            select: () =>
              Effect.sync(() => {
                selections += 1
                return { bucketDigest: patternDigest, selectedArmID: arm.id }
              }),
            appendReward: () => Effect.void,
          }),
          integrationLayer(),
          Layer.mock(LLMClient.Service, {
            generate: () =>
              Effect.sync(() => {
                calls += 1
                return new LLMResponse({
                  message: Message.assistant(output),
                  events: [LLMEvent.textDelta({ id: "output", text: output })],
                  finishReason: "stop",
                })
              }),
          }),
          Layer.mock(SelfImprovementAdmission.Service, {
            admit: (input) =>
              Effect.sync(() => {
                if (input.generated === undefined) throw new Error("expected generated metadata")
                leaseID = input.generated.generationLeaseID
                return leaseID
              }).pipe(
                Effect.flatMap(store.get),
                Effect.tap((lease) =>
                  Effect.sync(() => {
                    expect(lease?.output).toEqual(new TextEncoder().encode(output))
                    admissions += 1
                  }),
                ),
                Effect.flatMap(() =>
                  admissions === 1
                    ? Effect.die("admission defect")
                    : Effect.succeed({ _tag: "accepted" as const } as SelfImprovementAdmission.Accepted),
                ),
              ),
          }),
        )
        const coordinator = SelfImprovementGeneration.layer.pipe(
          Layer.provideMerge(
            Layer.mock(SelfImprovementArtifactStore.Service, {
              getArtifactByKey: () => Effect.succeed(undefined),
              getActiveArtifactVersionByKey: () => Effect.succeed(undefined),
            }),
          ),
          Layer.provideMerge(dependencies),
        )
        const service = yield* SelfImprovementGeneration.Service.pipe(Effect.provide(coordinator))
        const principal = new SelfImprovementLifecycle.Principal({ id: ownerID, kind: "coordinator", locationID })
        const first = yield* service.generate({ principal, pattern: patternMetadata, now }).pipe(Effect.exit)
        expect(first._tag).toBe("Failure")
        if (first._tag === "Failure") expect(first.cause.reasons.some((reason) => Cause.isDieReason(reason))).toBe(true)
        if (leaseID === undefined) throw new Error("expected generation lease")
        const pending = yield* store.get(leaseID)
        expect(pending?.output).toEqual(new TextEncoder().encode(output))
        expect(pending?.outcome).toBe("pending")
        modelAvailable = false
        const second = yield* service.generate({
          principal,
          pattern: patternMetadata,
          now: SelfImprovementLifecycle.TimestampMillis.make(now + 10 * 60_000),
        })
        expect(second.outcome).toBe("admitted")
        expect(calls).toBe(1)
        expect(selections).toBe(1)
        expect((yield* store.get(leaseID))?.outcome).toBe("admitted")
      }),
    ),
  )
})

test("terminally rejects persisted output without its original strategy pull", async () => {
  await Effect.runPromise(
    program(
      Effect.gen(function* () {
        const store = yield* SelfImprovementGenerationStore.Service
        const first = yield* acquire(store)
        if (first === undefined) throw new Error("expected generation lease")
        expect(
          yield* store.recordOutput({
            leaseID: first.id,
            leaseTokenDigest: token("7"),
            output: new TextEncoder().encode("{}"),
            now,
          }),
        ).toBe(true)
        const dependencies = Layer.mergeAll(
          Layer.mock(Catalog.Service, {
            provider: {
              get: () => Effect.die("unused"),
              all: () => Effect.die("unused"),
              available: () => Effect.die("unused"),
            },
            model: {
              get: () => Effect.die("unused"),
              all: () => Effect.die("unused"),
              available: () => Effect.die("unused"),
              default: () => Effect.succeed(undefined),
              small: () => Effect.die("unused"),
            },
          }),
          integrationLayer({ active: () => Effect.die("unused") }),
          Layer.mock(LLMClient.Service, { generate: () => Effect.die("LLM must not run") }),
          Layer.mock(SelfImprovementAdmission.Service, { admit: () => Effect.die("admission must not run") }),
        )
        const coordinator = SelfImprovementGeneration.layer.pipe(
          Layer.provideMerge(
            Layer.mock(SelfImprovementArtifactStore.Service, {
              getArtifactByKey: () => Effect.succeed(undefined),
              getActiveArtifactVersionByKey: () => Effect.succeed(undefined),
            }),
          ),
          Layer.provideMerge(dependencies),
        )
        const service = yield* SelfImprovementGeneration.Service.pipe(Effect.provide(coordinator))
        const result = yield* service
          .generate({
            principal: new SelfImprovementLifecycle.Principal({ id: ownerID, kind: "coordinator", locationID }),
            pattern: patternMetadata,
            now: SelfImprovementLifecycle.TimestampMillis.make(now + 10 * 60_000),
          })
          .pipe(Effect.exit)
        expect(result).toMatchObject({
          _tag: "Failure",
          cause: { reasons: [{ error: { _tag: "SelfImprovementGeneration.AdmissionRejected" } }] },
        })
        expect((yield* store.get(first.id))?.outcome).toBe("hard-rejected")
      }),
    ),
  )
})

test("appends same-name generation only to the active generated lineage and inherits its behavior class", async () => {
  await Effect.runPromise(
    program(
      Effect.gen(function* () {
        const artifact = lineageArtifact()
        const version = lineageVersion("generated", "behavior-changing")
        let admitted: Parameters<SelfImprovementAdmission.Interface["admit"]>[0] | undefined
        const coordinator = SelfImprovementGeneration.layer.pipe(
          Layer.provideMerge(
            Layer.mock(SelfImprovementArtifactStore.Service, {
              getArtifactByKey: () => Effect.succeed(artifact),
              getActiveArtifactVersionByKey: () => Effect.succeed({ artifact, version }),
            }),
          ),
          Layer.provideMerge(
            lineageDependencies((input) =>
              Effect.sync(() => {
                admitted = input
                return { _tag: "accepted", artifact, version, replayed: false }
              }),
            ),
          ),
        )
        const result = yield* SelfImprovementGeneration.Service.use((service) =>
          service.generate({
            principal: new SelfImprovementLifecycle.Principal({ id: ownerID, kind: "coordinator", locationID }),
            pattern: patternMetadata,
            now,
          }),
        ).pipe(Effect.provide(coordinator))

        expect(result.outcome).toBe("admitted")
        expect(admitted).toMatchObject({
          source: "generated",
          behaviorClass: "behavior-changing",
          append: { artifactID: artifact.id, expectedRevision: artifact.revision },
          generated: { strategyPullID: expect.anything(), originatingTaskIDDigest: taskIDDigest },
        })
      }),
    ),
  )
})

test("creates a new generated skill as an instruction-only lineage", async () => {
  await Effect.runPromise(
    program(
      Effect.gen(function* () {
        const artifact = lineageArtifact()
        const version = lineageVersion("generated", "instruction-only")
        let admitted: Parameters<SelfImprovementAdmission.Interface["admit"]>[0] | undefined
        const coordinator = SelfImprovementGeneration.layer.pipe(
          Layer.provideMerge(
            Layer.mock(SelfImprovementArtifactStore.Service, {
              getArtifactByKey: () => Effect.succeed(undefined),
              getActiveArtifactVersionByKey: () => Effect.die("active lineage must not be read for a new name"),
            }),
          ),
          Layer.provideMerge(
            lineageDependencies((input) =>
              Effect.sync(() => {
                admitted = input
                return { _tag: "accepted", artifact, version, replayed: false }
              }),
            ),
          ),
        )
        const result = yield* SelfImprovementGeneration.Service.use((service) =>
          service.generate({
            principal: new SelfImprovementLifecycle.Principal({ id: ownerID, kind: "coordinator", locationID }),
            pattern: patternMetadata,
            now,
          }),
        ).pipe(Effect.provide(coordinator))

        expect(result.outcome).toBe("admitted")
        expect(admitted).toMatchObject({ source: "generated", behaviorClass: "instruction-only" })
        expect(admitted).not.toHaveProperty("append")
      }),
    ),
  )
})

test("rejects same-name generation without a live generated active lineage", async () => {
  const scenarios = [
    {
      name: "human active lineage",
      artifact: lineageArtifact(),
      active: { artifact: lineageArtifact(), version: lineageVersion("human", "instruction-only") },
    },
    { name: "missing active lineage", artifact: lineageArtifact(), active: undefined },
    { name: "tombstoned name", artifact: lineageArtifact("tombstoned"), active: undefined },
  ] as const

  for (const scenario of scenarios) {
    await Effect.runPromise(
      program(
        Effect.gen(function* () {
          let admissions = 0
          const coordinator = SelfImprovementGeneration.layer.pipe(
            Layer.provideMerge(
              Layer.mock(SelfImprovementArtifactStore.Service, {
                getArtifactByKey: () => Effect.succeed(scenario.artifact),
                getActiveArtifactVersionByKey: () => Effect.succeed(scenario.active),
              }),
            ),
            Layer.provideMerge(
              lineageDependencies(() =>
                Effect.sync(() => {
                  admissions += 1
                  return {
                    _tag: "accepted",
                    artifact: lineageArtifact(),
                    version: lineageVersion("generated", "instruction-only"),
                    replayed: false,
                  }
                }),
              ),
            ),
          )
          const result = yield* SelfImprovementGeneration.Service.use((service) =>
            service
              .generate({
                principal: new SelfImprovementLifecycle.Principal({ id: ownerID, kind: "coordinator", locationID }),
                pattern: patternMetadata,
                now,
              })
              .pipe(Effect.exit),
          ).pipe(Effect.provide(coordinator))

          expect(result).toMatchObject({
            _tag: "Failure",
            cause: { reasons: [{ error: { _tag: "SelfImprovementGeneration.AdmissionRejected" } }] },
          })
          expect(admissions).toBe(0)
        }),
      ),
    )
  }
})

const pull = Schema.decodeSync(SelfImprovementLearning.PullEvent)({
  id: SelfImprovementLifecycle.PullEventID.make("si_pul_test"),
  locationID,
  actionDomain: "generation-strategy",
  bucketDigest: patternDigest,
  derivationRevision: SelfImprovementLifecycle.Revision.make(1),
  allowlistRevision: SelfImprovementLifecycle.Revision.make(1),
  orderedEligibleArmIDs: [SelfImprovementLifecycle.GenerationStrategyArmID.make("si_gsa_test")],
  selectedArmID: SelfImprovementLifecycle.GenerationStrategyArmID.make("si_gsa_test"),
  timestamp: now,
})

const setup = (generationConstraint = "") =>
  Effect.gen(function* () {
    const db = yield* makeDb
    yield* db.run(sql`
      CREATE TABLE self_improvement_observation (
        id TEXT PRIMARY KEY, location_id TEXT NOT NULL, pattern_digest TEXT NOT NULL, identity_digest TEXT NOT NULL,
        workload TEXT NOT NULL, workload_revision INTEGER NOT NULL, error_class TEXT NOT NULL,
        ordered_tool_symbol_digest TEXT NOT NULL, outcome_class TEXT NOT NULL, task_id_digest TEXT NOT NULL,
        producer_id TEXT NOT NULL, occurred_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
      )
    `)
    yield* db.run(sql`
      CREATE TABLE self_improvement_pull_event (
        id TEXT PRIMARY KEY, location_id TEXT NOT NULL, action_domain TEXT NOT NULL, bucket_digest TEXT NOT NULL,
        derivation_revision INTEGER NOT NULL, allowlist_revision INTEGER NOT NULL, ordered_eligible_arm_ids_json TEXT NOT NULL,
        selected_arm_id TEXT NOT NULL, proposal_digest TEXT, session_digest TEXT, version_id TEXT, timestamp INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      )
    `)
    yield* db.run(sql`
      CREATE TABLE self_improvement_generation_lease (
        id TEXT PRIMARY KEY, location_id TEXT NOT NULL, pattern_digest TEXT NOT NULL, owner_id TEXT NOT NULL,
        lease_token_digest TEXT NOT NULL, attempt_number INTEGER NOT NULL, acquired_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL, completed_at INTEGER, model_request_digest TEXT NOT NULL,
        model_output_digest TEXT, model_output_bytes TEXT, outcome TEXT NOT NULL, pull_event_id TEXT,
        originating_task_id_digest TEXT NOT NULL ${sql.raw(generationConstraint)}
      )
    `)
    yield* db.run(sql`
      CREATE UNIQUE INDEX self_improvement_generation_lease_pending_idx
      ON self_improvement_generation_lease (location_id, pattern_digest)
      WHERE outcome = 'pending'
    `)
    return db
  })

const insertObservation = (input: {
  readonly id: string
  readonly identity: string
  readonly taskID?: SelfImprovement.Digest
  readonly occurredAt?: SelfImprovementLifecycle.TimestampMillis
  readonly expiresAt?: SelfImprovementLifecycle.TimestampMillis
}) =>
  sql`INSERT INTO self_improvement_observation VALUES (
    ${input.id}, ${locationID}, ${patternDigest}, ${SelfImprovement.Digest.make(input.identity.repeat(64).slice(0, 64))},
    'typescript', 1, 'error', ${patternDigest}, 'failure', ${input.taskID ?? taskIDDigest}, ${ownerID},
    ${input.occurredAt ?? now}, ${input.expiresAt ?? SelfImprovementLifecycle.TimestampMillis.make(now + 1)}
  )`

const program = <A, E>(
  effect: Effect.Effect<
    A,
    E,
    SelfImprovementGenerationStore.Service | Database.Service | SelfImprovementLearningStore.Service
  >,
) =>
  Effect.gen(function* () {
    const db = yield* setup()
    yield* db.run(insertObservation({ id: "one", identity: "4" }))
    yield* db.run(insertObservation({ id: "two", identity: "5" }))
    yield* db.run(insertObservation({ id: "three", identity: "6" }))
    const layer = SelfImprovementGenerationStore.layer.pipe(
      Layer.provideMerge(SelfImprovementLearningStore.layer),
      Layer.provideMerge(Layer.succeed(Database.Service, Database.Service.of({ db }))),
    )
    return yield* effect.pipe(Effect.provide(layer))
  }).pipe(Effect.provide(SqliteClient.layer({ filename: ":memory:", disableWAL: true })), Effect.scoped)

const acquire = (
  store: SelfImprovementGenerationStore.Interface,
  input?: Partial<Parameters<SelfImprovementGenerationStore.Interface["acquire"]>[0]>,
) =>
  store.acquire({
    locationID,
    ownerID,
    patternDigest,
    requestDigest,
    leaseTokenDigest: token("7"),
    now,
    ...input,
  })

test("uses the most recent unexpired distinct observation task ID deterministically", async () => {
  await Effect.runPromise(
    program(
      Effect.gen(function* () {
        const db = yield* Database.Service
        yield* db.db.run(sql`DELETE FROM self_improvement_observation`)
        const latestTask = SelfImprovement.Digest.make("8".repeat(64))
        yield* db.db.run(insertObservation({ id: "one", identity: "4", occurredAt: now }))
        yield* db.db.run(insertObservation({ id: "two", identity: "5", occurredAt: now }))
        yield* db.db.run(
          insertObservation({
            id: "three",
            identity: "6",
            taskID: latestTask,
            occurredAt: SelfImprovementLifecycle.TimestampMillis.make(now + 1),
          }),
        )
        yield* db.db.run(
          insertObservation({
            id: "expired",
            identity: "9",
            taskID: SelfImprovement.Digest.make("9".repeat(64)),
            expiresAt: now,
          }),
        )
        const store = yield* SelfImprovementGenerationStore.Service
        const lease = yield* acquire(store)
        expect(lease?.originatingTaskIDDigest).toBe(latestTask)
      }),
    ),
  )
})

test("concurrently creates one active lease with the pending partial index and atomically persists its selected pull", async () => {
  await Effect.runPromise(
    program(
      Effect.gen(function* () {
        const store = yield* SelfImprovementGenerationStore.Service
        const db = yield* Database.Service
        const leases = yield* Effect.all(
          Array.from({ length: 4 }, (_, index) =>
            acquire(store, { leaseTokenDigest: token(String(index)), selectedPull: index === 0 ? pull : undefined }),
          ),
          { concurrency: "unbounded" },
        )
        expect(leases.filter(Boolean)).toHaveLength(1)
        expect(leases.find(Boolean)?.pullEventID).toBe(pull.id)
        expect(
          yield* db.db.get<{ count: number }>(
            sql`SELECT COUNT(*) AS count FROM self_improvement_pull_event WHERE id = ${pull.id}`,
          ),
        ).toEqual({ count: 1 })
      }),
    ),
  )
})

test("rolls back the pull when lease insertion fails", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const db = yield* setup("CHECK (attempt_number > 1)")
      yield* db.run(insertObservation({ id: "one", identity: "4" }))
      yield* db.run(insertObservation({ id: "two", identity: "5" }))
      yield* db.run(insertObservation({ id: "three", identity: "6" }))
      const layer = SelfImprovementGenerationStore.layer.pipe(
        Layer.provideMerge(SelfImprovementLearningStore.layer),
        Layer.provideMerge(Layer.succeed(Database.Service, Database.Service.of({ db }))),
      )
      const result = yield* Effect.gen(function* () {
        const store = yield* SelfImprovementGenerationStore.Service
        return yield* acquire(store, { selectedPull: pull }).pipe(Effect.exit)
      }).pipe(Effect.provide(layer))
      expect(result._tag).toBe("Failure")
      expect(yield* db.get<{ count: number }>(sql`SELECT COUNT(*) AS count FROM self_improvement_pull_event`)).toEqual({
        count: 0,
      })
    }).pipe(Effect.provide(SqliteClient.layer({ filename: ":memory:", disableWAL: true })), Effect.scoped),
  )
})

test("records output before finish and lets an expired pending lease replay it with a new token", async () => {
  await Effect.runPromise(
    program(
      Effect.gen(function* () {
        const store = yield* SelfImprovementGenerationStore.Service
        const first = yield* acquire(store)
        if (!first) throw new Error("expected lease")
        const output = new TextEncoder().encode("{}")
        expect(yield* store.recordOutput({ leaseID: first.id, leaseTokenDigest: token("7"), output, now })).toBe(true)
        const details = yield* store.get(first.id)
        expect(details?.output).toEqual(output)
        const replay = yield* acquire(store, {
          leaseTokenDigest: token("8"),
          now: SelfImprovementLifecycle.TimestampMillis.make(now + 10 * 60_000),
        })
        expect(replay?.id).toBe(first.id)
        expect(replay?.attemptNumber).toBe(1)
        expect(replay?.modelRequestDigest).toBe(requestDigest)
        expect(replay?.output).toEqual(output)
        expect(
          yield* store.finish({
            leaseID: first.id,
            leaseTokenDigest: token("7"),
            now: SelfImprovementLifecycle.TimestampMillis.make(now + 10 * 60_000),
            outcome: "output-rejected",
          }),
        ).toBe(false)
        expect(
          yield* store.finish({
            leaseID: first.id,
            leaseTokenDigest: token("8"),
            now: SelfImprovementLifecycle.TimestampMillis.make(now + 10 * 60_000),
            outcome: "output-rejected",
          }),
        ).toBe(true)
      }),
    ),
  )
})

test("requires persisted output bytes and digest before finishing a non-model failure", async () => {
  await Effect.runPromise(
    program(
      Effect.gen(function* () {
        const store = yield* SelfImprovementGenerationStore.Service
        const db = yield* Database.Service
        const first = yield* acquire(store)
        if (!first) throw new Error("expected lease")
        yield* db.db.run(
          sql`UPDATE self_improvement_generation_lease SET model_output_bytes = ${JSON.stringify([123])} WHERE id = ${first.id}`,
        )
        expect(
          yield* store.finish({ leaseID: first.id, leaseTokenDigest: token("7"), now, outcome: "output-rejected" }),
        ).toBe(false)
        yield* db.db.run(
          sql`UPDATE self_improvement_generation_lease SET model_output_digest = ${token("8")} WHERE id = ${first.id}`,
        )
        expect(
          yield* store.finish({ leaseID: first.id, leaseTokenDigest: token("7"), now, outcome: "output-rejected" }),
        ).toBe(true)
      }),
    ),
  )
})

test("does not let an expired owner record output or finish", async () => {
  await Effect.runPromise(
    program(
      Effect.gen(function* () {
        const store = yield* SelfImprovementGenerationStore.Service
        const first = yield* acquire(store)
        if (!first) throw new Error("expected lease")
        const expiredAt = SelfImprovementLifecycle.TimestampMillis.make(now + 10 * 60_000)
        expect(
          yield* store.recordOutput({
            leaseID: first.id,
            leaseTokenDigest: token("7"),
            output: new TextEncoder().encode("{}"),
            now: expiredAt,
          }),
        ).toBe(false)
        expect(
          yield* store.finish({
            leaseID: first.id,
            leaseTokenDigest: token("7"),
            now: expiredAt,
            outcome: "model-failed",
          }),
        ).toBe(false)
      }),
    ),
  )
})

test("renews a pending lease repeatedly without changing its other details", async () => {
  await Effect.runPromise(
    program(
      Effect.gen(function* () {
        const store = yield* SelfImprovementGenerationStore.Service
        const first = yield* acquire(store)
        if (!first) throw new Error("expected lease")
        const original = yield* store.get(first.id)
        const firstRenewal = SelfImprovementLifecycle.TimestampMillis.make(now + 1)
        expect(yield* store.renew({ leaseID: first.id, leaseTokenDigest: token("7"), now: firstRenewal })).toBe(true)
        const renewed = yield* store.get(first.id)
        expect(renewed?.expiresAt).toBe(SelfImprovementLifecycle.TimestampMillis.make(firstRenewal + 10 * 60_000))
        expect({
          attemptNumber: renewed?.attemptNumber,
          pullEventID: renewed?.pullEventID,
          modelRequestDigest: renewed?.modelRequestDigest,
          output: renewed?.output,
          acquiredAt: renewed?.acquiredAt,
          ownerID: renewed?.ownerID,
        }).toEqual({
          attemptNumber: original?.attemptNumber,
          pullEventID: original?.pullEventID,
          modelRequestDigest: original?.modelRequestDigest,
          output: original?.output,
          acquiredAt: original?.acquiredAt,
          ownerID: original?.ownerID,
        })
        const secondRenewal = SelfImprovementLifecycle.TimestampMillis.make(firstRenewal + 1)
        expect(yield* store.renew({ leaseID: first.id, leaseTokenDigest: token("7"), now: secondRenewal })).toBe(true)
        expect((yield* store.get(first.id))?.expiresAt).toBe(
          SelfImprovementLifecycle.TimestampMillis.make(secondRenewal + 10 * 60_000),
        )
      }),
    ),
  )
})

test("rejects renewal from a stale, expired, or reacquired lease owner", async () => {
  await Effect.runPromise(
    program(
      Effect.gen(function* () {
        const store = yield* SelfImprovementGenerationStore.Service
        const first = yield* acquire(store)
        if (!first) throw new Error("expected lease")
        expect(yield* store.renew({ leaseID: first.id, leaseTokenDigest: token("8"), now })).toBe(false)
        const expiredAt = SelfImprovementLifecycle.TimestampMillis.make(now + 10 * 60_000)
        expect(yield* store.renew({ leaseID: first.id, leaseTokenDigest: token("7"), now: expiredAt })).toBe(false)
        const reacquired = yield* acquire(store, { leaseTokenDigest: token("8"), now: expiredAt })
        if (!reacquired) throw new Error("expected reacquired lease")
        expect(yield* store.renew({ leaseID: first.id, leaseTokenDigest: token("7"), now: expiredAt })).toBe(false)
      }),
    ),
  )
})

test("rejects renewal after a lease becomes terminal", async () => {
  await Effect.runPromise(
    program(
      Effect.gen(function* () {
        const store = yield* SelfImprovementGenerationStore.Service
        const first = yield* acquire(store)
        if (!first) throw new Error("expected lease")
        expect(
          yield* store.finish({ leaseID: first.id, leaseTokenDigest: token("7"), now, outcome: "model-failed" }),
        ).toBe(true)
        expect(yield* store.renew({ leaseID: first.id, leaseTokenDigest: token("7"), now })).toBe(false)
      }),
    ),
  )
})

test("allows terminal model-unavailable attempts without a pull and blocks only before the 24-hour boundary", async () => {
  await Effect.runPromise(
    program(
      Effect.gen(function* () {
        const store = yield* SelfImprovementGenerationStore.Service
        const db = yield* Database.Service
        const first = yield* acquire(store)
        if (!first) throw new Error("expected lease")
        expect(first.pullEventID).toBeUndefined()
        expect(
          yield* store.finish({ leaseID: first.id, leaseTokenDigest: token("7"), now, outcome: "model-failed" }),
        ).toBe(true)
        const blocked = yield* acquire(store, {
          now: SelfImprovementLifecycle.TimestampMillis.make(now + 24 * 60 * 60_000 - 1),
        }).pipe(Effect.flip)
        expect(blocked._tag).toBe("SelfImprovementGenerationStore.NotEligible")
        yield* db.db.run(
          sql`UPDATE self_improvement_observation SET expires_at = ${SelfImprovementLifecycle.TimestampMillis.make(now + 2 * 24 * 60 * 60_000)}`,
        )
        const second = yield* acquire(store, {
          leaseTokenDigest: token("8"),
          now: SelfImprovementLifecycle.TimestampMillis.make(now + 24 * 60 * 60_000),
        })
        expect(second?.attemptNumber).toBe(2)
      }),
    ),
  )
})
