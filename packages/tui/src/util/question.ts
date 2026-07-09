type QuestionOption = {
  label: string
  description?: string
  recommended?: boolean
}

type AutoAnswerQuestion = {
  question?: string
  header?: string
  options?: ReadonlyArray<QuestionOption>
  multiple?: boolean
}

export function autoAnswer(question: AutoAnswerQuestion): string[] {
  const options = question.options ?? []
  if (options.length === 0) return [""]

  const picked = options.some((option) => option.recommended === true)
    ? options.filter((option) => option.recommended === true)
    : options

  if (question.multiple === true) return picked.map((option) => option.label)
  return [picked[0]!.label]
}
