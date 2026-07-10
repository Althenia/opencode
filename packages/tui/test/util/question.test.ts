import { describe, expect, test } from "bun:test"
import { autoAnswer } from "../../src/util/question"

describe("util.question", () => {
  test("returns undefined when there are no options", () => {
    expect(autoAnswer({ question: "Pick one", header: "Pick", options: [] })).toBeUndefined()
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

  test("returns undefined for custom-only questions", () => {
    expect(autoAnswer({ question: "Custom", header: "Custom", options: [] })).toBeUndefined()
  })

  test("uses the provided fallback for custom-only questions", () => {
    expect(
      autoAnswer(
        { question: "Custom", header: "Custom", options: [] },
        "Use your best judgment from the goal and current context, then continue.",
      ),
    ).toEqual(["Use your best judgment from the goal and current context, then continue."])
  })
})
