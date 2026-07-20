# Prompt Cache Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve cross-session prompt-cache reuse and eliminate prefix instability and invalid cache markers.

**Architecture:** Add one pure cache-namespace helper used by the Core session runner, canonicalize ToolRegistry output, extend OpenRouter options with `session_id`, and make automatic cache breakpoint placement require non-empty content.

**Tech Stack:** TypeScript, Effect, Bun test, OpenAI Responses, OpenRouter Chat, Anthropic Messages, Bedrock Converse.

## Global Constraints

- Preserve model-visible message text and tool semantics.
- Keep five-minute TTL as the default.
- Do not include session IDs in shared cache namespaces.
- Maintain exact location, agent, provider, and model isolation.
- Follow RED -> GREEN -> refactor.
- Commit only after complete verification.

---

### Task 1: Stable cache namespace

**Files:**
- Create: `packages/core/src/session/runner/cache.ts`
- Modify: `packages/core/src/session/runner/llm.ts`
- Modify: `packages/opencode/src/session/llm.ts`
- Modify: `packages/opencode/src/session/llm/request.ts`
- Modify: `packages/opencode/src/provider/transform.ts`
- Test: `packages/core/test/session-runner-cache.test.ts`
- Test: `packages/core/test/session-runner.test.ts`

- [ ] Write pure RED tests for stable same-location keys and isolation dimensions.
- [ ] Implement SHA-256 namespace generation.
- [ ] Replace session-derived OpenAI cache keys and add OpenRouter `sessionID`.
- [ ] Pass the same namespace through the legacy AI-SDK path without changing affinity headers.
- [ ] Update integration tests to prove fresh sessions share one key.

### Task 2: OpenRouter sticky routing

**Files:**
- Modify: `packages/llm/src/providers/openrouter.ts`
- Test: `packages/llm/test/provider/openrouter.test.ts`

- [ ] Write RED test expecting top-level `session_id`.
- [ ] Add typed `sessionID` option and lower it to `session_id`.
- [ ] Run focused test GREEN.

### Task 3: Deterministic tool ordering

**Files:**
- Modify: `packages/core/src/tool/registry.ts`
- Test: `packages/core/test/session-runner-tool-registry.test.ts`

- [ ] Write RED test registering tools in reverse order and expecting lexical definitions.
- [ ] Sort filtered registrations before materialization.
- [ ] Run focused test GREEN.

### Task 4: Non-empty cache breakpoints

**Files:**
- Modify: `packages/llm/src/cache-policy.ts`
- Test: `packages/llm/test/cache-policy.test.ts`

- [ ] Write RED tests for empty and whitespace-only system and user blocks.
- [ ] Select only non-empty text/content targets for automatic hints.
- [ ] Preserve manual valid hints.
- [ ] Run cache policy and Anthropic/Bedrock tests GREEN.

### Task 5: Verification and commit

- [ ] Run focused suites for all four tasks.
- [ ] Run Core session runner and tool registry suites.
- [ ] Run LLM cache and provider suites.
- [ ] Run Core, LLM, and OpenCode typechecks.
- [ ] Run migration check.
- [ ] Run native build with binary smoke test.
- [ ] Review diff and commit `perf(cache): stabilize prompt prefixes`.
