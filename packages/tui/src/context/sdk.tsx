import { createOpencodeClient } from "@opencode-ai/sdk/v2"
import type { GlobalEvent } from "@opencode-ai/sdk/v2"
import { Flag } from "@opencode-ai/core/flag/flag"
import { createSimpleContext } from "./helper"
import { batch, onCleanup, onMount } from "solid-js"

export type EventSource = {
  subscribe: (handler: (event: GlobalEvent) => void) => Promise<() => void>
}

type Client = ReturnType<typeof createOpencodeClient>
type GoalStatus = {
  readonly goal: string
  readonly active: boolean
  readonly iteration: number
  readonly cap: number
  readonly phase: "starting" | "running" | "stalled"
}
type ClientWithSessions = Client & {
  sessions: {
    goalStart(input: GoalStartInput): Promise<GoalStatus>
    goalResume(input: GoalSessionInput): Promise<GoalStatus | null>
    goalStop(input: GoalSessionInput): Promise<void>
    goalStatus(input: GoalSessionInput): Promise<GoalStatus | null>
  }
}

type GoalSessionInput = { readonly sessionID: string }
type GoalStartInput = GoalSessionInput & {
  readonly goal: string
  readonly messageID?: string
  readonly files?: Array<{ uri: string; name?: string; source?: { start: number; end: number; text: string } }>
}

export const { use: useSDK, provider: SDKProvider } = createSimpleContext({
  name: "SDK",
  init: (props: {
    url: string
    directory?: string
    fetch?: typeof fetch
    headers?: RequestInit["headers"]
    events?: EventSource
  }) => {
    const abort = new AbortController()
    let sse: AbortController | undefined

    function createSDK(): ClientWithSessions {
      const headers = new Headers(props.headers)
      if (props.directory) headers.set("x-opencode-directory", encodeURIComponent(props.directory))
      const fetcher = props.fetch ?? fetch
      async function request<T>(path: string, init?: RequestInit) {
        if (init?.body !== undefined && !headers.has("content-type")) headers.set("content-type", "application/json")
        const response = await fetcher(new Request(new URL(path, props.url), { ...init, headers }))
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`.trim())
        if (response.status === 204) return undefined as T
        return response.json() as Promise<T>
      }
      const client = createOpencodeClient({
        baseUrl: props.url,
        signal: abort.signal,
        directory: props.directory,
        fetch: props.fetch,
        headers: props.headers,
      })
      return Object.assign(client, {
        sessions: {
          goalStart: (input: GoalStartInput) =>
            request<{ readonly data: GoalStatus }>(`/api/session/${encodeURIComponent(input.sessionID)}/goal/start`, {
              method: "POST",
              body: JSON.stringify({ goal: input.goal, messageID: input.messageID, files: input.files }),
            }).then((response) => response.data),
          goalStop: (input: GoalSessionInput) =>
            request<void>(`/api/session/${encodeURIComponent(input.sessionID)}/goal/stop`, { method: "POST" }),
          goalStatus: (input: GoalSessionInput) =>
            request<{ readonly data: GoalStatus | null }>(
              `/api/session/${encodeURIComponent(input.sessionID)}/goal/status`,
            ).then((response) => response.data),
          goalResume: (input: GoalSessionInput) =>
            request<{ readonly data: GoalStatus | null }>(
              `/api/session/${encodeURIComponent(input.sessionID)}/goal/resume`,
              { method: "POST" },
            ).then((response) => response.data),
        },
      })
    }

    let sdk = createSDK()

    const handlers = new Set<(event: GlobalEvent) => void>()
    const emitter = {
      emit(_type: "event", event: GlobalEvent) {
        for (const handler of handlers) handler(event)
      },
      on(_type: "event", handler: (event: GlobalEvent) => void) {
        handlers.add(handler)
        return () => {
          handlers.delete(handler)
        }
      },
    }

    let queue: GlobalEvent[] = []
    let timer: Timer | undefined
    let last = 0
    const retryDelay = 1000
    const maxRetryDelay = 30000

    const flush = () => {
      if (queue.length === 0) return
      const events = queue
      queue = []
      timer = undefined
      last = Date.now()
      // Batch all event emissions so all store updates result in a single render
      batch(() => {
        for (const event of events) {
          emitter.emit("event", event)
        }
      })
    }

    const handleEvent = (event: GlobalEvent) => {
      queue.push(event)
      const elapsed = Date.now() - last

      if (timer) return
      // If we just flushed recently (within 16ms), batch this with future events
      // Otherwise, process immediately to avoid latency
      if (elapsed < 16) {
        timer = setTimeout(flush, 16)
        return
      }
      flush()
    }

    function startSSE() {
      sse?.abort()
      const ctrl = new AbortController()
      sse = ctrl
      ;(async () => {
        let attempt = 0
        while (true) {
          if (abort.signal.aborted || ctrl.signal.aborted) break

          const events = await sdk.global.event({
            signal: ctrl.signal,
            sseMaxRetryAttempts: 0,
          })

          if (Flag.OPENCODE_EXPERIMENTAL_WORKSPACES) {
            // Start syncing workspaces, it's important to do this after
            // we've started listening to events
            await sdk.sync.start().catch(() => {})
          }

          for await (const event of events.stream) {
            if (ctrl.signal.aborted) break
            handleEvent(event)
          }

          if (timer) clearTimeout(timer)
          if (queue.length > 0) flush()
          attempt += 1
          if (abort.signal.aborted || ctrl.signal.aborted) break

          // Exponential backoff
          const backoff = Math.min(retryDelay * 2 ** (attempt - 1), maxRetryDelay)
          await new Promise((resolve) => setTimeout(resolve, backoff))
        }
      })().catch(() => {})
    }

    onMount(async () => {
      if (props.events) {
        const unsub = await props.events.subscribe(handleEvent)
        onCleanup(unsub)

        if (Flag.OPENCODE_EXPERIMENTAL_WORKSPACES) {
          // Start syncing workspaces, it's important to do this after
          // we've started listening to events
          await sdk.sync.start().catch(() => {})
        }
      } else {
        startSSE()
      }
    })

    onCleanup(() => {
      abort.abort()
      sse?.abort()
      if (timer) clearTimeout(timer)
      handlers.clear()
    })

    return {
      get client() {
        return sdk
      },
      directory: props.directory,
      event: emitter,
      fetch: props.fetch ?? fetch,
      url: props.url,
    }
  },
})
