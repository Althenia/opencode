import { SelfImprovementLifecycle } from "@opencode-ai/schema"
import { SelfImprovementAuthorization } from "@opencode-ai/core/self-improvement/authorization"
import { createHmac, timingSafeEqual } from "crypto"
import { Effect, Redacted } from "effect"
import { HttpApiError } from "effect/unstable/httpapi"

export type Tokens = ReadonlyMap<Redacted.Redacted, SelfImprovementLifecycle.Principal>

export function resolvePrincipal(authorization: string | undefined, tokens: Tokens) {
  const match = /^Bearer ([^\s]+)$/.exec(authorization ?? "")
  if (!match) return undefined
  return Array.from(tokens.entries()).find(([token]) => Redacted.value(token) === match[1])?.[1]
}

export const authorize = Effect.fn("SelfImprovementHttpApi.authorize")(function* (input: {
  readonly authorization: string | undefined
  readonly locationID: SelfImprovementLifecycle.LocationID
  readonly parentLocationID?: SelfImprovementLifecycle.LocationID
  readonly operation: SelfImprovementLifecycle.Operation
  readonly tokens: Tokens
}) {
  const principal = resolvePrincipal(input.authorization, input.tokens)
  if (!principal) return yield* new HttpApiError.Forbidden({})
  if (input.parentLocationID && input.parentLocationID !== input.locationID) {
    return yield* new HttpApiError.NotFound({})
  }
  yield* SelfImprovementAuthorization.authorize(principal, input.operation, input.locationID).pipe(
    Effect.catchTag("SelfImprovementAuthorization.Forbidden", () => new HttpApiError.Forbidden({})),
  )
  return principal
})

export function authorizeThen<A, E>(
  input: Parameters<typeof authorize>[0],
  downstream: (principal: SelfImprovementLifecycle.Principal) => Effect.Effect<A, E>,
) {
  return Effect.gen(function* () {
    const principal = yield* authorize(input)
    return yield* downstream(principal)
  })
}

export function createCursorCodec(secret: Redacted.Redacted) {
  const sign = (value: string) => createHmac("sha256", Redacted.value(secret)).update(value).digest("base64url")

  return {
    encode(input: {
      readonly locationID: SelfImprovementLifecycle.LocationID
      readonly endpoint: string
      readonly tuple: ReadonlyArray<string>
    }) {
      const payload = Buffer.from(JSON.stringify(input)).toString("base64url")
      return `${payload}.${sign(payload)}`
    },
    decode(
      cursor: string,
      input: { readonly locationID: SelfImprovementLifecycle.LocationID; readonly endpoint: string },
    ): ReadonlyArray<string> | undefined {
      const [payload, signature, extra] = cursor.split(".")
      if (!payload || !signature || extra || signature.length !== sign(payload).length) return undefined
      if (!timingSafeEqual(Buffer.from(signature), Buffer.from(sign(payload)))) return undefined
      try {
        const decoded: unknown = JSON.parse(Buffer.from(payload, "base64url").toString())
        if (!isCursor(decoded)) return undefined
        if (decoded.locationID !== input.locationID || decoded.endpoint !== input.endpoint) return undefined
        return decoded.tuple
      } catch {
        return undefined
      }
    },
  }
}

function isCursor(value: unknown): value is {
  readonly locationID: SelfImprovementLifecycle.LocationID
  readonly endpoint: string
  readonly tuple: ReadonlyArray<string>
} {
  if (typeof value !== "object" || !value) return false
  const cursor = value as { locationID?: unknown; endpoint?: unknown; tuple?: unknown }
  return typeof cursor.locationID === "string" && typeof cursor.endpoint === "string" && Array.isArray(cursor.tuple)
}
