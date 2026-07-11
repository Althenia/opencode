import { describe, expect, spyOn, test } from "bun:test"
import { cacheRatios, displayStats } from "@/cli/cmd/stats"

describe("cli.stats.cacheRatios", () => {
  test("weights cache read and write tokens against all input-side tokens", () => {
    expect(cacheRatios({ input: 2, cache: { read: 6, write: 2 } })).toEqual({ read: 60, write: 20 })
  })

  test("returns zero ratios when there are no input-side tokens", () => {
    expect(cacheRatios({ input: 0, cache: { read: 0, write: 0 } })).toEqual({ read: 0, write: 0 })
  })

  test("renders distinct total and per-model cache ratios", () => {
    const output: string[] = []
    const log = spyOn(console, "log").mockImplementation((...args) => output.push(args.join(" ")))
    try {
      displayStats(
        {
          totalSessions: 1,
          totalMessages: 1,
          totalCost: 0,
          totalTokens: { input: 20, output: 0, reasoning: 0, cache: { read: 6, write: 4 } },
          toolUsage: {},
          modelUsage: {
            "openrouter/openai/gpt-4.1": {
              messages: 1,
              tokens: { input: 2, output: 0, cache: { read: 6, write: 2 } },
              cost: 0,
            },
          },
          dateRange: { earliest: 0, latest: 0 },
          days: 1,
          costPerDay: 0,
          tokensPerSession: 30,
          medianTokensPerSession: 30,
        },
        undefined,
        1,
      )
    } finally {
      log.mockRestore()
    }

    const rendered = output.join("\n")
    expect(rendered).toMatch(/Cache Read Ratio\s+20\.0%/)
    expect(rendered).toMatch(/Cache Write Ratio\s+13\.3%/)
    expect(rendered).toMatch(/  Cache Read Ratio\s+60\.0%/)
    expect(rendered).toMatch(/  Cache Write Ratio\s+20\.0%/)
  })
})
