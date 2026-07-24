// Apply an `LLMRequest.cache` policy by injecting `CacheHint`s onto the parts
// the policy designates. Runs once at compile time, before the per-protocol
// body builder, so the existing inline-hint lowering path handles the rest.
//
// The default `"auto"` shape places one breakpoint at the last tool definition,
// one at the last system part, and one at the latest cacheable message. The
// message breakpoint advances through completed tool results, so each next
// tool-loop attempt reuses the longest completed conversation prefix.
//
// Manual `cache: CacheHint` placements on individual parts are preserved —
// this function only fills gaps the caller left empty.
import { CacheHint, type CachePolicy, type CachePolicyObject } from "./schema/options"
import { LLMRequest, Message, ToolDefinition, type ContentPart } from "./schema/messages"

export const CACHE_POLICY_REVISION = "provider-native/v1"

const AUTO: CachePolicyObject = {
  tools: true,
  system: true,
  messages: { tail: 1 },
}

const NONE: CachePolicyObject = {}

// Resolution rules:
//   - undefined   → "auto" — caching is on by default. The math favors it:
//                   Anthropic 5m-cache write is 1.25x base, read is 0.1x,
//                   so a single reuse within 5 minutes already wins.
//   - "auto"      → tools + system + latest cacheable message.
//   - "none"      → no auto placement; manual `CacheHint`s still flow.
//   - object form → exactly what the caller asked for.
const resolve = (policy: CachePolicy | undefined): CachePolicyObject => {
  if (policy === undefined || policy === "auto") return AUTO
  if (policy === "none") return NONE
  return policy
}

// Protocols whose wire format ignores inline cache markers (OpenAI's implicit
// prefix caching, Gemini's implicit + out-of-band CachedContent). Skip the
// whole policy pass for these — emitting hints would be harmless but pointless.
const RESPECTS_INLINE_HINTS = new Set(["anthropic-messages", "bedrock-converse"])
const INLINE_HINT_CAP = 4

const makeHint = (ttlSeconds: number | undefined): CacheHint =>
  ttlSeconds !== undefined ? new CacheHint({ type: "ephemeral", ttlSeconds }) : new CacheHint({ type: "ephemeral" })

type HintPosition = readonly [section: number, item: number, part: number]

interface ManualHint {
  readonly hint: CacheHint
  readonly position: HintPosition
}

// Section numbers preserve provider wire order: tools → system → messages.
const comparePosition = (left: HintPosition, right: HintPosition) =>
  left[0] - right[0] || left[1] - right[1] || left[2] - right[2]

const isOneHour = (hint: CacheHint) => hint.ttlSeconds !== undefined && hint.ttlSeconds >= 3600

const manualHints = (request: LLMRequest): ReadonlyArray<ManualHint> => [
  ...request.tools.flatMap((tool, item) =>
    tool.cache ? [{ hint: tool.cache, position: [0, item, 0] as const }] : [],
  ),
  ...request.system.flatMap((part, item) =>
    part.cache ? [{ hint: part.cache, position: [1, item, 0] as const }] : [],
  ),
  ...request.messages.flatMap((message, item) =>
    message.content.flatMap((part, index) => {
      const hint = "cache" in part ? part.cache : undefined
      return hint ? [{ hint, position: [2, item, index] as const }] : []
    }),
  ),
]

const coordinateAutoHints = (request: LLMRequest) => {
  const manual = manualHints(request)
  const state = { remaining: Math.max(0, INLINE_HINT_CAP - manual.length) }
  return (position: HintPosition, hint: CacheHint) => {
    if (state.remaining <= 0) return false
    const conflicts = isOneHour(hint)
      ? manual.some((entry) => !isOneHour(entry.hint) && comparePosition(entry.position, position) < 0)
      : manual.some((entry) => isOneHour(entry.hint) && comparePosition(entry.position, position) > 0)
    if (conflicts) return false
    state.remaining -= 1
    return true
  }
}

const markLastTool = (
  tools: ReadonlyArray<ToolDefinition>,
  hint: CacheHint,
  reserve: (position: HintPosition, hint: CacheHint) => boolean,
): ReadonlyArray<ToolDefinition> => {
  if (tools.length === 0) return tools
  const last = tools.length - 1
  if (tools[last]!.cache || !reserve([0, last, 0], hint)) return tools
  return tools.map((tool, i) => (i === last ? new ToolDefinition({ ...tool, cache: hint }) : tool))
}

const markLastSystem = (
  system: LLMRequest["system"],
  hint: CacheHint,
  reserve: (position: HintPosition, hint: CacheHint) => boolean,
): LLMRequest["system"] => {
  const last = system.findLastIndex((part) => part.text.trim().length > 0)
  if (last < 0 || system[last]!.cache || !reserve([1, last, 0], hint)) return system
  return system.map((part, i) => (i === last ? { ...part, cache: hint } : part))
}

const lastIndexOfRole = (messages: ReadonlyArray<Message>, role: Message["role"]): number =>
  messages.findLastIndex((m) => m.role === role)

const isMarkablePart = (part: ContentPart) =>
  (part.type === "text" && part.text.trim().length > 0) || part.type === "tool-result"

const lastMarkableMessage = (messages: ReadonlyArray<Message>) =>
  messages.findLastIndex((message) => message.content.some(isMarkablePart))

// Mark the last non-empty text or tool-result part of `messages[index]`.
// Other part types do not expose a cache field in the canonical schema and
// empty text markers are rejected by Anthropic-compatible APIs.
const markMessageAt = (
  messages: ReadonlyArray<Message>,
  index: number,
  hint: CacheHint,
  reserve: (position: HintPosition, hint: CacheHint) => boolean,
): ReadonlyArray<Message> => {
  if (index < 0 || index >= messages.length) return messages
  const target = messages[index]!
  if (target.content.length === 0) return messages
  const markAt = target.content.findLastIndex(isMarkablePart)
  if (markAt < 0) return messages
  const existing = target.content[markAt]!
  if (("cache" in existing && existing.cache) || !reserve([2, index, markAt], hint)) return messages
  const nextContent = target.content.map((part, i) => (i === markAt ? ({ ...part, cache: hint } as ContentPart) : part))
  const next = new Message({ ...target, content: nextContent })
  // Single pass over `messages`, substituting the one updated entry. Long
  // conversations call this on every request, so avoid `.map()` here — its
  // closure dispatch and identity copies show up in profiling.
  const result = messages.slice()
  result[index] = next
  return result
}

const markMessages = (
  messages: ReadonlyArray<Message>,
  strategy: NonNullable<CachePolicyObject["messages"]>,
  hint: CacheHint,
  reserve: (position: HintPosition, hint: CacheHint) => boolean,
): ReadonlyArray<Message> => {
  if (messages.length === 0) return messages
  if (strategy === "latest-user-message") return markMessageAt(messages, lastIndexOfRole(messages, "user"), hint, reserve)
  if (strategy === "latest-assistant") return markMessageAt(messages, lastIndexOfRole(messages, "assistant"), hint, reserve)
  const start = Math.max(0, messages.length - strategy.tail)
  let next = messages
  for (let i = start; i < messages.length; i++) next = markMessageAt(next, i, hint, reserve)
  return next
}

export const applyCachePolicy = (request: LLMRequest): LLMRequest => {
  if (!RESPECTS_INLINE_HINTS.has(request.model.route.protocol)) return request
  const policy = resolve(request.cache)
  const auto = request.cache === undefined || request.cache === "auto"
  if (!policy.tools && !policy.system && !policy.messages) return request

  const hint = makeHint(policy.ttlSeconds)
  const reserve = coordinateAutoHints(request)
  const tools = policy.tools ? markLastTool(request.tools, hint, reserve) : request.tools
  const system = policy.system ? markLastSystem(request.system, hint, reserve) : request.system
  const messages = !policy.messages
    ? request.messages
    : auto
      ? markMessageAt(request.messages, lastMarkableMessage(request.messages), hint, reserve)
      : markMessages(request.messages, policy.messages, hint, reserve)

  if (tools === request.tools && system === request.system && messages === request.messages) return request
  return LLMRequest.update(request, { tools, system, messages })
}
