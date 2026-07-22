/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import type { SessionOrchestrationTask } from "@opencode-ai/client"
import { TestTuiContexts } from "../../fixture/tui-environment"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"

const module = await import("../../../src/routes/session/composer/subagents-tab")

async function renderMetadata(input: { model?: string; status?: string; width?: number }) {
  const [{ ConfigProvider }, { ThemeProvider }] = await Promise.all([
    import("../../../src/config"),
    import("../../../src/context/theme"),
  ])

  const app = await testRender(
    () => (
      <TestTuiContexts>
        <ConfigProvider config={createTuiResolvedConfig()}>
          <ThemeProvider mode="dark" source={{ discover: () => Promise.resolve({}) }}>
            <box flexDirection="row">
              <box flexGrow={1}>
                <text>Task</text>
              </box>
              <module.SubagentMetadata model={input.model} status={input.status} active={false} />
            </box>
          </ThemeProvider>
        </ConfigProvider>
      </TestTuiContexts>
    ),
    { width: input.width ?? 80, height: 3 },
  )
  app.renderer.start()
  await app.waitForFrame((frame) => frame.includes("Task"))
  return app
}

test("formats provider, model, and optional variant", () => {
  expect(module.formatSubagentModel({ providerID: "openai", id: "gpt-5.6-luna", variant: "high" })).toBe(
    "openai/gpt-5.6-luna#high",
  )
  expect(module.formatSubagentModel({ providerID: "openai", id: "gpt-5.6-sol" })).toBe(
    "openai/gpt-5.6-sol",
  )
  expect(module.formatSubagentModel(undefined)).toBeUndefined()
})

test("derives rows only from durable managed tasks", () => {
  const tasks: SessionOrchestrationTask[] = [
    {
      sessionID: "ses_waiting",
      parentID: "ses_parent",
      description: "Review implementation",
      agent: "reviewer",
      model: { providerID: "openai", id: "gpt-5.6", variant: "high" },
      background: true,
      state: "waiting",
      question: { id: "qst_review", text: "Proceed?", time: 1 },
      revision: 2,
      time: { created: 1, updated: 2 },
    },
    {
      sessionID: "ses_lost",
      parentID: "ses_parent",
      description: "Inspect runtime",
      agent: "explore",
      model: { providerID: "openai", id: "gpt-5.6-luna" },
      background: true,
      state: "lost",
      revision: 3,
      time: { created: 2, updated: 3 },
    },
  ]

  expect(module.entriesFromTasks(tasks, "ses_waiting")).toEqual([
    expect.objectContaining({ sessionID: "ses_waiting", title: "Review implementation", status: "waiting", current: true }),
    expect.objectContaining({ sessionID: "ses_lost", title: "Inspect runtime", status: "lost", current: false }),
  ])
  expect(module.taskStatusLabel("waiting")).toBe("Waiting")
  expect(module.taskStatusLabel("failed")).toBe("Failed")
  expect(module.taskStatusLabel("lost")).toBe("Lost")
  expect(module.taskStatusLabel("cancelled")).toBe("Cancelled")
})

test("cancels waiting managed tasks through the durable endpoint", async () => {
  const calls: Array<{ parentID: string; childID: string }> = []
  let interrupted = false
  const client = {
    api: {
      session: {
        interrupt: async () => {
          interrupted = true
        },
        subagent: {
          cancel: async (input: { parentID: string; childID: string }) => {
            calls.push(input)
            return { state: "cancelled" }
          },
        },
      },
    },
  }

  expect(module.canCancelSubagent("waiting")).toBe(true)
  expect(module.canCancelSubagent("running")).toBe(true)
  expect(module.canCancelSubagent("completed")).toBe(false)
  await module.cancelManagedSubagent(client, "ses_parent", "ses_child")

  expect(calls).toEqual([{ parentID: "ses_parent", childID: "ses_child" }])
  expect(interrupted).toBe(false)
})

test("renders model and running status on one row", async () => {
  const app = await renderMetadata({ model: "openai/gpt-5.6-luna#high", status: "Running" })
  try {
    const frame = app.captureCharFrame()
    expect(frame).toContain("openai/gpt-5.6-luna#high · Running")
    expect(frame.split("\n").find((line) => line.includes("Running"))?.trimEnd().endsWith("Running")).toBe(true)
  } finally {
    app.renderer.destroy()
  }
})

test("renders model metadata for a completed row without status", async () => {
  const app = await renderMetadata({ model: "openai/gpt-5.6-sol" })
  try {
    const frame = app.captureCharFrame()
    expect(frame).toContain("openai/gpt-5.6-sol")
    expect(frame).not.toContain("Running")
  } finally {
    app.renderer.destroy()
  }
})

test("omits model metadata when the session has no model", async () => {
  const app = await renderMetadata({ status: "Running" })
  try {
    const frame = app.captureCharFrame()
    expect(frame).not.toContain("·")
    expect(frame.split("\n").find((line) => line.includes("Running"))?.trimEnd().endsWith("Running")).toBe(true)
  } finally {
    app.renderer.destroy()
  }
})

test("clips a long model label while preserving running status", async () => {
  const model = `provider/${"model".repeat(16)}#variant`
  const app = await renderMetadata({ model, status: "Running", width: 48 })
  try {
    const frame = app.captureCharFrame()
    expect(frame).not.toContain(model)
    expect(frame).toContain(model.slice(0, 12))
    const contentRows = frame.split("\n").filter((line) => line.trim().length > 0)
    expect(contentRows).toHaveLength(1)
    expect(contentRows[0]).toContain("Task")
    expect(contentRows[0]).toContain(model.slice(0, 12))
    expect(contentRows[0]).toContain("Running")
    expect(frame.split("\n").find((line) => line.includes("Running"))?.trimEnd().endsWith("Running")).toBe(true)
  } finally {
    app.renderer.destroy()
  }
})
