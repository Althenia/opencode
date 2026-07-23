import { expect, test } from "bun:test"
import { Schema } from "effect"
import { isOpenCodeEvent, OpenCodeEvent } from "../src/groups/event.js"

test("classifies public events by type", () => {
  expect(isOpenCodeEvent({ type: "server.connected" })).toBe(true)
  expect(isOpenCodeEvent({ type: "mcp.status.changed" })).toBe(true)
  expect(isOpenCodeEvent({ type: "mcp.resources.changed" })).toBe(true)
  expect(isOpenCodeEvent({ type: "mcp.tools.changed" })).toBe(false)
})

test("public step events omit the derivable cache mechanism", () => {
  const event = Schema.decodeUnknownSync(OpenCodeEvent)({
    id: "evt_test",
    created: 0,
    type: "session.step.ended",
    durable: { aggregateID: "ses_test", seq: 1, version: 1 },
    data: {
      sessionID: "ses_test",
      assistantMessageID: "msg_test",
      finish: "stop",
      cost: 0,
      tokens: { input: 10, output: 2, reasoning: 0, cache: { read: 5, write: 0 } },
      cacheMechanism: "openai-prompt-cache",
    },
  })

  expect(event.data).not.toHaveProperty("cacheMechanism")
})
