export type PromptSkill = {
  id: string
  name: string
  mention?: {
    start: number
    end: number
    text: string
  }
}

export function promptSkillMetadata(skills: readonly PromptSkill[]) {
  const selected = skills.filter((skill, index) => skill.id.trim() && skill.name.trim() && skills.findIndex((item) => item.id === skill.id) === index)
  if (!selected.length) return
  return { skills: selected.map((skill) => ({ id: skill.id, name: skill.name })) }
}

export function promptSkillsFromMetadata(value: unknown): PromptSkill[] {
  if (!value || typeof value !== "object") return []
  const skills = (value as Record<string, unknown>).skills
  if (!Array.isArray(skills)) return []
  return skills.flatMap((skill) => {
    if (!skill || typeof skill !== "object") return []
    const item = skill as Record<string, unknown>
    if (typeof item.id !== "string" || !item.id.trim() || typeof item.name !== "string" || !item.name.trim()) return []
    return [{ id: item.id, name: item.name }]
  })
}

export function segmentPromptSkills(text: string, skills: readonly PromptSkill[]) {
  const selected = new Map(promptSkillsFromMetadata({ skills }).map((skill) => [skill.id, skill.name]))
  const segments: Array<{ type: "text" | "skill"; value: string }> = []
  const ids = [...selected.keys()].sort((a, b) => b.length - a.length)
  if (!ids.length) return [{ type: "text" as const, value: text }]
  const matcher = new RegExp(`(^|\\s)\\$(${ids.map((id) => id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?=\\s|$)`, "g")
  let offset = 0
  for (const match of text.matchAll(matcher)) {
    const id = match[2]
    const name = id ? selected.get(id) : undefined
    if (!name || match.index === undefined) continue
    const start = match.index + match[1].length
    if (start > offset) segments.push({ type: "text", value: text.slice(offset, start) })
    segments.push({ type: "skill", value: `✦ ${name}` })
    offset = start + id.length + 1
  }
  if (offset < text.length) segments.push({ type: "text", value: text.slice(offset) })
  return segments
}
