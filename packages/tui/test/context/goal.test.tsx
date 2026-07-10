import { expect, test } from "bun:test"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { testRender, useRenderer } from "@opentui/solid"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { onCleanup, onMount } from "solid-js"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"
import { createEventSource, createFetch, directory, json } from "../fixture/tui-sdk"
import { TestTuiContexts } from "../fixture/tui-environment"
import { tmpdir } from "../fixture/fixture"
import { ArgsProvider } from "../../src/context/args"
import { ClipboardProvider } from "../../src/context/clipboard"
import { DataProvider } from "../../src/context/data"
import { EditorContextProvider } from "../../src/context/editor"
import { ExitProvider } from "../../src/context/exit"
import { GoalProvider, useGoal } from "../../src/context/goal"
import { KVProvider } from "../../src/context/kv"
import { LocalProvider, useLocal } from "../../src/context/local"
import { LocationProvider } from "../../src/context/location"
import { PermissionProvider } from "../../src/context/permission"
import { ProjectProvider } from "../../src/context/project"
import { PromptRefProvider, usePromptRef } from "../../src/context/prompt"
import { RouteProvider, useRoute } from "../../src/context/route"
import { SDKProvider } from "../../src/context/sdk"
import { SyncProvider, useSync } from "../../src/context/sync"
import { ThemeProvider } from "../../src/context/theme"
import { TuiConfigProvider } from "../../src/config"
import { FrecencyProvider } from "../../src/component/prompt/frecency"
import { Prompt, type PromptRef } from "../../src/component/prompt"
import { PromptHistoryProvider } from "../../src/component/prompt/history"
import { PromptStashProvider } from "../../src/component/prompt/stash"
import { Sidebar } from "../../src/routes/session/sidebar"
import { createPluginRuntime, PluginRuntimeProvider } from "../../src/plugin/runtime"
import { DialogProvider, useDialog } from "../../src/ui/dialog"
import { ToastProvider } from "../../src/ui/toast"
import { OpencodeKeymapProvider, registerOpencodeKeymap } from "../../src/keymap"

test("/goal asks the agent to create or update the goal todo list", async () => {
  const calls: Array<{ method: string; body?: unknown }> = []
  const app = await mountGoalPrompt(async (url, request) => {
    if (url.pathname === "/api/session/session-test/goal/start") {
      calls.push({ method: "goalStart", body: request ? await request.json() : undefined })
      return json({ data: { goal: "ship task 6", active: true, iteration: 1, cap: 7 } })
    }
    if (url.pathname === "/session/session-test/message") {
      calls.push({ method: "prompt", body: request ? await request.json() : undefined })
      return json({ data: {} })
    }
  })

  try {
    await waitFor(() => !!app.promptRef)
    await waitFor(() => !!app.local.model.current())
    app.promptRef?.set({ input: "/goal", parts: [] })
    await app.promptRef?.submit()
    await waitFor(() => calls.length === 1)

    expect(calls[0]?.method).toBe("goalStart")
    expect(JSON.stringify(calls[0]?.body)).toContain("create or update the goal todo list")
    expect(app.local.permission.mode).toBe("auto")
  } finally {
    app.renderer.destroy()
  }
})

test("/goal with text is sent as a normal prompt", async () => {
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

    expect(calls[0]?.method).toBe("prompt")
    expect(JSON.stringify(calls[0]?.body)).toContain("/goal focus on auth and tests")
    expect(app.local.permission.mode).not.toBe("auto")
  } finally {
    app.renderer.destroy()
  }
})

test("goal start switches to yolo before the server responds", async () => {
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
    await waitFor(() => app.local.permission.mode === "auto")
    await waitFor(() => resolveStart !== undefined)
    resolveStart(json({ data: { goal: "ship task 6", active: true, iteration: 1, cap: 7 } }))
    await start

    expect(app.local.permission.mode).toBe("auto")
  } finally {
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

    expect(app.local.permission.mode).toBe("auto")
    expect(app.goal.current()).toMatchObject({ goal: "second", active: true })
  } finally {
    app.renderer.destroy()
  }
})

test("overlapping same-session start failures restore the original permission mode", async () => {
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
    expect(app.local.permission.mode).toBe("auto")
    expect(app.goal.active("session-b")).toBe(true)
    expect(app.goal.current()).toMatchObject({ goal: "second", active: true })
  } finally {
    app.renderer.destroy()
  }
})

test("overlapping cross-session start failures restore the original permission mode", async () => {
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
    await waitFor(() => app.local.permission.mode === "auto")
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

test("clear stops an atomic toggle after its status response", async () => {
  let resolveStatus!: (response: Response) => void
  let statusCalls = 0
  let starts = 0
  let stops = 0
  const app = await mountGoalPrompt((url) => {
    if (url.pathname === "/api/session/session-test/goal/status") {
      statusCalls++
      if (statusCalls === 1) return json({ data: null })
      return new Promise<Response>((resolve) => {
        resolveStatus = resolve
      })
    }
    if (url.pathname === "/api/session/session-test/goal/start") {
      starts++
      return json({ data: { goal: "unexpected", active: true, iteration: 1, cap: 7 } })
    }
    if (url.pathname === "/api/session/session-test/goal/stop") {
      stops++
      return new Response(null, { status: 204 })
    }
  })

  try {
    await waitFor(() => statusCalls === 1)
    const toggle = app.goal.toggle()
    await waitFor(() => resolveStatus !== undefined)
    app.goal.clear("session-test")
    resolveStatus(json({ data: null }))
    await toggle

    expect(starts).toBe(0)
    expect(stops).toBe(0)
    expect(app.goal.current()).toBeUndefined()
  } finally {
    app.renderer.destroy()
  }
})

test("toggle keeps its captured session when the route changes during status", async () => {
  let resolveStatus!: (response: Response) => void
  let statusCalls = 0
  const starts: string[] = []
  const app = await mountGoalPrompt((url) => {
    if (url.pathname === "/api/session/session-test/goal/status") {
      statusCalls++
      if (statusCalls === 1) return json({ data: null })
      return new Promise<Response>((resolve) => {
        resolveStatus = resolve
      })
    }
    if (url.pathname === "/api/session/session-b/goal/status") return json({ data: null })
    if (url.pathname.endsWith("/goal/start")) {
      starts.push(url.pathname)
      return json({ data: { goal: "ship", active: true, iteration: 1, cap: 7 } })
    }
  })

  try {
    await waitFor(() => statusCalls === 1)
    const toggle = app.goal.toggle()
    await waitFor(() => resolveStatus !== undefined)
    app.route.navigate({ type: "session", sessionID: "session-b" })
    resolveStatus(json({ data: null }))
    await toggle

    expect(starts).toEqual(["/api/session/session-test/goal/start"])
    expect(app.goal.active("session-test")).toBe(true)
    expect(app.goal.active("session-b")).toBe(false)
  } finally {
    app.renderer.destroy()
  }
})

test("overlapping toggles serialize one start followed by one stop", async () => {
  let statusCalls = 0
  let starts = 0
  let stops = 0
  const app = await mountGoalPrompt((url) => {
    if (url.pathname === "/api/session/session-test/goal/status") {
      statusCalls++
      return json({ data: null })
    }
    if (url.pathname === "/api/session/session-test/goal/start") {
      starts++
      return json({ data: { goal: "ship", active: true, iteration: 1, cap: 7 } })
    }
    if (url.pathname === "/api/session/session-test/goal/stop") {
      stops++
      return new Response(null, { status: 204 })
    }
  })

  try {
    await waitFor(() => statusCalls === 1)
    await Promise.all([app.goal.toggle(), app.goal.toggle()])

    expect(starts).toBe(1)
    expect(stops).toBe(1)
    expect(app.goal.current()).toBeUndefined()
  } finally {
    app.renderer.destroy()
  }
})

test("/goal-mode alias toggles goal supervision on", async () => {
  const calls: Array<{ method: string; body?: unknown }> = []
  const app = await mountGoalPrompt(async (url, request) => {
    if (url.pathname === "/api/session/session-test/goal/start") {
      calls.push({ method: "goalStart", body: request ? await request.json() : undefined })
      return json({ data: { goal: "ship task 6", active: true, iteration: 1, cap: 7 } })
    }
  })

  try {
    await waitFor(() => !!app.promptRef)
    await waitFor(() => !!app.local.model.current())
    app.promptRef?.set({ input: "/goal-mode", parts: [] })
    await app.promptRef?.submit()
    await waitFor(() => calls.length === 1)

    expect(calls[0]?.method).toBe("goalStart")
    expect(JSON.stringify(calls[0])).toContain("create or update the goal todo list")
    expect(app.local.permission.mode).toBe("auto")
  } finally {
    app.renderer.destroy()
  }
})

test("/goal renders the goal badge after starting", async () => {
  const app = await mountGoalPrompt(async (url, request) => {
    if (url.pathname === "/api/session/session-test/goal/start") {
      await request?.json()
      return json({ data: { goal: "ship task 6", active: true, iteration: 1, cap: 7 } })
    }
  })

  try {
    await waitFor(() => !!app.promptRef)
    await waitFor(() => !!app.local.model.current())
    app.promptRef?.set({ input: "/goal", parts: [] })
    await app.promptRef?.submit()

    const frame = await captureFrame(app, (frame) => frame.includes("yolo") && frame.includes("goal"))
    expect(frame).toMatch(/yolo\s+goal · 1\/7/)
  } finally {
    app.renderer.destroy()
  }
})

test("/goal stop is sent as a normal prompt", async () => {
  const calls: string[] = []
  const app = await mountGoalPrompt((url) => {
    if (url.pathname === "/api/session/session-test/goal/status") {
      calls.push("status")
      return json({ data: { goal: "ship task 6", active: true, iteration: 3, cap: 7 } })
    }
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
    await app.goal.status()
    const frame = await captureFrame(app, (frame) => frame.includes("goal"))
    expect(frame).toContain("goal · 3/7")
    await waitFor(() => !!app.promptRef)
    await waitFor(() => !!app.local.model.current())
    app.promptRef?.set({ input: "/goal stop", parts: [] })
    await app.promptRef?.submit()
    await waitFor(() => calls.includes("prompt"))

    expect(calls).not.toContain("stop")
  } finally {
    app.renderer.destroy()
  }
})

test("/goal toggles active supervision off", async () => {
  const calls: string[] = []
  let stopped = false
  const app = await mountGoalPrompt((url) => {
    if (url.pathname === "/api/session/session-test/goal/status") {
      if (stopped) return json({ data: null })
      calls.push("status")
      return json({ data: { goal: "ship task 6", active: true, iteration: 3, cap: 7 } })
    }
    if (url.pathname === "/api/session/session-test/goal/stop") {
      calls.push("stop")
      stopped = true
      return new Response(null, { status: 204 })
    }
  })

  try {
    await app.goal.status()
    await waitFor(() => !!app.goal.current())
    await waitFor(() => !!app.promptRef)
    app.promptRef?.set({ input: "/goal", parts: [] })
    await app.promptRef?.submit()
    await waitFor(() => calls.includes("stop"))
    await waitFor(() => app.promptRef?.current.input === "")
  } finally {
    app.renderer.destroy()
  }
})

test("toggle refreshes absent local state before stopping active supervision", async () => {
  const calls: string[] = []
  let statusCalls = 0
  const app = await mountGoalPrompt((url) => {
    if (url.pathname === "/api/session/session-test/goal/status") {
      statusCalls++
      calls.push("status")
      return json({ data: statusCalls === 1 ? null : { goal: "ship task 6", active: true, iteration: 2, cap: 7 } })
    }
    if (url.pathname === "/api/session/session-test/goal/stop") {
      calls.push("stop")
      return new Response(null, { status: 204 })
    }
    if (url.pathname === "/api/session/session-test/goal/start") {
      calls.push("start")
      return json({ data: { goal: "unexpected", active: true, iteration: 1, cap: 7 } })
    }
  })

  try {
    await waitFor(() => statusCalls === 1 && !app.goal.current())
    await app.goal.toggle()

    expect(calls).toEqual(["status", "status", "stop"])
  } finally {
    app.renderer.destroy()
  }
})

test("status polling renders active goal badge with the counter", async () => {
  const app = await mountGoalPrompt((url) => {
    if (url.pathname === "/api/session/session-test/goal/status") {
      return json({ data: { goal: "ship task 6", active: true, iteration: 2, cap: 7 } })
    }
  })

  try {
    app.goal.status()
    const frame = await captureFrame(app, (frame) => frame.includes("goal · 2/7"))
    expect(frame).toContain("goal · 2/7")
  } finally {
    app.renderer.destroy()
  }
})

test("status polling renders active goal in the sidebar", async () => {
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
    const frame = await captureFrame(app, (frame) => frame.includes("Goal") && frame.includes("ship task 6"))
    expect(frame).toContain("Goal")
    expect(frame).toContain("ship task 6")
    expect(frame).toContain("2/7")
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

test("failed goal start does not switch permission mode", async () => {
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
  options: { sidebar?: boolean } = {},
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
  }
  const app = await testRender(
    () => <Harness root={tmp.path} fetch={fetch} events={events.source} state={state} sidebar={options.sidebar} />,
    { width: 80, height: 24 },
  )
  await app.renderOnce()
  await waitFor(() => !!state.local && !!state.dialog && !!state.goal)
  return { ...app, ...state }
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
  }
  sidebar?: boolean
}) {
  const renderer = useRenderer()
  const config = createTuiResolvedConfig({ plugin_enabled: {} })
  const keymap = createDefaultOpenTuiKeymap(renderer)
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
                  <RouteProvider initialRoute={{ type: "session", sessionID: "session-test" }}>
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
                                                  <EditorContextProvider>
                                                    <LocationProvider>
                                                      <PromptSyncData state={props.state} />
                                                      <Prompt
                                                        sessionID="session-test"
                                                        ref={(ref) => {
                                                          props.state.promptRef = ref
                                                        }}
                                                      />
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

function PromptSyncData(props: {
  state: {
    promptRef?: PromptRef
    local?: ReturnType<typeof useLocal>
    dialog?: ReturnType<typeof useDialog>
    goal?: ReturnType<typeof useGoal>
    route?: ReturnType<typeof useRoute>
  }
}) {
  const sync = useSync()
  usePromptRef()
  props.state.local = useLocal()
  props.state.dialog = useDialog()
  props.state.goal = useGoal()
  props.state.route = useRoute()
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
