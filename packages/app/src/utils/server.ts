import { createOpencodeClient } from "@opencode-ai/sdk/v2/client"
import type { ServerConnection } from "@/context/server"
import { decode64 } from "@/utils/base64"

export function authTokenFromCredentials(input: { username?: string; password: string }) {
  return btoa(`${input.username ?? "opencode"}:${input.password}`)
}

export function authFromToken(token: string | null) {
  const decoded = decode64(token ?? undefined)
  if (!decoded) return
  const separator = decoded.indexOf(":")
  if (separator === -1) return
  return {
    username: decoded.slice(0, separator) || "opencode",
    password: decoded.slice(separator + 1),
  }
}

export function createSdkForServer({
  server,
  ...config
}: Omit<NonNullable<Parameters<typeof createOpencodeClient>[0]>, "baseUrl"> & {
  server: ServerConnection.HttpBase
}) {
  const auth = (() => {
    if (!server.password) return
    return {
      Authorization: `Basic ${authTokenFromCredentials({ username: server.username, password: server.password })}`,
    }
  })()
  const headers = {
    ...(config.headers instanceof Headers ? Object.fromEntries(config.headers.entries()) : config.headers),
    ...(config.directory ? { "x-opencode-directory": encodeURIComponent(config.directory) } : {}),
    ...(config.experimental_workspaceID ? { "x-opencode-workspace": config.experimental_workspaceID } : {}),
    ...auth,
  }
  const client = createOpencodeClient({
    ...config,
    headers,
    baseUrl: server.url,
  })
  const request = async <T>(path: string, init: RequestInit) => {
    const url = new URL(path, server.url)
    const requestHeaders = new Headers(headers)
    if (init.body !== undefined) requestHeaders.set("content-type", "application/json")
    const response = await (config.fetch ?? fetch)(url, { ...init, headers: requestHeaders, signal: config.signal })
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`.trim())
    if (response.status === 204) return undefined as T
    return response.json() as Promise<T>
  }

  return Object.assign(client, {
    goal: {
      start: (input: { sessionID: string; goal: string }) =>
        request<{ data: { goal: string; active: boolean; iteration: number; cap: number } }>(
          `/api/session/${encodeURIComponent(input.sessionID)}/goal/start`,
          { method: "POST", body: JSON.stringify({ goal: input.goal }) },
        ).then((response) => response.data),
      stop: (input: { sessionID: string }) =>
        request<void>(`/api/session/${encodeURIComponent(input.sessionID)}/goal/stop`, { method: "POST" }),
    },
  })
}
