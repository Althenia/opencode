export * as VariantPlugin from "./variant"

import type { ModelV2Info } from "@opencode-ai/sdk/v2/types"
import { Effect } from "effect"
import { define } from "./internal"

const GPT5_6_RE = /(?:^|\/)gpt-5[.-]6(?:[.-]|$)/
const GPT5_6_EFFORTS = ["none", "low", "medium", "high", "xhigh", "max"]
const GPT5_6_PRO_RE = /(?:^|\/)gpt-5[.-]6[.-]pro(?:[.-]|$)/

export const Plugin = define({
  id: "variant",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.catalog.transform((catalog) => {
      for (const record of catalog.provider.list()) {
        for (const model of record.models.values()) {
          catalog.model.update(model.providerID, model.id, (draft) => {
            const generated = generate({
              ...draft,
              api:
                draft.api.type === "native" && !draft.api.url && Object.keys(draft.api.settings).length === 0
                  ? { ...record.provider.api, id: draft.api.id }
                  : draft.api,
            })
            if (generated.length === 0) return

            const explicit = new Map(draft.variants.map((variant) => [variant.id, variant]))
            const generatedIDs = new Set(generated.map((variant) => variant.id))
            draft.variants = [
              ...generated.map((variant) => explicit.get(variant.id) ?? variant),
              ...draft.variants.filter((variant) => !generatedIDs.has(variant.id)),
            ]
          })
        }
      }
    })
  }),
})

export function generate(model: ModelV2Info): ModelV2Info["variants"] {
  if (model.api.type !== "aisdk") return []
  const ids = [model.id, model.api.id].map((id) => id.toLowerCase())
  if (model.api.package === "@ai-sdk/openai") {
    const matching = ids.filter((id) => GPT5_6_RE.test(id))
    if (matching.length === 0) return []
    const efforts = matching.some((id) => id.includes("deep-research") || id.includes("-chat"))
      ? ["medium", "max"]
      : matching.some((id) => GPT5_6_PRO_RE.test(id))
        ? ["medium", "high", "xhigh", "max"]
        : GPT5_6_EFFORTS
    return efforts.map((id) => ({
      id,
      headers: {},
      body: { reasoning: { effort: id } },
    }))
  }
  if (model.api.package !== "@ai-sdk/openai-compatible") return []
  const joined = ids.join(" ")
  if (!["glm-5.2", "glm-5-2", "glm-5p2"].some((name) => joined.includes(name))) return []
  return ["high", "max"].map((id) => ({
    id,
    headers: {},
    body: { reasoning_effort: id },
  }))
}
