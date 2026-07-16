import { describe, expect, test } from "bun:test"
import {
  displayCharAt,
  displaySkillReference,
  displaySkillReferences,
  displaySlice,
  mentionTriggerIndex,
  skillReferenceTriggerIndex,
} from "../../src/prompt/display"

describe("prompt display", () => {
  test("uses display-width offsets for mentions", () => {
    expect(mentionTriggerIndex("@")).toBe(0)
    expect(mentionTriggerIndex("test @")).toBe(5)
    expect(mentionTriggerIndex("中文 @")).toBe(5)
    expect(mentionTriggerIndex("こんにちは @")).toBe(11)
    expect(mentionTriggerIndex("한국어 @")).toBe(7)
    expect(mentionTriggerIndex("🙂 @")).toBe(3)
    expect(mentionTriggerIndex("中文 @src file", Bun.stringWidth("中文 @src"))).toBe(5)
    expect(displayCharAt("中文 @src", Bun.stringWidth("中文 @"))).toBe("s")
    expect(displaySlice("中文 @src", 5, Bun.stringWidth("中文 @src"))).toBe("@src")
    expect(displaySlice("中文 @src", 6, Bun.stringWidth("中文 @src"))).toBe("src")
    expect(mentionTriggerIndex("👨‍👩‍👧‍👦 @src", Bun.stringWidth("👨‍👩‍👧‍👦 @src"))).toBe(3)
    expect(displayCharAt("👨‍👩‍👧‍👦 @src", Bun.stringWidth("👨‍👩‍👧‍👦 @"))).toBe("s")
    expect(displaySlice("👨‍👩‍👧‍👦 @src", 3, Bun.stringWidth("👨‍👩‍👧‍👦 @src"))).toBe("@src")
    expect(mentionTriggerIndex("@file1\n@file2", 13)).toBe(7)
    expect(displayCharAt("@file1\n@file2", 6)).toBe("\n")
    expect(displaySlice("@file1\n@file2", 8, 13)).toBe("file2")
    expect(mentionTriggerIndex("@file1\nfoo @file2", 17)).toBe(11)
    expect(mentionTriggerIndex("中文 @one\n@two", 14)).toBe(10)
    expect(displaySlice("中文 @one\n@two", 11, 14)).toBe("two")
    expect(mentionTriggerIndex("中文@")).toBeUndefined()
    expect(mentionTriggerIndex("こんにちは@")).toBeUndefined()
    expect(mentionTriggerIndex("한국어@")).toBeUndefined()
    expect(mentionTriggerIndex("🙂@")).toBeUndefined()
    expect(mentionTriggerIndex("hello@")).toBeUndefined()
    expect(mentionTriggerIndex("foo@bar.com")).toBeUndefined()
    expect(mentionTriggerIndex("中文 @src file")).toBeUndefined()
  })

  test("uses display-width offsets for skill references", () => {
    expect(skillReferenceTriggerIndex("$")).toBe(0)
    expect(skillReferenceTriggerIndex("test me $")).toBe(8)
    expect(skillReferenceTriggerIndex("test me $format hello", Bun.stringWidth("test me $format"))).toBe(8)
    expect(skillReferenceTriggerIndex("price$format")).toBeUndefined()
    expect(skillReferenceTriggerIndex("test $format hello")).toBeUndefined()
  })

  test("replaces skill reference prefix with an icon marker", () => {
    expect(displaySkillReference("$dispatching-parallel-agents")).toBe("✦ dispatching-parallel-agents")
  })

  test("leaves known skill text unchanged without selected-reference provenance", () => {
    expect(displaySkillReferences("echo $effect", new Set(["effect"]))).toBe("echo $effect")
    expect(displaySkillReferences("Pay $20", new Set(["20"]))).toBe("Pay $20")
  })

  test("renders only the selected occurrence of a known skill reference", () => {
    const value = "$effect then $effect"
    expect(
      displaySkillReferences(value, new Set(["effect"]), {
        skillReferences: [{ start: 13, end: 20, name: "effect" }],
      }),
    ).toBe("$effect then ✦ effect")
  })

  test("renders selected numeric skill names", () => {
    expect(
      displaySkillReferences("Run $20", new Set(["20"]), {
        skillReferences: [{ start: 4, end: 7, name: "20" }],
      }),
    ).toBe("Run ✦ 20")
  })

  test("leaves stale and malformed skill reference provenance unchanged", () => {
    const skills = new Set(["effect"])
    expect(
      displaySkillReferences("Run $effect", skills, {
        skillReferences: [{ start: 4, end: 11, name: "missing" }],
      }),
    ).toBe("Run $effect")
    expect(
      displaySkillReferences("Run $effect", skills, {
        skillReferences: [{ start: 0, end: 11, name: "effect" }],
      }),
    ).toBe("Run $effect")
    expect(displaySkillReferences("Run $effect", skills, { skillReferences: "effect" })).toBe("Run $effect")
  })
})
