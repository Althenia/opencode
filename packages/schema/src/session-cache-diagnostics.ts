export * as SessionCacheDiagnostics from "./session-cache-diagnostics.js"

import { Schema } from "effect"
import { Model } from "./model.js"
import { Money } from "./money.js"
import { NonNegativeInt, optional } from "./schema.js"

export const Mechanism = Schema.Literals([
  "openai-prompt-cache",
  "openrouter-sticky-prefix",
  "anthropic-cache-control",
  "bedrock-cache-point",
  "gemini-implicit-prefix",
  "provider-reported",
  "none",
]).annotate({ identifier: "Session.CacheMechanism" })
export type Mechanism = typeof Mechanism.Type

export const Info = Schema.Struct({
  model: Model.Ref,
  context: Schema.Struct({
    total: NonNegativeInt,
    limit: NonNegativeInt.pipe(optional),
    remaining: NonNegativeInt.pipe(optional),
    percent: Schema.Finite.pipe(optional),
  }),
  tokens: Schema.Struct({
    uncachedInput: NonNegativeInt,
    output: NonNegativeInt,
    reasoning: NonNegativeInt,
    cacheRead: NonNegativeInt,
    cacheWrite: NonNegativeInt,
  }),
  cache: Schema.Struct({
    eligible: NonNegativeInt,
    hitRatio: Schema.Finite.pipe(optional),
    mechanism: Mechanism,
  }),
  estimatedCost: Money.USD,
}).annotate({ identifier: "Session.CacheDiagnostics" })
export interface Info extends Schema.Schema.Type<typeof Info> {}
