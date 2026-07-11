import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { LLMRequestPrep } from "@/session/llm/request"

describe("session.llm.request.prepare", () => {
  test("sets X-Session-Id for OpenRouter requests", async () => {
    const sessionID = "session-openrouter-header"
    const prepared = await Effect.runPromise(
      LLMRequestPrep.prepare({
        user: {
          id: "msg-openrouter-header",
          sessionID,
          role: "user",
          time: { created: 0 },
          agent: "test",
          model: { providerID: "openrouter", modelID: "openai/gpt-4.1" },
        } as never,
        sessionID,
        model: {
          id: "openrouter/openai/gpt-4.1",
          providerID: "openrouter",
          api: { id: "openai/gpt-4.1", url: "https://openrouter.ai/api/v1", npm: "@openrouter/ai-sdk-provider" },
          name: "GPT-4.1",
          capabilities: {
            temperature: true,
            reasoning: false,
            attachment: false,
            toolcall: true,
            input: { text: true, audio: false, image: false, video: false },
            output: { text: true, audio: false, image: false, video: false },
          },
          limit: { context: 128_000, output: 16_000 },
          options: {},
          headers: {},
        } as never,
        agent: { name: "test", mode: "primary", options: {}, permission: [] } as never,
        system: [],
        messages: [{ role: "user", content: "Hello" }],
        tools: {},
        provider: { id: "openrouter", options: {} } as never,
        auth: undefined,
        plugin: {
          trigger: (_name: string, _input: unknown, output: unknown) => Effect.succeed(output),
          list: () => Effect.succeed([]),
          init: () => Effect.void,
        } as never,
        flags: { outputTokenMax: 32_000, client: "test" } as never,
        isWorkflow: false,
      }),
    )

    expect(prepared.headers).toMatchObject({ "X-Session-Id": sessionID })
  })
})
