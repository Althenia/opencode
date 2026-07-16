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
const it = testEffect(layer)

describe("Auth", () => {
  test("imports OpenAI OAuth from auth.json without persisting environment auth", async () => {
    const previous = process.env.OPENCODE_AUTH_CONTENT
    const authFile = path.join(Global.Path.data, "auth.json")
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

    try {
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
    } finally {
      if (previous === undefined) delete process.env.OPENCODE_AUTH_CONTENT
      else process.env.OPENCODE_AUTH_CONTENT = previous
      await Bun.write(authFile, "{}")
      await Effect.gen(function* () {
        const credentials = yield* Credential.Service
        yield* Effect.forEach(yield* credentials.list(Integration.ID.make("openai")), (item) =>
          credentials.remove(item.id),
        )
      }).pipe(Effect.provide(LayerNode.compile(Credential.node)), Effect.scoped, Effect.runPromise)
    }
  })

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
