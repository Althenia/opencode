# Final Runtime Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish every remaining OpenCode V2/TUI deliverable: deterministic TUI builds, quiet preview updates, verified YOLO/Goal autonomy, completed subagent model display, clean verification, and a healthy rebuilt background service.

**Architecture:** Keep build data local and versioned so normal builds never depend on live network availability. Keep update policy and autonomy decisions behind small pure functions with focused tests, then prove the complete behavior through the compiled runtime smoke. Preserve unrelated user-owned work and commit each coherent slice independently.

**Tech Stack:** TypeScript, Bun, Effect, SolidJS/OpenTUI, SQLite, generated Effect/Promise clients.

## Global Constraints

- Do not weaken explicit deny rules, inherited permission ceilings, sandbox restrictions, or policy blocks in YOLO or Goal mode.
- Goal continuation must remain durable, idempotent, bounded by iteration/no-progress limits, and stop on the explicit completion marker.
- Normal TUI builds must not fetch Models.dev or require the user to supply a JSON path.
- Preview builds whose version begins with `0.0.0-` must not query npm for automatic updates.
- Do not modify or stage the unrelated `.gitignore` change.
- Remove only generated repository-local runtime state known to have been created during verification.
- Use red-green tests before production changes and run fresh verification before every completion claim.

---

### Task 1: Deterministic Embedded Model Snapshot

**Files:**
- Create: `packages/cli/script/models-dev.snapshot.json`
- Create: `packages/cli/script/models-snapshot.ts`
- Create: `packages/cli/script/models-snapshot.test.ts`
- Create: `packages/cli/script/refresh-models.ts`
- Modify: `packages/cli/script/generate.ts`
- Modify: `packages/cli/package.json`
- Modify: `package.json`

**Interfaces:**
- Produces: `readModelsSnapshot(file: string): Promise<string>` and `fetchModelsSnapshot(url: string, fetcher?: typeof fetch): Promise<string>`.
- Build imports `modelsData` from `generate.ts`, which reads `MODELS_DEV_API_JSON` when explicitly supplied and otherwise reads the committed snapshot.

- [ ] Add tests proving valid snapshots load, invalid JSON/object shapes fail clearly, non-2xx refresh responses fail, and normal `generate.ts` loading does not call the network.
- [ ] Run `bun test script/models-snapshot.test.ts` from `packages/cli` and confirm RED.
- [ ] Copy the latest validated `/tmp/models-dev-api.json` into the committed snapshot file.
- [ ] Implement snapshot validation and bounded refresh fetching with `AbortSignal.timeout(30_000)`.
- [ ] Change `generate.ts` to read the explicit environment path or committed snapshot only; remove the default live fetch.
- [ ] Add `refresh:models` scripts that explicitly refresh the committed snapshot.
- [ ] Run the focused tests, CLI typecheck, and a normal `bun run build:tui` without `MODELS_DEV_API_JSON`.
- [ ] Commit as `fix(build): make model snapshot deterministic`.

### Task 2: Suppress Preview Update Checks

**Files:**
- Modify: `packages/cli/src/services/updater.ts`
- Modify: `packages/cli/src/services/updater.test.ts`

**Interfaces:**
- Produces: `updateCheckSkipReason(input): "local-install" | "disabled" | "preview-build" | undefined`.

- [ ] Add tests proving `0.0.0-main-*` and other `0.0.0-*` builds skip checks, release versions remain eligible, local builds skip, and the disable environment flag skips.
- [ ] Run `bun test src/services/updater.test.ts` and confirm RED.
- [ ] Implement the pure skip-reason function and use it at the start of `Updater.check`.
- [ ] Run focused tests and CLI typecheck.
- [ ] Commit as `fix(cli): skip preview update checks`.

### Task 3: YOLO and Goal Correctness Gate

**Files:**
- Modify: `packages/core/test/permission.test.ts`
- Modify: `packages/core/test/question.test.ts`
- Modify: `packages/core/test/form.test.ts`
- Modify: `packages/core/test/session-execution.test.ts` only if a core execution defect is exposed
- Modify: `packages/cli/script/runtime-smoke.ts`
- Modify production autonomy files only when a new regression fails for a real behavioral defect.

**Interfaces:**
- YOLO/Goal permission behavior: convert only `ask` to `allow`; preserve explicit/inherited `deny`.
- Question behavior: deterministic first option or safest-default text, with no pending prompt.
- Form behavior: deterministic valid answer only; unsafe required fields stay interactive.
- Compiled Goal behavior: API set/get, first assistant question, synthetic user-proxy continuation, explicit completion marker, final durable completed state.

- [ ] Add focused permission tests for YOLO auto-allow, explicit deny preservation, and Goal permission-ceiling preservation.
- [ ] Add Question tests for YOLO and Goal automatic answers with no pending requests.
- [ ] Add Form tests proving Goal auto-answer parity and safe fallback to interactive behavior.
- [ ] Extend the compiled runtime smoke to round-trip YOLO mode and execute a complete two-turn Goal session through the real API, provider adapter, execution settlement, durable state, and completion marker.
- [ ] Run focused Core tests and the compiled runtime smoke; fix only defects exposed by these tests.
- [ ] Run Protocol, Server, Client, Core, CLI, and TUI autonomy-related type/tests.
- [ ] Commit as `test(runtime): prove yolo and goal autonomy` or a `fix(runtime)` commit if production changes are required.

### Task 4: Complete Subagent Model Display

**Files:**
- Modify: `packages/tui/src/routes/session/composer/subagents-tab.tsx`
- Create: `packages/tui/test/cli/tui/subagents-tab.test.tsx`
- Add: `docs/superpowers/specs/2026-07-22-subagent-model-display-design.md`
- Add: `docs/superpowers/plans/2026-07-22-subagent-model-display.md`

**Interfaces:**
- `formatSubagentModel(model): string | undefined`
- `SubagentMetadata` keeps provider/model/variant and status on one row with constrained model width.

- [ ] Run the five focused Subagents tests.
- [ ] Fix any renderer/layout/type failures without changing session/protocol contracts.
- [ ] Run TUI typecheck and full TUI tests.
- [ ] Review the design/plan for placeholders and consistency.
- [ ] Commit the implementation, tests, design, and plan as one coherent UI slice.

### Task 5: Repository Hygiene and Exhaustive Verification

**Files:**
- Remove generated: `.config/opencode/service-*.json`
- Preserve unstaged: `.gitignore`

- [ ] Remove repository-local generated service registration and confirm no build/test verifier directories remain.
- [ ] Run `git diff --check` and changed-file lint.
- [ ] Run package typechecks for Core, Protocol, Server, Client, CLI, and TUI.
- [ ] Run full Core, CLI, and TUI suites sequentially; isolate process-heavy files only if the connector time cap requires it.
- [ ] Build the TUI using the committed model snapshot.
- [ ] Run `smoke:tui` and the expanded `smoke:runtime`.
- [ ] Restart the real-profile managed service from the rebuilt artifact.
- [ ] Verify authenticated health, real-location startup latency, steady-state CPU/RSS, and absence of new database-lock/watcher/update-noise errors.
- [ ] Commit any verification-only test hardening separately.
- [ ] Confirm final status contains only the unrelated `.gitignore` modification.
