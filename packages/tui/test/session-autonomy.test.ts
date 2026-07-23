import { expect, test } from "bun:test"
import type { SessionAutonomyState } from "@opencode-ai/client"
import { activateGoal, autonomyModeLabel, autonomyProgressLabel, parseGoalCommand } from "../src/util/session-autonomy"

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

test("parses single-line, multiline, non-goal, and empty goal commands", () => {
  expect(parseGoalCommand("/goal Finish the migration")).toEqual({ goal: "Finish the migration" })
  expect(parseGoalCommand("/goal Finish the migration\nRun the tests")).toEqual({ goal: "Finish the migration\nRun the tests" })
  expect(parseGoalCommand("/goals Finish the migration")).toBeUndefined()
  expect(parseGoalCommand("/goal")).toEqual({ goal: "" })
})

test("admits a goal before setting mode and wakes only after mode is active", async () => {
  const calls: string[] = []
  await activateGoal({
    sessionID: "ses_123",
    id: "msg_goal",
    goal: "Finish the migration",
    get: async () => {
      calls.push("get")
      return { mode: "normal" }
    },
    set: async () => {
      calls.push("set")
      return {
        mode: "goal",
        goal: {
          text: "Finish the migration",
          status: "active",
          iteration: 0,
          maxIterations: 12,
          noProgress: 0,
          maxNoProgress: 3,
        },
      }
    },
    prompt: async (input) => {
      calls.push(`prompt:${input.id}:${input.resume === false ? "admit" : "wake"}`)
    },
  })
  expect(calls).toEqual(["prompt:msg_goal:admit", "get", "set", "prompt:msg_goal:wake"])
})

test("retries a lost goal wake without resetting an identical active goal", async () => {
  const calls: string[] = []
  let state: SessionAutonomyState = { mode: "normal" }
  let failWake = true
  const run = () =>
    activateGoal({
      sessionID: "ses_123",
      id: "msg_goal",
      goal: "Finish the migration",
      get: async () => {
        calls.push("get")
        return state
      },
      set: async () => {
        calls.push("set")
        state = {
          mode: "goal",
          goal: {
            text: "Finish the migration",
            status: "active",
            iteration: 0,
            maxIterations: 12,
            noProgress: 0,
            maxNoProgress: 3,
          },
        }
        return state
      },
      prompt: async (input) => {
        calls.push(input.resume === false ? "admit" : "wake")
        if (input.resume !== false && failWake) {
          failWake = false
          throw new Error("lost response")
        }
      },
    })

  await expect(run()).rejects.toThrow("lost response")
  await run()

  expect(calls).toEqual(["admit", "get", "set", "wake", "admit", "get", "wake"])
})

test("retains the admitted goal when changed content is submitted after a lost wake", async () => {
  const util = await import("../src/util/session-autonomy")
  const original = util.retainSessionSubmission(undefined, "/goal Finish migration", 0, {
    goal: "Finish migration",
  })
  original.sessionID = "ses_123"
  const calls: string[] = []

  await expect(
    activateGoal({
      sessionID: original.sessionID,
      id: original.promptID,
      goal: original.payload.goal,
      get: async () => ({ mode: "normal" }),
      set: async () => ({
        mode: "goal",
        goal: {
          text: original.payload.goal,
          status: "active",
          iteration: 0,
          maxIterations: 12,
          noProgress: 0,
          maxNoProgress: 3,
        },
      }),
      prompt: async (input) => {
        calls.push(`${input.sessionID}:${input.id}:${input.resume === false ? "admit" : "wake"}`)
        if (input.resume !== false) throw new Error("lost response")
      },
    }),
  ).rejects.toThrow("lost response")

  const changed = util.retainSessionSubmission(original, "/goal Replace migration", 0, {
    goal: "Replace migration",
  })

  expect(changed).toBe(original)
  expect(changed.sessionID).toBe("ses_123")
  expect(changed.promptID).toBe(original.promptID)
  expect(changed.payload).toEqual({ goal: "Finish migration" })
  expect(calls).toEqual([
    `ses_123:${original.promptID}:admit`,
    `ses_123:${original.promptID}:wake`,
  ])
})

test("exposes autonomy only for the connected active session", async () => {
  const util = await import("../src/util/session-autonomy")
  const currentSessionAutonomy = Reflect.get(util, "currentSessionAutonomy")
  expect(typeof currentSessionAutonomy).toBe("function")
  if (typeof currentSessionAutonomy !== "function") return

  const goal: SessionAutonomyState = {
    mode: "goal",
    goal: {
      text: "Old session goal",
      status: "active",
      iteration: 1,
      maxIterations: 12,
      noProgress: 0,
      maxNoProgress: 3,
    },
  }
  const response = { sessionID: "ses_old", state: goal }

  expect(currentSessionAutonomy("ses_new", true, response)).toEqual({ mode: "normal" })
  expect(currentSessionAutonomy("ses_old", false, response)).toEqual({ mode: "normal" })
  expect(currentSessionAutonomy("ses_old", true, response)).toEqual(goal)
})
