import { expect, test } from "bun:test"
import type {
  V2SessionHistoryData,
  V2SessionSubagentLaunchData,
  V2SessionSubagentMessageData,
} from "../src/v2/gen/types.gen"

test("uses numeric Session history positions", () => {
  const input = {
    path: { sessionID: "ses_test" },
    query: { after: 1, limit: 50 },
    url: "/api/session/{sessionID}/history",
  } satisfies V2SessionHistoryData

  expect(input.query.after).toBe(1)
})

test("exposes canonical Session subagent launch data", () => {
  const input = {
    path: { parentID: "ses_parent" },
    body: {
      parentAssistantMessageID: "msg_parent",
      toolCallID: "call_1",
      agent: "reviewer",
      description: "Review implementation",
      prompt: "Review the changed files",
      background: true,
      model: { providerID: "openai", id: "gpt-5.6", variant: "high" },
    },
    url: "/api/session/{parentID}/subagent",
  } satisfies V2SessionSubagentLaunchData

  expect(input.body.model.variant).toBe("high")
})

test("requires an idempotency identity for Session subagent messages", () => {
  const input = {
    path: { parentID: "ses_parent", childID: "ses_child" },
    body: { messageID: "msg_control", text: "Use this context", delivery: "queue" },
    url: "/api/session/{parentID}/subagent/{childID}/message",
  } satisfies V2SessionSubagentMessageData

  expect(input.body.messageID).toBe("msg_control")
})
