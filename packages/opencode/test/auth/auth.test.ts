import { describe, expect, test } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Credential } from "@opencode-ai/core/credential"
import { Global } from "@opencode-ai/core/global"
import { Integration } from "@opencode-ai/core/integration"
import { Effect } from "effect"
import path from "path"
import { Auth } from "../../src/auth"
import { testEffect } from "../lib/effect"

const layer = LayerNode.compile(LayerNode.group([Auth.node, Credential.node]))
const credentialLayer = LayerNode.compile(Credential.node)
const it = testEffect(layer)
const authFile = path.join(Global.Path.data, "auth.json")

async function withAuthState(run: (file: string) => Promise<void>) {
  const previousEnv = process.env.OPENCODE_AUTH_CONTENT
  const existed = await Bun.file(authFile).exists()
  const previousFile = existed ? await Bun.file(authFile).text() : undefined
  const previousCredentialIDs = new Set(
    await Effect.gen(function* () {
      const credentials = yield* Credential.Service
      return (yield* credentials.list(Integration.ID.make("openai"))).map((item) => item.id)
    }).pipe(Effect.provide(credentialLayer), Effect.scoped, Effect.runPromise),
  )

  try {
    await run(authFile)
  } finally {
    if (previousEnv === undefined) delete process.env.OPENCODE_AUTH_CONTENT
    else process.env.OPENCODE_AUTH_CONTENT = previousEnv
    try {
      if (previousFile === undefined) await Bun.file(authFile).delete()
      else await Bun.write(authFile, previousFile)
    } finally {
      await Effect.gen(function* () {
        const credentials = yield* Credential.Service
        yield* Effect.forEach(
          (yield* credentials.list(Integration.ID.make("openai"))).filter(
            (item) => !previousCredentialIDs.has(item.id),
          ),
          (item) => credentials.remove(item.id),
        )
      }).pipe(Effect.provide(credentialLayer), Effect.scoped, Effect.runPromise)
    }
  }
}

describe("Auth", () => {
  test("imports OpenAI OAuth from auth.json without persisting environment auth", () =>
    withAuthState(async (authFile) => {
      await Bun.write(
        authFile,
        JSON.stringify({
          openai: {
            type: "oauth",
            refresh: "file-refresh-token",
            access: "file-access-token",
            expires: 2_000_000_000_000,
            accountId: "file-account-id",
          },
        }),
      )
      process.env.OPENCODE_AUTH_CONTENT = JSON.stringify({
        openai: {
          type: "oauth",
          refresh: "environment-refresh-token",
          access: "environment-access-token",
          expires: 2_000_000_000_000,
          accountId: "environment-account-id",
        },
      })

      const result = await Effect.gen(function* () {
        const credentials = yield* Credential.Service
        return yield* credentials.list(Integration.ID.make("openai"))
      }).pipe(Effect.provide(layer), Effect.scoped, Effect.runPromise)

      expect(result).toMatchObject([
        {
          integrationID: "openai",
          value: {
            type: "oauth",
            access: "file-access-token",
            metadata: { accountID: "file-account-id" },
          },
        },
      ])
    }),
  )

  test("set does not persist environment auth", () =>
    withAuthState(async (authFile) => {
      await Bun.write(authFile, JSON.stringify({ disk: { type: "api", key: "disk-key" } }))
      process.env.OPENCODE_AUTH_CONTENT = JSON.stringify({
        environment: { type: "api", key: "environment-key" },
      })

      await Effect.gen(function* () {
        const auth = yield* Auth.Service
        yield* auth.set("added", { type: "api", key: "added-key" })
      }).pipe(Effect.provide(layer), Effect.scoped, Effect.runPromise)

      expect(await Bun.file(authFile).json()).toEqual({
        disk: { type: "api", key: "disk-key" },
        added: { type: "api", key: "added-key" },
      })
    }),
  )

  test("remove does not persist environment auth", () =>
    withAuthState(async (authFile) => {
      await Bun.write(
        authFile,
        JSON.stringify({
          disk: { type: "api", key: "disk-key" },
          removed: { type: "api", key: "removed-key" },
        }),
      )
      process.env.OPENCODE_AUTH_CONTENT = JSON.stringify({
        environment: { type: "api", key: "environment-key" },
      })

      await Effect.gen(function* () {
        const auth = yield* Auth.Service
        yield* auth.remove("removed")
      }).pipe(Effect.provide(layer), Effect.scoped, Effect.runPromise)

      expect(await Bun.file(authFile).json()).toEqual({
        disk: { type: "api", key: "disk-key" },
      })
    }),
  )

  it.instance("projects OpenAI OAuth into the V2 credential store", () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      const credentials = yield* Credential.Service
      yield* auth.set("openai", {
        type: "oauth",
        refresh: "refresh-token",
        access: "access-token",
        expires: 2_000_000_000_000,
        accountId: "account-id",
      })

      expect(yield* credentials.list(Integration.ID.make("openai"))).toMatchObject([
        {
          integrationID: "openai",
          value: {
            type: "oauth",
            methodID: "chatgpt-browser",
            refresh: "refresh-token",
            access: "access-token",
            expires: 2_000_000_000_000,
            metadata: { accountID: "account-id" },
          },
        },
      ])
    }),
  )

  it.instance("set normalizes trailing slashes in keys", () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      yield* auth.set("https://example.com/", {
        type: "wellknown",
        key: "TOKEN",
        token: "abc",
      })
      const data = yield* auth.all()
      expect(data["https://example.com"]).toBeDefined()
      expect(data["https://example.com/"]).toBeUndefined()
    }),
  )

  it.instance("set cleans up pre-existing trailing-slash entry", () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      yield* auth.set("https://example.com/", {
        type: "wellknown",
        key: "TOKEN",
        token: "old",
      })
      yield* auth.set("https://example.com", {
        type: "wellknown",
        key: "TOKEN",
        token: "new",
      })
      const data = yield* auth.all()
      const keys = Object.keys(data).filter((key) => key.includes("example.com"))
      expect(keys).toEqual(["https://example.com"])
      const entry = data["https://example.com"]!
      expect(entry.type).toBe("wellknown")
      if (entry.type === "wellknown") expect(entry.token).toBe("new")
    }),
  )

  it.instance("remove deletes both trailing-slash and normalized keys", () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      yield* auth.set("https://example.com", {
        type: "wellknown",
        key: "TOKEN",
        token: "abc",
      })
      yield* auth.remove("https://example.com/")
      const data = yield* auth.all()
      expect(data["https://example.com"]).toBeUndefined()
      expect(data["https://example.com/"]).toBeUndefined()
    }),
  )

  it.instance("set and remove are no-ops on keys without trailing slashes", () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      yield* auth.set("anthropic", {
        type: "api",
        key: "sk-test",
      })
      const data = yield* auth.all()
      expect(data["anthropic"]).toBeDefined()
      yield* auth.remove("anthropic")
      const after = yield* auth.all()
      expect(after["anthropic"]).toBeUndefined()
    }),
  )
})
