import { expect, test } from "bun:test"
import { SessionRunnerCache } from "@opencode-ai/core/session/runner/cache"

const base = {
  projectID: "project",
  directory: "/repo",
  workspaceID: "workspace",
  agentID: "build",
  providerID: "openai",
  modelID: "gpt-5.6",
}

test("builds one stable bounded cache namespace", () => {
  const first = SessionRunnerCache.promptCacheNamespace(base)
  const second = SessionRunnerCache.promptCacheNamespace({ ...base })

  expect(first).toBe(second)
  expect(first).toMatch(/^[0-9a-f]{64}$/)
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
  })) {
    expect(SessionRunnerCache.promptCacheNamespace({ ...base, [key]: value })).not.toBe(baseline)
  }
  expect(SessionRunnerCache.promptCacheNamespace({ ...base, workspaceID: undefined })).not.toBe(baseline)
})
