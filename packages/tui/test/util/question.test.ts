import { describe, expect, test } from "bun:test"
import { autoAnswer } from "../../src/util/question"

describe("util.question", () => {
  test("returns an empty answer when there are no options", () => {
    expect(autoAnswer({ question: "Pick one", header: "Pick", options: [] })).toEqual([""])
  })

  test("prefers recommended options and keeps all picked labels for multiple questions", () => {
    expect(
      autoAnswer({
        question: "Pick many",
        header: "Pick",
        multiple: true,
        options: [
          { label: "A", description: "A" },
          { label: "B", description: "B", recommended: true },
          { label: "C", description: "C", recommended: true },
        ],
      }),
    ).toEqual(["B", "C"])
  })

  test("uses all options when none are recommended", () => {
    expect(
      autoAnswer({
        question: "Pick many",
        header: "Pick",
        multiple: true,
        options: [
          { label: "A", description: "A" },
          { label: "B", description: "B" },
        ],
      }),
    ).toEqual(["A", "B"])
  })

  test("returns the first picked label for single-select questions", () => {
    expect(
      autoAnswer({
        question: "Pick one",
        header: "Pick",
        options: [
          { label: "A", description: "A", recommended: true },
          { label: "B", description: "B", recommended: true },
        ],
      }),
    ).toEqual(["A"])
  })

  test("returns the first option for single-select questions with no recommendations", () => {
    expect(
      autoAnswer({
        question: "Pick one",
        header: "Pick",
        options: [
          { label: "A", description: "A" },
          { label: "B", description: "B" },
        ],
      }),
    ).toEqual(["A"])
  })

  test("falls back to an empty answer for custom-only questions", () => {
    expect(autoAnswer({ question: "Custom", header: "Custom" })).toEqual([""])
  })
})
