import { expect, test } from "bun:test"
import { SystemPart, ToolDefinition } from "@opencode-ai/ai"
import { CACHE_POLICY_REVISION } from "@opencode-ai/ai/cache-policy"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { SessionRunnerCache } from "@opencode-ai/core/session/runner/cache"

const base = {
  projectID: "project",
  directory: "/repo",
  workspaceID: "workspace",
  agentID: "build",
  providerID: "openai",
  modelID: "gpt-5.6",
  variant: "default",
  policyRevision: CACHE_POLICY_REVISION,
  permissions: [{ action: "read", resource: "**", effect: "allow" }] satisfies PermissionV2.Ruleset,
  system: [SystemPart.make("System after hook")],
  tools: [
    ToolDefinition.make({
      name: "search",
      description: "Search",
      inputSchema: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
      },
    }),
  ],
} satisfies SessionRunnerCache.PromptCacheNamespaceInput

const namespaceWithSchema = (inputSchema: Readonly<Record<string, unknown>>) =>
  SessionRunnerCache.promptCacheNamespace({
    ...base,
    tools: [
      ToolDefinition.make({
        name: "search",
        description: "Search",
        inputSchema,
      }),
    ],
  })

test("pins the canonical prompt-cache namespace digest", () => {
  expect(SessionRunnerCache.promptCacheNamespace(base)).toBe(
    "a7b8e1c2ae9e5f1771db591cf4866c4c263bf0c5c69665d3df911e2202aa75de",
  )
})

test("canonicalizes object order and preserves JSON array positions", () => {
  const sparse = Array<string | undefined>(2)
  sparse[1] = "tail"
  expect(
    namespaceWithSchema({
      type: "object",
      properties: { b: { type: "string" }, a: { type: "null" } },
    }),
  ).toBe(
    namespaceWithSchema({
      properties: { a: { type: "null" }, b: { type: "string" } },
      type: "object",
    }),
  )
  expect(namespaceWithSchema({ values: sparse })).toBe(namespaceWithSchema({ values: [undefined, "tail"] }))
  expect(namespaceWithSchema({ values: [undefined, "tail"] })).toBe(namespaceWithSchema({ values: [null, "tail"] }))
  expect(namespaceWithSchema({ value: undefined })).toBe(namespaceWithSchema({}))
  expect(namespaceWithSchema({ value: null })).not.toBe(namespaceWithSchema({}))
})

test("uses deterministic code-point ordering for integer-like and non-BMP keys", () => {
  expect(namespaceWithSchema({ "10": "ten", "2": "two", "\u{10000}": "astral", "\u{e000}": "bmp" })).toBe(
    "1eb891bbfc2208cc8ebced61ab2b09c2108bb47615ec44e830c28ca07edb875f",
  )
})

test("rejects unsupported and cyclic schema values instead of aliasing them", () => {
  const cyclic: Record<string, unknown> = {}
  cyclic.self = cyclic

  for (const value of [1n, () => undefined, Symbol("unsupported"), new Date(0), new Map(), new Set(), cyclic]) {
    expect(() => namespaceWithSchema({ value })).toThrow(TypeError)
  }
})

test("isolates every cache sharing dimension", () => {
  const baseline = SessionRunnerCache.promptCacheNamespace(base)
  for (const [key, value] of Object.entries({
    projectID: "other-project",
    directory: "/other",
    workspaceID: "other-workspace",
    agentID: "reviewer",
    providerID: "anthropic",
    modelID: "claude",
    variant: "reasoning",
    policyRevision: "provider-native/v2",
    permissions: [{ action: "read", resource: "**", effect: "deny" }],
    system: [SystemPart.make("Changed by hook")],
    tools: [],
  })) {
    expect(SessionRunnerCache.promptCacheNamespace({ ...base, [key]: value })).not.toBe(baseline)
  }
  expect(SessionRunnerCache.promptCacheNamespace({ ...base, workspaceID: undefined })).not.toBe(baseline)
})
