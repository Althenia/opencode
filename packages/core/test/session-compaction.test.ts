import { expect, test } from "bun:test"
import { Effect, Stream } from "effect"
import { LLMEvent } from "@opencode-ai/llm"
import { SessionCompaction } from "@opencode-ai/core/session/compaction"

test("compaction prompt preserves detailed work state and relevant files", () => {
  const prompt = SessionCompaction.buildPrompt({ context: ["conversation history"] })

  expect(prompt).toContain("## Work State\n### Completed")
  expect(prompt).toContain("### Active")
  expect(prompt).toContain("### Blocked")
  expect(prompt).toContain("## Relevant Files")
})

test("overflow recovery does nothing when automatic compaction is disabled", async () => {
  let published = 0
  let streamed = 0
  const compaction = SessionCompaction.make({
    config: [{ type: "document", info: { compaction: { auto: false } } }] as never,
    events: {
      publish: () => Effect.sync(() => published++),
    } as never,
    llm: {
      stream: () => {
        streamed++
        return Stream.make(LLMEvent.textDelta({ id: "summary", text: "summary" }))
      },
    },
  })

  const result = await Effect.runPromise(
    compaction.compactAfterOverflow({
      sessionID: "ses_test" as never,
      entries: [
        {
          seq: 1,
          message: { type: "user", id: "msg_older", text: "Older context ".repeat(4_000) },
        },
        {
          seq: 2,
          message: { type: "user", id: "msg_recent", text: "Recent context ".repeat(4_000) },
        },
      ] as never,
      model: { route: { defaults: { limits: { context: 100_000, output: 1_000 } } } } as never,
      request: { messages: [], system: [], tools: [], generation: { maxTokens: 1_000 } } as never,
    }),
  )

  expect(result).toBe(false)
  expect(published).toBe(0)
  expect(streamed).toBe(0)
})

test("compaction describes tool media without embedding base64", () => {
  const base64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB"
  const serialized = SessionCompaction.serializeToolContent([
    { type: "text", text: "Image read successfully" },
    {
      type: "file",
      uri: `data:image/png;base64,${base64}`,
      mime: "image/png",
      name: "pixel.png",
    },
  ])

  expect(serialized).toBe("Image read successfully\n[Attached image/png: pixel.png]")
  expect(serialized).not.toContain(base64)
})
