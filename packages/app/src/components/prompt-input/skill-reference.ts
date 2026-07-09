export type SkillReferenceTrigger = {
  start: number
  end: number
  query: string
}

export function findSkillReferenceTrigger(text: string, cursor: number) {
  const beforeCursor = text.substring(0, cursor)
  const match = beforeCursor.match(/(^|\s)\$(\S*)$/)
  if (!match) return undefined

  const query = match[2] ?? ""
  const start = cursor - query.length - 1
  return { start, end: cursor, query } satisfies SkillReferenceTrigger
}

export function replaceSkillReferenceTrigger(text: string, trigger: Pick<SkillReferenceTrigger, "start" | "end">, skill: string) {
  const insert = `$${skill}`
  return {
    text: text.slice(0, trigger.start) + insert + text.slice(trigger.end),
    cursor: trigger.start + insert.length,
  }
}
