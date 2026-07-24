import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { CacheHint, LLM, Message, ToolCallPart } from "../src"
import { Auth, LLMClient } from "../src/route"
import { AmazonBedrock, GoogleVertexMessages } from "../src/providers"
import * as AnthropicMessages from "../src/protocols/anthropic-messages"
import * as Gemini from "../src/protocols/gemini"
import * as OpenAIChat from "../src/protocols/openai-chat"
import { CACHE_POLICY_REVISION, applyCachePolicy } from "../src/cache-policy"
import { it } from "./lib/effect"

const anthropicModel = AnthropicMessages.route
  .with({ endpoint: { baseURL: "https://api.anthropic.test/v1/" }, auth: Auth.header("x-api-key", "test") })
  .model({ id: "claude-sonnet-4-5" })

const bedrockModel = AmazonBedrock.configure({
  credentials: { region: "us-east-1", accessKeyId: "fixture", secretAccessKey: "fixture" },
}).model("anthropic.claude-3-5-sonnet-20241022-v2:0")

const vertexAnthropicModel = GoogleVertexMessages.configure({
  accessToken: "test",
  baseURL: "https://vertex.test/v1/projects/test/locations/global/publishers/anthropic/models",
}).model("claude-sonnet-4-5")

const openaiModel = OpenAIChat.route
  .with({ endpoint: { baseURL: "https://api.openai.test/v1/" }, auth: Auth.bearer("test") })
  .model({ id: "gpt-4o-mini" })

const geminiModel = Gemini.route
  .with({
    endpoint: { baseURL: "https://generativelanguage.test/v1beta/" },
    auth: Auth.header("x-goog-api-key", "test"),
  })
  .model({ id: "gemini-2.5-flash" })

test("pins the provider-native cache policy revision", () => {
  expect(CACHE_POLICY_REVISION).toBe("provider-native/v1")
})

describe("applyCachePolicy", () => {
  it.effect("undefined cache resolves to 'auto' (the recommended default)", () =>
    Effect.gen(function* () {
      const prepared = yield* LLMClient.prepare(
        LLM.request({
          model: anthropicModel,
          system: "You are concise.",
          prompt: "hi",
        }),
      )

      // No explicit cache field → auto policy fires → last system part + latest
      // user message both get cache_control markers.
      expect(prepared.body).toMatchObject({
        system: [{ type: "text", text: "You are concise.", cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: [{ type: "text", text: "hi", cache_control: { type: "ephemeral" } }] }],
      })
    }),
  )

  it.effect("'auto' marks the last tool, last system part, and latest user message on Anthropic", () =>
    Effect.gen(function* () {
      const prepared = yield* LLMClient.prepare(
        LLM.request({
          model: anthropicModel,
          system: "Sys A",
          tools: [{ name: "t1", description: "t1", inputSchema: { type: "object", properties: {} } }],
          messages: [
            Message.user("first user"),
            Message.assistant("assistant reply"),
            Message.user("latest user message"),
          ],
          cache: "auto",
        }),
      )

      expect(prepared.body).toMatchObject({
        tools: [{ name: "t1", cache_control: { type: "ephemeral" } }],
        system: [{ type: "text", text: "Sys A", cache_control: { type: "ephemeral" } }],
        messages: [
          { role: "user", content: [{ type: "text", text: "first user" }] },
          { role: "assistant", content: [{ type: "text", text: "assistant reply" }] },
          {
            role: "user",
            content: [{ type: "text", text: "latest user message", cache_control: { type: "ephemeral" } }],
          },
        ],
      })
    }),
  )

  it.effect("'auto' follows the Anthropic Messages protocol on Vertex", () =>
    Effect.gen(function* () {
      const prepared = yield* LLMClient.prepare(
        LLM.request({
          model: vertexAnthropicModel,
          system: "Sys",
          prompt: "hi",
          cache: "auto",
        }),
      )

      expect(prepared.body).toMatchObject({
        system: [{ type: "text", text: "Sys", cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: [{ type: "text", text: "hi", cache_control: { type: "ephemeral" } }] }],
      })
    }),
  )

  it.effect("'auto' is a no-op on OpenAI (implicit caching protocol)", () =>
    Effect.gen(function* () {
      const prepared = yield* LLMClient.prepare(
        LLM.request({
          model: openaiModel,
          system: "Sys",
          prompt: "hi",
          cache: "auto",
        }),
      )

      const body = prepared.body as { messages: Array<{ content: unknown }> }
      // OpenAI doesn't accept cache_control on messages — policy must skip.
      const flat = JSON.stringify(body)
      expect(flat).not.toContain("cache_control")
      expect(flat).not.toContain("cachePoint")
    }),
  )

  it.effect("'auto' is a no-op on Gemini (out-of-band caching protocol)", () =>
    Effect.gen(function* () {
      const prepared = yield* LLMClient.prepare(
        LLM.request({
          model: geminiModel,
          system: "Sys",
          prompt: "hi",
          cache: "auto",
        }),
      )

      const flat = JSON.stringify(prepared.body)
      expect(flat).not.toContain("cache_control")
      expect(flat).not.toContain("cachePoint")
    }),
  )

  it.effect("'auto' on Bedrock emits cachePoint markers in the right places", () =>
    Effect.gen(function* () {
      const prepared = yield* LLMClient.prepare(
        LLM.request({
          model: bedrockModel,
          system: "Sys",
          tools: [{ name: "t1", description: "t1", inputSchema: { type: "object", properties: {} } }],
          messages: [Message.user("first user"), Message.assistant("reply"), Message.user("latest user")],
          cache: "auto",
        }),
      )

      expect(prepared.body).toMatchObject({
        toolConfig: {
          tools: [{ toolSpec: { name: "t1" } }, { cachePoint: { type: "default" } }],
        },
        system: [{ text: "Sys" }, { cachePoint: { type: "default" } }],
        messages: [
          { role: "user", content: [{ text: "first user" }] },
          { role: "assistant", content: [{ text: "reply" }] },
          { role: "user", content: [{ text: "latest user" }, { cachePoint: { type: "default" } }] },
        ],
      })
    }),
  )

  it.effect("'auto' falls back to the latest cacheable message before trailing media on Anthropic", () =>
    Effect.gen(function* () {
      const prepared = yield* LLMClient.prepare(
        LLM.request({
          model: anthropicModel,
          messages: [
            Message.user("cacheable prefix"),
            Message.user({ type: "media", mediaType: "image/png", data: "AAECAw==" }),
          ],
          cache: "auto",
        }),
      )

      const body = prepared.body as { messages: Array<{ content: Array<{ cache_control?: unknown }> }> }
      expect(body.messages[0]?.content[0]?.cache_control).toEqual({ type: "ephemeral" })
      expect(body.messages[1]?.content[0]?.cache_control).toBeUndefined()
    }),
  )

  it.effect("'auto' falls back to the latest cacheable message before trailing media on Bedrock", () =>
    Effect.gen(function* () {
      const prepared = yield* LLMClient.prepare(
        LLM.request({
          model: bedrockModel,
          messages: [
            Message.user("cacheable prefix"),
            Message.user({ type: "media", mediaType: "image/png", data: "AAECAw==" }),
          ],
          cache: "auto",
        }),
      )

      const body = prepared.body as { messages: Array<{ content: Array<{ cachePoint?: unknown }> }> }
      expect(body.messages[0]?.content[1]?.cachePoint).toEqual({ type: "default" })
      expect(body.messages[1]?.content[0]?.cachePoint).toBeUndefined()
    }),
  )

  it.effect("explicit tail policy does not search before trailing media", () =>
    Effect.gen(function* () {
      const prepared = yield* LLMClient.prepare(
        LLM.request({
          model: anthropicModel,
          messages: [
            Message.user("cacheable prefix"),
            Message.user({ type: "media", mediaType: "image/png", data: "AAECAw==" }),
          ],
          cache: { messages: { tail: 1 } },
        }),
      )

      expect(JSON.stringify(prepared.body)).not.toContain("cache_control")
    }),
  )

  it.effect("'auto' advances the Anthropic cache breakpoint through completed tool results", () =>
    Effect.gen(function* () {
      const messages = [
        Message.user("U"),
        Message.assistant([ToolCallPart.make({ id: "call_1", name: "lookup", input: {} })]),
        Message.tool({ id: "call_1", name: "lookup", result: "T1" }),
        Message.assistant([ToolCallPart.make({ id: "call_2", name: "lookup", input: {} })]),
        Message.tool({ id: "call_2", name: "lookup", result: "T2" }),
      ]
      const attempts = yield* Effect.all(
        [1, 3, 5].map((count) => LLMClient.prepare(LLM.request({ model: anthropicModel, messages: messages.slice(0, count) }))),
      )
      const bodies = attempts.map((attempt) => attempt.body as { messages: Array<{ content: Array<{ cache_control?: unknown }> }> })

      expect(bodies[0]?.messages[0]?.content[0]?.cache_control).toEqual({ type: "ephemeral" })
      expect(bodies[1]?.messages[0]?.content[0]?.cache_control).toBeUndefined()
      expect(bodies[1]?.messages[2]?.content[0]?.cache_control).toEqual({ type: "ephemeral" })
      expect(bodies[2]?.messages[2]?.content[0]?.cache_control).toBeUndefined()
      expect(bodies[2]?.messages[4]?.content[0]?.cache_control).toEqual({ type: "ephemeral" })
    }),
  )

  it.effect("'auto' advances the Bedrock cache breakpoint through completed tool results", () =>
    Effect.gen(function* () {
      const messages = [
        Message.user("U"),
        Message.assistant([ToolCallPart.make({ id: "call_1", name: "lookup", input: {} })]),
        Message.tool({ id: "call_1", name: "lookup", result: "T1" }),
        Message.assistant([ToolCallPart.make({ id: "call_2", name: "lookup", input: {} })]),
        Message.tool({ id: "call_2", name: "lookup", result: "T2" }),
      ]
      const attempts = yield* Effect.all(
        [1, 3, 5].map((count) => LLMClient.prepare(LLM.request({ model: bedrockModel, messages: messages.slice(0, count) }))),
      )
      const bodies = attempts.map(
        (attempt) => attempt.body as { messages: Array<{ content: Array<{ cachePoint?: unknown }> }> },
      )

      expect(bodies[0]?.messages[0]?.content[1]?.cachePoint).toEqual({ type: "default" })
      expect(bodies[1]?.messages[0]?.content[1]?.cachePoint).toBeUndefined()
      expect(bodies[1]?.messages[2]?.content[1]?.cachePoint).toEqual({ type: "default" })
      expect(bodies[2]?.messages[2]?.content[1]?.cachePoint).toBeUndefined()
      expect(bodies[2]?.messages[4]?.content[1]?.cachePoint).toEqual({ type: "default" })
    }),
  )

  it.effect("'none' disables auto placement even when manual hints exist", () =>
    Effect.gen(function* () {
      const prepared = yield* LLMClient.prepare(
        LLM.request({
          model: anthropicModel,
          system: "Sys",
          tools: [{ name: "t1", description: "t1", inputSchema: { type: "object", properties: {} } }],
          prompt: "hi",
          cache: "none",
        }),
      )

      expect(prepared.body).toMatchObject({
        tools: [{ name: "t1", cache_control: undefined }],
        system: [{ type: "text", text: "Sys", cache_control: undefined }],
      })
    }),
  )

  it.effect("granular object form: tools-only marks just tools", () =>
    Effect.gen(function* () {
      const prepared = yield* LLMClient.prepare(
        LLM.request({
          model: anthropicModel,
          system: "Sys",
          tools: [{ name: "t1", description: "t1", inputSchema: { type: "object", properties: {} } }],
          prompt: "hi",
          cache: { tools: true },
        }),
      )

      expect(prepared.body).toMatchObject({
        tools: [{ name: "t1", cache_control: { type: "ephemeral" } }],
        system: [{ type: "text", text: "Sys", cache_control: undefined }],
      })
    }),
  )

  it.effect("auto policy preserves manual CacheHints on other parts", () =>
    Effect.gen(function* () {
      const prepared = yield* LLMClient.prepare(
        LLM.request({
          model: anthropicModel,
          system: [
            { type: "text", text: "first system", cache: new CacheHint({ type: "ephemeral", ttlSeconds: 3600 }) },
            { type: "text", text: "last system" },
          ],
          prompt: "hi",
          cache: "auto",
        }),
      )

      const body = prepared.body as { system: Array<{ text: string; cache_control?: unknown }> }
      expect(body.system[0]?.cache_control).toEqual({ type: "ephemeral", ttl: "1h" })
      expect(body.system[1]?.cache_control).toEqual({ type: "ephemeral" })
    }),
  )

  it.effect("four manual hints consume the automatic breakpoint budget", () =>
    Effect.gen(function* () {
      const manual = new CacheHint({ type: "ephemeral" })
      const prepared = yield* LLMClient.prepare(
        LLM.request({
          model: anthropicModel,
          tools: [{ name: "t1", description: "t1", inputSchema: { type: "object", properties: {} } }],
          system: [
            { type: "text", text: "system one", cache: manual },
            { type: "text", text: "system two", cache: manual },
          ],
          messages: [
            new Message({ role: "user", content: [{ type: "text", text: "u1", cache: manual }] }),
            new Message({ role: "assistant", content: [{ type: "text", text: "a1", cache: manual }] }),
            Message.user("u2"),
          ],
          cache: "auto",
        }),
      )

      const body = prepared.body as {
        tools: Array<{ cache_control?: unknown }>
        system: Array<{ cache_control?: unknown }>
        messages: Array<{ content: Array<{ cache_control?: unknown }> }>
      }
      expect(body.tools[0]?.cache_control).toBeUndefined()
      expect(body.system.map((part) => part.cache_control)).toEqual([
        { type: "ephemeral" },
        { type: "ephemeral" },
      ])
      expect(body.messages.map((message) => message.content[0]?.cache_control)).toEqual([
        { type: "ephemeral" },
        { type: "ephemeral" },
        undefined,
      ])
    }),
  )

  it.effect("default auto hints do not precede a manual one-hour hint", () =>
    Effect.gen(function* () {
      const prepared = yield* LLMClient.prepare(
        LLM.request({
          model: anthropicModel,
          tools: [{ name: "t1", description: "t1", inputSchema: { type: "object", properties: {} } }],
          system: [
            {
              type: "text",
              text: "one-hour prefix",
              cache: new CacheHint({ type: "ephemeral", ttlSeconds: 3600 }),
            },
            { type: "text", text: "default prefix" },
          ],
          prompt: "hi",
          cache: "auto",
        }),
      )

      const body = prepared.body as {
        tools: Array<{ cache_control?: unknown }>
        system: Array<{ cache_control?: unknown }>
        messages: Array<{ content: Array<{ cache_control?: unknown }> }>
      }
      expect(body.tools[0]?.cache_control).toBeUndefined()
      expect(body.system.map((part) => part.cache_control)).toEqual([
        { type: "ephemeral", ttl: "1h" },
        { type: "ephemeral" },
      ])
      expect(body.messages[0]?.content[0]?.cache_control).toEqual({ type: "ephemeral" })
    }),
  )

  it.effect("skips an empty trailing system block and marks the previous non-empty block", () =>
    Effect.gen(function* () {
      const prepared = yield* LLMClient.prepare(
        LLM.request({
          model: anthropicModel,
          system: [
            { type: "text", text: "Stable system prefix" },
            { type: "text", text: "" },
          ],
          prompt: "hi",
          cache: { system: true },
        }),
      )

      const body = prepared.body as { system: Array<{ text: string; cache_control?: unknown }> }
      expect(body.system[0]?.cache_control).toEqual({ type: "ephemeral" })
      expect(body.system[1]?.cache_control).toBeUndefined()
    }),
  )

  it.effect("skips an empty trailing user text part and marks the previous non-empty part", () =>
    Effect.gen(function* () {
      const prepared = yield* LLMClient.prepare(
        LLM.request({
          model: anthropicModel,
          messages: [
            new Message({
              role: "user",
              content: [
                { type: "text", text: "Stable user prefix" },
                { type: "text", text: "" },
              ],
            }),
          ],
          cache: { messages: "latest-user-message" },
        }),
      )

      const body = prepared.body as { messages: Array<{ content: Array<{ text?: string; cache_control?: unknown }> }> }
      expect(body.messages[0]?.content[0]?.cache_control).toEqual({ type: "ephemeral" })
      expect(body.messages[0]?.content[1]?.cache_control).toBeUndefined()
    }),
  )

  it.effect("does not add a cache marker when a message contains only empty text", () =>
    Effect.gen(function* () {
      const prepared = yield* LLMClient.prepare(
        LLM.request({
          model: anthropicModel,
          messages: [Message.user("")],
          cache: { messages: "latest-user-message" },
        }),
      )

      expect(JSON.stringify(prepared.body)).not.toContain("cache_control")
    }),
  )

  it.effect("ttlSeconds in the policy flows through to wire markers", () =>
    Effect.gen(function* () {
      const prepared = yield* LLMClient.prepare(
        LLM.request({
          model: anthropicModel,
          system: "Sys",
          prompt: "hi",
          cache: { system: true, ttlSeconds: 3600 },
        }),
      )

      expect(prepared.body).toMatchObject({
        system: [{ type: "text", text: "Sys", cache_control: { type: "ephemeral", ttl: "1h" } }],
      })
    }),
  )

  it.effect("messages: { tail: 2 } marks the last 2 message boundaries", () =>
    Effect.gen(function* () {
      const prepared = yield* LLMClient.prepare(
        LLM.request({
          model: anthropicModel,
          messages: [Message.user("u1"), Message.assistant("a1"), Message.user("u2"), Message.assistant("a2")],
          cache: { messages: { tail: 2 } },
        }),
      )

      const body = prepared.body as { messages: Array<{ content: Array<{ cache_control?: unknown }> }> }
      expect(body.messages[0]?.content[0]?.cache_control).toBeUndefined()
      expect(body.messages[1]?.content[0]?.cache_control).toBeUndefined()
      expect(body.messages[2]?.content[0]?.cache_control).toEqual({ type: "ephemeral" })
      expect(body.messages[3]?.content[0]?.cache_control).toEqual({ type: "ephemeral" })
    }),
  )

  it.effect("'latest-assistant' marks the last assistant message", () =>
    Effect.gen(function* () {
      const prepared = yield* LLMClient.prepare(
        LLM.request({
          model: anthropicModel,
          messages: [Message.user("u1"), Message.assistant("a1"), Message.user("u2")],
          cache: { messages: "latest-assistant" },
        }),
      )

      const body = prepared.body as { messages: Array<{ content: Array<{ cache_control?: unknown }> }> }
      expect(body.messages[0]?.content[0]?.cache_control).toBeUndefined()
      expect(body.messages[1]?.content[0]?.cache_control).toEqual({ type: "ephemeral" })
      expect(body.messages[2]?.content[0]?.cache_control).toBeUndefined()
    }),
  )

  test("returns the same request reference when policy is a no-op (pure function)", () => {
    const request = LLM.request({
      model: anthropicModel,
      prompt: "hi",
      cache: "none",
    })
    expect(applyCachePolicy(request)).toBe(request)
  })
})
