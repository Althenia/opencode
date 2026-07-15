import { describe, expect, test } from "bun:test"
import { authFromToken, authTokenFromCredentials, createSdkForServer } from "./server"

describe("authFromToken", () => {
  test("decodes basic auth credentials from auth_token", () => {
    expect(authFromToken(btoa("kit:secret"))).toEqual({ username: "kit", password: "secret" })
  })

  test("defaults blank username to opencode", () => {
    expect(authFromToken(btoa(":secret"))).toEqual({ username: "opencode", password: "secret" })
  })

  test("ignores malformed tokens", () => {
    expect(authFromToken("not base64")).toBeUndefined()
    expect(authFromToken(btoa("missing-separator"))).toBeUndefined()
  })
})

describe("authTokenFromCredentials", () => {
  test("encodes credentials with the default username", () => {
    expect(authTokenFromCredentials({ password: "secret" })).toBe(btoa("opencode:secret"))
  })
})

describe("createSdkForServer", () => {
  test("preserves auth and location headers for Goal requests", async () => {
    let request: Request | undefined
    const fetcher = Object.assign(
      async (...args: Parameters<typeof fetch>) => {
        request = new Request(...args)
        return Response.json({ data: { goal: "ship", active: true, iteration: 1, cap: 25 } })
      },
      { preconnect: fetch.preconnect },
    )
    const client = createSdkForServer({
      server: { url: "http://localhost:4096", username: "kit", password: "secret" },
      directory: "/repo",
      experimental_workspaceID: "workspace-1",
      fetch: fetcher,
    })

    await client.goal.start({ sessionID: "session-1", goal: "ship" })

    expect(request?.headers.get("authorization")).toBe(`Basic ${btoa("kit:secret")}`)
    expect(request?.headers.get("x-opencode-directory")).toBe(encodeURIComponent("/repo"))
    expect(request?.headers.get("x-opencode-workspace")).toBe("workspace-1")
  })
})
