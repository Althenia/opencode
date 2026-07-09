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
import { RouteProvider } from "../../src/context/route"
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
    app.promptRef?.submit()
    await waitFor(() => calls.length === 1)

    expect(calls[0]?.method).toBe("prompt")
    expect(JSON.stringify(calls[0]?.body)).toContain("create or update the goal todo list")
    expect(app.local.permission.mode).toBe("auto")
  } finally {
    app.renderer.destroy()
  }
})

test("/goal with text passes the text as context for the agent", async () => {
  const calls: unknown[] = []
  const app = await mountGoalPrompt(async (url, request) => {
    if (url.pathname === "/session/session-test/message") {
      calls.push(request ? await request.json() : undefined)
      return json({ data: {} })
    }
  })

  try {
    await waitFor(() => !!app.promptRef)
    await waitFor(() => !!app.local.model.current())
    app.promptRef?.set({ input: "/goal focus on auth and tests", parts: [] })
    app.promptRef?.submit()
    await waitFor(() => calls.length === 1)

    expect(JSON.stringify(calls[0])).toContain("create or update the goal todo list")
    expect(JSON.stringify(calls[0])).toContain("focus on auth and tests")
    expect(app.local.permission.mode).toBe("auto")
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
    resolveStart(json({ data: { goal: "ship task 6", active: true, iteration: 1, cap: 7 } }))
    await start

    expect(app.local.permission.mode).toBe("auto")
  } finally {
    app.renderer.destroy()
  }
})

test("/goal-mode alias asks the agent to create or update goals", async () => {
  const calls: unknown[] = []
  const app = await mountGoalPrompt(async (url, request) => {
    if (url.pathname === "/session/session-test/message") {
      calls.push(request ? await request.json() : undefined)
      return json({ data: {} })
    }
  })

  try {
    await waitFor(() => !!app.promptRef)
    await waitFor(() => !!app.local.model.current())
    app.promptRef?.set({ input: "/goal-mode alias goal", parts: [] })
    await app.promptRef?.submit()
    await waitFor(() => calls.length === 1)

    expect(JSON.stringify(calls[0])).toContain("create or update the goal todo list")
    expect(JSON.stringify(calls[0])).toContain("alias goal")
  } finally {
    app.renderer.destroy()
  }
})

test("/goal with no text does not open a popup", async () => {
  const calls: unknown[] = []
  const app = await mountGoalPrompt(async (url, request) => {
    if (url.pathname === "/api/session/session-test/goal/start") {
      calls.push(request ? await request.json() : undefined)
      return json({ data: { goal: "unexpected", active: true, iteration: 1, cap: 7 } })
    }
    if (url.pathname === "/session/session-test/message") return json({ data: {} })
  })

  try {
    await waitFor(() => !!app.promptRef)
    app.promptRef?.set({ input: "/goal", parts: [] })
    await app.promptRef?.submit()
    await Bun.sleep(50)

    expect(calls).toEqual([])
  } finally {
    app.renderer.destroy()
  }
})

test("/goal stop stops supervision and clears the active badge", async () => {
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
  })

  try {
    await app.goal.status()
    expect(await captureFrame(app, (frame) => frame.includes("goal · 3/7"))).toContain("goal · 3/7")
    await waitFor(() => !!app.promptRef)
    app.promptRef?.set({ input: "/goal stop", parts: [] })
    app.promptRef?.submit()
    await waitFor(() => calls.includes("stop"))

    expect(await captureFrame(app, (frame) => !frame.includes("goal ·"))).not.toContain("goal ·")
  } finally {
    app.renderer.destroy()
  }
})

test("status polling renders goal iteration and returned cap", async () => {
  const app = await mountGoalPrompt((url) => {
    if (url.pathname === "/api/session/session-test/goal/status") {
      return json({ data: { goal: "ship task 6", active: true, iteration: 2, cap: 7 } })
    }
  })

  try {
    app.goal.status()
    expect(await captureFrame(app, (frame) => frame.includes("goal · 2/7"))).toContain("goal · 2/7")
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
  }
}) {
  const sync = useSync()
  usePromptRef()
  props.state.local = useLocal()
  props.state.dialog = useDialog()
  props.state.goal = useGoal()
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
