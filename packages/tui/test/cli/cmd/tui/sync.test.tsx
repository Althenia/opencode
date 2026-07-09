/** @jsxImportSource @opentui/solid */
import { describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { onMount } from "solid-js"
import { tmpdir } from "../../../fixture/fixture"
import { mount, wait } from "./sync-fixture"
import type { GlobalEvent } from "@opencode-ai/sdk/v2"
import { ArgsProvider } from "../../../../src/context/args"
import { ExitProvider } from "../../../../src/context/exit"
import { KVProvider, useKV } from "../../../../src/context/kv"
import { PermissionProvider } from "../../../../src/context/permission"
import { ProjectProvider, useProject } from "../../../../src/context/project"
import { SDKProvider } from "../../../../src/context/sdk"
import { SyncProvider, useSync } from "../../../../src/context/sync"
import { TestTuiContexts } from "../../../fixture/tui-environment"
import { createEventSource, createFetch, directory } from "../../../fixture/tui-sdk"

type Ctx = { kv: ReturnType<typeof useKV>; project: ReturnType<typeof useProject>; sync: ReturnType<typeof useSync> }

async function mountAuto(override?: Parameters<typeof createFetch>[0], state?: string) {
  const events = createEventSource()
  const calls = createFetch(override, events)
  let sync!: ReturnType<typeof useSync>
  let project!: ReturnType<typeof useProject>
  let kv!: ReturnType<typeof useKV>
  let done!: () => void
  const ready = new Promise<void>((resolve) => {
    done = resolve
  })

  function Probe() {
    const ctx: Ctx = { kv: useKV(), project: useProject(), sync: useSync() }
    onMount(() => {
      sync = ctx.sync
      project = ctx.project
      kv = ctx.kv
      done()
    })
    return <box />
  }

  const app = await testRender(() => (
    <TestTuiContexts paths={state ? { state } : undefined}>
      <ArgsProvider auto={true}>
        <KVProvider>
          <SDKProvider url="http://test" directory={directory} fetch={calls.fetch} events={events.source}>
            <PermissionProvider>
              <ProjectProvider>
                <ExitProvider exit={() => {}}>
                  <SyncProvider>
                    <Probe />
                  </SyncProvider>
                </ExitProvider>
              </ProjectProvider>
            </PermissionProvider>
          </SDKProvider>
        </KVProvider>
      </ArgsProvider>
    </TestTuiContexts>
  ))

  await ready
  await wait(() => sync.status === "complete")
  return { app, emit: events.emit, kv, project, sync, session: calls.session }
}

function branchEvent(branch: string, workspace?: string): GlobalEvent {
  return {
    directory: "/tmp/other",
    project: "proj_test",
    workspace,
    payload: {
      id: `evt_vcs_${branch}`,
      type: "vcs.branch.updated",
      properties: { branch },
    },
  }
}

describe("tui sync", () => {
  test("refresh scopes sessions by default and lists project sessions when disabled", async () => {
    await using tmp = await tmpdir()
    await Bun.write(`${tmp.path}/kv.json`, "{}")
    const { app, kv, sync, session } = await mount(undefined, tmp.path)

    try {
      expect(kv.get("session_directory_filter_enabled", true)).toBe(true)
      expect(session.at(-1)?.searchParams.get("roots")).toBeNull()
      expect(session.at(-1)?.searchParams.get("scope")).toBeNull()
      expect(session.at(-1)?.searchParams.get("path")).toBe("packages/tui")

      kv.set("session_directory_filter_enabled", false)
      await sync.session.refresh()

      expect(session.at(-1)?.searchParams.get("scope")).toBe("project")
      expect(session.at(-1)?.searchParams.get("path")).toBeNull()
      expect(session.at(-1)?.searchParams.get("roots")).toBeNull()
    } finally {
      app.renderer.destroy()
    }
  })

  test("vcs branch updates only apply for the active workspace", async () => {
    await using tmp = await tmpdir()
    await Bun.write(`${tmp.path}/kv.json`, "{}")
    const { app, emit, project, sync } = await mount(undefined, tmp.path)

    try {
      expect(sync.data.vcs?.branch).toBe("main")

      project.workspace.set("ws_a")
      emit(branchEvent("other", "ws_b"))
      await Bun.sleep(30)

      expect(sync.data.vcs?.branch).toBe("main")

      emit(branchEvent("feature", "ws_a"))
      await wait(() => sync.data.vcs?.branch === "feature")

      expect(sync.data.vcs?.branch).toBe("feature")
    } finally {
      app.renderer.destroy()
    }
  })

  test("auto answers question requests without storing them", async () => {
    await using tmp = await tmpdir()
    await Bun.write(`${tmp.path}/kv.json`, "{}")

    const requests: URL[] = []
    const { app, emit, sync } = await mountAuto((url) => {
      if (url.pathname === "/question/question-1/reply") {
        requests.push(url)
        return new Response("true")
      }
    }, tmp.path)

    try {
      emit({
        directory: "/tmp/other",
        project: "proj_test",
        workspace: "ws_auto",
        payload: {
          id: "event-1",
          type: "question.asked",
          properties: {
            id: "question-1",
            sessionID: "session",
            questions: [
              {
                question: "Pick one",
                header: "Pick",
                options: [
                  { label: "A", description: "A" },
                  { label: "B", description: "B" },
                ],
              },
            ],
          },
        },
      })

      await wait(() => requests.length === 1)
      expect(requests[0]?.searchParams.get("directory")).toBe("/tmp/other")
      expect(requests[0]?.searchParams.get("workspace")).toBe("ws_auto")
      expect(sync.data.question.session).toBeUndefined()
    } finally {
      app.renderer.destroy()
    }
  })
})
