# TUI Self-Improvement Closed Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make normal TUI/session prompt cycles automatically produce governed self-improvement observations, control baselines, evaluation samples, generated candidates, and configured automatic approvals.

**Architecture:** Add one location-scoped `SelfImprovementSessionObserver` at the Core session terminal boundary. The observer derives redacted evidence from durable messages, persists idempotent session evidence, freezes a baseline after 20 samples, and feeds open evaluation runs. Extend the existing automation coordinator to seed generation strategy, pass stable pattern metadata, and approve pending requests through existing command boundaries.

**Tech Stack:** TypeScript, Bun, Effect v4, Drizzle SQLite, existing Core session runner and self-improvement services.

## Global Constraints

- Work directly on `main`, as explicitly authorized by the user.
- Use strict RED → GREEN → REFACTOR TDD for every behavior change.
- Do not persist prompt text, assistant text, tool input/output, file content, or raw errors.
- Do not add a TUI-only path or require `opencode serve`.
- Self-improvement failures must not change the session result.
- Reuse existing authorization, approval, idempotency, evaluation, lifecycle, audit, and context services.
- Run tests from package directories, never repository root.
- Run `bun typecheck`, never direct `tsc`.
- Commit only after fresh full verification passes.

---

### Task 1: Durable session evidence and observer

**Files:**
- Create: `packages/core/src/self-improvement/session-evidence.sql.ts`
- Create: `packages/core/src/self-improvement/session-observer.ts`
- Create: `packages/core/test/self-improvement-session-observer.test.ts`
- Modify: `packages/core/src/location-services.ts`
- Modify: generated Core migration/schema files through the documented Drizzle workflow

**Interfaces:**
- Produces `SelfImprovementSessionObserver.Service` with:

```ts
export interface Interface {
  readonly record: (input: {
    readonly sessionID: SessionSchema.ID
    readonly exit: Exit.Exit<void, unknown>
  }) => Effect.Effect<void>
}
```

- Persists one row per `(location_id, task_id_digest)` containing workload, revision, producer ID, sample digest, metric JSON, outcome, started/terminal timestamps, and creation timestamp.

- [ ] **Step 1: Write failing observer tests**

Add tests that construct durable user/assistant messages and prove:

```ts
test("records one privacy-safe observation for a successful prompt cycle", ...)
test("classifies tool failure without storing its raw message", ...)
test("records cancellation as observation-only", ...)
test("replaying the same terminal cycle is idempotent", ...)
test("bootstraps exactly one baseline from twenty unique control samples", ...)
test("adds one sample to each matching open evaluation run", ...)
```

Tests must assert the new table contains no prompt, assistant, tool input/output, file, or error-message columns.

- [ ] **Step 2: Run RED tests**

Run:

```bash
cd packages/core
bun test test/self-improvement-session-observer.test.ts
```

Expected: FAIL because `session-observer.ts` and its SQL table do not exist.

- [ ] **Step 3: Implement the SQL table**

Create a table named `self_improvement_session_evidence` with a unique index on `(location_id, task_id_digest)` and indexes for `(location_id, workload, workload_revision, terminal_at)`.

- [ ] **Step 4: Implement evidence derivation**

Load durable messages for the session, select the latest user message and following assistant messages, then derive:

```ts
const workload = SelfImprovementEvaluation.Workload.make(`agent:${agentID}`)
const workloadRevision = SelfImprovementLifecycle.Revision.make(1)
const taskIDDigest = SelfImprovement.Digest.make(Hash.sha256(`${locationID}\0${user.id}`))
```

Use unique tool names in first-call order. Classify errors only by stable type/tool name. Build deterministic metric components from token totals, timestamps, tool success/failure, and terminal outcome.

- [ ] **Step 5: Implement governed writes**

When `experimental.self_improvement.automatic !== true`, return without side effects. Otherwise:

1. insert session evidence with `onConflictDoNothing`;
2. call `SelfImprovementPrivateEvidenceCommand.createObservation` with a dedicated `runtime-evidence-service` principal;
3. for non-cancelled evidence, bootstrap baseline or append samples to eligible open runs;
4. catch/log all observer failures so the caller remains successful.

- [ ] **Step 6: Implement frozen baseline bootstrap**

For a workload with no baseline, load the earliest 20 unique non-cancelled rows, convert them to in-memory metric samples, aggregate via `SelfImprovementMetrics.aggregate`, idempotently write one deterministic suite revision, then write one deterministic baseline. Treat duplicate suite/baseline conflicts as successful concurrent initialization.

- [ ] **Step 7: Run GREEN tests and migration generation**

Run:

```bash
cd packages/core
bun test test/self-improvement-session-observer.test.ts
bun run db generate
bun typecheck
```

Expected: observer tests PASS, schema/migration generated, typecheck exits 0.

---

### Task 2: Invoke observer from every normal session prompt cycle

**Files:**
- Modify: `packages/core/src/session/runner/llm.ts`
- Modify: `packages/core/test/session-runner.test.ts`

**Interfaces:**
- Consumes `SelfImprovementSessionObserver.node`.
- Produces one observer call after each promoted steer/queue cycle, including terminal failure/interruption.

- [ ] **Step 1: Write failing session-runner test**

Add a deterministic observer layer to the runner fixture and assert a normal prompt cycle records exactly one call with the session ID and terminal exit.

- [ ] **Step 2: Run RED test**

Run:

```bash
cd packages/core
bun test test/session-runner.test.ts --test-name-pattern "records terminal session evidence"
```

Expected: FAIL because the runner never calls the observer.

- [ ] **Step 3: Implement cycle boundary wiring**

Wrap each outer prompt-cycle execution in `Effect.exit`, call `observer.record({ sessionID, exit: Exit.asVoid(exit) })`, then restore the original success/failure/interrupt result. Do not wrap individual provider turns because one prompt may require multiple tool-continuation turns.

- [ ] **Step 4: Add layer dependency**

Add `SelfImprovementSessionObserver.node` to `SessionRunnerLLM.node.deps` and update test graph replacements.

- [ ] **Step 5: Run GREEN and regression tests**

Run:

```bash
cd packages/core
bun test test/session-runner.test.ts test/self-improvement-session-observer.test.ts
bun typecheck
```

Expected: PASS with no unbound layer nodes.

---

### Task 3: Make generation automatically ready and meaningful

**Files:**
- Modify: `packages/core/src/self-improvement/automation.ts`
- Modify: `packages/core/src/self-improvement/generation.ts`
- Modify: `packages/core/test/self-improvement-automation.test.ts`
- Modify: `packages/core/test/self-improvement-generation.test.ts`

**Interfaces:**
- Automation eligible-pattern entries include digest, workload, workload revision, error class, tool-symbol digest, and outcome.
- Generation request accepts the stable pattern metadata and includes it in the model prompt.

- [ ] **Step 1: Write RED tests**

Add tests proving automatic mode:

```ts
test("seeds one default generation strategy idempotently", ...)
test("generates only from eligible failure patterns", ...)
test("passes privacy-safe pattern metadata to generation", ...)
```

- [ ] **Step 2: Run RED tests**

Run:

```bash
cd packages/core
bun test test/self-improvement-automation.test.ts test/self-improvement-generation.test.ts
```

Expected: FAIL because no default arm is seeded and generation receives only a digest.

- [ ] **Step 3: Seed the default arm**

When automatic mode is enabled, idempotently insert one active `GenerationStrategyArm` with revision `1` and strategy ID `generalize-remediation`. Ignore only the exact duplicate conflict.

- [ ] **Step 4: Restrict and enrich eligible patterns**

Change the automation query to use live `failure` observations, group by pattern digest, require three identities, and return the stable metadata from the newest representative row.

- [ ] **Step 5: Enrich generation prompt**

Pass the stable metadata into `SelfImprovementGeneration.generate` and include it in the JSON request. Never include prompt content, assistant content, raw error messages, or tool inputs/outputs.

- [ ] **Step 6: Run GREEN tests**

Run:

```bash
cd packages/core
bun test test/self-improvement-automation.test.ts test/self-improvement-generation.test.ts
bun typecheck
```

Expected: PASS.

---

### Task 4: Governed automatic approval

**Files:**
- Modify: `packages/core/src/config/experimental.ts`
- Modify: `packages/core/src/self-improvement/automation.ts`
- Modify: `packages/core/test/self-improvement-automation.test.ts`
- Modify affected OpenCode configuration tests if schema decoding requires it

**Interfaces:**
- Adds optional `experimental.self_improvement.auto_approve: boolean`.
- Automation dependencies add `listPendingApprovals` and `approve`.

- [ ] **Step 1: Write RED tests**

Add tests proving:

```ts
test("auto approves pending bound requests through the approval command", ...)
test("does not approve when auto_approve is false", ...)
test("isolates one approval failure and continues reconciliation", ...)
```

- [ ] **Step 2: Run RED tests**

Run:

```bash
cd packages/core
bun test test/self-improvement-automation.test.ts
```

Expected: FAIL because the config and approval stage do not exist.

- [ ] **Step 3: Implement pending-request query**

Query location approval requests without a corresponding decision, ordered deterministically and capped at 100.

- [ ] **Step 4: Approve through the existing command**

Use a dedicated location-scoped principal:

```ts
principal(locationID, "location-approver", "self-improvement-automatic-approver")
```

Call `SelfImprovementPrivateArtifactCommand.approve` with the request binding and a deterministic idempotency key. Do not write approval rows directly.

- [ ] **Step 5: Run GREEN tests and typechecks**

Run:

```bash
cd packages/core
bun test test/self-improvement-automation.test.ts
bun typecheck
cd ../opencode
bun typecheck
```

Expected: PASS.

---

### Task 5: End-to-end verification and commit

**Files:**
- Modify/add an OpenCode E2E test only if the existing fixture cannot demonstrate the new session observer path.
- Review all changed files and generated migration/schema output.

- [ ] **Step 1: Run focused Core proof matrix**

```bash
cd packages/core
bun test \
  test/self-improvement-session-observer.test.ts \
  test/self-improvement-automation.test.ts \
  test/self-improvement-generation.test.ts \
  test/self-improvement-keyring.test.ts \
  test/self-improvement-ingress-store.test.ts \
  test/self-improvement-private-evidence-command.test.ts \
  test/session-runner.test.ts \
  test/location-services.test.ts
```

Expected: all PASS.

- [ ] **Step 2: Run full self-improvement E2E/API suites**

```bash
cd packages/opencode
bun test test/server/self-improvement-*.test.ts
```

Expected: all PASS.

- [ ] **Step 3: Run package typechecks**

```bash
cd packages/core && bun typecheck
cd ../opencode && bun typecheck
```

Expected: exit 0 for both.

- [ ] **Step 4: Run native production build and smoke test**

```bash
cd packages/opencode
bun run build --single --skip-install
```

Expected: `Smoke test passed` for the current platform binary.

- [ ] **Step 5: Review exact change set**

```bash
git status --short
git diff --check
git diff --stat
git diff
```

Expected: only intended source, test, migration/schema, and design/plan files.

- [ ] **Step 6: Commit**

```bash
git add <intended-files>
git commit -m "feat(core): connect sessions to self improvement"
```

- [ ] **Step 7: Post-commit verification**

Re-run the focused Core matrix, OpenCode self-improvement suites, both typechecks, and `git status --short --branch`. Report the commit hash and any intentionally remaining uncommitted files.
