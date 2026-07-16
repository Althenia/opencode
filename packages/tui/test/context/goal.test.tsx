import { expect, test } from "bun:test"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { testRender, useRenderer } from "@opentui/solid"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { Show, createSignal, onCleanup, onMount } from "solid-js"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"
import { createEventSource, createFetch, directory, json } from "../fixture/tui-sdk"
import { TestTuiContexts } from "../fixture/tui-environment"
import { tmpdir } from "../fixture/fixture"
import { ArgsProvider } from "../../src/context/args"
import { ClipboardProvider } from "../../src/context/clipboard"
import { DataProvider } from "../../src/context/data"
import { EditorContextProvider, useEditorContext, type EditorSelection } from "../../src/context/editor"
import { ExitProvider } from "../../src/context/exit"
import { GoalProvider, useGoal } from "../../src/context/goal"
import { KVProvider } from "../../src/context/kv"
import { LocalProvider, useLocal } from "../../src/context/local"
import { LocationProvider } from "../../src/context/location"
import { PermissionProvider } from "../../src/context/permission"
import { ProjectProvider } from "../../src/context/project"
import { PromptRefProvider, usePromptRef } from "../../src/context/prompt"
import { RouteProvider, useRoute } from "../../src/context/route"
import { SDKProvider, useSDK } from "../../src/context/sdk"
import { SyncProvider, useSync } from "../../src/context/sync"
import { ThemeProvider } from "../../src/context/theme"
import { TuiConfigProvider } from "../../src/config"
import { FrecencyProvider } from "../../src/component/prompt/frecency"
import { Prompt, type PromptRef } from "../../src/component/prompt"
import { PromptHistoryProvider, type PromptInfo } from "../../src/component/prompt/history"
import { PromptStashProvider } from "../../src/component/prompt/stash"
import { Sidebar } from "../../src/routes/session/sidebar"
import { createPluginRuntime, PluginRuntimeProvider } from "../../src/plugin/runtime"
import { DialogProvider, useDialog } from "../../src/ui/dialog"
import { ToastProvider, useToast } from "../../src/ui/toast"
import { OpencodeKeymapProvider, registerOpencodeKeymap } from "../../src/keymap"

test("bare /goal on home opens the goal prompt without creating a session or starting Goal", async () => {
  const calls: string[] = []
  const app = await mountGoalPrompt(
    (url, request) => {
      if (url.pathname === "/session" && request?.method === "POST") calls.push("create")
      if (url.pathname.endsWith("/goal/start") || url.pathname.endsWith("/goal/stop")) calls.push(url.pathname)
      return undefined
    },
    { home: true },
  )

  try {
    await waitFor(() => !!app.promptRef)
    await waitFor(() => !!app.local.model.current())
    app.promptRef?.set({ input: "/goal", parts: [] })
    await app.promptRef?.submit()
    const frame = await captureFrame(app, (value) => value.includes("Start Goal"))

    expect(frame).toContain("Start Goal")
    expect(calls).toEqual([])
    expect(app.goal.selected()).toBe(false)
    expect(app.route.data.type).toBe("home")
    expect(app.promptRef?.current.input).toBe("/goal")
  } finally {
    app.renderer.destroy()
  }
})

test("the first accepted home Goal prompt creates one session and starts Goal with its ID", async () => {
  const calls: Array<{ method: string; body?: unknown }> = []
  const app = await mountGoalPrompt(
    async (url, request) => {
      if (url.pathname === "/session" && request?.method === "POST") {
        calls.push({ method: "create", body: await request?.json() })
        return json({
          id: "session-home",
          title: "Home Goal",
          slug: "session-home",
          projectID: "project-test",
          directory,
          version: "0.0.0-test",
          time: { created: 0, updated: 0 },
        })
      }
      if (url.pathname === "/api/session/session-home/goal/start") {
        calls.push({ method: "goalStart", body: await request?.json() })
        return json({ data: { goal: "ship task 6", active: true, iteration: 1, cap: 7 } })
      }
      if (url.pathname === "/session/session-home/message") calls.push({ method: "prompt" })
    },
    { home: true },
  )

  try {
    await waitFor(() => !!app.promptRef)
    await waitFor(() => !!app.local.model.current())
    app.promptRef?.set({ input: "/goal ship task 6", parts: [] })
    await app.promptRef?.submit()
    await waitFor(() => calls.length === 2)

    expect(app.goal.selected("session-home")).toBe(true)
    expect(calls.map((call) => call.method)).toEqual(["create", "goalStart"])
    expect(calls[1]?.body).toMatchObject({ goal: "ship task 6" })
    expect(app.goal.selected()).toBe(true)
    expect(app.route.data).toMatchObject({ type: "session", sessionID: "session-home" })
  } finally {
    app.renderer.destroy()
  }
})

test("Home Goal shows Starting and clears input before goalStart resolves", async () => {
  let resolveStart!: (response: Response) => void
  const app = await mountGoalPrompt(
    (url, request) => {
      if (url.pathname === "/session" && request?.method === "POST") {
        return json({
          id: "session-home",
          title: "Home Goal",
          slug: "session-home",
          projectID: "project-test",
          directory,
          version: "0.0.0-test",
          time: { created: 0, updated: 0 },
        })
      }
      if (url.pathname === "/api/session/session-home/goal/start") {
        return new Promise<Response>((resolve) => {
          resolveStart = resolve
        })
      }
    },
    { home: true },
  )

  try {
    await waitFor(() => !!app.promptRef)
    await waitFor(() => !!app.local.model.current())
    app.promptRef?.set({ input: "/goal ship task 6", parts: [] })
    app.promptRef?.submit()
    await waitFor(() => resolveStart !== undefined)

    expect(app.promptRef?.current.input).toBe("")
    expect(app.route.data).toMatchObject({ type: "session", sessionID: "session-home" })
    const frame = await captureFrame(
      app,
      (value) => value.includes("Starting · ship task 6") && value.includes("0 of 0 resolved · 0%"),
    )
    expect(frame).not.toContain("Goal ·")
    expect(frame).toContain("Starting · ship task 6")
    expect(frame).toContain("0 of 0 resolved · 0%")

    resolveStart(json({ data: { goal: "ship task 6", active: true, iteration: 1, cap: 7 } }))
    await waitFor(() => app.goal.active("session-home"))
  } finally {
    resolveStart?.(json({ data: { goal: "ship task 6", active: true, iteration: 1, cap: 7 } }))
    app.renderer.destroy()
  }
})

test("stale Home Goal failure preserves a newer Goal and draft", async () => {
  let resolveFirst!: (response: Response) => void
  let starts = 0
  const app = await mountGoalPrompt(
    (url, request) => {
      if (url.pathname === "/session" && request?.method === "POST") {
        return json({
          id: "session-home",
          title: "Home Goal",
          slug: "session-home",
          projectID: "project-test",
          directory,
          version: "0.0.0-test",
          time: { created: 0, updated: 0 },
        })
      }
      if (url.pathname === "/api/session/session-home/goal/start") {
        starts++
        if (starts === 1) {
          return new Promise<Response>((resolve) => {
            resolveFirst = resolve
          })
        }
        return json({ data: { goal: "goal B", active: true, iteration: 1, cap: 7 } })
      }
    },
    { home: true },
  )

  try {
    await waitFor(() => !!app.promptRef)
    await waitFor(() => !!app.local.model.current())
    app.promptRef?.set({ input: "/goal goal A", parts: [] })
    app.promptRef?.submit()
    await waitFor(() => resolveFirst !== undefined)

    const second = app.goal.start("goal B", "session-home")
    app.promptRef?.set({ input: "newer draft", parts: [] })
    resolveFirst(json({ error: "goal A failed" }, { status: 409 }))
    await second

    expect(starts).toBe(2)
    expect(app.goal.current()).toMatchObject({ goal: "goal B", active: true })
    expect(app.goal.selected("session-home")).toBe(true)
    expect(app.promptRef?.current.input).toBe("newer draft")
  } finally {
    resolveFirst?.(json({ error: "goal A failed" }, { status: 409 }))
    app.renderer.destroy()
  }
})

test.each(["failure", "success"] as const)(
  "stale Home Goal %s cannot take ownership from a newer Home Goal",
  async (outcome) => {
    const creates: Array<(response: Response) => void> = []
    const app = await mountGoalPrompt(
      (url, request) => {
        if (url.pathname === "/session" && request?.method === "POST") {
          return new Promise<Response>((resolve) => creates.push(resolve))
        }
        if (url.pathname === "/api/session/session-a/goal/start") {
          if (outcome === "failure") return json({ error: "goal A failed" }, { status: 409 })
          return json({ data: { goal: "goal A", active: true, iteration: 1, cap: 7 } })
        }
        if (url.pathname === "/api/session/session-b/goal/start") {
          return json({ data: { goal: "goal B", active: true, iteration: 1, cap: 7 } })
        }
      },
      { home: true, routed: true },
    )
    const submissions: Array<Promise<boolean>> = []

    try {
      await waitFor(() => !!app.promptRef)
      await waitFor(() => !!app.local.model.current())
      const firstPrompt = app.state.promptRef
      firstPrompt?.set({ input: "/goal goal A", parts: [] })
      submissions.push(firstPrompt?.submit() ?? Promise.resolve(false))
      await waitFor(() => creates.length === 1 && app.goal.pending() === "goal A")

      app.route.navigate({ type: "session", sessionID: "session-other" })
      await app.renderOnce()
      await waitFor(() => app.state.promptRef !== firstPrompt && app.route.data.type === "session")
      const sessionPrompt = app.state.promptRef
      app.route.navigate({ type: "home" })
      await app.renderOnce()
      await waitFor(() => app.state.promptRef !== sessionPrompt && app.route.data.type === "home")
      app.state.promptRef?.set({ input: "/goal goal B", parts: [] })
      submissions.push(app.state.promptRef?.submit() ?? Promise.resolve(false))
      await waitFor(() => creates.length === 2 && app.goal.pending() === "goal B")

      creates[0](
        json({
          id: "session-a",
          title: "Goal A",
          slug: "session-a",
          projectID: "project-test",
          directory,
          version: "0.0.0-test",
          time: { created: 0, updated: 0 },
        }),
      )
      await submissions[0]
      await app.renderOnce()

      expect(app.route.data).toEqual({ type: "home" })
      expect(app.goal.pending()).toBe("goal B")
      expect(app.state.promptRef?.current.input).toBe("")

      creates[1](
        json({
          id: "session-b",
          title: "Goal B",
          slug: "session-b",
          projectID: "project-test",
          directory,
          version: "0.0.0-test",
          time: { created: 0, updated: 0 },
        }),
      )
      await submissions[1]
    } finally {
      creates.forEach((resolve) => resolve(json({ error: "create failed" }, { status: 500 })))
      await Promise.allSettled(submissions)
      app.renderer.destroy()
    }
  },
)

test("failed Home session creation restores the Goal command", async () => {
  const app = await mountGoalPrompt(
    (url, request) => {
      if (url.pathname === "/session" && request?.method === "POST") {
        return json({ error: "create failed" }, { status: 500 })
      }
    },
    { home: true },
  )

  try {
    await waitFor(() => !!app.promptRef)
    await waitFor(() => !!app.local.model.current())
    app.promptRef?.set({ input: "/goal ship task 6", parts: [] })
    app.promptRef?.submit()
    await waitFor(() => app.promptRef?.current.input === "/goal ship task 6")

    expect(app.goal.pending()).toBeUndefined()
    expect(app.route.data.type).toBe("home")
  } finally {
    app.renderer.destroy()
  }
})

test("failed Home session creation does not restore after navigating away", async () => {
  let resolveCreate!: (response: Response) => void
  const app = await mountGoalPrompt(
    (url, request) => {
      if (url.pathname === "/session" && request?.method === "POST") {
        return new Promise<Response>((resolve) => {
          resolveCreate = resolve
        })
      }
    },
    { home: true },
  )

  try {
    await waitFor(() => !!app.promptRef)
    await waitFor(() => !!app.local.model.current())
    app.promptRef?.set({ input: "/goal ship task 6", parts: [] })
    app.promptRef?.submit()
    await waitFor(() => resolveCreate !== undefined && app.promptRef?.current.input === "")

    app.route.navigate({ type: "session", sessionID: "session-other" })
    resolveCreate(json({ error: "create failed" }, { status: 500 }))
    await waitFor(() => app.goal.pending() === undefined)

    expect(app.route.data).toEqual({ type: "session", sessionID: "session-other" })
    expect(app.promptRef?.current.input).toBe("")
  } finally {
    resolveCreate?.(json({ error: "create failed" }, { status: 500 }))
    app.renderer.destroy()
  }
})

test("rejected Home session creation restores the exact Goal prompt", async () => {
  let rejectCreate!: (error: Error) => void
  const app = await mountGoalPrompt(() => undefined, { home: true })
  const createSession = app.sdk.client.session.create
  app.sdk.client.session.create = (() =>
    new Promise<never>((_, reject) => {
      rejectCreate = reject
    })) as typeof app.sdk.client.session.create
  const submitted = {
    input: "/goal ship task 6 [Image 1]",
    parts: [
      {
        type: "file" as const,
        mime: "image/png",
        filename: "diagram.png",
        url: "data:image/png;base64,AA==",
        source: {
          type: "file" as const,
          path: "diagram.png",
          text: { start: 18, end: 27, value: "[Image 1]" },
        },
      },
    ],
  } satisfies PromptInfo

  try {
    await waitFor(() => !!app.promptRef)
    await waitFor(() => !!app.local.model.current())
    app.promptRef?.set(submitted)
    app.promptRef?.submit()
    await waitFor(() => rejectCreate !== undefined && app.promptRef?.current.input === "")

    rejectCreate(new Error("network down"))
    await waitFor(() => app.promptRef?.current.input === submitted.input)

    expect(app.promptRef?.current).toEqual(submitted)
    expect(app.promptRef?.focused).toBe(true)
    expect(app.goal.pending()).toBeUndefined()
    expect(app.goal.selected()).toBe(false)
    expect(app.route.data.type).toBe("home")

    await app.mockInput.typeText(" ")
    expect(app.promptRef?.current.parts).toEqual(submitted.parts)
  } finally {
    app.sdk.client.session.create = createSession
    rejectCreate?.(new Error("network down"))
    app.renderer.destroy()
  }
})

test("failed Home-created Goal start does not restore after navigating away", async () => {
  let resolveStart!: (response: Response) => void
  const app = await mountGoalPrompt(
    (url, request) => {
      if (url.pathname === "/session" && request?.method === "POST") {
        return json({
          id: "session-home",
          title: "Home Goal",
          slug: "session-home",
          projectID: "project-test",
          directory,
          version: "0.0.0-test",
          time: { created: 0, updated: 0 },
        })
      }
      if (url.pathname === "/api/session/session-home/goal/start") {
        return new Promise<Response>((resolve) => {
          resolveStart = resolve
        })
      }
    },
    { home: true },
  )

  try {
    await waitFor(() => !!app.promptRef)
    await waitFor(() => !!app.local.model.current())
    app.promptRef?.set({ input: "/goal ship task 6", parts: [] })
    app.promptRef?.submit()
    await waitFor(
      () => resolveStart !== undefined && app.route.data.type === "session" && app.route.data.sessionID === "session-home",
    )

    app.route.navigate({ type: "session", sessionID: "session-other" })
    resolveStart(json({ error: "goal failed" }, { status: 409 }))
    await waitFor(() => app.toast.currentToast?.title === "Failed to start Goal")

    expect(app.route.data).toEqual({ type: "session", sessionID: "session-other" })
    expect(app.promptRef?.current.input).toBe("")
    expect(app.goal.pending("session-home")).toBeUndefined()
  } finally {
    resolveStart?.(json({ error: "goal failed" }, { status: 409 }))
    app.renderer.destroy()
  }
})

test("newer normal submission prevents failed Home Goal restoration", async () => {
  let resolveStart!: (response: Response) => void
  const prompts: unknown[] = []
  const app = await mountGoalPrompt(
    async (url, request) => {
      if (url.pathname === "/session" && request?.method === "POST") {
        return json({
          id: "session-home",
          title: "Home Goal",
          slug: "session-home",
          projectID: "project-test",
          directory,
          version: "0.0.0-test",
          time: { created: 0, updated: 0 },
        })
      }
      if (url.pathname === "/api/session/session-home/goal/start") {
        return new Promise<Response>((resolve) => {
          resolveStart = resolve
        })
      }
      if (url.pathname === "/session/session-home/message") {
        prompts.push(await request?.json())
        return json({ data: {} })
      }
    },
    { home: true, routed: true },
  )

  try {
    await waitFor(() => !!app.state.promptRef)
    await waitFor(() => !!app.local.model.current())
    const homePrompt = app.state.promptRef
    homePrompt?.set({ input: "/goal goal A", parts: [] })
    const start = homePrompt?.submit()
    await waitFor(
      () => resolveStart !== undefined && app.route.data.type === "session" && app.route.data.sessionID === "session-home",
    )
    await waitFor(() => app.state.promptRef !== homePrompt)

    app.state.promptRef?.set({ input: "newer normal prompt", parts: [] })
    await app.state.promptRef?.submit()
    await waitFor(() => prompts.length === 1 && app.state.promptRef?.current.input === "")

    resolveStart(json({ error: "goal A failed" }, { status: 409 }))
    await start

    expect(app.state.promptRef?.current.input).toBe("")
  } finally {
    resolveStart?.(json({ error: "goal A failed" }, { status: 409 }))
    app.renderer.destroy()
  }
})

test("newer failed Home submission prevents restoration but clears owned Goal optimism", async () => {
  let resolveGoalCreate!: (response: Response) => void
  let creates = 0
  const app = await mountGoalPrompt(
    (url, request) => {
      if (url.pathname === "/session" && request?.method === "POST") {
        creates++
        if (creates === 1) {
          return new Promise<Response>((resolve) => {
            resolveGoalCreate = resolve
          })
        }
        return json({ error: "normal submission failed" }, { status: 500 })
      }
    },
    { home: true, routed: true },
  )

  try {
    await waitFor(() => !!app.state.promptRef && !!app.state.remountPrompt)
    await waitFor(() => !!app.local.model.current())
    const goalPrompt = app.state.promptRef
    if (!goalPrompt) throw new Error("Goal prompt did not mount")
    goalPrompt.set({ input: "/goal goal A", parts: [] })
    const goalSubmission = goalPrompt.submit()
    await waitFor(() => resolveGoalCreate !== undefined && app.goal.pending() === "goal A")

    app.state.remountPrompt?.()
    await app.renderOnce()
    await waitFor(() => app.state.promptRef !== goalPrompt)
    const normalPrompt = app.state.promptRef
    if (!normalPrompt) throw new Error("Normal prompt did not mount")
    normalPrompt.set({ input: "newer normal prompt", parts: [] })
    await normalPrompt.submit()
    normalPrompt.reset()
    expect(app.route.data).toEqual({ type: "home" })
    expect(app.state.promptRef?.current.input).toBe("")

    resolveGoalCreate(json({ error: "goal A create failed" }, { status: 500 }))
    await goalSubmission

    await waitFor(() => app.goal.pending() === undefined)
    expect(app.goal.pending()).toBeUndefined()
    expect(app.state.promptRef?.current.input).toBe("")
    expect(await captureFrame(app, (value) => value.includes("model"))).not.toContain("Starting · goal A")
  } finally {
    resolveGoalCreate?.(json({ error: "goal A create failed" }, { status: 500 }))
    app.renderer.destroy()
  }
})

test("/goal autocomplete handles blank cancellation and starts Goal through keyboard input", async () => {
  const calls: Array<{ method: string; body?: unknown }> = []
  const app = await mountGoalPrompt(async (url, request) => {
    if (url.pathname === "/api/session/session-test/goal/start") {
      calls.push({ method: "goalStart", body: request ? await request.json() : undefined })
      return json({ data: { goal: "focus on auth and tests", active: true, iteration: 1, cap: 7 } })
    }
  })

  try {
    await waitFor(() => !!app.promptRef)
    await waitFor(() => !!app.local.model.current())
    await waitFor(() => app.promptRef?.focused === true)

    await app.mockInput.typeText("/go")
    expect(await captureFrame(app, (value) => value.includes("/goal"))).toContain("/goal")
    app.mockInput.pressEnter()
    expect(await captureFrame(app, (value) => value.includes("Start Goal"))).toContain("Start Goal")

    await app.mockInput.typeText("   ")
    app.mockInput.pressEnter()
    await waitFor(() => app.dialog.stack.length === 0)
    expect(calls).toEqual([])

    await waitFor(() => app.promptRef?.focused === true)
    await app.mockInput.typeText("/go")
    expect(await captureFrame(app, (value) => value.includes("/goal"))).toContain("/goal")
    app.mockInput.pressEnter()
    expect(await captureFrame(app, (value) => value.includes("Start Goal"))).toContain("Start Goal")

    await app.mockInput.typeText("focus on auth and tests")
    app.mockInput.pressEnter()
    await waitFor(() => calls.length === 1)

    expect(calls[0]?.method).toBe("goalStart")
    expect(calls[0]?.body).toMatchObject({ goal: "focus on auth and tests" })
  } finally {
    app.renderer.destroy()
  }
})

test("/goal with text starts Goal", async () => {
  const calls: Array<{ method: string; body?: unknown }> = []
  const app = await mountGoalPrompt(async (url, request) => {
    if (url.pathname === "/api/session/session-test/goal/start") {
      calls.push({ method: "goalStart", body: request ? await request.json() : undefined })
      return json({ data: { goal: "unexpected", active: true, iteration: 1, cap: 7 } })
    }
    if (url.pathname === "/session/session-test/message") {
      calls.push({ method: "prompt", body: request ? await request.json() : undefined })
      return json({ data: {} })
    }
  })

  try {
    await waitFor(() => !!app.promptRef)
    await waitFor(() => !!app.local.model.current())
    app.promptRef?.set({ input: "/goal focus on auth and tests", parts: [] })
    await app.promptRef?.submit()
    await waitFor(() => calls.length === 1)

    expect(calls[0]?.method).toBe("goalStart")
    expect(calls[0]?.body).toMatchObject({ goal: "focus on auth and tests" })
    expect(app.local.permission.mode).not.toBe("auto")
  } finally {
    app.renderer.destroy()
  }
})

test("failed /goal start preserves the command", async () => {
  const app = await mountGoalPrompt((url) => {
    if (url.pathname === "/api/session/session-test/goal/start") {
      return json({ error: "goal failed" }, { status: 409 })
    }
  })

  try {
    await waitFor(() => !!app.promptRef)
    await waitFor(() => !!app.local.model.current())
    app.promptRef?.set({ input: "/goal ship task 6", parts: [] })
    await app.promptRef?.submit()
    await waitFor(() => app.toast.currentToast?.title === "Failed to start Goal")

    expect(app.promptRef?.current.input).toBe("/goal ship task 6")
    expect(app.goal.pending("session-test")).toBeUndefined()
  } finally {
    app.renderer.destroy()
  }
})

test("failed Goal start preserves a newer draft", async () => {
  let resolveStart!: (response: Response) => void
  const app = await mountGoalPrompt((url) => {
    if (url.pathname === "/api/session/session-test/goal/start") {
      return new Promise<Response>((resolve) => {
        resolveStart = resolve
      })
    }
  })

  try {
    await waitFor(() => !!app.promptRef)
    await waitFor(() => !!app.local.model.current())
    app.promptRef?.set({ input: "/goal goal A", parts: [] })
    app.promptRef?.submit()
    await waitFor(() => resolveStart !== undefined)

    app.promptRef?.set({ input: "newer draft", parts: [] })
    resolveStart(json({ error: "goal A failed" }, { status: 409 }))
    await waitFor(() => app.toast.currentToast?.title === "Failed to start Goal")

    expect(app.promptRef?.current.input).toBe("newer draft")
  } finally {
    resolveStart?.(json({ error: "goal A failed" }, { status: 409 }))
    app.renderer.destroy()
  }
})

test("failed replacement Goal start preserves the active Goal", async () => {
  let starts = 0
  const app = await mountGoalPrompt((url) => {
    if (url.pathname === "/api/session/session-test/goal/start") {
      starts++
      if (starts === 1) return json({ data: { goal: "existing goal", active: true, iteration: 2, cap: 7 } })
      return json({ error: "replacement failed" }, { status: 409 })
    }
  })

  try {
    await waitFor(() => !!app.promptRef)
    await waitFor(() => !!app.local.model.current())
    await app.goal.start("existing goal")

    app.promptRef?.set({ input: "/goal replacement goal", parts: [] })
    app.promptRef?.submit()
    await waitFor(() => app.toast.currentToast?.title === "Failed to start Goal")

    expect(app.promptRef?.current.input).toBe("/goal replacement goal")
    expect(app.goal.current()).toMatchObject({ goal: "existing goal", active: true, iteration: 2, cap: 7 })
    expect(app.goal.active("session-test")).toBe(true)
    expect(app.goal.selected("session-test")).toBe(true)
    expect(app.goal.pending("session-test")).toBeUndefined()
  } finally {
    app.renderer.destroy()
  }
})

test("failed /goal stop preserves the command", async () => {
  const app = await mountGoalPrompt((url) => {
    if (url.pathname === "/api/session/session-test/goal/stop") {
      return json({ error: "goal failed" }, { status: 409 })
    }
  })

  try {
    await waitFor(() => !!app.promptRef)
    await waitFor(() => !!app.local.model.current())
    app.promptRef?.set({ input: "/goal stop", parts: [] })
    await app.promptRef?.submit()
    await waitFor(() => app.toast.currentToast?.title === "Failed to stop Goal")

    expect(app.promptRef?.current.input).toBe("/goal stop")
  } finally {
    app.renderer.destroy()
  }
})

test("free text steers an active goal through the normal prompt endpoint", async () => {
  const calls: string[] = []
  const app = await mountGoalPrompt((url) => {
    if (url.pathname === "/api/session/session-test/goal/start") {
      calls.push("goalStart")
      return json({ data: { goal: "ship task 6", active: true, iteration: 1, cap: 7 } })
    }
    if (url.pathname === "/session/session-test/message") {
      calls.push("prompt")
      return json({ data: {} })
    }
  })

  try {
    await waitFor(() => !!app.promptRef)
    await waitFor(() => !!app.local.model.current())
    await app.goal.start("ship task 6")
    app.promptRef?.set({ input: "focus on tests", parts: [] })
    await app.promptRef?.submit()
    await waitFor(() => calls.includes("prompt"))

    expect(calls).toEqual(["goalStart", "prompt"])
  } finally {
    app.renderer.destroy()
  }
})

test("selected skill autocomplete persists only its exact reference range", async () => {
  const calls: unknown[] = []
  const app = await mountGoalPrompt(async (url, request) => {
    if (url.pathname !== "/session/session-test/message") return
    calls.push(await request?.json())
    return json({ data: {} })
  })

  try {
    await waitFor(() => !!app.promptRef)
    await waitFor(() => !!app.local.model.current())
    await waitFor(() => app.promptRef?.focused === true)

    await app.mockInput.typeText("echo $effect ")
    await app.mockInput.typeText("$eff")
    expect(await captureFrame(app, (value) => value.includes("✦ effect"))).toContain("✦ effect")
    app.mockInput.pressEnter()
    await waitFor(() => app.promptRef?.current.input === "echo $effect $effect ")
    app.mockInput.pressEnter()
    await waitFor(() => calls.length === 1)

    expect(calls[0]).toMatchObject({
      parts: [
        {
          type: "text",
          text: "echo $effect $effect ",
          metadata: { skillReferences: [{ start: 13, end: 20, name: "effect" }] },
        },
      ],
    })
  } finally {
    app.renderer.destroy()
  }
})

test("selected skill provenance survives prompt history restoration", async () => {
  const calls: unknown[] = []
  const app = await mountGoalPrompt(async (url, request) => {
    if (url.pathname !== "/session/session-test/message") return
    calls.push(await request?.json())
    return json({ data: {} })
  })

  try {
    await waitFor(() => !!app.promptRef)
    await waitFor(() => !!app.local.model.current())
    await waitFor(() => app.promptRef?.focused === true)

    await app.mockInput.typeText("echo $effect ")
    await app.mockInput.typeText("$eff")
    expect(await captureFrame(app, (value) => value.includes("✦ effect"))).toContain("✦ effect")
    app.mockInput.pressEnter()
    await waitFor(() => app.promptRef?.current.input === "echo $effect $effect ")
    app.mockInput.pressEnter()
    await waitFor(() => calls.length === 1 && app.promptRef?.current.input === "")

    app.keymap.dispatchCommand("prompt.history.previous")
    await waitFor(() => app.promptRef?.current.input === "echo $effect $effect ")
    expect(app.promptRef?.current.parts).toEqual([
      {
        type: "text",
        text: "$effect",
        metadata: { kind: "skill_reference", name: "effect" },
        source: { text: { start: 13, end: 20, value: "$effect" } },
      },
    ])

    app.mockInput.pressEnter()
    await waitFor(() => calls.length === 2)
    expect(calls[1]).toMatchObject({
      parts: [
        {
          type: "text",
          text: "echo $effect $effect ",
          metadata: { skillReferences: [{ start: 13, end: 20, name: "effect" }] },
        },
      ],
    })
  } finally {
    app.renderer.destroy()
  }
})

test("submitted skill reference ranges account for tracked pasted-text expansion", async () => {
  const calls: unknown[] = []
  const app = await mountGoalPrompt(async (url, request) => {
    if (url.pathname !== "/session/session-test/message") return
    calls.push(await request?.json())
    return json({ data: {} })
  })

  try {
    await waitFor(() => !!app.promptRef)
    await waitFor(() => !!app.local.model.current())
    app.promptRef?.set({
      input: "[Pasted ~3 lines] $effect",
      parts: [
        {
          type: "text",
          text: "alpha\nbeta\ngamma",
          source: { text: { start: 0, end: 17, value: "[Pasted ~3 lines]" } },
        },
        {
          type: "text",
          text: "$effect",
          metadata: { kind: "skill_reference", name: "effect" },
          source: { text: { start: 18, end: 25, value: "$effect" } },
        },
      ],
    })
    await app.promptRef?.submit()
    await waitFor(() => calls.length === 1)

    expect(calls[0]).toMatchObject({
      parts: [
        {
          type: "text",
          text: "alpha\nbeta\ngamma $effect",
          metadata: { skillReferences: [{ start: 17, end: 24, name: "effect" }] },
        },
      ],
    })
  } finally {
    app.renderer.destroy()
  }
})

test("goal start does not switch yolo before the server responds", async () => {
  let resolveStart!: (response: Response) => void
  const app = await mountGoalPrompt((url) => {
    if (url.pathname === "/api/session/session-test/goal/start") {
      return new Promise<Response>((resolve) => {
        resolveStart = resolve
      })
    }
  })

  try {
    const start = app.goal.start("ship task 6")
    await waitFor(() => resolveStart !== undefined)
    expect(app.local.permission.mode).toBe("normal")
    resolveStart(json({ data: { goal: "ship task 6", active: true, iteration: 1, cap: 7 } }))
    await start

    expect(app.local.permission.mode).toBe("normal")
  } finally {
    app.renderer.destroy()
  }
})

test("goal start after deselection immediately owns selection", async () => {
  let resolveStart!: (response: Response) => void
  const app = await mountGoalPrompt((url) => {
    if (url.pathname === "/api/session/session-test/goal/start") {
      return new Promise<Response>((resolve) => {
        resolveStart = resolve
      })
    }
  })

  try {
    app.goal.deselect("session-test")
    const start = app.goal.start("ship task 6")
    await waitFor(() => resolveStart !== undefined)

    expect(app.goal.selected("session-test")).toBe(true)
    expect(app.goal.answering("session-test")).toBe(true)
    resolveStart(json({ data: { goal: "ship task 6", active: true, iteration: 1, cap: 7 } }))
    await start

    expect(app.goal.selected("session-test")).toBe(true)
    expect(app.goal.active("session-test")).toBe(true)
  } finally {
    resolveStart?.(json({ data: { goal: "ship task 6", active: true, iteration: 1, cap: 7 } }))
    app.renderer.destroy()
  }
})

test("pending start toggle updates selection and answering immediately", async () => {
  let resolveStart!: (response: Response) => void
  let resolveStop!: (response: Response) => void
  const app = await mountGoalPrompt((url) => {
    if (url.pathname === "/api/session/session-test/goal/start") {
      return new Promise<Response>((resolve) => {
        resolveStart = resolve
      })
    }
    if (url.pathname === "/api/session/session-test/goal/stop") {
      return new Promise<Response>((resolve) => {
        resolveStop = resolve
      })
    }
  })

  try {
    const start = app.goal.start("ship task 6")
    await waitFor(() => resolveStart !== undefined)
    const off = app.goal.toggle()
    expect(app.goal.selected("session-test")).toBe(false)
    expect(app.goal.answering("session-test")).toBe(false)

    const on = app.goal.toggle()
    expect(app.goal.selected("session-test")).toBe(true)
    expect(app.goal.answering("session-test")).toBe(true)

    resolveStart(json({ data: { goal: "ship task 6", active: true, iteration: 1, cap: 7 } }))
    await start
    await waitFor(() => resolveStop !== undefined)
    resolveStop(new Response(null, { status: 204 }))
    await Promise.all([off, on])

    expect(app.goal.selected("session-test")).toBe(true)
    expect(app.goal.answering("session-test")).toBe(false)
  } finally {
    resolveStart?.(json({ data: { goal: "ship task 6", active: true, iteration: 1, cap: 7 } }))
    resolveStop?.(new Response(null, { status: 204 }))
    app.renderer.destroy()
  }
})

test("an older same-session start failure does not roll back a newer start", async () => {
  let resolveFirst!: (response: Response) => void
  let starts = 0
  const app = await mountGoalPrompt((url) => {
    if (url.pathname === "/api/session/session-test/goal/start") {
      starts++
      if (starts === 1) {
        return new Promise<Response>((resolve) => {
          resolveFirst = resolve
        })
      }
      return json({ data: { goal: "second", active: true, iteration: 1, cap: 7 } })
    }
  })

  try {
    const first = app.goal.start("first").then(
      () => false,
      () => true,
    )
    await waitFor(() => resolveFirst !== undefined)
    const second = app.goal.start("second")

    resolveFirst(json({ error: "goal failed" }, { status: 409 }))
    expect(await first).toBe(true)
    await second

    expect(app.local.permission.mode).toBe("normal")
    expect(app.goal.current()).toMatchObject({ goal: "second", active: true })
  } finally {
    app.renderer.destroy()
  }
})

test("overlapping same-session start failures do not change yolo mode", async () => {
  let resolveFirst!: (response: Response) => void
  let starts = 0
  const app = await mountGoalPrompt((url) => {
    if (url.pathname === "/api/session/session-test/goal/start") {
      starts++
      if (starts === 1) {
        return new Promise<Response>((resolve) => {
          resolveFirst = resolve
        })
      }
      return json({ error: "second goal failed" }, { status: 409 })
    }
  })

  try {
    const first = app.goal.start("first").then(
      () => false,
      () => true,
    )
    await waitFor(() => resolveFirst !== undefined)
    const second = app.goal.start("second").then(
      () => false,
      () => true,
    )

    resolveFirst(json({ error: "first goal failed" }, { status: 409 }))

    expect(await Promise.all([first, second])).toEqual([true, true])
    expect(app.local.permission.mode).toBe("normal")
    expect(app.goal.current()).toBeUndefined()
  } finally {
    app.renderer.destroy()
  }
})

test("queued replacement failure preserves the active Goal completed ahead of it", async () => {
  let resolveFirst!: (response: Response) => void
  let starts = 0
  const app = await mountGoalPrompt((url) => {
    if (url.pathname === "/api/session/session-test/goal/start") {
      starts++
      if (starts === 1) {
        return new Promise<Response>((resolve) => {
          resolveFirst = resolve
        })
      }
      return json({ error: "goal B failed" }, { status: 409 })
    }
  })

  try {
    const first = app.goal.start("goal A")
    await waitFor(() => resolveFirst !== undefined)
    const second = app.goal.start("goal B").then(
      () => false,
      () => true,
    )

    resolveFirst(json({ data: { goal: "goal A", active: true, iteration: 1, cap: 7 } }))
    await first

    expect(await second).toBe(true)
    expect(app.goal.current()).toMatchObject({ goal: "goal A", active: true })
    expect(app.goal.selected("session-test")).toBe(true)
    expect(app.goal.answering("session-test")).toBe(true)
  } finally {
    resolveFirst?.(json({ data: { goal: "goal A", active: true, iteration: 1, cap: 7 } }))
    app.renderer.destroy()
  }
})

test("an older cross-session start failure does not roll back a newer start", async () => {
  let resolveFirst!: (response: Response) => void
  const app = await mountGoalPrompt((url) => {
    if (url.pathname.endsWith("/goal/status")) return json({ data: null })
    if (url.pathname === "/api/session/session-a/goal/start") {
      return new Promise<Response>((resolve) => {
        resolveFirst = resolve
      })
    }
    if (url.pathname === "/api/session/session-b/goal/start") {
      return json({ data: { goal: "second", active: true, iteration: 1, cap: 7 } })
    }
  })

  try {
    app.route.navigate({ type: "session", sessionID: "session-a" })
    const first = app.goal.start("first").then(
      () => false,
      () => true,
    )
    await waitFor(() => resolveFirst !== undefined)

    app.route.navigate({ type: "session", sessionID: "session-b" })
    await app.goal.start("second")
    resolveFirst(json({ error: "goal failed" }, { status: 409 }))

    expect(await first).toBe(true)
    expect(app.local.permission.mode).toBe("normal")
    expect(app.goal.active("session-b")).toBe(true)
    expect(app.goal.current()).toMatchObject({ goal: "second", active: true })
  } finally {
    app.renderer.destroy()
  }
})

test("overlapping cross-session start failures do not change yolo mode", async () => {
  let resolveFirst!: (response: Response) => void
  let resolveSecond!: (response: Response) => void
  const app = await mountGoalPrompt((url) => {
    if (url.pathname.endsWith("/goal/status")) return json({ data: null })
    if (url.pathname === "/api/session/session-a/goal/start") {
      return new Promise<Response>((resolve) => {
        resolveFirst = resolve
      })
    }
    if (url.pathname === "/api/session/session-b/goal/start") {
      return new Promise<Response>((resolve) => {
        resolveSecond = resolve
      })
    }
  })

  try {
    app.route.navigate({ type: "session", sessionID: "session-a" })
    const first = app.goal.start("first").then(
      () => false,
      () => true,
    )
    await waitFor(() => resolveFirst !== undefined)

    app.route.navigate({ type: "session", sessionID: "session-b" })
    const second = app.goal.start("second").then(
      () => false,
      () => true,
    )
    await waitFor(() => resolveSecond !== undefined)

    resolveSecond(json({ error: "second goal failed" }, { status: 409 }))
    resolveFirst(json({ error: "first goal failed" }, { status: 409 }))

    expect(await Promise.all([first, second])).toEqual([true, true])
    expect(app.local.permission.mode).toBe("normal")
    expect(app.goal.active("session-a")).toBe(false)
    expect(app.goal.active("session-b")).toBe(false)
  } finally {
    app.renderer.destroy()
  }
})

test("serializes a slow inactive refresh before start", async () => {
  let resolveRefresh!: (response: Response) => void
  let statusCalls = 0
  let startCalls = 0
  const app = await mountGoalPrompt((url) => {
    if (url.pathname === "/api/session/session-test/goal/status") {
      statusCalls++
      if (statusCalls === 1) return json({ data: null })
      return new Promise<Response>((resolve) => {
        resolveRefresh = resolve
      })
    }
    if (url.pathname === "/api/session/session-test/goal/start") {
      startCalls++
      return json({ data: { goal: "ship task 6", active: true, iteration: 1, cap: 7 } })
    }
  })

  try {
    await waitFor(() => statusCalls === 1)
    const refresh = app.goal.status()
    await waitFor(() => statusCalls === 2)
    const start = app.goal.start("ship task 6")
    const startWaitedForRefresh = startCalls === 0

    resolveRefresh(json({ data: null }))
    await Promise.all([refresh, start])

    expect(startWaitedForRefresh).toBe(true)
    expect(app.goal.current()).toMatchObject({ goal: "ship task 6", active: true })
  } finally {
    app.renderer.destroy()
  }
})

test("serializes a slow active refresh before stop", async () => {
  let resolveRefresh!: (response: Response) => void
  let statusCalls = 0
  let stopCalls = 0
  const app = await mountGoalPrompt((url) => {
    if (url.pathname === "/api/session/session-test/goal/status") {
      statusCalls++
      if (statusCalls === 1) return json({ data: null })
      return new Promise<Response>((resolve) => {
        resolveRefresh = resolve
      })
    }
    if (url.pathname === "/api/session/session-test/goal/start") {
      return json({ data: { goal: "ship task 6", active: true, iteration: 1, cap: 7 } })
    }
    if (url.pathname === "/api/session/session-test/goal/stop") {
      stopCalls++
      return new Response(null, { status: 204 })
    }
  })

  try {
    await waitFor(() => statusCalls === 1)
    await app.goal.start("ship task 6")
    const refresh = app.goal.status()
    await waitFor(() => statusCalls === 2)
    const stop = app.goal.stop()
    const stopWaitedForRefresh = stopCalls === 0

    resolveRefresh(json({ data: { goal: "ship task 6", active: true, iteration: 2, cap: 7 } }))
    await Promise.all([refresh, stop])

    expect(stopWaitedForRefresh).toBe(true)
    expect(app.goal.current()).toBeUndefined()
  } finally {
    app.renderer.destroy()
  }
})

test("clear invalidates an in-flight status response", async () => {
  let resolveStatus!: (response: Response) => void
  let statusCalls = 0
  const app = await mountGoalPrompt((url) => {
    if (url.pathname === "/api/session/session-test/goal/status") {
      statusCalls++
      if (statusCalls === 1) return json({ data: null })
      return new Promise<Response>((resolve) => {
        resolveStatus = resolve
      })
    }
  })

  try {
    await waitFor(() => statusCalls === 1)
    const status = app.goal.status()
    await waitFor(() => resolveStatus !== undefined)
    app.goal.clear("session-test")
    resolveStatus(json({ data: { goal: "deleted", active: true, iteration: 1, cap: 7 } }))
    await status

    expect(app.goal.active("session-test")).toBe(false)
    expect(app.goal.current()).toBeUndefined()
  } finally {
    app.renderer.destroy()
  }
})

test("clear invalidates a toggle queued behind an in-flight request", async () => {
  let resolveStart!: (response: Response) => void
  let starts = 0
  let stops = 0
  const app = await mountGoalPrompt((url) => {
    if (url.pathname === "/api/session/session-test/goal/start") {
      starts++
      return new Promise<Response>((resolve) => {
        resolveStart = resolve
      })
    }
    if (url.pathname === "/api/session/session-test/goal/stop") {
      stops++
      return new Response(null, { status: 204 })
    }
  })

  try {
    const start = app.goal.start("ship")
    await waitFor(() => resolveStart !== undefined)
    const toggle = app.goal.toggle()
    app.goal.clear("session-test")
    resolveStart(json({ data: { goal: "ship", active: true, iteration: 1, cap: 7 } }))
    await Promise.all([start, toggle])

    expect(starts).toBe(1)
    expect(stops).toBe(0)
    expect(app.goal.selected("session-test")).toBe(false)
    expect(app.goal.current()).toBeUndefined()
  } finally {
    app.renderer.destroy()
  }
})

test("overlapping selected goal toggles preserve selection parity", async () => {
  let stops = 0
  const app = await mountGoalPrompt((url) => {
    if (url.pathname === "/api/session/session-test/goal/start") {
      return json({ data: { goal: "ship", active: true, iteration: 1, cap: 7 } })
    }
    if (url.pathname === "/api/session/session-test/goal/stop") {
      stops++
      return new Response(null, { status: 204 })
    }
  })

  try {
    await app.goal.start("ship")
    expect(app.goal.selected("session-test")).toBe(true)
    const first = app.goal.toggle()
    const second = app.goal.toggle()
    await Promise.all([first, second])

    expect(stops).toBe(1)
    expect(app.goal.selected("session-test")).toBe(true)
  } finally {
    app.renderer.destroy()
  }
})

test("/goal stop stops the active Goal", async () => {
  const calls: string[] = []
  const app = await mountGoalPrompt((url) => {
    if (url.pathname === "/api/session/session-test/goal/stop") {
      calls.push("stop")
      return new Response(null, { status: 204 })
    }
    if (url.pathname === "/session/session-test/message") {
      calls.push("prompt")
      return json({ data: {} })
    }
  })

  try {
    await waitFor(() => !!app.promptRef)
    await waitFor(() => !!app.local.model.current())
    app.promptRef?.set({ input: "/goal stop", parts: [] })
    await app.promptRef?.submit()
    await waitFor(() => calls.includes("stop"))

    expect(calls).not.toContain("prompt")
  } finally {
    app.renderer.destroy()
  }
})

test("toggle stops an exhausted run before deselecting", async () => {
  let stops = 0
  const app = await mountGoalPrompt((url) => {
    if (url.pathname === "/api/session/session-test/goal/status") {
      return json({ data: { goal: "ship task 6", active: false, iteration: 7, cap: 7 } })
    }
    if (url.pathname === "/api/session/session-test/goal/stop") {
      stops++
      return new Response(null, { status: 204 })
    }
  })

  try {
    await app.goal.status()
    expect(app.goal.selected("session-test")).toBe(true)

    await app.goal.toggle()

    expect(stops).toBe(1)
    expect(app.goal.selected("session-test")).toBe(false)
  } finally {
    app.renderer.destroy()
  }
})

test("explicit exhausted stop remains deselected after polling", async () => {
  let stops = 0
  const app = await mountGoalPrompt((url) => {
    if (url.pathname === "/api/session/session-test/goal/status") {
      return json({ data: { goal: "ship task 6", active: false, iteration: 7, cap: 7 } })
    }
    if (url.pathname === "/api/session/session-test/goal/stop") {
      stops++
      return new Response(null, { status: 204 })
    }
  })

  try {
    await app.goal.status()
    await app.goal.stop("session-test")
    app.goal.deselect("session-test")
    await app.goal.status()

    expect(stops).toBe(1)
    expect(app.goal.selected("session-test")).toBe(false)
    expect(app.goal.current()).toBeUndefined()
  } finally {
    app.renderer.destroy()
  }
})

test("explicit start and stop target the supplied session", async () => {
  const calls: string[] = []
  const app = await mountGoalPrompt((url) => {
    if (url.pathname === "/api/session/session-a/goal/start") {
      calls.push("start-a")
      return json({ data: { goal: "ship", active: true, iteration: 1, cap: 7 } })
    }
    if (url.pathname === "/api/session/session-a/goal/stop") {
      calls.push("stop-a")
      return new Response(null, { status: 204 })
    }
    if (url.pathname === "/api/session/session-b/goal/status") return json({ data: null })
    if (url.pathname.endsWith("/goal/start")) {
      calls.push("start-wrong")
      return json({ data: { goal: "wrong", active: true, iteration: 1, cap: 7 } })
    }
    if (url.pathname.endsWith("/goal/stop")) {
      calls.push("stop-wrong")
      return new Response(null, { status: 204 })
    }
  })

  try {
    app.route.navigate({ type: "session", sessionID: "session-b" })
    await app.goal.start("ship", "session-a")
    await app.goal.stop("session-a")

    expect(calls).toEqual(["start-a", "stop-a"])
    expect(app.goal.active("session-a")).toBe(false)
  } finally {
    app.renderer.destroy()
  }
})

test("prompt submission steers normally while a Goal is starting", async () => {
  let starts = 0
  let prompts = 0
  let resolveStart!: (response: Response) => void
  const app = await mountGoalPrompt((url) => {
    if (url.pathname === "/api/session/session-test/goal/start") {
      starts++
      return new Promise<Response>((resolve) => {
        resolveStart = resolve
      })
    }
    if (url.pathname === "/session/session-test/message") {
      prompts++
      return json({ data: {} })
    }
  })

  try {
    await waitFor(() => !!app.promptRef)
    await waitFor(() => !!app.local.model.current())
    const start = app.goal.start("first")
    await waitFor(() => resolveStart !== undefined)

    app.promptRef?.set({ input: "steer while starting", parts: [] })
    app.promptRef?.submit()
    await waitFor(() => prompts === 1)

    expect(starts).toBe(1)
    resolveStart(json({ data: { goal: "first", active: true, iteration: 1, cap: 7 } }))
    await start
  } finally {
    app.renderer.destroy()
  }
})

test("status polling records active goal status", async () => {
  const app = await mountGoalPrompt((url) => {
    if (url.pathname === "/api/session/session-test/goal/status") {
      return json({ data: { goal: "ship task 6", active: true, iteration: 2, cap: 7 } })
    }
  })

  try {
    await app.goal.status()

    expect(app.goal.current()).toMatchObject({ goal: "ship task 6", active: true, iteration: 2, cap: 7 })
  } finally {
    app.renderer.destroy()
  }
})

test("inactive exhausted Goal status stays persisted without rendering the band", async () => {
  const app = await mountGoalPrompt((url) => {
    if (url.pathname === "/api/session/session-test/goal/status") {
      return json({ data: { goal: "finished goal", active: false, iteration: 7, cap: 7 } })
    }
  })

  try {
    await app.goal.status()
    const frame = await captureFrame(app, (value) => value.includes("model"))

    expect(app.goal.current()).toMatchObject({ goal: "finished goal", active: false, iteration: 7, cap: 7 })
    expect(app.goal.selected("session-test")).toBe(true)
    expect(frame).not.toContain("Goal · finished goal")
    expect(frame).not.toContain("Current target · finished goal")
  } finally {
    app.renderer.destroy()
  }
})

test("Goal band shows todo-driven progress from synchronized updates", async () => {
  const app = await mountGoalPrompt((url) => {
    if (url.pathname === "/session/session-test") {
      return json({
        id: "session-test",
        title: "Goal session",
        slug: "session-test",
        projectID: "project-test",
        directory,
        version: "0.0.0-test",
        time: { created: 0, updated: 0 },
      })
    }
    if (url.pathname === "/session/session-test/message" || url.pathname === "/session/session-test/diff") {
      return json([])
    }
    if (url.pathname === "/api/session/session-test/goal/start") {
      return json({ data: { goal: "ship task 6", active: true, iteration: 1, cap: 7 } })
    }
    if (url.pathname === "/session/session-test/todo") {
      return json([
        { content: "Inspect", status: "completed", priority: "high" },
        { content: "Discard obsolete path", status: "cancelled", priority: "low" },
        { content: "Verify source", status: "in_progress", priority: "high" },
        { content: "Review", status: "pending", priority: "medium" },
      ])
    }
  })

  try {
    await app.sync.session.sync("session-test")
    await app.goal.start("ship task 6")
    const frame = await captureFrame(
      app,
      (value) => value.includes("Current target · Verify source") && value.includes("2 of 4 resolved · 50%"),
    )
    expect(frame).toContain("Current target · Verify source")
    expect(frame).toContain("2 of 4 resolved · 50%")
    expect(frame).not.toContain("Goal · ship task 6")

    app.events.emit({
      directory,
      project: "project-test",
      payload: {
        id: "event-todo-updated",
        type: "todo.updated",
        properties: {
          sessionID: "session-test",
          todos: [
            { content: "Inspect", status: "completed", priority: "high" },
            { content: "Verify source", status: "completed", priority: "high" },
            { content: "Final review", status: "in_progress", priority: "medium" },
          ],
        },
      },
    })

    const updated = await captureFrame(
      app,
      (value) => value.includes("Current target · Final review") && value.includes("2 of 3 resolved · 67%"),
    )
    expect(updated).toContain("2 of 3 resolved · 67%")
  } finally {
    app.renderer.destroy()
  }
})

test("replacement Goal starts at zero without old todos", async () => {
  let resolveReplacement!: (response: Response) => void
  let starts = 0
  const app = await mountGoalPrompt((url) => {
    if (url.pathname === "/api/session/session-test/goal/start") {
      starts++
      if (starts === 1) return json({ data: { goal: "old goal", active: true, iteration: 2, cap: 7 } })
      return new Promise<Response>((resolve) => {
        resolveReplacement = resolve
      })
    }
  })

  try {
    await app.goal.start("old goal")
    app.sync.set("todo", "session-test", [
      { content: "Old completed", status: "completed", priority: "high" },
      { content: "Old pending", status: "pending", priority: "medium" },
    ])

    const replacement = app.goal.start("new objective")
    await waitFor(() => resolveReplacement !== undefined)
    const frame = await captureFrame(
      app,
      (value) => value.includes("Starting · new objective") && value.includes("0 of 0 resolved · 0%"),
    )

    expect(frame).not.toContain("Goal ·")
    expect(frame).toContain("Starting · new objective")
    expect(frame).toContain("0 of 0 resolved · 0%")
    expect(frame).not.toContain("Old pending")

    resolveReplacement(json({ data: { goal: "new objective", active: true, iteration: 1, cap: 7 } }))
    await replacement
  } finally {
    resolveReplacement?.(json({ data: { goal: "new objective", active: true, iteration: 1, cap: 7 } }))
    app.renderer.destroy()
  }
})

test("Goal state transitions from replacement start to active to removed", async () => {
  let resolveStart!: (response: Response) => void
  const app = await mountGoalPrompt((url) => {
    if (url.pathname === "/api/session/session-test/goal/status") {
      return json({ data: { goal: "stale goal", active: false, iteration: 7, cap: 7 } })
    }
    if (url.pathname === "/api/session/session-test/goal/start") {
      return new Promise<Response>((resolve) => {
        resolveStart = resolve
      })
    }
    if (url.pathname === "/api/session/session-test/goal/stop") return new Response(null, { status: 204 })
  })

  try {
    await app.goal.status()
    const start = app.goal.start("replacement goal")
    await waitFor(() => resolveStart !== undefined)

    expect(app.goal.starting("session-test")).toBe(true)
    expect(app.goal.current()?.goal).toBe("stale goal")

    resolveStart(json({ data: { goal: "replacement goal", active: true, iteration: 1, cap: 7 } }))
    await start
    expect(app.goal.current()).toMatchObject({ goal: "replacement goal", active: true })
    expect(app.goal.starting("session-test")).toBe(false)

    await app.goal.stop()
    expect(app.goal.answering("session-test")).toBe(false)
    expect(app.goal.current()).toBeUndefined()
  } finally {
    resolveStart?.(json({ data: { goal: "replacement goal", active: true, iteration: 1, cap: 7 } }))
    app.renderer.destroy()
  }
})

test("long Goal keeps prompt controls visible at narrow width", async () => {
  const goal = "ship a deliberately long goal through every validation stage"
  const app = await mountGoalPrompt(
    (url) => {
      if (url.pathname === "/api/session/session-test/goal/start") {
        return json({ data: { goal, active: true, iteration: 1, cap: 7 } })
      }
    },
    { width: 60, right: true },
  )

  try {
    await app.goal.start(goal)
    const frame = await captureFrame(app, (value) => value.includes("model") && value.includes("controls"))

    expect(frame).toContain("model")
    expect(frame).toContain("controls")
    expect(frame).not.toContain("Goal ·")
    expect(frame).toContain("Current target · ship a deliberately long goal")
  } finally {
    app.renderer.destroy()
  }
})

test("Goal band stays compact with long content at narrow width", async () => {
  const goal = Array(12).fill("objective").join(" ")
  const target = Array(12).fill("verification").join(" ")
  const app = await mountGoalPrompt(
    (url) => {
      if (url.pathname === "/api/session/session-test/goal/start") {
        return json({ data: { goal, active: true, iteration: 1, cap: 7 } })
      }
    },
    { width: 24 },
  )

  try {
    await app.goal.start(goal)
    app.sync.set("todo", "session-test", [{ content: target, status: "in_progress", priority: "high" }])
    const frame = await captureFrame(app, (value) => value.includes("Current target") && value.includes("model"))
    const rows = frame.split("\n")
    const barRows = rows.filter((row) => row.includes("━"))
    const barRow = rows.findIndex((row) => row.includes("━"))
    const targetRow = rows.findIndex((row) => row.includes("Current target"))
    const summaryRows = rows.filter((row) => row.includes("0/1 · 0%"))
    const resolvedRow = rows.findIndex((row) => row.includes("0/1 · 0%"))

    expect(barRows).toHaveLength(1)
    expect(barRows[0]?.match(/━/g)).toHaveLength(19)
    expect(summaryRows).toHaveLength(1)
    expect(barRow).toBeGreaterThanOrEqual(0)
    expect(targetRow).toBeGreaterThan(barRow)
    expect(resolvedRow).toBeGreaterThan(targetRow)
    expect(resolvedRow - barRow).toBeLessThanOrEqual(3)
    expect(frame).not.toContain("Goal ·")
    expect(frame).toContain("model")

    const digitTodos = [
      { content: "Done", status: "completed" as const, priority: "high" as const },
      { content: target, status: "in_progress" as const, priority: "high" as const },
      ...Array.from({ length: 9 }, (_, index) => ({
        content: `Pending ${index}`,
        status: "pending" as const,
        priority: "low" as const,
      })),
    ]
    app.sync.set("todo", "session-test", digitTodos)
    const nine = await captureFrame(app, (value) => value.includes("1/11 · 9%"))
    const nineRows = nine.split("\n")
    const nineSummaryRow = nineRows.findIndex((row) => row.includes("1/11 · 9%"))

    app.sync.set("todo", "session-test", digitTodos.slice(0, -1))
    const ten = await captureFrame(app, (value) => value.includes("1/10 · 10%"))
    const tenRows = ten.split("\n")
    const tenSummaryRow = tenRows.findIndex((row) => row.includes("1/10 · 10%"))

    expect(nineRows.filter((row) => row.includes("1/11 · 9%"))).toHaveLength(1)
    expect(tenRows.filter((row) => row.includes("1/10 · 10%"))).toHaveLength(1)
    expect(tenSummaryRow).toBe(nineSummaryRow)
  } finally {
    app.renderer.destroy()
  }
})

test("a server-active final goal attempt remains active and answering", async () => {
  let starts = 0
  const app = await mountGoalPrompt((url) => {
    if (url.pathname === "/api/session/session-test/goal/start") {
      starts++
      return json({ data: { goal: "ship task 6", active: true, iteration: 7, cap: 7 } })
    }
    if (url.pathname === "/api/session/session-test/goal/status") {
      return json({ data: { goal: "ship task 6", active: true, iteration: 7, cap: 7 } })
    }
  })

  try {
    await app.goal.start("ship task 6")

    expect(starts).toBe(1)
    expect(app.goal.active("session-test")).toBe(true)
    expect(app.goal.answering("session-test")).toBe(true)

    await app.goal.status()

    expect(app.goal.active("session-test")).toBe(true)
    expect(app.goal.answering("session-test")).toBe(true)
  } finally {
    app.renderer.destroy()
  }
})

test("status polling does not render goal details in the sidebar", async () => {
  const app = await mountGoalPrompt(
    (url) => {
      if (url.pathname === "/api/session/session-test/goal/status") {
        return json({ data: { goal: "ship task 6", active: true, iteration: 2, cap: 7 } })
      }
    },
    { sidebar: true },
  )

  try {
    await app.goal.status()
    const frame = await captureFrame(app, (frame) => frame.includes("Goal session"))
    expect(frame).not.toContain("ship task 6")
    expect(frame).not.toContain("2/7")
  } finally {
    app.renderer.destroy()
  }
})

test("clear removes a known session goal status", async () => {
  const app = await mountGoalPrompt((url) => {
    if (url.pathname === "/api/session/session-test/goal/start") {
      return json({ data: { goal: "ship task 6", active: true, iteration: 1, cap: 7 } })
    }
  })

  try {
    await app.goal.start("ship task 6")
    expect(app.goal.active("session-test")).toBe(true)

    app.goal.clear("session-test")

    expect(app.goal.active("session-test")).toBe(false)
    expect(app.goal.current()).toBeUndefined()
  } finally {
    app.renderer.destroy()
  }
})

test("failed goal start does not change yolo mode", async () => {
  const app = await mountGoalPrompt((url) => {
    if (url.pathname === "/api/session/session-test/goal/start") {
      return json({ error: "goal already active" }, { status: 409 })
    }
  })

  try {
    let rejected = false
    try {
      await app.goal.start("ship task 6")
    } catch {
      rejected = true
    }

    expect(rejected).toBe(true)
    expect(app.local.permission.mode).not.toBe("auto")
  } finally {
    app.renderer.destroy()
  }
})

async function mountGoalPrompt(
  handler: (url: URL, request?: Request) => Response | undefined | Promise<Response | undefined>,
  options: {
    sidebar?: boolean
    home?: boolean
    editorSelection?: EditorSelection
    width?: number
    right?: boolean
    routed?: boolean
  } = {},
) {
  const tmp = await tmpdir()
  await mkdir(path.join(tmp.path, "state"), { recursive: true })
  await Bun.write(path.join(tmp.path, "state", "kv.json"), "{}")
  const events = createEventSource()
  const base = createFetch(undefined, events)
  const fetch = (async (input: RequestInfo | URL) => {
    const request = input instanceof Request ? input : new Request(input)
    const url = new URL(request.url)
    const overridden = await handler(url, request.clone())
    if (overridden) return overridden
    if (url.pathname === "/api/session/session-test/goal/status") return json({ data: null })
    return base.fetch(request)
  }) as typeof globalThis.fetch
  const state = {} as {
    promptRef: PromptRef | undefined
    local: ReturnType<typeof useLocal>
    dialog: ReturnType<typeof useDialog>
    goal: ReturnType<typeof useGoal>
    route: ReturnType<typeof useRoute>
    toast: ReturnType<typeof useToast>
    editor: ReturnType<typeof useEditorContext>
    sync: ReturnType<typeof useSync>
    sdk: ReturnType<typeof useSDK>
    keymap: ReturnType<typeof createDefaultOpenTuiKeymap>
    remountPrompt?: () => void
  }
  const app = await testRender(
    () => (
      <Harness
        root={tmp.path}
        fetch={fetch}
        events={events.source}
        state={state}
        sidebar={options.sidebar}
        home={options.home}
        editorSelection={options.editorSelection}
        right={options.right}
        routed={options.routed}
      />
    ),
    { width: options.width ?? 80, height: 24 },
  )
  const destroy = app.renderer.destroy.bind(app.renderer)
  app.renderer.destroy = () => {
    state.promptRef?.reset()
    destroy()
  }
  await app.renderOnce()
  await waitFor(() => !!state.local && !!state.dialog && !!state.goal && !!state.sync && !!state.sdk && !!state.keymap)
  return { ...app, ...state, state, events }
}

function Harness(props: {
  root: string
  fetch: typeof fetch
  events: ReturnType<typeof createEventSource>["source"]
  state: {
    promptRef?: PromptRef
    local?: ReturnType<typeof useLocal>
    dialog?: ReturnType<typeof useDialog>
    goal?: ReturnType<typeof useGoal>
    route?: ReturnType<typeof useRoute>
    toast?: ReturnType<typeof useToast>
    editor?: ReturnType<typeof useEditorContext>
    sync?: ReturnType<typeof useSync>
    sdk?: ReturnType<typeof useSDK>
    keymap?: ReturnType<typeof createDefaultOpenTuiKeymap>
    remountPrompt?: () => void
  }
  sidebar?: boolean
  home?: boolean
  editorSelection?: EditorSelection
  right?: boolean
  routed?: boolean
}) {
  const renderer = useRenderer()
  const config = createTuiResolvedConfig({ plugin_enabled: {} })
  const keymap = createDefaultOpenTuiKeymap(renderer)
  props.state.keymap = keymap
  const pluginRuntime = createPluginRuntime()
  const off = registerOpencodeKeymap(keymap, renderer, config)
  onCleanup(off)

  return (
    <TestTuiContexts
      directory={directory}
      paths={{ cwd: directory, home: props.root, state: path.join(props.root, "state"), worktree: props.root }}
    >
      <ExitProvider exit={() => {}}>
        <ClipboardProvider>
          <OpencodeKeymapProvider keymap={keymap}>
            <ArgsProvider model="test/model">
              <KVProvider>
                <ToastProvider>
                  <RouteProvider
                    initialRoute={props.home ? { type: "home" } : { type: "session", sessionID: "session-test" }}
                  >
                    <TuiConfigProvider config={config}>
                      <PluginRuntimeProvider value={pluginRuntime}>
                        <SDKProvider url="http://test" directory={directory} fetch={props.fetch} events={props.events}>
                          <PermissionProvider>
                            <GoalProvider>
                              <ProjectProvider>
                                <SyncProvider>
                                  <DataProvider>
                                    <ThemeProvider mode="dark">
                                      <LocalProvider>
                                        <PromptStashProvider>
                                          <DialogProvider>
                                            <FrecencyProvider>
                                              <PromptHistoryProvider>
                                                <PromptRefProvider>
                                                  <EditorContextProvider
                                                    integration={
                                                      props.editorSelection
                                                        ? {
                                                            selection: async () => ({
                                                              type: "selection",
                                                              selection: props.editorSelection,
                                                            }),
                                                          }
                                                        : undefined
                                                    }
                                                  >
                                                    <LocationProvider>
                                                      <PromptSyncData state={props.state} />
                                                      <box flexGrow={1} justifyContent="flex-end">
                                                        <Show
                                                          when={props.routed ? true : undefined}
                                                          fallback={
                                                            <Prompt
                                                              sessionID={props.home ? undefined : "session-test"}
                                                              right={props.right ? <text>controls</text> : undefined}
                                                              ref={(ref) => {
                                                                props.state.promptRef = ref
                                                              }}
                                                            />
                                                          }
                                                        >
                                                          <RoutedPrompt state={props.state} />
                                                        </Show>
                                                      </box>
                                                      {props.sidebar && <Sidebar sessionID="session-test" />}
                                                    </LocationProvider>
                                                  </EditorContextProvider>
                                                </PromptRefProvider>
                                              </PromptHistoryProvider>
                                            </FrecencyProvider>
                                          </DialogProvider>
                                        </PromptStashProvider>
                                      </LocalProvider>
                                    </ThemeProvider>
                                  </DataProvider>
                                </SyncProvider>
                              </ProjectProvider>
                            </GoalProvider>
                          </PermissionProvider>
                        </SDKProvider>
                      </PluginRuntimeProvider>
                    </TuiConfigProvider>
                  </RouteProvider>
                </ToastProvider>
              </KVProvider>
            </ArgsProvider>
          </OpencodeKeymapProvider>
        </ClipboardProvider>
      </ExitProvider>
    </TestTuiContexts>
  )
}

function RoutedPrompt(props: {
  state: {
    promptRef?: PromptRef
    remountPrompt?: () => void
  }
}) {
  const route = useRoute()
  const promptRef = usePromptRef()
  const [revision, setRevision] = createSignal(0)
  props.state.remountPrompt = () => setRevision((value) => value + 1)
  const key = () => {
    if (route.data.type === "home") return `home:${revision()}`
    if (route.data.type === "session") return `${route.data.sessionID}:${revision()}`
  }
  return (
    <Show when={key()} keyed>
      {(value) => (
        <Prompt
          sessionID={
            value.startsWith("home:") ? undefined : route.data.type === "session" ? route.data.sessionID : undefined
          }
          ref={(ref) => {
            props.state.promptRef = ref
            promptRef.set(ref)
          }}
        />
      )}
    </Show>
  )
}

function PromptSyncData(props: {
  state: {
    promptRef?: PromptRef
    local?: ReturnType<typeof useLocal>
    dialog?: ReturnType<typeof useDialog>
    goal?: ReturnType<typeof useGoal>
    route?: ReturnType<typeof useRoute>
    toast?: ReturnType<typeof useToast>
    editor?: ReturnType<typeof useEditorContext>
    sync?: ReturnType<typeof useSync>
    sdk?: ReturnType<typeof useSDK>
    keymap?: ReturnType<typeof createDefaultOpenTuiKeymap>
    remountPrompt?: () => void
  }
}) {
  const sync = useSync()
  usePromptRef()
  props.state.local = useLocal()
  props.state.dialog = useDialog()
  props.state.goal = useGoal()
  props.state.route = useRoute()
  props.state.toast = useToast()
  props.state.editor = useEditorContext()
  props.state.sync = sync
  props.state.sdk = useSDK()
  onMount(() => {
    sync.set("session", [
      {
        id: "session-test",
        title: "Goal session",
        slug: "session-test",
        projectID: "project-test",
        directory,
        version: "0.0.0-test",
        time: { created: 0, updated: 0 },
      },
    ])
    sync.set("agent", [{ name: "Build", mode: "primary", hidden: false, permission: [], options: {} }])
    sync.set("command", [
      { name: "effect", description: "Effect skill", source: "skill", template: "$effect", hints: [] },
    ])
    sync.set("provider_default", { test: "model" })
    sync.set("provider", [
      {
        id: "test",
        name: "test",
        source: "custom",
        env: [],
        options: {},
        models: {
          model: {
            id: "model",
            providerID: "test",
            api: { id: "test", url: "http://test", npm: "@test/provider" },
            name: "model",
            capabilities: {
              temperature: false,
              reasoning: false,
              attachment: false,
              toolcall: true,
              input: { text: true, audio: false, image: false, video: false, pdf: false },
              output: { text: true, audio: false, image: false, video: false, pdf: false },
              interleaved: false,
            },
            cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
            limit: { context: 200_000, output: 8_000 },
            status: "active",
            options: {},
            headers: {},
            release_date: "2026-01-01",
          },
        },
      },
    ])
  })
  return undefined
}

async function waitFor(check: () => boolean) {
  for (let i = 0; i < 100; i++) {
    if (check()) return
    await Bun.sleep(10)
  }
  expect(check()).toBe(true)
}

async function captureFrame(setup: Awaited<ReturnType<typeof testRender>>, matches: (frame: string) => boolean) {
  for (let i = 0; i < 200; i++) {
    await setup.renderOnce()
    const frame = setup.captureCharFrame()
    if (matches(frame)) return frame
    await Bun.sleep(10)
  }
  return setup.captureCharFrame()
}
