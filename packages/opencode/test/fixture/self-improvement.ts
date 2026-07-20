import { mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Clock, ConfigProvider, Duration, Effect, Layer, ManagedRuntime } from "effect"
import * as TestClock from "effect/testing/TestClock"
import { LLMClient, LLMResponse, Message } from "@opencode-ai/llm"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Catalog } from "@opencode-ai/core/catalog"
import { Config } from "@opencode-ai/core/config"
import { ConfigProviderPlugin } from "@opencode-ai/core/config/plugin/provider"
import { Global } from "@opencode-ai/core/global"
import { Integration } from "@opencode-ai/core/integration"
import { Location } from "@opencode-ai/core/location"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { VariantPlugin } from "@opencode-ai/core/plugin/variant"
import { Policy } from "@opencode-ai/core/policy"
import { Project } from "@opencode-ai/core/project"
import { SelfImprovementAdmission } from "@opencode-ai/core/self-improvement/admission"
import { SelfImprovementApprovalStore } from "@opencode-ai/core/self-improvement/approval-store"
import { SelfImprovementArtifactStore } from "@opencode-ai/core/self-improvement/artifact-store"
import { SelfImprovementAuditStore } from "@opencode-ai/core/self-improvement/audit-store"
import { SelfImprovementContextReconciler } from "@opencode-ai/core/self-improvement/context-reconciler"
import { SelfImprovementContextStore } from "@opencode-ai/core/self-improvement/context-store"
import { SelfImprovementContracts } from "@opencode-ai/core/self-improvement/contracts"
import { SelfImprovementEvaluationStore } from "@opencode-ai/core/self-improvement/evaluation-store"
import { SelfImprovementIdempotencyStore } from "@opencode-ai/core/self-improvement/idempotency-store"
import { SelfImprovementIngressStore } from "@opencode-ai/core/self-improvement/ingress-store"
import { SelfImprovementGeneration } from "@opencode-ai/core/self-improvement/generation"
import { SelfImprovementGenerationStore } from "@opencode-ai/core/self-improvement/generation-store"
import { SelfImprovementKeyring } from "@opencode-ai/core/self-improvement/keyring"
import { SelfImprovementLearningStore } from "@opencode-ai/core/self-improvement/learning-store"
import { SelfImprovementLifecycleCoordinator } from "@opencode-ai/core/self-improvement/lifecycle-coordinator"
import { SelfImprovementLifecycleWorkflow } from "@opencode-ai/core/self-improvement/lifecycle-workflow"
import { SelfImprovementMutationStore } from "@opencode-ai/core/self-improvement/mutation-store"
import { SelfImprovementPrivateArtifactCommand } from "@opencode-ai/core/self-improvement/private-artifact-command"
import { SelfImprovementPrivateEvidenceCommand } from "@opencode-ai/core/self-improvement/private-evidence-command"
import { SelfImprovementPrivateQuery } from "@opencode-ai/core/self-improvement/private-query"
import { SelfImprovementRetention } from "@opencode-ai/core/self-improvement/retention"
import { Routing } from "@opencode-ai/core/self-improvement/routing"
import { SessionRunnerModel } from "@opencode-ai/core/session/runner/model"
import { SelfImprovementTransitionStore } from "@opencode-ai/core/self-improvement/transition-store"
import { SystemContextRegistry } from "@opencode-ai/core/system-context/registry"
import {
  AbsolutePath,
  SelfImprovementApi,
  SelfImprovementLearning,
  SelfImprovementLifecycle,
} from "@opencode-ai/schema"

const manifest = new SelfImprovementLifecycle.CapabilityManifest({
  toolIDs: [],
  filesystemScopeIDs: [],
  networkOriginIDs: [],
  modelRoutes: [],
  childAgentTargets: [],
  artifactReferences: [],
  denies: [],
})

export interface SelfImprovementFixtureOptions {
  readonly generatedModelBytes?: Uint8Array
  readonly workloadBinding?: Routing.WorkloadBinding
  readonly routingDefault?: string
}

const runtimeLayer = (
  database: string,
  location: Location.Ref,
  options: SelfImprovementFixtureOptions,
  globalConfig: string,
  initialTime = 0,
) => {
  const db = Database.layerFromPath(database)
  const locationLayer = Layer.succeed(
    Location.Service,
    Location.Service.of({
      directory: location.directory,
      project: { id: Project.ID.global, directory: location.directory },
    }),
  )
  const baseStores = Layer.mergeAll(
    SelfImprovementApprovalStore.layer,
    SelfImprovementArtifactStore.layer,
    SelfImprovementAuditStore.layer,
    SelfImprovementContextStore.layer,
    SelfImprovementEvaluationStore.layer,
    SelfImprovementGenerationStore.layer,
    SelfImprovementIdempotencyStore.layer,
    SelfImprovementMutationStore.layer,
    SelfImprovementTransitionStore.layer,
    LayerNode.compile(SystemContextRegistry.node),
  ).pipe(Layer.provideMerge(db))
  const ingress = SelfImprovementIngressStore.layer.pipe(
    Layer.provide(SelfImprovementIngressStore.evaluationEvidenceLayer.pipe(Layer.provide(baseStores))),
    Layer.provide(
      SelfImprovementKeyring.layer.pipe(
        Layer.provide(
          ConfigProvider.layer(ConfigProvider.fromUnknown({ OPENCODE_SELF_IMPROVEMENT_HMAC_KEY: "fixture-key" })),
        ),
      ),
    ),
    Layer.provide(baseStores),
  )
  const stores = Layer.mergeAll(baseStores, ingress)
  const admission = SelfImprovementAdmission.layer.pipe(Layer.provide(stores))
  const coordinator = SelfImprovementLifecycleCoordinator.layer.pipe(Layer.provide(stores))
  const workflow = SelfImprovementLifecycleWorkflow.layer.pipe(Layer.provide(coordinator), Layer.provide(stores))
  const command = SelfImprovementPrivateArtifactCommand.layer.pipe(
    Layer.provide(SelfImprovementPrivateArtifactCommand.admissionPolicyLayer),
    Layer.provide(workflow),
    Layer.provide(coordinator),
    Layer.provide(admission),
    Layer.provide(stores),
  )
  const evidence = SelfImprovementPrivateEvidenceCommand.layer.pipe(Layer.provide(workflow), Layer.provide(stores))
  const query = SelfImprovementPrivateQuery.layer.pipe(Layer.provide(stores))
  const materializer = LayerNode.compile(SelfImprovementContextReconciler.materializerNode).pipe(Layer.provide(stores))
  const reconciler = Layer.effect(
    SelfImprovementContextReconciler.Service,
    Effect.gen(function* () {
      const db = (yield* Database.Service).db
      const service = SelfImprovementContextReconciler.make({
        transaction: (work) => db.transaction(work),
        approvals: yield* SelfImprovementApprovalStore.Service,
        audit: yield* SelfImprovementAuditStore.Service,
        context: yield* SelfImprovementContextStore.Service,
        idempotency: yield* SelfImprovementIdempotencyStore.Service,
        learning: yield* SelfImprovementLearningStore.Service,
        materializer: yield* SelfImprovementContextReconciler.Materializer,
        mutations: yield* SelfImprovementMutationStore.Service,
        registry: yield* SystemContextRegistry.Service,
        transitions: yield* SelfImprovementTransitionStore.Service,
      })
      yield* service.recover.pipe(Effect.orDie)
      return SelfImprovementContextReconciler.Service.of(service)
    }),
  ).pipe(Layer.provide(materializer), Layer.provide(stores))
  const retention = SelfImprovementRetention.layer.pipe(Layer.provide(locationLayer), Layer.provide(stores))

  const generatedModel = Layer.mock(LLMClient.Service, {
    generate: () => {
      const text = new TextDecoder().decode(
        options.generatedModelBytes ??
          new TextEncoder().encode(
            '{"kind":"skill","name":"generated","definition":{"description":"Generated","content":"Use generated instructions."},"references":[]}',
          ),
      )
      return Effect.succeed(
        new LLMResponse({
          message: Message.assistant([Message.text(text)]),
          events: [{ type: "text-delta", id: "fixture", text }],
          finishReason: "stop",
        }),
      )
    },
  })
  const routingDependencies = AppNodeBuilder.build(
    LayerNode.group([
      Policy.node,
      Integration.node,
      Catalog.node,
      PluginV2.node,
      SessionRunnerModel.node,
      Config.node,
      SelfImprovementLearningStore.node,
    ]),
    [
      [Database.node, db],
      [Global.node, Global.layerWith({ config: globalConfig })],
      [Location.node, locationLayer],
    ],
  )
  const routing = Layer.mergeAll(
    routingDependencies,
    Routing.layerWith(() => Effect.succeed(options.workloadBinding)).pipe(Layer.provide(routingDependencies)),
  )
  const generation = SelfImprovementGeneration.layer.pipe(
    Layer.provide(generatedModel),
    Layer.provide(admission),
    Layer.provide(stores),
    Layer.provide(routingDependencies),
  )

  const clock = Layer.effect(
    Clock.Clock,
    Effect.gen(function* () {
      const clock = yield* TestClock.make()
      yield* clock.setTime(initialTime)
      return clock
    }),
  )

  return Layer.mergeAll(
    command,
    evidence,
    query,
    retention,
    admission,
    coordinator,
    workflow,
    materializer,
    reconciler,
    routing,
    generation,
    generatedModel,
  )
    .pipe(Layer.provideMerge(clock))
    .pipe(Layer.provideMerge(stores))
    .pipe(Layer.provideMerge(routingDependencies))
}

export async function selfImprovementFixture(options: SelfImprovementFixtureOptions = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "opencode-self-improvement-"))
  const database = path.join(directory, "opencode.db")
  const location = Location.Ref.make({ directory: AbsolutePath.make(directory) })
  const locationID = SelfImprovementContracts.locationID(location)
  const principal = new SelfImprovementLifecycle.Principal({
    id: SelfImprovementLifecycle.PrincipalID.make("self-improvement-e2e"),
    kind: "first-party-user",
    locationID,
  })
  await writeFile(
    path.join(directory, "opencode.json"),
    JSON.stringify({
      model: `provider/${options.routingDefault ?? "default"}`,
      providers: {
        provider: {
          api: { type: "aisdk", package: "@ai-sdk/openai", url: "https://openai.example/v1" },
          request: { body: { apiKey: "fixture-key" } },
          models: Object.fromEntries(
            ["fallback", "session", "role", "recommended", "default", "missing"].map((id) => [
              id,
              {
                ...(id === "missing"
                  ? { api: { type: "aisdk", package: "@ai-sdk/unsupported", url: "https://openai.example/v1" } }
                  : {}),
                capabilities: { tools: true, input: ["text"], output: ["text"] },
                variants: [{ id: "configured" }],
              },
            ]),
          ),
        },
      },
    }),
  )
  let runtime = ManagedRuntime.make(runtimeLayer(database, location, options, directory))
  let routingInitialization: Promise<void> | undefined

  const initializeRouting = () => {
    if (routingInitialization !== undefined) return routingInitialization
    const initialization = runtime.runPromise(
      Effect.gen(function* () {
        const catalog = yield* Catalog.Service
        const integration = yield* Integration.Service
        const plugins = yield* PluginV2.Service
        yield* Effect.all(
          [
            plugins.wait(PluginV2.ID.make(ConfigProviderPlugin.Plugin.id)),
            plugins.wait(PluginV2.ID.make(VariantPlugin.Plugin.id)),
          ],
          { discard: true },
        )
        yield* integration.reload()
        yield* catalog.reload()
      }),
    )
    routingInitialization = initialization.catch((error) => {
      routingInitialization = undefined
      throw error
    })
    return routingInitialization
  }

  return {
    locationID,
    location,
    principal,
    async run<A, E>(effect: Effect.Effect<A, E, ManagedRuntime.ManagedRuntime.Services<typeof runtime>>) {
      await initializeRouting()
      return runtime.runPromise(effect)
    },
    advance(duration: Duration.Input) {
      return runtime.runPromise(TestClock.adjust(duration))
    },
    async createSkill(input: { readonly name: string; readonly content: string }) {
      const now = SelfImprovementLifecycle.TimestampMillis.make(await runtime.runPromise(Clock.currentTimeMillis))
      const result = await runtime.runPromise(
        SelfImprovementPrivateArtifactCommand.Service.use((command) =>
          command.createArtifact({
            locationID,
            principal,
            request: new SelfImprovementApi.CreateArtifactRequest({
              proposalBytes: new TextEncoder().encode(
                JSON.stringify({
                  kind: "skill",
                  name: input.name,
                  definition: { description: input.name, content: input.content },
                  references: [],
                }),
              ),
              behaviorClass: "instruction-only",
              capabilityManifest: manifest,
            }),
            idempotencyKey: SelfImprovementLearning.IdempotencyKey.make(`create-${input.name}`),
            now,
          }),
        ),
      )
      if (!(result.response.body instanceof SelfImprovementApi.CreateArtifactResponse))
        throw new Error("Expected an artifact admission response")
      return result.response.body
    },
    getArtifact(artifactID: SelfImprovementLifecycle.ArtifactID) {
      return runtime.runPromise(
        SelfImprovementPrivateQuery.Service.use((query) =>
          query
            .getArtifact({ locationID, artifactID })
            .pipe(
              Effect.flatMap((artifact) =>
                artifact === undefined
                  ? Effect.die(`Expected artifact ${artifactID} to exist`)
                  : Effect.succeed(artifact),
              ),
            ),
        ),
      )
    },
    async restart() {
      const now = await runtime.runPromise(Clock.currentTimeMillis)
      await runtime.dispose()
      runtime = ManagedRuntime.make(runtimeLayer(database, location, options, directory, now))
      routingInitialization = undefined
    },
    recoverPendingContext() {
      return runtime.runPromise(SelfImprovementContextReconciler.Service.use((reconciler) => reconciler.recover))
    },
    async [Symbol.asyncDispose]() {
      await runtime.dispose()
      await rm(directory, { recursive: true, force: true })
    },
  }
}
