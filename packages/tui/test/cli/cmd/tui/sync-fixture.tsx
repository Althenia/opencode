/** @jsxImportSource @opentui/solid */
import { testRender } from "@opentui/solid"
import { onMount } from "solid-js"
import { ArgsProvider } from "../../../../src/context/args"
import { KVProvider, useKV } from "../../../../src/context/kv"
import { ProjectProvider, useProject } from "../../../../src/context/project"
import { SDKProvider } from "../../../../src/context/sdk"
import { SyncProvider, useSync } from "../../../../src/context/sync"
import { PermissionProvider } from "../../../../src/context/permission"
import { ExitProvider } from "../../../../src/context/exit"
import { GoalProvider, useGoal } from "../../../../src/context/goal"
import { RouteProvider, useRoute } from "../../../../src/context/route"
import { ToastProvider, useToast } from "../../../../src/ui/toast"
import { createEventSource, createFetch, type FetchHandler, directory } from "../../../fixture/tui-sdk"
import { TestTuiContexts } from "../../../fixture/tui-environment"
export { createEventSource, createFetch, directory, eventSource, json, worktree } from "../../../fixture/tui-sdk"

export async function wait(fn: () => boolean, timeout = 2000) {
  const start = Date.now()
  while (!fn()) {
    if (Date.now() - start > timeout) throw new Error("timed out waiting for condition")
    await Bun.sleep(10)
  }
}

type Ctx = {
  goal: ReturnType<typeof useGoal>
  kv: ReturnType<typeof useKV>
  project: ReturnType<typeof useProject>
  route: ReturnType<typeof useRoute>
  sync: ReturnType<typeof useSync>
  toast: ReturnType<typeof useToast>
}

export async function mount(override?: FetchHandler, state?: string, options?: { auto?: boolean; sessionID?: string }) {
  const calls = createFetch(override)
  const events = createEventSource()
  const requests: Request[] = []
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init)
    requests.push(request.clone())
    return calls.fetch(request)
  }) as typeof globalThis.fetch
  let sync!: ReturnType<typeof useSync>
  let project!: ReturnType<typeof useProject>
  let route!: ReturnType<typeof useRoute>
  let kv!: ReturnType<typeof useKV>
  let goal!: ReturnType<typeof useGoal>
  let toast!: ReturnType<typeof useToast>
  let done!: () => void
  const ready = new Promise<void>((resolve) => {
    done = resolve
  })

  function Probe() {
    const ctx: Ctx = {
      goal: useGoal(),
      kv: useKV(),
      project: useProject(),
      route: useRoute(),
      sync: useSync(),
      toast: useToast(),
    }
    onMount(() => {
      sync = ctx.sync
      project = ctx.project
      route = ctx.route
      kv = ctx.kv
      goal = ctx.goal
      toast = ctx.toast
      done()
    })
    return <box />
  }

  const app = await testRender(() => (
    <TestTuiContexts paths={state ? { state } : undefined}>
      <ArgsProvider auto={options?.auto}>
        <KVProvider>
          <ToastProvider>
            <RouteProvider
              initialRoute={options?.sessionID ? { type: "session", sessionID: options.sessionID } : undefined}
            >
              <SDKProvider url="http://test" directory={directory} fetch={fetch} events={events.source}>
                <PermissionProvider>
                  <GoalProvider>
                    <ProjectProvider>
                      <ExitProvider exit={() => {}}>
                        <SyncProvider>
                          <Probe />
                        </SyncProvider>
                      </ExitProvider>
                    </ProjectProvider>
                  </GoalProvider>
                </PermissionProvider>
              </SDKProvider>
            </RouteProvider>
          </ToastProvider>
        </KVProvider>
      </ArgsProvider>
    </TestTuiContexts>
  ))

  await ready
  await wait(() => sync.status === "complete")
  return { app, emit: events.emit, goal, kv, project, requests, route, sync, session: calls.session, toast }
}
