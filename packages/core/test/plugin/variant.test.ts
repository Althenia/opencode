import { describe, expect, test } from "bun:test"
import { Catalog } from "@opencode-ai/core/catalog"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Location } from "@opencode-ai/core/location"
import { ModelV2 } from "@opencode-ai/core/model"
import { VariantPlugin } from "@opencode-ai/core/plugin/variant"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { AbsolutePath } from "@opencode-ai/core/schema"
import type { ModelV2Info } from "@opencode-ai/sdk/v2/types"
import { Effect, Layer } from "effect"
import { location } from "../fixture/location"
import { testEffect } from "../lib/effect"
import { catalogHost, host } from "./host"

const locationLayer = Layer.succeed(
  Location.Service,
  Location.Service.of(location({ directory: AbsolutePath.make(import.meta.dir) })),
)
const it = testEffect(AppNodeBuilder.build(Catalog.node, [[Location.node, locationLayer]]))

function modelInfo(id: string, apiID = id, pkg = "@ai-sdk/openai"): ModelV2Info {
  return {
    id,
    providerID: "openai",
    name: id,
    api: { id: apiID, type: "aisdk", package: pkg },
    capabilities: { tools: true, input: ["text"], output: ["text"] },
    request: { headers: {}, body: {} },
    variants: [],
    time: { released: 0 },
    cost: [],
    status: "active",
    enabled: true,
    limit: { context: 1, output: 1 },
  }
}

describe("VariantPlugin", () => {
  test("adds max to direct OpenAI GPT-5.6 models", () => {
    for (const model of [
      modelInfo("gpt-5.6"),
      modelInfo("gpt-5.6-solace"),
      modelInfo("alias", "gpt-5.6"),
    ]) {
      expect(VariantPlugin.generate(model)).toEqual([
        {
          id: "max",
          headers: {},
          body: { reasoning: { effort: "max" } },
        },
      ])
    }
  })

  test("adds ultra only for direct OpenAI GPT-5.6 Sol, Terra, and Luna", () => {
    for (const model of [
      modelInfo("gpt-5.6-sol", "alias"),
      modelInfo("alias", "gpt-5.6-terra"),
      modelInfo("gpt-5.6-luna"),
    ]) {
      expect(VariantPlugin.generate(model)).toEqual([
        {
          id: "max",
          headers: {},
          body: { reasoning: { effort: "max" } },
        },
        {
          id: "ultra",
          headers: {},
          body: { reasoning: { effort: "ultra" } },
        },
      ])
    }
  })

  test("does not add ultra or max to non-matching models or compatible providers", () => {
    for (const model of [
      modelInfo("gpt-5.7"),
      modelInfo("gpt-5.6-sol", "gpt-5.6-sol", "@ai-sdk/openai-compatible"),
    ]) {
      expect(VariantPlugin.generate(model)).toEqual([])
    }
  })

  it.effect("adds GLM 5.2 variants after catalog sources", () =>
    Effect.gen(function* () {
      const service = yield* Catalog.Service
      yield* service.transform((catalog) => {
        catalog.provider.update(ProviderV2.ID.opencode, (provider) => {
          provider.api = { type: "aisdk", package: "@ai-sdk/openai-compatible" }
        })
        catalog.model.update(ProviderV2.ID.opencode, ModelV2.ID.make("glm-5.2"), (model) => {
          model.api = {
            id: ModelV2.ID.make("glm-5.2"),
            type: "aisdk",
            package: "@ai-sdk/openai-compatible",
          }
        })
      })
      yield* VariantPlugin.Plugin.effect(host({ catalog: catalogHost(service) }))

      expect((yield* service.model.get(ProviderV2.ID.opencode, ModelV2.ID.make("glm-5.2")))?.variants).toEqual([
        expect.objectContaining({ id: "high", body: { reasoning_effort: "high" } }),
        expect.objectContaining({ id: "max", body: { reasoning_effort: "max" } }),
      ])
    }),
  )

  it.effect("keeps explicit variants over generated defaults", () =>
    Effect.gen(function* () {
      const service = yield* Catalog.Service
      yield* service.transform((catalog) => {
        catalog.model.update(ProviderV2.ID.opencode, ModelV2.ID.make("glm-5.2"), (model) => {
          model.api = {
            id: ModelV2.ID.make("glm-5.2"),
            type: "aisdk",
            package: "@ai-sdk/openai-compatible",
          }
          model.variants = [{ id: ModelV2.VariantID.make("high"), headers: { custom: "true" }, body: {} }]
        })
      })
      yield* VariantPlugin.Plugin.effect(host({ catalog: catalogHost(service) }))

      expect((yield* service.model.get(ProviderV2.ID.opencode, ModelV2.ID.make("glm-5.2")))?.variants).toEqual([
        expect.objectContaining({ id: "high", headers: { custom: "true" } }),
        expect.objectContaining({ id: "max", body: { reasoning_effort: "max" } }),
      ])
    }),
  )

  it.effect("keeps an explicit gpt-5.6-sol ultra variant over the generated defaults", () =>
    Effect.gen(function* () {
      const service = yield* Catalog.Service
      yield* service.transform((catalog) => {
        catalog.model.update(ProviderV2.ID.opencode, ModelV2.ID.make("glm-5.2"), (model) => {
          model.api = {
            id: ModelV2.ID.make("gpt-5.6-sol"),
            type: "aisdk",
            package: "@ai-sdk/openai",
          }
          model.variants = [
            {
              id: ModelV2.VariantID.make("ultra"),
              headers: { custom: "true" },
              body: { reasoning: { effort: "custom" } },
            },
          ]
        })
      })
      yield* VariantPlugin.Plugin.effect(host({ catalog: catalogHost(service) }))

      expect((yield* service.model.get(ProviderV2.ID.opencode, ModelV2.ID.make("glm-5.2")))?.variants).toEqual([
        {
          id: ModelV2.VariantID.make("max"),
          headers: {},
          body: { reasoning: { effort: "max" } },
        },
        {
          id: ModelV2.VariantID.make("ultra"),
          headers: { custom: "true" },
          body: { reasoning: { effort: "custom" } },
        },
      ])
    }),
  )
})
