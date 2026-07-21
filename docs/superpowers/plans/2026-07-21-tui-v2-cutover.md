# TUI V2 Cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fork's legacy TUI runtime with upstream V2 Core/CLI/TUI and port all fork-specific self-improvement, caching, compaction, skill, permission, instruction, and shell-security behavior.

**Architecture:** Upstream `opencode/v2` is the base. `packages/core` is the only execution engine, `packages/ai` owns provider protocol lowering, `packages/server`/`packages/client` expose runtime state, `packages/cli` launches the local service, and `packages/tui` is presentation only. Fork features are ported as V2-native services; deleted `packages/opencode` code is never restored.

**Tech Stack:** Bun, TypeScript, Effect, Drizzle SQLite, OpenTUI/Solid, V2 Core/AI/Server/Client APIs.

## Global Constraints

- TUI-only product target; desktop is deferred.
- Base on current upstream `opencode/v2` and preserve fork behavior through V2-native ports.
- Use TDD: RED test, minimal GREEN implementation, refactor, broad verification, commit.
- Do not restore `packages/opencode` or duplicate session/model/tool logic.
- Provider cache controls must match actual provider protocols and fail no requests on unsupported models.
- OpenRouter response caching is disabled for ordinary agent turns.
- Shell `required` mode fails before permission or spawn if no enforceable backend exists.
- Every stage must leave the TUI buildable and runnable.

---

### Task 1: Establish and lock the upstream V2 baseline

**Files:**
- Modify: `bun.lock` only if installation requires it
- Create: `docs/superpowers/evidence/tui-v2-baseline.md`

**Interfaces:**
- Consumes: upstream V2 branch at migration start
- Produces: verified baseline commands and known upstream failures

- [ ] Run `bun install` in the V2 worktree.
- [ ] Run package typechecks for `packages/core`, `packages/ai`, `packages/server`, `packages/client`, `packages/cli`, and `packages/tui`.
- [ ] Run focused upstream session/TUI tests.
- [ ] Record exact pass/fail evidence and commit the baseline document.

### Task 2: Port self-improvement schemas, persistence, and services

**Files:**
- Port from fork: `packages/schema/src/self-improvement-*.ts`
- Port from fork: `packages/core/src/self-improvement/**`
- Modify: `packages/core/src/config/experimental.ts`
- Modify: `packages/core/src/location-services.ts`
- Modify: `packages/core/src/database/migration.gen.ts`
- Add corresponding Core/Schema tests

**Interfaces:**
- Produces: `SelfImprovementSessionObserver.Service`, automation, admission, evaluation, lifecycle, routing, generated-skill projection, and database tables

- [ ] Add RED schema/config tests for the self-improvement settings.
- [ ] Port schema types and database migrations without generated-schema hand edits where regeneration exists.
- [ ] Port Core services in dependency order: stores → evaluation/learning → lifecycle → generation/automation → observer/projection.
- [ ] Register nodes in the V2 location graph.
- [ ] Run all self-improvement Core/Schema tests and typechecks.
- [ ] Commit the subsystem port.

### Task 3: Connect V2 terminal sessions to automatic observation

**Files:**
- Modify: `packages/core/src/session/runner/**`
- Modify: `packages/core/src/session/projector.ts` only if terminal event data is incomplete
- Test: `packages/core/test/session-runner.test.ts`
- Test: new V2 observer integration test

**Interfaces:**
- Consumes: `SelfImprovementSessionObserver.Service.record`
- Produces: exactly one evidence row per terminal user task

- [ ] Write a RED runner test that completes one V2 task and queries `self_improvement_session_evidence`.
- [ ] Hook observation into the terminal runner lifecycle using `Effect.ensuring`/exit capture so success, failure, and cancellation are classified once.
- [ ] Prove duplicate resume/continuation paths remain idempotent.
- [ ] Verify a disposable SQLite prompt cycle creates evidence automatically.
- [ ] Commit.

### Task 4: Port automatic generation, approval, and generated skills

**Files:**
- Modify: V2 startup/location service graph
- Port: generated-skill projector and discovery registration
- Modify: `packages/core/src/config/plugin/skill.ts`
- Add TUI-independent automation integration tests

**Interfaces:**
- Produces: interval-driven automation and generated skills discoverable by V2 Skill service

- [ ] Write RED tests proving configured automation ticks and promoted generated skills appear in discovery.
- [ ] Register automation lifecycle in the scoped runtime.
- [ ] Preserve ownership marker, atomic replacement, retry, and provenance checks.
- [ ] Verify `automatic`, `auto_approve`, `interval_seconds`, and `evaluation_window_minutes` affect behavior.
- [ ] Commit.

### Task 5: Port V2 correctness and security hardening

**Files:**
- Port/adapt Core changes for task permission ceilings, instruction limits, compaction, generated skills, and shell sandboxing
- Add/update focused tests in Core

**Interfaces:**
- Produces: hardened V2 runtime with no legacy equivalents

- [ ] Reproduce each fork regression against upstream V2 before porting.
- [ ] Skip changes already fixed upstream and add regression coverage where useful.
- [ ] Port only confirmed gaps.
- [ ] Run permission, instruction, compaction, skill, and shell suites.
- [ ] Commit in independently reviewable batches.

### Task 6: Implement provider-aware cache policy

**Files:**
- Create: `packages/core/src/session/cache-policy.ts`
- Modify: `packages/core/src/session/model-request.ts`
- Modify provider lowering in `packages/ai/src/protocols/**` and provider option types only where needed
- Test: Core session request tests and AI protocol tests

**Interfaces:**
- Produces: `SessionCachePolicy.prepare({ session, location, agent, model, tools, system, messages })`
- Returns stable namespace, provider options, cache hints, and diagnostic mechanism

- [ ] Write RED tests for stable namespace independence from random session IDs.
- [ ] Add OpenAI stable `promptCacheKey`.
- [ ] Add OpenRouter stable `promptCacheKey` and `session_id` stickiness; assert response-cache headers are absent.
- [ ] Add Anthropic explicit cache breakpoints on stable tools/system/latest eligible history boundaries with protocol cap.
- [ ] Add Bedrock cache points in tools → system → messages order.
- [ ] Preserve Gemini/implicit-provider stable prefix ordering without fake markers.
- [ ] Ensure deterministic tool/system/message ordering and empty-block skipping.
- [ ] Verify cache read/write usage parsing for all supported protocols.
- [ ] Commit.

### Task 7: Add normalized cache diagnostics

**Files:**
- Create: `packages/core/src/session/cache-diagnostics.ts`
- Modify Core session/info API schemas
- Modify server/client projection
- Modify `packages/tui` session context/status components
- Add Core, Client, and TUI tests

**Interfaces:**
- Produces: context total/limit, uncached input, cache read, cache write, cache-hit ratio, provider mechanism

- [ ] Write RED unit tests proving context occupancy is independent from cache-hit ratio.
- [ ] Add normalized diagnostics to session responses/events.
- [ ] Render separate Context and Cache sections in TUI.
- [ ] Add labels explaining that context occupancy does not decrease on a cache hit.
- [ ] Commit.

### Task 8: Add self-improvement TUI diagnostics and controls

**Files:**
- Add V2 server/client endpoints for status, evidence counts, automation tick state, and generated slots
- Add TUI status/dialog components
- Add endpoint and TUI tests

**Interfaces:**
- Produces: observable automatic engine status without direct SQLite inspection

- [ ] Write RED endpoint tests for enabled state and zero-evidence failure reason.
- [ ] Expose last observation, evidence count, last tick/result, and generated slots.
- [ ] Add a TUI status view and refresh action.
- [ ] Ensure secrets/raw observations are never returned.
- [ ] Commit.

### Task 9: TUI-only packaging and extraction boundary

**Files:**
- Modify root/package scripts and CLI build entries
- Create: `docs/tui-architecture.md`
- Remove/deactivate desktop build dependencies from the TUI release path only

**Interfaces:**
- Produces: standalone TUI binary and documented package extraction graph

- [ ] Add a TUI-only build command.
- [ ] Prove it does not compile or package desktop artifacts.
- [ ] Document required packages and allowed dependency directions for later extraction.
- [ ] Commit.

### Task 10: Final end-to-end verification and main integration

**Files:**
- No feature changes unless a test exposes a defect

- [ ] Run Core, AI, Schema, Server, Client, CLI, and TUI typechecks.
- [ ] Run focused and broad test suites.
- [ ] Build the TUI-only binary.
- [ ] Run a disposable real V2 prompt cycle with automatic self-improvement enabled and verify evidence in SQLite.
- [ ] Run two repeated provider requests in recorded/fake protocol tests and verify stable cache namespace plus normalized cache usage.
- [ ] Confirm no runtime dependency on `packages/opencode`.
- [ ] Review diff, fast-forward `main`, and leave the upstream-based worktree available until user validation.
