import { expect, test } from "bun:test"
import { Money } from "@opencode-ai/schema/money"
import { SessionCacheDiagnostics } from "@opencode-ai/core/session/cache-diagnostics"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"

const model = (providerID: string) =>
  ModelV2.Ref.make({ id: ModelV2.ID.make("model"), providerID: ProviderV2.ID.make(providerID) })

const tokens = {
  input: 100,
  output: 20,
  reasoning: 10,
  cache: { read: 900, write: 0 },
}

test("keeps cache effectiveness separate from context occupancy", () => {
  const result = SessionCacheDiagnostics.calculate({
    tokens,
    estimatedCost: Money.USD.make(0.0123),
    contextLimit: 2_000,
    model: model("openai"),
  })

  expect(result.context).toEqual({ total: 1_030, limit: 2_000, remaining: 970, percent: 52 })
  expect(result.tokens).toEqual({
    uncachedInput: 100,
    output: 20,
    reasoning: 10,
    cacheRead: 900,
    cacheWrite: 0,
  })
  expect(result.cache).toEqual({ eligible: 1_000, hitRatio: 0.9, mechanism: "openai-prompt-cache" })
  expect(result.estimatedCost).toBe(Money.USD.make(0.0123))
})

test("reports zero cache hits without lowering the context total", () => {
  const result = SessionCacheDiagnostics.calculate({
    tokens: { ...tokens, input: 1_000, cache: { read: 0, write: 0 } },
    estimatedCost: Money.USD.zero,
    contextLimit: 2_000,
    model: model("anthropic"),
  })

  expect(result.context.total).toBe(1_030)
  expect(result.cache).toEqual({ eligible: 1_000, hitRatio: 0, mechanism: "anthropic-cache-control" })
})

test("omits ratios and limits when no denominator or valid context limit exists", () => {
  const result = SessionCacheDiagnostics.calculate({
    tokens: { input: 0, output: 5, reasoning: 0, cache: { read: 0, write: 0 } },
    estimatedCost: Money.USD.zero,
    contextLimit: 0,
    model: model("custom"),
  })

  expect(result.context).toEqual({ total: 5 })
  expect(result.cache).toEqual({ eligible: 0, mechanism: "none" })
})

test("labels unknown providers only when they report cache activity", () => {
  expect(
    SessionCacheDiagnostics.calculate({
      tokens: { input: 10, output: 0, reasoning: 0, cache: { read: 5, write: 0 } },
      estimatedCost: Money.USD.zero,
      model: model("custom"),
    }).cache.mechanism,
  ).toBe("provider-reported")
})
