/** @jsxImportSource @opentui/solid */
import { describe, expect, test } from "bun:test"
import { tmpdir } from "../../../fixture/fixture"
import { json, mount, wait } from "./sync-fixture"
import type { GlobalEvent } from "@opencode-ai/sdk/v2"

const fallback = "Use your best judgment from the goal and current context, then continue."

function questionEvent(
  id: string,
  options?: Array<{ label: string; description: string }>,
  includeCustom = false,
  sessionID = "session",
): GlobalEvent {
  return {
    directory: "/tmp/other",
    project: "proj_test",
    workspace: "ws_auto",
    payload: {
      id: `event-${id}`,
      type: "question.asked",
      properties: {
        id,
        sessionID,
        questions: [
          { question: options ? "Pick one" : "Custom", header: "Question", options: options ?? [] },
          ...(includeCustom ? [{ question: "Custom", header: "Custom", options: [] }] : []),
        ],
      },
    },
  }
}

function permissionEvent(id: string, sessionID = "session"): GlobalEvent {
  return {
    directory: "/tmp/other",
    project: "proj_test",
    workspace: "ws_auto",
    payload: {
      id: `event-${id}`,
      type: "permission.asked",
      properties: {
        id,
        sessionID,
        permission: "edit",
        patterns: ["*"],
        metadata: {},
        always: [],
      },
    },
  }
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

    const { app, emit, requests, sync } = await mount(
      (url) => {
        if (url.pathname === "/question/question-1/reply") return new Response("true")
      },
      tmp.path,
      { auto: true },
    )

    try {
      emit(
        questionEvent("question-1", [
          { label: "A", description: "A" },
          { label: "B", description: "B" },
        ]),
      )

      await wait(() => requests.some((request) => new URL(request.url).pathname === "/question/question-1/reply"))
      const request = requests.find((request) => new URL(request.url).pathname === "/question/question-1/reply")!
      expect(new URL(request.url).searchParams.get("directory")).toBe("/tmp/other")
      expect(new URL(request.url).searchParams.get("workspace")).toBe("ws_auto")
      expect(sync.data.question.session).toBeUndefined()
    } finally {
      app.renderer.destroy()
    }
  })

  test("keeps custom-only questions pending in ordinary yolo mode", async () => {
    await using tmp = await tmpdir()
    await Bun.write(`${tmp.path}/kv.json`, "{}")
    const { app, emit, requests, sync } = await mount(undefined, tmp.path, { auto: true })

    try {
      emit(questionEvent("question-custom"))
      await wait(() => sync.data.question.session?.length === 1)

      expect(requests.some((request) => new URL(request.url).pathname === "/question/question-custom/reply")).toBe(false)
      expect(sync.data.question.session?.[0]?.id).toBe("question-custom")
    } finally {
      app.renderer.destroy()
    }
  })

  test("keeps the whole request pending when any yolo question needs user input", async () => {
    await using tmp = await tmpdir()
    await Bun.write(`${tmp.path}/kv.json`, "{}")
    const { app, emit, requests, sync } = await mount(undefined, tmp.path, { auto: true })

    try {
      emit(questionEvent("question-mixed", [{ label: "A", description: "A" }], true))
      await wait(() => sync.data.question.session?.length === 1)

      expect(sync.data.question.session?.[0]?.questions).toHaveLength(2)
      expect(requests.some((request) => new URL(request.url).pathname === "/question/question-mixed/reply")).toBe(false)
    } finally {
      app.renderer.destroy()
    }
  })

  test("uses the goal fallback for custom-only questions in active goal mode", async () => {
    await using tmp = await tmpdir()
    await Bun.write(`${tmp.path}/kv.json`, "{}")
    const { app, emit, goal, requests, sync } = await mount(
      (url) => {
        if (url.pathname === "/api/session/session/goal/status") return json({ data: null })
        if (url.pathname === "/api/session/session/goal/start") {
          return json({ data: { goal: "ship", active: true, iteration: 1, cap: 7 } })
        }
        if (url.pathname === "/question/question-goal/reply") return new Response("true")
      },
      tmp.path,
      { auto: true, sessionID: "session" },
    )

    try {
      await goal.start("ship")
      emit(questionEvent("question-goal"))
      await wait(() => requests.some((request) => new URL(request.url).pathname === "/question/question-goal/reply"))

      const request = requests.find((request) => new URL(request.url).pathname === "/question/question-goal/reply")!
      expect(await request.json()).toMatchObject({ answers: [[fallback]] })
      expect(sync.data.question.session).toBeUndefined()
    } finally {
      app.renderer.destroy()
    }
  })

  test("does not use another session's active goal fallback", async () => {
    await using tmp = await tmpdir()
    await Bun.write(`${tmp.path}/kv.json`, "{}")
    const { app, emit, goal, requests, route, sync } = await mount(
      (url) => {
        if (url.pathname === "/api/session/session-a/goal/status") return json({ data: null })
        if (url.pathname === "/api/session/session-a/goal/start") {
          return json({ data: { goal: "ship", active: true, iteration: 1, cap: 7 } })
        }
      },
      tmp.path,
      { auto: true, sessionID: "session-a" },
    )

    try {
      await goal.start("ship")
      route.navigate({ type: "session", sessionID: "session-b" })
      emit(questionEvent("question-session-b", undefined, false, "session-b"))
      await wait(() => sync.data.question["session-b"]?.length === 1)

      expect(requests.some((request) => new URL(request.url).pathname === "/question/question-session-b/reply")).toBe(
        false,
      )
      expect(goal.active("session-a")).toBe(true)
      expect(goal.active("session-b")).toBe(false)
    } finally {
      app.renderer.destroy()
    }
  })

  test("restores a question when its automatic reply rejects", async () => {
    await using tmp = await tmpdir()
    await Bun.write(`${tmp.path}/kv.json`, "{}")
    const { app, emit, sync, toast } = await mount(
      (url) => {
        if (url.pathname === "/question/question-failed/reply") throw new Error("reply failed")
        return undefined
      },
      tmp.path,
      { auto: true },
    )

    try {
      emit(questionEvent("question-failed", [{ label: "A", description: "A" }]))
      await wait(() => sync.data.question.session?.length === 1)

      expect(sync.data.question.session?.[0]?.id).toBe("question-failed")
      expect(toast.currentToast?.variant).toBe("warning")
      expect(toast.currentToast?.message).toBe("Automatic reply failed; user input is required.")
    } finally {
      app.renderer.destroy()
    }
  })

  test("restores a permission when its automatic reply rejects", async () => {
    await using tmp = await tmpdir()
    await Bun.write(`${tmp.path}/kv.json`, "{}")
    const { app, emit, sync, toast } = await mount(
      (url) => {
        if (url.pathname === "/permission/permission-failed/reply") throw new Error("reply failed")
        return undefined
      },
      tmp.path,
      { auto: true },
    )

    try {
      emit(permissionEvent("permission-failed"))
      await wait(() => sync.data.permission.session?.length === 1)

      expect(sync.data.permission.session?.[0]?.id).toBe("permission-failed")
      expect(toast.currentToast?.variant).toBe("warning")
      expect(toast.currentToast?.message).toBe("Automatic reply failed; user input is required.")
    } finally {
      app.renderer.destroy()
    }
  })

  test("coalesces overlapping automatic question replies", async () => {
    await using tmp = await tmpdir()
    await Bun.write(`${tmp.path}/kv.json`, "{}")
    let resolveReply!: (response: Response) => void
    const reply = new Promise<Response>((resolve) => {
      resolveReply = resolve
    })
    const { app, emit, requests } = await mount(
      (url) => {
        if (url.pathname === "/question/question-duplicate/reply") return reply
      },
      tmp.path,
      { auto: true },
    )

    try {
      const event = questionEvent("question-duplicate", [{ label: "A", description: "A" }])
      emit(event)
      emit({ ...event, payload: { ...event.payload, id: "event-question-duplicate-2" } })
      await wait(
        () => requests.filter((request) => new URL(request.url).pathname === "/question/question-duplicate/reply").length > 0,
      )
      await Bun.sleep(20)

      expect(
        requests.filter((request) => new URL(request.url).pathname === "/question/question-duplicate/reply"),
      ).toHaveLength(1)
      resolveReply(new Response("true"))
    } finally {
      app.renderer.destroy()
    }
  })

  test("coalesces overlapping automatic permission replies", async () => {
    await using tmp = await tmpdir()
    await Bun.write(`${tmp.path}/kv.json`, "{}")
    let resolveReply!: (response: Response) => void
    const reply = new Promise<Response>((resolve) => {
      resolveReply = resolve
    })
    const { app, emit, requests } = await mount(
      (url) => {
        if (url.pathname === "/permission/permission-duplicate/reply") return reply
      },
      tmp.path,
      { auto: true },
    )

    try {
      const event = permissionEvent("permission-duplicate")
      emit(event)
      emit({ ...event, payload: { ...event.payload, id: "event-permission-duplicate-2" } })
      await wait(
        () =>
          requests.filter((request) => new URL(request.url).pathname === "/permission/permission-duplicate/reply")
            .length > 0,
      )
      await Bun.sleep(20)

      expect(
        requests.filter((request) => new URL(request.url).pathname === "/permission/permission-duplicate/reply"),
      ).toHaveLength(1)
      resolveReply(new Response("true"))
    } finally {
      app.renderer.destroy()
    }
  })

  test("restores one question after overlapping automatic replies fail", async () => {
    await using tmp = await tmpdir()
    await Bun.write(`${tmp.path}/kv.json`, "{}")
    let rejectReply!: (error: Error) => void
    const reply = new Promise<Response>((_, reject) => {
      rejectReply = reject
    })
    const { app, emit, requests, sync } = await mount(
      (url) => {
        if (url.pathname === "/question/question-duplicate-failed/reply") return reply
      },
      tmp.path,
      { auto: true },
    )

    try {
      const event = questionEvent("question-duplicate-failed", [{ label: "A", description: "A" }])
      emit(event)
      emit({ ...event, payload: { ...event.payload, id: "event-question-duplicate-failed-2" } })
      await wait(
        () =>
          requests.filter((request) => new URL(request.url).pathname === "/question/question-duplicate-failed/reply")
            .length > 0,
      )
      rejectReply(new Error("reply failed"))
      await wait(() => sync.data.question.session?.length === 1)

      expect(sync.data.question.session).toHaveLength(1)
      expect(
        requests.filter((request) => new URL(request.url).pathname === "/question/question-duplicate-failed/reply"),
      ).toHaveLength(1)
      emit({ ...event, payload: { ...event.payload, id: "event-question-duplicate-failed-3" } })
      await Bun.sleep(20)
      expect(
        requests.filter((request) => new URL(request.url).pathname === "/question/question-duplicate-failed/reply"),
      ).toHaveLength(1)
      emit({
        ...event,
        payload: {
          id: "event-question-duplicate-failed-replied",
          type: "question.replied",
          properties: { sessionID: "session", requestID: "question-duplicate-failed", answers: [["A"]] },
        },
      })
      await wait(() => sync.data.question.session?.length === 0)
      await Bun.sleep(20)
      expect(sync.data.question.session).toHaveLength(0)
    } finally {
      app.renderer.destroy()
    }
  })

  test("restores one permission after overlapping automatic replies fail", async () => {
    await using tmp = await tmpdir()
    await Bun.write(`${tmp.path}/kv.json`, "{}")
    let rejectReply!: (error: Error) => void
    const reply = new Promise<Response>((_, reject) => {
      rejectReply = reject
    })
    const { app, emit, requests, sync } = await mount(
      (url) => {
        if (url.pathname === "/permission/permission-duplicate-failed/reply") return reply
      },
      tmp.path,
      { auto: true },
    )

    try {
      const event = permissionEvent("permission-duplicate-failed")
      emit(event)
      emit({ ...event, payload: { ...event.payload, id: "event-permission-duplicate-failed-2" } })
      await wait(
        () =>
          requests.filter(
            (request) => new URL(request.url).pathname === "/permission/permission-duplicate-failed/reply",
          ).length > 0,
      )
      rejectReply(new Error("reply failed"))
      await wait(() => sync.data.permission.session?.length === 1)

      expect(sync.data.permission.session).toHaveLength(1)
      expect(
        requests.filter((request) => new URL(request.url).pathname === "/permission/permission-duplicate-failed/reply"),
      ).toHaveLength(1)
      emit({ ...event, payload: { ...event.payload, id: "event-permission-duplicate-failed-3" } })
      await Bun.sleep(20)
      expect(
        requests.filter((request) => new URL(request.url).pathname === "/permission/permission-duplicate-failed/reply"),
      ).toHaveLength(1)
      emit({
        ...event,
        payload: {
          id: "event-permission-duplicate-failed-replied",
          type: "permission.replied",
          properties: { sessionID: "session", requestID: "permission-duplicate-failed", reply: "once" },
        },
      })
      await wait(() => sync.data.permission.session?.length === 0)
      await Bun.sleep(20)
      expect(sync.data.permission.session).toHaveLength(0)
    } finally {
      app.renderer.destroy()
    }
  })

  test("does not restore a question after it resolves before a late automatic reply failure", async () => {
    await using tmp = await tmpdir()
    await Bun.write(`${tmp.path}/kv.json`, "{}")
    let rejectReply!: (error: Error) => void
    const reply = new Promise<Response>((_, reject) => {
      rejectReply = reject
    })
    const { app, emit, sync } = await mount(
      (url) => {
        if (url.pathname === "/question/question-resolved/reply") return reply
      },
      tmp.path,
      { auto: true },
    )

    try {
      const event = questionEvent("question-resolved", [{ label: "A", description: "A" }])
      emit(event)
      await Bun.sleep(20)
      emit({
        ...event,
        payload: {
          id: "event-question-resolved-replied",
          type: "question.replied",
          properties: { sessionID: "session", requestID: "question-resolved", answers: [["A"]] },
        },
      })
      rejectReply(new Error("reply failed late"))
      await Bun.sleep(20)

      expect(sync.data.question.session).toBeUndefined()
    } finally {
      app.renderer.destroy()
    }
  })

  test("does not restore a permission after it resolves before a late automatic reply failure", async () => {
    await using tmp = await tmpdir()
    await Bun.write(`${tmp.path}/kv.json`, "{}")
    let rejectReply!: (error: Error) => void
    const reply = new Promise<Response>((_, reject) => {
      rejectReply = reject
    })
    const { app, emit, sync } = await mount(
      (url) => {
        if (url.pathname === "/permission/permission-resolved/reply") return reply
      },
      tmp.path,
      { auto: true },
    )

    try {
      const event = permissionEvent("permission-resolved")
      emit(event)
      await Bun.sleep(20)
      emit({
        ...event,
        payload: {
          id: "event-permission-resolved-replied",
          type: "permission.replied",
          properties: { sessionID: "session", requestID: "permission-resolved", reply: "once" },
        },
      })
      rejectReply(new Error("reply failed late"))
      await Bun.sleep(20)

      expect(sync.data.permission.session).toBeUndefined()
    } finally {
      app.renderer.destroy()
    }
  })
})
