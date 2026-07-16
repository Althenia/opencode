const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" })

export function promptOffsetWidth(value: string) {
  let width = 0
  for (const part of graphemes.segment(value)) {
    // Textarea offsets count newlines as one position; Bun.stringWidth counts them as zero.
    width += part.segment === "\n" ? 1 : Bun.stringWidth(part.segment)
  }
  return width
}

function displayOffsetIndex(value: string, offset: number) {
  if (offset <= 0) return 0

  let width = 0
  for (const part of graphemes.segment(value)) {
    const next = width + promptOffsetWidth(part.segment)
    if (next > offset) return part.index
    width = next
  }

  return value.length
}

export function displaySlice(value: string, start = 0, end = promptOffsetWidth(value)) {
  return value.slice(displayOffsetIndex(value, start), displayOffsetIndex(value, end))
}

export function displayCharAt(value: string, offset: number) {
  let width = 0
  for (const part of graphemes.segment(value)) {
    const next = width + promptOffsetWidth(part.segment)
    if (offset === width || offset < next) return part.segment
    width = next
  }
}

export function mentionTriggerIndex(value: string, offset = promptOffsetWidth(value)) {
  const text = displaySlice(value, 0, offset)
  const index = text.lastIndexOf("@")
  if (index === -1) return

  const before = index === 0 ? undefined : text[index - 1]
  const query = text.slice(index)
  if ((before === undefined || /\s/.test(before)) && !/\s/.test(query)) {
    return promptOffsetWidth(text.slice(0, index))
  }
}

export function skillReferenceTriggerIndex(value: string, offset = promptOffsetWidth(value)) {
  const text = displaySlice(value, 0, offset)
  const index = text.lastIndexOf("$")
  if (index === -1) return

  const before = index === 0 ? undefined : text[index - 1]
  const query = text.slice(index)
  if ((before === undefined || /\s/.test(before)) && !/\s/.test(query)) {
    return promptOffsetWidth(text.slice(0, index))
  }
}

export function displaySkillReference(value: string) {
  return value.startsWith("$") ? `✦ ${value.slice(1)}` : value
}

export function displaySkillReferences(value: string, skills: ReadonlySet<string>, metadata?: unknown) {
  if (!metadata || typeof metadata !== "object" || !("skillReferences" in metadata)) return value
  if (!Array.isArray(metadata.skillReferences)) return value

  const result = metadata.skillReferences
    .filter(
      (reference): reference is { start: number; end: number; name: string } =>
        reference !== null &&
        typeof reference === "object" &&
        "start" in reference &&
        Number.isSafeInteger(reference.start) &&
        "end" in reference &&
        Number.isSafeInteger(reference.end) &&
        "name" in reference &&
        typeof reference.name === "string" &&
        reference.start >= 0 &&
        reference.end > reference.start &&
        skills.has(reference.name) &&
        displaySlice(value, reference.start, reference.end) === `$${reference.name}`,
    )
    .sort((a, b) => a.start - b.start)
    .reduce(
      (output, reference) => {
        if (reference.start < output.end) return output
        output.value +=
          displaySlice(value, output.end, reference.start) + displaySkillReference(`$${reference.name}`)
        output.end = reference.end
        return output
      },
      { value: "", end: 0 },
    )

  return result.value + displaySlice(value, result.end)
}
