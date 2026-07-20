export * as ConfigSelfImprovement from "./self-improvement"

import { SelfImprovementLifecycle } from "@opencode-ai/schema"
import { Option, Redacted, Schema } from "effect"

const TokenInfo = Schema.Struct({
  tokens: Schema.Record(Schema.String, SelfImprovementLifecycle.Principal),
})
const Info = Schema.Struct({
  tokens: Schema.Record(Schema.String, SelfImprovementLifecycle.Principal),
  cursorSecret: Schema.String,
})

export type Tokens = ReadonlyMap<Redacted.Redacted, SelfImprovementLifecycle.Principal>
export interface Settings {
  readonly tokens: Tokens
  readonly cursorSecret: Redacted.Redacted
}

export function tokens(value: unknown): Tokens {
  const decoded = Schema.decodeUnknownOption(TokenInfo)(value)
  if (Option.isNone(decoded)) return immutable(new Map())
  return immutable(
    new Map(Object.entries(decoded.value.tokens).map(([token, principal]) => [Redacted.make(token), principal])),
  )
}

export function settings(value: unknown): Settings | undefined {
  if (typeof value !== "object" || !value || !("experimental" in value)) return undefined
  const experimental = value.experimental
  if (typeof experimental !== "object" || !experimental || !("self_improvement" in experimental)) return undefined
  const decoded = Schema.decodeUnknownOption(Info)(experimental.self_improvement)
  if (Option.isNone(decoded) || !decoded.value.cursorSecret) return undefined
  return {
    tokens: tokens(decoded.value),
    cursorSecret: Redacted.make(decoded.value.cursorSecret),
  }
}

function immutable(result: Map<Redacted.Redacted, SelfImprovementLifecycle.Principal>): Tokens {
  return Object.freeze({
    get size() {
      return result.size
    },
    get: result.get.bind(result),
    has: result.has.bind(result),
    entries: result.entries.bind(result),
    keys: result.keys.bind(result),
    values: result.values.bind(result),
    forEach: result.forEach.bind(result),
    [Symbol.iterator]: result[Symbol.iterator].bind(result),
  })
}
