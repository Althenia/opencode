import type { QuestionInfo } from "@opencode-ai/sdk/v2"

export function autoAnswer(question: QuestionInfo, fallback?: string): string[] | undefined {
  const options = question.options
  if (options.length === 0) return fallback === undefined ? undefined : [fallback]

  const picked = options.some((option) => option.recommended === true)
    ? options.filter((option) => option.recommended === true)
    : options

  if (question.multiple === true) return picked.map((option) => option.label)
  return [picked[0]!.label]
}
