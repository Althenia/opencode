import { describe, expect, test } from "bun:test"
import { findSkillReferenceTrigger, replaceSkillReferenceTrigger } from "./skill-reference"

describe("skill reference triggers", () => {
  test("finds a dollar trigger before the cursor anywhere in text", () => {
    expect(findSkillReferenceTrigger("test me $format hello", 15)).toEqual({ start: 8, end: 15, query: "format" })
  })

  test("does not treat dollar signs inside words as skill triggers", () => {
    expect(findSkillReferenceTrigger("price$format", 12)).toBeUndefined()
  })

  test("replaces only the active dollar trigger", () => {
    expect(replaceSkillReferenceTrigger("test me $for hello", { start: 8, end: 12 }, "formatter")).toEqual({
      text: "test me $formatter hello",
      cursor: 18,
    })
  })
})
