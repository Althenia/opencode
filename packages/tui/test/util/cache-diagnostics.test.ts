import { expect, test } from "bun:test"
import type { SessionCacheDiagnostics } from "@opencode-ai/client"
import { formatCacheDiagnostics } from "../../src/util/cache-diagnostics"

const diagnostics: SessionCacheDiagnostics = {
  model: { id: "model", providerID: "openai" },
  context: { total: 1_030, limit: 2_000, remaining: 970, percent: 52 },
  tokens: { uncachedInput: 100, output: 20, reasoning: 10, cacheRead: 900, cacheWrite: 0 },
  cache: { eligible: 1_000, hitRatio: 0.9, mechanism: "openai-prompt-cache" },
  estimatedCost: 0.0123,
}

test("formats context and cache as separate labeled values", () => {
  expect(formatCacheDiagnostics(diagnostics)).toEqual({
    context: "Context 1.0K/2.0K (52%; includes cached)",
    cache: "Cache hit 90% · 900 read · 0 write · 100 uncached",
  })
})

test("handles missing limits and ratios safely", () => {
  expect(
    formatCacheDiagnostics({
      ...diagnostics,
      context: { total: 5 },
      cache: { eligible: 0, mechanism: "none" },
    }),
  ).toEqual({
    context: "Context 5 (includes cached)",
    cache: "Cache hit n/a · 900 read · 0 write · 100 uncached",
  })
})
