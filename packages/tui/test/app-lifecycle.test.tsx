import { expect, mock, test } from "bun:test"
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { createTestRenderer } from "@opentui/core/testing"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { testRender, useRenderer } from "@opentui/solid"
import { Effect } from "effect"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { onCleanup, onMount } from "solid-js"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Global } from "@opencode-ai/core/global"
import { createTuiResolvedConfig } from "./fixture/tui-runtime"
import { createEventSource, createFetch, directory, json } from "./fixture/tui-sdk"
import { TestTuiContexts } from "./fixture/tui-environment"
import { tmpdir } from "./fixture/fixture"
import { ArgsProvider } from "../src/context/args"
import { ClipboardProvider } from "../src/context/clipboard"
import { DataProvider } from "../src/context/data"
import { EditorContextProvider } from "../src/context/editor"
import { EpilogueProvider } from "../src/context/epilogue"
import { ExitProvider } from "../src/context/exit"
import { GoalProvider, useGoal } from "../src/context/goal"
import { KVProvider } from "../src/context/kv"
import { LocalProvider } from "../src/context/local"
import { LocationProvider } from "../src/context/location"
import { PermissionProvider } from "../src/context/permission"
import { ProjectProvider } from "../src/context/project"
import { PromptRefProvider } from "../src/context/prompt"
import { RouteProvider } from "../src/context/route"
import { SDKProvider } from "../src/context/sdk"
import { SyncProvider, useSync } from "../src/context/sync"
import { ThemeProvider } from "../src/context/theme"
import { TuiConfigProvider } from "../src/config"
import { FrecencyProvider } from "../src/component/prompt/frecency"
import { Prompt } from "../src/component/prompt"
import { PromptHistoryProvider } from "../src/component/prompt/history"
import { PromptStashProvider } from "../src/component/prompt/stash"
import { createPluginRuntime, PluginRuntimeProvider } from "../src/plugin/runtime"
import { Session } from "../src/routes/session"
import { DialogProvider } from "../src/ui/dialog"
import { ToastProvider } from "../src/ui/toast"
import { OpencodeKeymapProvider, registerOpencodeKeymap } from "../src/keymap"

test("SIGHUP clears title and disposes scoped resources once", async () => {
  const setup = await createTestRenderer({ width: 80, height: 24, useThread: false })
  const core = await import("@opentui/core")
  mock.module("@opentui/core", () => ({ ...core, createCliRenderer: async () => setup.renderer }))
  const titles: string[] = []
  const setTitle = setup.renderer.setTerminalTitle.bind(setup.renderer)
  setup.renderer.setTerminalTitle = (title) => {
    titles.push(title)
    setTitle(title)
  }
  const listeners = new Set(process.listeners("SIGHUP"))
  const events = createEventSource()
  const calls = createFetch()
  let started!: () => void
  const ready = new Promise<void>((resolve) => {
    started = resolve
  })
  let disposes = 0

  try {
    const { run } = await import("../src/app")
    const task = Effect.runPromise(
      run({
        url: "http://test",
        directory,
        config: createTuiResolvedConfig({ plugin_enabled: {} }),
        fetch: calls.fetch,
        events: events.source,
        args: {},
        pluginHost: {
          async start() {
            started()
          },
          async dispose() {
            disposes++
          },
        },
      }).pipe(Effect.provide(AppNodeBuilder.build(Global.node))),
    )
    await ready
    process.emit("SIGHUP")
    await task

    expect(setup.renderer.isDestroyed).toBe(true)
    expect(titles.at(-1)).toBe("")
    expect(disposes).toBe(1)
    expect(process.listeners("SIGHUP").every((listener) => listeners.has(listener))).toBe(true)
  } finally {
    if (!setup.renderer.isDestroyed) setup.renderer.destroy()
    mock.restore()
  }
})

test("app.exit prints the session epilogue after scoped cleanup", async () => {
  const setup = await createTestRenderer({ width: 80, height: 24, useThread: false })
  const core = await import("@opentui/core")
  mock.module("@opentui/core", () => ({ ...core, createCliRenderer: async () => setup.renderer }))
  const events = createEventSource()
  const calls = createFetch((url) => {
    if (url.pathname === "/session")
      return json([
        {
          id: "dummy",
          title: "Demo session",
          slug: "dummy",
          projectID: "project",
          directory,
          version: "0.0.0-test",
          time: { created: 0, updated: 0 },
        },
      ])
  })
  const originalWrite = process.stdout.write.bind(process.stdout)
  let stdout = ""
  let api: TuiPluginApi | undefined
  let started!: () => void
  const ready = new Promise<void>((resolve) => {
    started = resolve
  })

  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout += String(chunk)
    return true
  }) as typeof process.stdout.write

  try {
    const { run } = await import("../src/app")
    const task = Effect.runPromise(
      run({
        url: "http://test",
        directory,
        config: createTuiResolvedConfig({ plugin_enabled: {} }),
        fetch: calls.fetch,
        events: events.source,
        args: { continue: true },
        pluginHost: {
          async start(input) {
            api = input.api
            started()
          },
          async dispose() {},
        },
      }).pipe(Effect.provide(AppNodeBuilder.build(Global.node))),
    )

    await ready
    await setup.renderOnce()
    await setup.renderOnce()
    api?.keymap.dispatchCommand("app.exit")
    await task

    expect(stdout).toContain("Demo session")
    expect(stdout).toContain("opencode -s dummy")
  } finally {
    process.stdout.write = originalWrite
    if (!setup.renderer.isDestroyed) setup.renderer.destroy()
    mock.restore()
  }
})

test("command palette renders yolo mode", async () => {
  const setup = await createTestRenderer({ width: 100, height: 100, useThread: false })
  const core = await import("@opentui/core")
  mock.module("@opentui/core", () => ({ ...core, createCliRenderer: async () => setup.renderer }))
  const events = createEventSource()
  const calls = createFetch(undefined, events)
  let api: TuiPluginApi | undefined
  let started!: () => void
  const ready = new Promise<void>((resolve) => {
    started = resolve
  })

  try {
    const { run } = await import("../src/app")
    const task = Effect.runPromise(
      run({
        url: "http://test",
        directory,
        config: createTuiResolvedConfig({ plugin_enabled: {} }),
        fetch: calls.fetch,
        events: events.source,
        args: {},
        pluginHost: {
          async start(input) {
            api = input.api
            started()
          },
          async dispose() {},
        },
      }).pipe(Effect.provide(AppNodeBuilder.build(Global.node))),
    )

    await ready
    api?.keymap.dispatchCommand("command.palette.show")
    expect(await captureFrame(setup, (frame) => frame.includes("Enable yolo mode"))).toContain("Enable yolo mode")
    api?.keymap.dispatchCommand("app.exit")
    await task
  } finally {
    if (!setup.renderer.isDestroyed) setup.renderer.destroy()
    mock.restore()
  }
})

test("disabling yolo mode does not stop active goal supervision", async () => {
  const setup = await createTestRenderer({ width: 100, height: 100, useThread: false })
  const core = await import("@opentui/core")
  mock.module("@opentui/core", () => ({ ...core, createCliRenderer: async () => setup.renderer }))
  const events = createEventSource()
  let stopped = false
  const calls = createFetch((url) => {
    if (url.pathname === "/api/session/dummy/goal/stop") {
      stopped = true
      return new Response(null, { status: 204 })
    }
  }, events)
  let api: TuiPluginApi | undefined
  let started!: () => void
  const ready = new Promise<void>((resolve) => {
    started = resolve
  })

  try {
    const { run } = await import("../src/app")
    const task = Effect.runPromise(
      run({
        url: "http://test",
        directory,
        config: createTuiResolvedConfig({ plugin_enabled: {} }),
        fetch: calls.fetch,
        events: events.source,
        args: { auto: true, continue: true },
        pluginHost: {
          async start(input) {
            api = input.api
            started()
          },
          async dispose() {},
        },
      }).pipe(Effect.provide(AppNodeBuilder.build(Global.node))),
    )

    await ready
    api?.keymap.dispatchCommand("permission.mode")
    await Bun.sleep(50)
    api?.keymap.dispatchCommand("app.exit")
    await task

    expect(stopped).toBe(false)
  } finally {
    if (!setup.renderer.isDestroyed) setup.renderer.destroy()
    mock.restore()
  }
})

test("goal palette command selects goal mode without starting supervision", async () => {
  const setup = await createTestRenderer({ width: 100, height: 100, useThread: false })
  const core = await import("@opentui/core")
  mock.module("@opentui/core", () => ({ ...core, createCliRenderer: async () => setup.renderer }))
  const events = createEventSource()
  let startedGoal = false
  let prompted = false
  const calls = createFetch((url) => {
    if (url.pathname === "/session/dummy") {
      return json({
        id: "dummy",
        title: "Demo session",
        slug: "dummy",
        projectID: "project",
        directory,
        version: "0.0.0-test",
        time: { created: 0, updated: 0 },
      })
    }
    if (url.pathname === "/api/session/dummy/goal/status") {
      return json({ data: null })
    }
    if (url.pathname === "/api/session/dummy/goal/start") {
      startedGoal = true
      return json({ data: { goal: "ship task 6", active: true, iteration: 1, cap: 7 } })
    }
    if (url.pathname === "/session/dummy/message" && url.searchParams.has("limit")) {
      return json({ data: [] })
    }
    if (url.pathname === "/session/dummy/message") {
      prompted = true
      return json({ data: {} })
    }
  }, events)
  let api: TuiPluginApi | undefined
  let started!: () => void
  const ready = new Promise<void>((resolve) => {
    started = resolve
  })

  try {
    const { run } = await import("../src/app")
    const task = Effect.runPromise(
      run({
        url: "http://test",
        directory,
        config: createTuiResolvedConfig({ plugin_enabled: {} }),
        fetch: calls.fetch,
        events: events.source,
        args: { auto: true, continue: true },
        pluginHost: {
          async start(input) {
            api = input.api
            started()
          },
          async dispose() {},
        },
      }).pipe(Effect.provide(AppNodeBuilder.build(Global.node))),
    )

    await ready
    api?.keymap.dispatchCommand("goal.stop")
    await Bun.sleep(50)
    expect(prompted).toBe(false)
    api?.keymap.dispatchCommand("app.exit")
    await task

    expect(startedGoal).toBe(false)
  } finally {
    if (!setup.renderer.isDestroyed) setup.renderer.destroy()
    mock.restore()
  }
})

test("goal palette stop command does not create a session on the home route", async () => {
  const setup = await createTestRenderer({ width: 100, height: 100, useThread: false })
  const core = await import("@opentui/core")
  mock.module("@opentui/core", () => ({ ...core, createCliRenderer: async () => setup.renderer }))
  const events = createEventSource()
  const mutations: string[] = []
  const calls = createFetch((url) => {
    if (url.pathname.endsWith("/goal/start") || url.pathname.endsWith("/goal/stop")) mutations.push(url.pathname)
    return undefined
  }, events)
  let api: TuiPluginApi | undefined
  let started!: () => void
  const ready = new Promise<void>((resolve) => {
    started = resolve
  })

  try {
    const { run } = await import("../src/app")
    const task = Effect.runPromise(
      run({
        url: "http://test",
        directory,
        config: createTuiResolvedConfig({ plugin_enabled: {} }),
        fetch: calls.fetch,
        events: events.source,
        args: {},
        pluginHost: {
          async start(input) {
            api = input.api
            started()
          },
          async dispose() {},
        },
      }).pipe(Effect.provide(AppNodeBuilder.build(Global.node))),
    )

    await ready
    api?.keymap.dispatchCommand("goal.stop")
    await Bun.sleep(0)
    api?.keymap.dispatchCommand("command.palette.show")
    expect(setup.captureCharFrame()).not.toContain("Stop goal mode")
    expect(mutations).toEqual([])
    api?.keymap.dispatchCommand("app.exit")
    await task
  } finally {
    if (!setup.renderer.isDestroyed) setup.renderer.destroy()
    mock.restore()
  }
})

test("goal palette command stops active supervision", async () => {
  const setup = await createTestRenderer({ width: 100, height: 100, useThread: false })
  const core = await import("@opentui/core")
  mock.module("@opentui/core", () => ({ ...core, createCliRenderer: async () => setup.renderer }))
  const events = createEventSource()
  let stopped = false
  const calls = createFetch((url) => {
    if (url.pathname === "/api/session/dummy/goal/status") {
      return json({ data: stopped ? null : { goal: "ship task 6", active: true, iteration: 2, cap: 7 } })
    }
    if (url.pathname === "/api/session/dummy/goal/stop") {
      stopped = true
      return new Response(null, { status: 204 })
    }
  }, events)
  let api: TuiPluginApi | undefined
  let started!: () => void
  const ready = new Promise<void>((resolve) => {
    started = resolve
  })

  try {
    const { run } = await import("../src/app")
    const task = Effect.runPromise(
      run({
        url: "http://test",
        directory,
        config: createTuiResolvedConfig({ plugin_enabled: {} }),
        fetch: calls.fetch,
        events: events.source,
        args: { auto: true, continue: true },
        pluginHost: {
          async start(input) {
            api = input.api
            started()
          },
          async dispose() {},
        },
      }).pipe(Effect.provide(AppNodeBuilder.build(Global.node))),
    )

    await ready
    api?.keymap.dispatchCommand("goal.stop")
    await waitFor(() => stopped)
    api?.keymap.dispatchCommand("app.exit")
    await task

    expect(stopped).toBe(true)
  } finally {
    if (!setup.renderer.isDestroyed) setup.renderer.destroy()
    mock.restore()
  }
})

test("exhausted goal shows Continue, Revise, and Stop even in yolo mode", async () => {
  const setup = await createTestRenderer({ width: 100, height: 100, useThread: false })
  const core = await import("@opentui/core")
  mock.module("@opentui/core", () => ({ ...core, createCliRenderer: async () => setup.renderer }))
  const events = createEventSource()
  const provider = { id: "test", name: "test", source: "custom", env: [], options: {}, models: {} }
  const goalMutations: string[] = []
  const calls = createFetch((url) => {
    if (url.pathname === "/config/providers") return json({ providers: [provider], default: {} })
    if (url.pathname === "/provider") return json({ all: [provider], default: {}, connected: ["test"] })
    if (url.pathname === "/session/dummy") {
      return json({
        id: "dummy",
        title: "Demo session",
        slug: "dummy",
        projectID: "project",
        directory,
        version: "0.0.0-test",
        time: { created: 0, updated: 0 },
      })
    }
    if (url.pathname === "/session/other") {
      return json({
        id: "other",
        title: "Other session",
        slug: "other",
        projectID: "project",
        directory,
        version: "0.0.0-test",
        time: { created: 0, updated: 0 },
      })
    }
    if (url.pathname === "/api/session/dummy/goal/status") {
      return json({ data: { goal: "ship task 6", active: false, iteration: 7, cap: 7 } })
    }
    if (url.pathname === "/api/session/other/goal/status") return json({ data: null })
    if (url.pathname.endsWith("/goal/start") || url.pathname.endsWith("/goal/stop")) {
      goalMutations.push(url.pathname)
      return url.pathname.endsWith("/goal/stop")
        ? new Response(null, { status: 204 })
        : json({ data: { goal: "unexpected", active: true, iteration: 1, cap: 7 } })
    }
    if (url.pathname === "/session/other/message") return json({ data: [] })
    if (url.pathname === "/session/other/todo" || url.pathname === "/session/other/diff") return json({ data: [] })
  }, events)
  let api: TuiPluginApi | undefined
  let started!: () => void
  const ready = new Promise<void>((resolve) => {
    started = resolve
  })

  try {
    const { run } = await import("../src/app")
    const task = Effect.runPromise(
      run({
        url: "http://test",
        directory,
        config: createTuiResolvedConfig({ plugin_enabled: {} }),
        fetch: calls.fetch,
        events: events.source,
        args: { auto: true, continue: true },
        pluginHost: {
          async start(input) {
            api = input.api
            started()
          },
          async dispose() {},
        },
      }).pipe(Effect.provide(AppNodeBuilder.build(Global.node))),
    )

    await ready
    const frame = await captureFrame(setup, (value) => value.includes("Goal iteration limit reached"))
    expect(frame).toContain("Continue")
    expect(frame).toContain("Revise")
    expect(frame).toContain("Stop")
    expect(frame).toContain("Goal iteration limit reached")
    api?.route.navigate("session", { sessionID: "other" })
    const switched = await captureFrame(setup, (value) => !value.includes("Goal iteration limit reached"))
    expect(switched).not.toContain("Goal iteration limit reached")
    expect(goalMutations).toEqual([])
    api?.keymap.dispatchCommand("app.exit")
    await task
  } finally {
    if (!setup.renderer.isDestroyed) setup.renderer.destroy()
    mock.restore()
  }
})

test("an active final goal attempt does not show the exhaustion dialog", async () => {
  const setup = await createTestRenderer({ width: 100, height: 100, useThread: false })
  const core = await import("@opentui/core")
  mock.module("@opentui/core", () => ({ ...core, createCliRenderer: async () => setup.renderer }))
  const events = createEventSource()
  const provider = { id: "test", name: "test", source: "custom", env: [], options: {}, models: {} }
  const calls = createFetch((url) => {
    if (url.pathname === "/config/providers") return json({ providers: [provider], default: {} })
    if (url.pathname === "/provider") return json({ all: [provider], default: {}, connected: ["test"] })
    if (url.pathname === "/session/dummy") {
      return json({
        id: "dummy",
        title: "Demo session",
        slug: "dummy",
        projectID: "project",
        directory,
        version: "0.0.0-test",
        time: { created: 0, updated: 0 },
      })
    }
    if (url.pathname === "/api/session/dummy/goal/status") {
      return json({ data: { goal: "ship task 6", active: true, iteration: 7, cap: 7 } })
    }
  }, events)
  let api: TuiPluginApi | undefined
  let started!: () => void
  const ready = new Promise<void>((resolve) => {
    started = resolve
  })

  try {
    const { run } = await import("../src/app")
    const task = Effect.runPromise(
      run({
        url: "http://test",
        directory,
        config: createTuiResolvedConfig({ plugin_enabled: {} }),
        fetch: calls.fetch,
        events: events.source,
        args: { auto: true, continue: true },
        pluginHost: {
          async start(input) {
            api = input.api
            started()
          },
          async dispose() {},
        },
      }).pipe(Effect.provide(AppNodeBuilder.build(Global.node))),
    )

    await ready
    const frame = await captureFrame(setup, (value) => value.includes("goal"))
    expect(frame).not.toContain("Goal iteration limit reached")
    expect(frame).not.toContain("Continue")
    expect(frame).not.toContain("Revise")
    expect(frame).not.toContain("Stop")
    api?.keymap.dispatchCommand("app.exit")
    await task
  } finally {
    if (!setup.renderer.isDestroyed) setup.renderer.destroy()
    mock.restore()
  }
})

test("session timeline keeps the active Goal below its first message", async () => {
  await using tmp = await tmpdir()
  await mkdir(path.join(tmp.path, "state"), { recursive: true })
  await Bun.write(path.join(tmp.path, "state", "kv.json"), "{}")
  const goalText = "finished the self-improvement features. auto approve dont ask until all verification is complete"
  const events = createEventSource()
  const calls = createFetch((url) => {
    const session = {
      id: "session-test",
      title: "Goal session",
      slug: "session-test",
      projectID: "project-test",
      directory,
      version: "0.0.0-test",
      time: { created: 0, updated: 0 },
    }
    if (url.pathname === "/session") return json([session])
    if (url.pathname === "/session/session-test") return json(session)
    if (url.pathname === "/session/session-test/message")
      return json([
        {
          info: {
            id: "message-test",
            sessionID: "session-test",
            role: "user",
            time: { created: 0 },
            agent: "Build",
            model: { providerID: "test", modelID: "model", variant: "ultra" },
          },
          parts: [
            {
              id: "part-test",
              sessionID: "session-test",
              messageID: "message-test",
              type: "text",
              text: "First timeline message",
            },
          ],
        },
        {
          info: {
            id: "message-assistant",
            sessionID: "session-test",
            role: "assistant",
            agent: "explore",
            modelID: "model",
            providerID: "test",
            mode: "explore",
            parentID: "message-test",
            path: { cwd: directory, root: directory },
            cost: 0,
            tokens: { input: 0, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
            time: { created: 1, completed: 2 },
          },
          parts: [
            {
              id: "part-assistant",
              sessionID: "session-test",
              messageID: "message-assistant",
              type: "text",
              text: "Done",
            },
          ],
        },
      ])
    if (url.pathname === "/session/session-test/todo" || url.pathname === "/session/session-test/diff") return json([])
    if (url.pathname === "/api/session/session-test/goal/status") {
      return json({ data: { goal: goalText, active: true, iteration: 2, cap: 7 } })
    }
  }, events)
  const app = await testRender(
    () => <PromptHarness root={tmp.path} fetch={calls.fetch} events={events.source} session />,
    { width: 80, height: 24 },
  )

  try {
    const frame = await captureFrame(app, (value) => value.includes("Current target"))
    const rows = frame.split("\n")
    const goalRow = rows.findIndex((row) => row.includes("Goal ·"))
    const messageRow = rows.findIndex((row) => row.includes("First timeline message"))
    expect(goalRow).toBeGreaterThanOrEqual(0)
    expect(messageRow).toBeGreaterThanOrEqual(0)
    expect(goalRow).toBeGreaterThan(messageRow)
    expect(frame).toContain("Current target")
    expect(frame).toContain("0%")
    expect(frame).toContain("Explore · model · ultra")
  } finally {
    app.renderer.destroy()
  }
})

function PromptHarness(props: {
  root: string
  fetch: typeof fetch
  events: ReturnType<typeof createEventSource>["source"]
  session?: boolean
}) {
  const renderer = useRenderer()
  const config = createTuiResolvedConfig({ plugin_enabled: {} })
  const keymap = createDefaultOpenTuiKeymap(renderer)
  const pluginRuntime = createPluginRuntime()
  pluginRuntime.Slot = (props) => props.children
  const off = registerOpencodeKeymap(keymap, renderer, config)
  onCleanup(off)

  return (
    <TestTuiContexts
      directory={directory}
      paths={{
        cwd: directory,
        home: props.root,
        state: path.join(props.root, "state"),
        worktree: props.root,
      }}
    >
      <ExitProvider exit={() => {}}>
        <ClipboardProvider>
          <OpencodeKeymapProvider keymap={keymap}>
            <ArgsProvider auto={true}>
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
                                        <PromptSyncData session={props.session} />
                                        <PromptStashProvider>
                                          <DialogProvider>
                                            <FrecencyProvider>
                                              <PromptHistoryProvider>
                                                <PromptRefProvider>
                                                  <EditorContextProvider>
                                                    <EpilogueProvider set={() => {}}>
                                                      <LocationProvider>
                                                        {props.session ? <Session /> : <Prompt sessionID="session-test" />}
                                                      </LocationProvider>
                                                    </EpilogueProvider>
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

function PromptSyncData(props: { session?: boolean }) {
  const sync = useSync()
  const goal = useGoal()
  onMount(() => {
    sync.set("agent", [{ name: "Build", mode: "primary", hidden: false, permission: [], options: {} }])
    if (!props.session) return
    goal.adoptHome("session-test", goal.prepareHome("ship task 6"))
    void goal.status()
  })
  return undefined
}

async function captureFrame(setup: Awaited<ReturnType<typeof createTestRenderer>>, matches: (frame: string) => boolean) {
  for (let i = 0; i < 200; i++) {
    await setup.renderOnce()
    const frame = setup.captureCharFrame()
    if (matches(frame)) return frame
    await Bun.sleep(10)
  }
  return setup.captureCharFrame()
}

async function waitFor(check: () => boolean) {
  for (let i = 0; i < 100; i++) {
    if (check()) return
    await Bun.sleep(10)
  }
  expect(check()).toBe(true)
}
