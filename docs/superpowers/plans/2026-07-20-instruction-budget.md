# Instruction Budget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bound all ambient instruction content before it enters prompts or durable context snapshots.

**Architecture:** Add a shared Core renderer with UTF-8 byte accounting and deterministic omission notices, expose one bounded config field in V1/V2, and call the renderer from both Core and legacy instruction loaders.

**Tech Stack:** TypeScript, Effect Schema, Bun test, SHA-256 utility, SystemContext.

## Global Constraints

- Default inline limit is exactly 51,200 bytes.
- Maximum configurable limit is exactly 1,048,576 bytes.
- Never partially inline oversized instruction content.
- Preserve source-change detection using SHA-256.
- Preserve existing discovery and precedence.
- Follow RED -> GREEN -> refactor.
- Commit only after complete verification.

---

### Task 1: Shared bounded renderer

**Files:**
- Create: `packages/core/src/instruction-content.ts`
- Create: `packages/core/test/instruction-content.test.ts`

- [ ] Write RED tests for ASCII/UTF-8 byte accounting, unchanged content, omitted content, stable digests, and read/webfetch notices.
- [ ] Implement the renderer and constants.
- [ ] Run focused tests GREEN.

### Task 2: Config schemas

**Files:**
- Modify: `packages/core/src/config.ts`
- Modify: `packages/core/src/v1/config/config.ts`
- Modify: `packages/core/src/v1/config/migrate.ts`
- Test: relevant config/migration tests.

- [ ] Add RED schema tests for default absence, valid values, zero rejection, and >1MiB rejection.
- [ ] Add `instruction_max_bytes` to V1 and V2 schemas.
- [ ] Preserve the value during V1 migration.
- [ ] Run focused tests GREEN.

### Task 3: Core V2 instruction context

**Files:**
- Modify: `packages/core/src/instruction-context.ts`
- Modify: `packages/core/test/instruction-context.test.ts`

- [ ] Write RED integration test with a >50KiB AGENTS.md.
- [ ] Store bounded content plus original digest/byte metadata.
- [ ] Read the effective config value through Config precedence.
- [ ] Prove baseline and serialized snapshot exclude raw oversized bytes.
- [ ] Run focused tests GREEN.

### Task 4: Legacy instruction path

**Files:**
- Modify: `packages/opencode/src/session/instruction.ts`
- Test: `packages/opencode/test/session/instruction.test.ts`

- [ ] Write RED tests for startup local, remote, and nearby oversized sources.
- [ ] Apply the shared renderer using the effective legacy config value.
- [ ] Preserve existing claims and discovery behavior.
- [ ] Run focused tests GREEN.

### Task 5: Verification and commit

- [ ] Run all instruction and config suites.
- [ ] Run Core, LLM, and OpenCode typechecks.
- [ ] Run migration check.
- [ ] Run native single-platform build with smoke test.
- [ ] Review diff and commit `fix(context): bound ambient instructions`.
