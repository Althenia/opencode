import { expect, test } from "bun:test"
import { autonomyModeLabel, autonomyProgressLabel } from "../src/util/session-autonomy"

test("labels normal, yolo, and goal modes", () => {
  expect(autonomyModeLabel({ mode: "normal" })).toBe("Normal")
  expect(autonomyModeLabel({ mode: "yolo" })).toBe("YOLO")
  expect(
    autonomyModeLabel({
      mode: "goal",
      goal: {
        text: "Finish the migration",
        status: "active",
        iteration: 2,
        maxIterations: 12,
        noProgress: 0,
        maxNoProgress: 3,
      },
    }),
  ).toBe("Goal")
})

test("formats bounded goal progress", () => {
  expect(
    autonomyProgressLabel({
      mode: "goal",
      goal: {
        text: "Finish the migration",
        status: "active",
        iteration: 2,
        maxIterations: 12,
        noProgress: 1,
        maxNoProgress: 3,
      },
    }),
  ).toBe("2/12 · no progress 1/3")
  expect(autonomyProgressLabel({ mode: "normal" })).toBeUndefined()
})
