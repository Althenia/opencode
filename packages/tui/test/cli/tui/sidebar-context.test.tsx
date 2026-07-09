/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { SidebarContextView } from "../../../src/feature-plugins/sidebar/context"

const api = {
  theme: {
    current: {
      text: "#ffffff",
      textMuted: "#888888",
    },
  },
  state: {
    session: {
      get: () => ({ cost: 1.25 }),
      messages: () => [
        {
          role: "assistant",
          providerID: "test",
          modelID: "model",
          tokens: {
            input: 100,
            output: 50,
            reasoning: 25,
            cache: { read: 20, write: 5 },
          },
        },
      ],
    },
    provider: [
      {
        id: "test",
        models: {
          model: {
            limit: { context: 1_000 },
          },
        },
      },
    ],
  },
} as unknown as TuiPluginApi

test("sidebar context expands token details", async () => {
  const app = await testRender(() => <SidebarContextView api={api} session_id="session-test" />)

  try {
    await app.renderOnce()
    const frame = app.captureCharFrame()
    expect(frame).toContain("Context")
    expect(frame).toContain("Input 100")
    expect(frame).toContain("Output 50")
    expect(frame).toContain("Reasoning 25")
    expect(frame).toContain("Cache read 20")
    expect(frame).toContain("Cache write 5")
    expect(frame).toContain("Total 200")
    expect(frame).toContain("20% used")
    expect(frame).toContain("Cache 13%")
  } finally {
    app.renderer.destroy()
  }
})

test("sidebar context can render collapsed summary", async () => {
  const app = await testRender(() => <SidebarContextView api={api} session_id="session-test" defaultCollapsed />)

  try {
    await app.renderOnce()
    const frame = app.captureCharFrame()
    expect(frame).toContain("Context")
    expect(frame).toContain("200 tokens")
    expect(frame).toContain("20% used")
    expect(frame).not.toContain("Input 100")
  } finally {
    app.renderer.destroy()
  }
})
