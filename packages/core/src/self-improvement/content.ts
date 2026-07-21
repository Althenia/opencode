export * as SelfImprovementContent from "./content"

import { Effect } from "effect"
import { marked, type Token } from "marked"
import { SelfImprovementEvaluation, SelfImprovementLifecycle } from "@opencode-ai/schema"

const maximumBytes = 32 * 1024
const maximumNodes = 512
const maximumDepth = 8
const forbiddenLanguage =
  /\b(ignore|override|reveal|reorder|weaken|reinterpret)\b[\s\S]{0,80}\b(prompt|policy|permission|gate|approval|audit|runtime|system|developer|assistant|tool|user)\b/i
const roleDelimiter =
  /<\|(system|developer|assistant|tool|user)\|>|<<\s*SYS\s*>>|(^|\n)\s*(system|developer|assistant|tool|user)\s*:/im

export const validateGeneratedSkill = (
  markdown: string,
  runID: SelfImprovementLifecycle.EvaluationRunID,
): Effect.Effect<ReadonlyArray<SelfImprovementEvaluation.GateFinding>> =>
  Effect.sync(() => {
    const violations = new Set<string>()
    if (new TextEncoder().encode(markdown).byteLength > maximumBytes) violations.add("content-bytes-exceeded")
    if (forbiddenLanguage.test(markdown)) violations.add("content-policy-override")
    if (roleDelimiter.test(markdown)) violations.add("content-role-delimiter")
    const inspect = (tokens: ReadonlyArray<Token>, depth: number): number =>
      tokens.reduce((count, token) => {
        if (depth > maximumDepth) violations.add("content-depth-exceeded")
        if (!allowed(token)) violations.add(`content-forbidden-${token.type}`)
        if (token.type === "heading" && (token.depth < 2 || token.depth > 4))
          violations.add("content-forbidden-heading")
        if (token.type === "link" || token.type === "image") violations.add("content-forbidden-link")
        if (token.type === "html") violations.add("content-forbidden-html")
        const nested = "tokens" in token && Array.isArray(token.tokens) ? inspect(token.tokens, depth + 1) : 0
        return count + 1 + nested
      }, 0)
    const nodeCount = inspect(marked.lexer(markdown), 1)
    if (nodeCount > maximumNodes) violations.add("content-nodes-exceeded")
    return [...violations].map((code) =>
      SelfImprovementEvaluation.GateFinding.make({
        id: SelfImprovementLifecycle.GateFindingID.create(),
        evaluationRunID: runID,
        order: SelfImprovementEvaluation.GateOrder["generated-content-safe"],
        gateID: "generated-content-safe",
        result: "fail",
        code,
      }),
    )
  })

function allowed(token: Token) {
  return ["paragraph", "heading", "text", "em", "strong", "codespan", "code", "list", "list_item", "space"].includes(
    token.type,
  )
}
