import { expect, test } from "bun:test"
import { tickSummary } from "../../src/feature-plugins/sidebar/self-improvement"

test("summarizes automation results without private evidence", () => {
  const summary = tickSummary({
    eligiblePatterns: 6,
    generated: 1,
    prepared: 2,
    runsCreated: 3,
    runsDecided: 4,
    reconciled: 5,
    failures: 1,
  })

  expect(summary).toBe("6 eligible · 1 generated · 2 prepared · 3 runs opened · 4 decided · 5 reconciled · 1 failure")
  expect(summary).not.toContain("metrics")
  expect(summary).not.toContain("prompt")
})
