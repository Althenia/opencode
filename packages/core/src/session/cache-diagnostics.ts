export * as SessionCacheDiagnostics from "./cache-diagnostics"

import { Session } from "@opencode-ai/schema/session"
import { Money } from "@opencode-ai/schema/money"
import type { TokenUsage } from "@opencode-ai/schema/token-usage"
import type { ModelV2 } from "../model"
import type { SessionMessage } from "./message"

export interface CalculateInput {
  readonly model: ModelV2.Ref
  readonly tokens: TokenUsage.Info
  readonly estimatedCost: Money.USD
  readonly contextLimit?: number
  readonly cacheMechanism?: Session.CacheMechanism
}

const safe = (value: number) => Math.max(0, Number.isFinite(value) ? value : 0)

export function mechanism(model: ModelV2.Ref, tokens: TokenUsage.Info): Session.CacheMechanism {
  switch (model.providerID) {
    case "openai":
    case "azure":
    case "github-copilot":
    case "opencode":
      return "openai-prompt-cache"
    case "openrouter":
      return "openrouter-sticky-prefix"
    case "anthropic":
      return "anthropic-cache-control"
    case "amazon-bedrock":
      return "bedrock-cache-point"
    case "google":
    case "google-vertex":
      return "gemini-implicit-prefix"
    default:
      return tokens.cache.read > 0 || tokens.cache.write > 0 ? "provider-reported" : "none"
  }
}

export function calculate(input: CalculateInput): Session.CacheDiagnostics {
  const uncachedInput = safe(input.tokens.input)
  const output = safe(input.tokens.output)
  const reasoning = safe(input.tokens.reasoning)
  const cacheRead = safe(input.tokens.cache.read)
  const cacheWrite = safe(input.tokens.cache.write)
  const total = uncachedInput + output + reasoning + cacheRead + cacheWrite
  const eligible = uncachedInput + cacheRead + cacheWrite
  const limit = input.contextLimit !== undefined && input.contextLimit > 0 ? Math.trunc(input.contextLimit) : undefined

  return {
    model: input.model,
    context: {
      total,
      ...(limit === undefined
        ? {}
        : {
            limit,
            remaining: Math.max(0, limit - total),
            percent: Math.round((total / limit) * 100),
          }),
    },
    tokens: { uncachedInput, output, reasoning, cacheRead, cacheWrite },
    cache: {
      eligible,
      ...(eligible > 0 ? { hitRatio: cacheRead / eligible } : {}),
      mechanism: input.cacheMechanism ?? mechanism(input.model, input.tokens),
    },
    estimatedCost: input.estimatedCost,
  }
}

export function latestAssistant(
  messages: ReadonlyArray<SessionMessage.Info>,
  boundary?: SessionMessage.ID,
): (SessionMessage.Assistant & { readonly tokens: TokenUsage.Info }) | undefined {
  const boundaryIndex = boundary ? messages.findIndex((message) => message.id === boundary) : -1
  if (boundary && boundaryIndex === -1) return undefined
  const end = boundaryIndex === -1 ? messages.length : boundaryIndex
  const compactionIndex = messages.findLastIndex(
    (message, index) => message.type === "compaction" && message.status === "completed" && index < end,
  )
  return messages.findLast(
    (message, index): message is SessionMessage.Assistant & { readonly tokens: TokenUsage.Info } =>
      message.type === "assistant" && message.tokens !== undefined && index > compactionIndex && index < end,
  )
}

export function fromMessages(
  messages: ReadonlyArray<SessionMessage.Info>,
  boundary?: SessionMessage.ID,
): Session.CacheDiagnostics | undefined {
  const last = latestAssistant(messages, boundary)
  if (!last) return undefined
  return calculate({
    model: last.model,
    tokens: last.tokens,
    estimatedCost: last.cost ?? Money.USD.zero,
    contextLimit: last.diagnostics?.contextLimit,
    cacheMechanism: last.diagnostics?.cacheMechanism,
  })
}
