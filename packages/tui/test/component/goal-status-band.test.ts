import { describe, expect, test } from "bun:test"
import { summarizeGoal } from "../../src/component/goal-status-band"

describe("GoalStatusBand", () => {
  test("uses the objective at zero percent before todos exist", () => {
    expect(summarizeGoal("Ship auth", [])).toEqual({
      resolved: 0,
      total: 0,
      percentage: 0,
      target: "Ship auth",
    })
  })

  test("counts completed and cancelled todos as resolved", () => {
    expect(
      summarizeGoal("Ship auth", [
        { content: "Inspect", status: "completed", priority: "high" },
        { content: "Discard obsolete path", status: "cancelled", priority: "low" },
        { content: "Verify source", status: "in_progress", priority: "high" },
        { content: "Review", status: "pending", priority: "medium" },
      ]),
    ).toEqual({ resolved: 2, total: 4, percentage: 50, target: "Verify source" })
  })

  test("prefers in-progress then pending work", () => {
    expect(
      summarizeGoal("Ship auth", [
        { content: "Next", status: "pending", priority: "high" },
        { content: "Now", status: "in_progress", priority: "medium" },
      ]).target,
    ).toBe("Now")
    expect(
      summarizeGoal("Ship auth", [{ content: "Next", status: "pending", priority: "high" }]).target,
    ).toBe("Next")
  })
})
