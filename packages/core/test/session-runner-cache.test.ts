import { expect, test } from "bun:test"
import { promptCacheNamespace } from "@opencode-ai/core/session/runner/cache"

const base = {
  projectID: "prj_alpha",
  directory: "/workspace/app",
  workspaceID: "wrk_main",
  agentID: "build",
  providerID: "openai",
  modelID: "gpt-5.6",
}

test("shares one bounded cache namespace across fresh sessions with the same stable prefix identity", () => {
  const first = promptCacheNamespace(base)
  const second = promptCacheNamespace({ ...base })

  expect(first).toBe(second)
  expect(first).toMatch(/^[0-9a-f]{64}$/)
})

test("isolates cache namespaces across every prefix identity dimension", () => {
  const original = promptCacheNamespace(base)
  const variants = [
    { ...base, projectID: "prj_beta" },
    { ...base, directory: "/workspace/other" },
    { ...base, workspaceID: "wrk_other" },
    { ...base, workspaceID: undefined },
    { ...base, agentID: "plan" },
    { ...base, providerID: "openrouter" },
    { ...base, modelID: "gpt-5.5" },
  ]

  expect(new Set(variants.map(promptCacheNamespace)).size).toBe(variants.length)
  for (const variant of variants) expect(promptCacheNamespace(variant)).not.toBe(original)
})
