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

  test("renders only known timeline skill references with the skill glyph", () => {
    const skills = new Set(["writing-test", "effect"])
    expect(displaySkillReferences("$writing-test", skills)).toBe("✦ writing-test")
    expect(displaySkillReferences("Use $effect, then continue", skills)).toBe("Use ✦ effect, then continue")
    expect(displaySkillReferences("Pay $20 and keep $UNKNOWN", skills)).toBe("Pay $20 and keep $UNKNOWN")
    expect(displaySkillReferences("price$effect", skills)).toBe("price$effect")
  })
})
