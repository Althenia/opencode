# OpenCode Hardening Sweep Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve the remaining compaction, generated-skill, and shell-isolation findings with backward-compatible, test-driven changes.

**Architecture:** Implement five independent batches with narrow interfaces and commits. Reuse existing configuration, instruction, skill, self-improvement, process, and sandbox abstractions; add only the smallest missing boundary for each confirmed defect.

**Tech Stack:** TypeScript, Bun, Effect, SQLite/Drizzle, OpenCode Core V2 and legacy runtime, native build scripts.

## Global Constraints

- Follow RED -> GREEN -> refactor for every behavior change.
- Keep prompt/cache prefixes deterministic.
- Preserve backward compatibility unless an unsafe configuration explicitly requests a guarantee the runtime cannot provide.
- Never overwrite user-authored skills.
- Do not use command-string filtering as a shell security boundary.
- Commit every independently verified batch.

---

### Task 1: Normalize Legacy Compaction Headroom

**Files:**
- Modify: `packages/opencode/src/session/overflow.ts`
- Modify: `packages/opencode/test/session/compaction.test.ts`

**Interfaces:**
- Consumes: `Provider.Model.limit.context`, optional `limit.input`, configured compaction reserve.
- Produces: `usable(input): number` using `min(explicitInput, contextMinusReserve)` when both limits exist.

- [ ] Write failing tests replacing the three current `BUG:` assertions with the desired symmetric behavior.
- [ ] Run the focused legacy compaction tests and verify failure reflects the current asymmetric formula.
- [ ] Implement the minimum bounded-budget formula.
- [ ] Run focused and full compaction tests.
- [ ] Run OpenCode typecheck.
- [ ] Commit `fix(compaction): normalize input headroom`.

### Task 2: Preserve One Continuation After Successful Compaction

**Files:**
- Modify: `packages/opencode/src/session/compaction.ts`
- Modify: `packages/opencode/src/session/prompt.ts` only if loop state requires an explicit marker.
- Modify: `packages/opencode/test/session/compaction.test.ts`
- Add or modify an `opencode run` E2E test under `packages/opencode/test/cli/` or the closest existing run-command suite.

**Interfaces:**
- Consumes: compaction result, `input.auto`, replay state, plugin auto-continuation decision.
- Produces: exactly one synthetic continuation or replayed user turn after successful automatic compaction.

- [ ] Write a failing integration test where an ordinary turn overflows, compaction succeeds, and the run loop must perform one final turn instead of exiting.
- [ ] Verify the test fails on current behavior.
- [ ] Implement the smallest loop/continuation correction with an explicit one-shot marker if needed.
- [ ] Add a regression preventing an infinite compaction-continuation cycle.
- [ ] Run full compaction and run-command suites.
- [ ] Run OpenCode typecheck.
- [ ] Commit `fix(compaction): continue after successful summary`.

### Task 3: Add Bounded Compaction Constraint Context

**Files:**
- Create: `packages/core/src/session/compaction-constraints.ts` if a shared pure boundary is useful.
- Modify: `packages/core/src/session/compaction.ts`
- Modify: `packages/core/src/session/runner/llm.ts`
- Modify: `packages/opencode/src/session/compaction.ts`
- Modify focused Core and legacy compaction tests.

**Interfaces:**
- Produces: `assembleCompactionConstraints(parts, maxBytes): readonly string[]` or equivalent bounded request system parts.
- Includes durable active rules; excludes volatile environment data, MCP tool descriptions, and full tool schemas.

- [ ] Write failing tests proving Core and legacy compaction summaries receive bounded durable constraints.
- [ ] Add tests proving oversized aggregate constraints are deterministically omitted/truncated with a notice and do not exceed the configured budget.
- [ ] Implement the pure bounded assembler.
- [ ] Wire Core V2 to pass active system context into summary requests without duplicating conversation history.
- [ ] Wire legacy compaction to include bounded agent/instruction/skill rules through existing services.
- [ ] Run Core runner/compaction and legacy compaction suites.
- [ ] Run Core and OpenCode typechecks.
- [ ] Commit `fix(compaction): preserve bounded constraints`.

### Task 4: Materialize Promoted Generated Skills

**Files:**
- Inspect and modify the self-improvement context reconciler/store under `packages/core/src/self-improvement/`.
- Inspect and modify skill discovery under `packages/core/src/skill/` and legacy equivalents if both are active.
- Add a focused generated-skill materializer module and tests.
- Add configuration/schema only if the generated root must be overridden.

**Interfaces:**
- Produces atomic filesystem reconciliation for active promoted skill artifacts.
- Default root: `<global config>/generated/<stable-name>/SKILL.md`.
- Frontmatter contains artifact ID, version ID, source, and ownership marker.

- [ ] Write failing tests for promotion materialization, idempotency, update, rollback/removal, collision isolation, and write-failure isolation.
- [ ] Implement stable names and atomic temp-file rename.
- [ ] Register the generated root with normal skill discovery.
- [ ] Ensure only owned generated files are deleted or replaced.
- [ ] Add observability for reconciliation failures without failing ordinary prompts.
- [ ] Run self-improvement, skill-discovery, context-reconciler, and server E2E suites.
- [ ] Run Core/OpenCode typechecks, migration check if needed, and build smoke test.
- [ ] Commit `feat(skills): materialize promoted generated skills`.

### Task 5: Enforce Optional Required Shell Sandboxing

**Files:**
- Inspect existing process/sandbox services under `packages/core/src/process/`, `packages/core/src/tool/bash.ts`, and configuration schemas.
- Create or modify a small sandbox-capability interface.
- Add tests for supported, unavailable, optional, and required modes.

**Interfaces:**
- New configuration: a backward-compatible shell sandbox mode such as `optional | required | disabled`, aligned with existing config conventions.
- Required mode rejects before spawn when no enforceable sandbox backend is available.
- Optional mode uses a backend when available and otherwise preserves current behavior with diagnostics.

- [ ] Write failing tests for fail-closed required mode and successful sandbox delegation.
- [ ] Implement capability detection and pre-spawn enforcement.
- [ ] Reuse an existing OS/container sandbox backend when present; do not introduce regex allowlisting.
- [ ] Document unsupported-platform behavior in config descriptions and errors.
- [ ] Run bash/process/security suites and typechecks.
- [ ] Run native build smoke test.
- [ ] Commit `feat(security): require enforceable shell sandboxing`.

### Task 6: Final Verification and Integration

- [ ] Run all affected Core, LLM, and OpenCode suites from Tasks 1-5.
- [ ] Run `bun typecheck` in `packages/core`, `packages/llm`, and `packages/opencode`.
- [ ] Run the repository-defined migration verification script.
- [ ] Run `bun run build --single --skip-install` in `packages/opencode` and execute the built binary with `--version`.
- [ ] Remove generated cache debris only.
- [ ] Verify clean git status and inspect commit list.
- [ ] Fast-forward or merge the isolated branch into `main` without rewriting the four existing commits.
