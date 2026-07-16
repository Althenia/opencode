import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import path from "path"
import { Effect, Layer, Record, Result, Schema, Context } from "effect"
import { Credential } from "@opencode-ai/core/credential"
import { NonNegativeInt } from "@opencode-ai/core/schema"
import { Global } from "@opencode-ai/core/global"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Integration } from "@opencode-ai/core/integration"

export const OAUTH_DUMMY_KEY = "opencode-oauth-dummy-key"

const file = path.join(Global.Path.data, "auth.json")

const fail = (message: string) => (cause: unknown) => new AuthError({ message, cause })

export class Oauth extends Schema.Class<Oauth>("OAuth")({
  type: Schema.Literal("oauth"),
  refresh: Schema.String,
  access: Schema.String,
  expires: NonNegativeInt,
  accountId: Schema.optional(Schema.String),
  enterpriseUrl: Schema.optional(Schema.String),
}) {}

export class Api extends Schema.Class<Api>("ApiAuth")({
  type: Schema.Literal("api"),
  key: Schema.String,
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.String)),
}) {}

export class WellKnown extends Schema.Class<WellKnown>("WellKnownAuth")({
  type: Schema.Literal("wellknown"),
  key: Schema.String,
  token: Schema.String,
}) {}

export const Info = Schema.Union([Oauth, Api, WellKnown]).annotate({ discriminator: "type", identifier: "Auth" })
export type Info = Schema.Schema.Type<typeof Info>

export class AuthError extends Schema.TaggedErrorClass<AuthError>()("AuthError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

export interface Interface {
  readonly get: (providerID: string) => Effect.Effect<Info | undefined, AuthError>
  readonly all: () => Effect.Effect<Record<string, Info>, AuthError>
  readonly set: (key: string, info: Info) => Effect.Effect<void, AuthError>
  readonly remove: (key: string) => Effect.Effect<void, AuthError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Auth") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fsys = yield* FSUtil.Service
    const credentials = yield* Credential.Service
    const decode = Schema.decodeUnknownOption(Info)

    const read = Effect.fnUntraced(function* () {
      const data = (yield* fsys.readJson(file).pipe(Effect.orElseSucceed(() => ({})))) as Record<string, unknown>
      return Record.filterMap(data, (value) => Result.fromOption(decode(value), () => undefined))
    })

    const project = Effect.fnUntraced(function* (providerID: string, info: Info) {
      if (providerID !== "openai") return
      const value =
        info.type === "api"
          ? Credential.Key.make({ type: "key", key: info.key, metadata: info.metadata })
          : info.type === "oauth"
            ? Credential.OAuth.make({
                type: "oauth",
                methodID: Integration.MethodID.make("chatgpt-browser"),
                refresh: info.refresh,
                access: info.access,
                expires: info.expires,
                metadata: info.accountId ? { accountID: info.accountId } : undefined,
              })
            : undefined
      if (!value) return
      yield* credentials.create({ integrationID: Integration.ID.make(providerID), value })
    })

    const all = Effect.fn("Auth.all")(function* () {
      if (process.env.OPENCODE_AUTH_CONTENT) {
        try {
          return JSON.parse(process.env.OPENCODE_AUTH_CONTENT)
        } catch (err) {}
      }

      return yield* read()
    })

    const get = Effect.fn("Auth.get")(function* (providerID: string) {
      return (yield* all())[providerID]
    })

    const set = Effect.fn("Auth.set")(function* (key: string, info: Info) {
      const norm = key.replace(/\/+$/, "")
      const data = yield* all()
      if (norm !== key) delete data[key]
      delete data[norm + "/"]
      yield* fsys
        .writeJson(file, { ...data, [norm]: info }, 0o600)
        .pipe(Effect.mapError(fail("Failed to write auth data")))
      yield* project(norm, info)
    })

    const remove = Effect.fn("Auth.remove")(function* (key: string) {
      const norm = key.replace(/\/+$/, "")
      const data = yield* all()
      delete data[key]
      delete data[norm]
      yield* fsys.writeJson(file, data, 0o600).pipe(Effect.mapError(fail("Failed to write auth data")))
      if (norm === "openai") {
        yield* Effect.forEach(yield* credentials.list(Integration.ID.make(norm)), (item) => credentials.remove(item.id), {
          discard: true,
        })
      }
    })

    const openaiID = Integration.ID.make("openai")
    if ((yield* credentials.list(openaiID)).length === 0) {
      const legacy = (yield* read()).openai
      if (legacy) yield* project(openaiID, legacy)
    }

    return Service.of({ get, all, set, remove })
  }),
)

export const node = LayerNode.make({ service: Service, layer: layer, deps: [FSUtil.node, Credential.node] })

export * as Auth from "."
