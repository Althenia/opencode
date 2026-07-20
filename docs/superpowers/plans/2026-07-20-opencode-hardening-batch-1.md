# OpenCode Hardening Batch 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce transitive deny ceilings for delegated tasks and lock in current recursion and prompt-cache-safe behavior.

**Architecture:** Extend the existing pure `deriveSubagentSessionPermission` helper to accept the calling agent and append only its deny rules as child-session ceilings. Keep the existing durable Core prompt projection unchanged and prove its serialized model input is stable. Preserve the current pre-permission subagent depth guard and prove global task permission cannot bypass it.

**Tech Stack:** TypeScript, Effect, Bun test, OpenCode V1 task/session permission model, Core V2 session runner.

## Global Constraints

- Follow RED -> GREEN -> refactor.
- Do not inherit parent allow rules into children.
- Do not weaken child-agent denies.
- Do not add shell-command string heuristics.
- Keep user prompt text unchanged.
- Commit only after complete verification.

---

### Task 1: Transitive parent deny ceiling

**Files:**
- Modify: `packages/opencode/src/agent/subagent-permissions.ts`
- Modify: `packages/opencode/src/tool/task.ts`
- Test: `packages/opencode/test/agent/plan-mode-subagent-bypass.test.ts`
- Test: `packages/opencode/test/tool/task.test.ts`

**Interfaces:**
- `deriveSubagentSessionPermission(input)` consumes `parentAgentPermission`, `parentSessionPermission`, and `subagent`.
- It returns session rules containing existing restrictions plus parent deny ceilings.
- Resumed task sessions append newly restrictive ceilings and validate parent/session-agent bindings.

- [ ] Write failing tests proving a parent agent's `edit` and `bash` denies remain denied for a permissive child.
- [ ] Write a failing test proving a resumed child acquires newly restrictive parent ceilings.
- [ ] Run the focused agent and task tests and confirm RED.
- [ ] Extend the helper input and append parent-agent denies after existing inherited session rules.
- [ ] Pass the current caller agent from `TaskTool`.
- [ ] Bind resumed `task_id` values to the original parent and subagent type, and append only new deny ceilings.
- [ ] Run the focused tests and confirm GREEN.
- [ ] Refactor duplicate rule filtering without changing behavior.

### Task 2: Depth guard regression

**Files:**
- Test: `packages/opencode/test/tool/task.test.ts`

**Interfaces:**
- Existing `TaskTool.execute` behavior remains unchanged.

- [ ] Add a test with global `permission.task = allow` and a nested child at the default depth.
- [ ] Assert failure occurs before `ask` and before a grandchild session is created.
- [ ] Run the focused test and confirm GREEN against current code.

### Task 3: Stable queued-message model serialization

**Files:**
- Test: `packages/core/test/session-runner.test.ts`

**Interfaces:**
- Existing Core durable prompt projection remains unchanged.

- [ ] Add a test that captures the first request consuming a queued prompt and a later request containing the same history.
- [ ] Compare the exact queued user message content arrays between requests.
- [ ] Assert neither representation contains `<system-reminder>`.
- [ ] Run the focused test and confirm GREEN against current code.

### Task 4: Complete verification and commit

**Files:**
- All files above plus this design and plan.

- [ ] Run `bun test test/agent/plan-mode-subagent-bypass.test.ts test/tool/task.test.ts` in `packages/opencode`.
- [ ] Run `bun test test/session-runner.test.ts` in `packages/core`.
- [ ] Run complete relevant OpenCode and Core tests.
- [ ] Run both package typechecks.
- [ ] Run `bun run script/migration.ts --check` in `packages/core`.
- [ ] Run `bun run script/build.ts --single --skip-install` in `packages/opencode` and require the binary smoke test to pass.
- [ ] Review `git diff --check` and the staged diff.
- [ ] Commit with `fix(security): enforce task permission ceilings`.
