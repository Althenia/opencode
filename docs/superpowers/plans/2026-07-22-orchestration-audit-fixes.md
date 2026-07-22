# Orchestration Audit Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make durable subagent orchestration authoritative from contracts through TUI, bound all persisted inputs, make notification recovery predictable, add executable acceptance coverage, and restore blocking lint gates.

**Architecture:** Shared Schema contracts own every byte limit and are reused by Protocol, Core, generated clients, and tools. Core exposes effective permission evaluation and child-identity errors, while the notifier processes bounded batches. The TUI stores and renders durable `SessionOrchestrationTask` projections and invokes durable cancellation. Server and compiled smoke tests prove the public path.

**Tech Stack:** TypeScript, Bun, Effect, Effect Schema, Drizzle SQLite, SolidJS, OpenTUI, generated HTTP clients.

## Global Constraints

- Work only in V2 packages; do not modify `packages/opencode`.
- Use TDD: failing test first, verify RED, implement minimally, verify GREEN, then refactor.
- Preserve the user-owned root `.gitignore` change; never stage it.
- Subagents tab contains only durable managed tasks.
- UTF-8 limits: description 4 KiB; prompt/message/answer text 64 KiB; JSON 8 KiB; failure text 16 KiB; tool-call ID 512 bytes.
- Fix all blocking lint errors and all Effect-pattern errors; leave non-blocking legacy warnings out of scope.
- Regenerate public clients after Protocol changes; do not edit generated Client files manually.
- No new dependencies.

---

### Task 1: Bound orchestration contracts and regenerate clients

**Files:**
- Modify: `packages/schema/src/session-orchestration.ts`
- Modify: `packages/schema/test/session-orchestration.test.ts`
- Modify: `packages/protocol/src/groups/session.ts`
- Modify: `packages/protocol/test/session-orchestration.test.ts`
- Regenerate: `packages/client/src/promise/generated/*`
- Regenerate: `packages/client/src/effect/generated/*`
- Regenerate: `packages/client/src/effect/api/api.ts`
- Regenerate: `packages/sdk/js/src/v2/gen/*`
- Test: `packages/client/test/promise.test.ts`
- Test: `packages/client/test/effect.test.ts`
- Test: `packages/sdk/js/test/session-history.test.ts`

**Interfaces:**
- Produces: `SessionOrchestration.DescriptionText`, `PromptText`, `ControlText`, `ToolCallID`, `FailureText`, and `AnswerData` schemas.
- Produces: Protocol DTOs built from those exact schemas.
- Consumers: Core orchestration, tools, server handlers, TUI generated client types, runtime smoke.

- [ ] **Step 1: Add failing Schema byte-boundary tests**

Add cases that accept exact limits and reject one-byte-over values, including multibyte UTF-8:

```ts
const bytes = (count: number) => "a".repeat(count)
const euros = (bytes: number) => "€".repeat(Math.floor(bytes / 3))

expect(Schema.decodeUnknownSync(SessionOrchestration.DescriptionText)(bytes(4 * 1024))).toHaveLength(4 * 1024)
expect(() => Schema.decodeUnknownSync(SessionOrchestration.DescriptionText)(bytes(4 * 1024 + 1))).toThrow()
expect(() => Schema.decodeUnknownSync(SessionOrchestration.DescriptionText)(euros(4 * 1024 + 3))).toThrow()
expect(() => Schema.decodeUnknownSync(SessionOrchestration.ToolCallID)(bytes(513))).toThrow()
expect(() => Schema.decodeUnknownSync(SessionOrchestration.PromptText)(bytes(64 * 1024 + 1))).toThrow()
expect(() => Schema.decodeUnknownSync(SessionOrchestration.FailureText)(bytes(16 * 1024 + 1))).toThrow()
expect(() =>
  Schema.decodeUnknownSync(SessionOrchestration.AnswerData)({ value: bytes(8 * 1024) }),
).toThrow()
```

Also assert `Control`, `Answer`, `Task`, and `Change` reject oversized nested fields.

- [ ] **Step 2: Run Schema tests and verify RED**

Run:

```bash
cd packages/schema
bun test test/session-orchestration.test.ts
```

Expected: FAIL because the named bounded schemas do not exist and current unrestricted fields accept oversized values.

- [ ] **Step 3: Implement reusable byte-bounded schemas**

In `session-orchestration.ts`, keep the current UTF-8 helper and add:

```ts
const boundedText = (bytes: number) => Schema.String.check(maxBytes(bytes))
const boundedJson = (bytes: number) =>
  Schema.Json.check(
    Schema.makeFilter((value) => encoder.encode(JSON.stringify(value)).byteLength <= bytes, {
      expected: `JSON totaling at most ${bytes} UTF-8 bytes`,
    }),
  )

export const DescriptionText = boundedText(4 * 1024)
export const PromptText = boundedText(64 * 1024)
export const ControlText = boundedText(64 * 1024)
export const ToolCallID = boundedText(512)
export const FailureText = boundedText(16 * 1024)
export const AnswerData = boundedJson(8 * 1024)
```

Use these schemas in `Task.description`, `Control.send.text`, `Control.answer.text/data`, `Answer`, `Change.launched`, and `Change.failed.error`. Keep progress/question/excerpt limits unchanged.

- [ ] **Step 4: Reuse Schema contracts in Protocol**

Replace unrestricted launch/message/answer fields:

```ts
export const SessionSubagentLaunch = Schema.Struct({
  parentAssistantMessageID: SessionMessage.ID,
  toolCallID: SessionOrchestration.ToolCallID,
  agent: Agent.ID,
  description: SessionOrchestration.DescriptionText,
  prompt: SessionOrchestration.PromptText,
  background: Schema.Boolean.pipe(Schema.optional),
  model: Model.Ref.pipe(Schema.optional),
})

export const SessionSubagentMessage = Schema.Struct({
  messageID: SessionMessage.ID,
  text: SessionOrchestration.ControlText,
  delivery: SessionDelivery.Delivery,
})

export const SessionSubagentAnswer = Schema.Struct({
  text: SessionOrchestration.ControlText.pipe(Schema.optional),
  data: SessionOrchestration.AnswerData.pipe(Schema.optional),
})
```

Add Protocol tests for exact-limit acceptance and over-limit rejection.

- [ ] **Step 5: Run Schema and Protocol tests**

```bash
(cd packages/schema && bun test test/session-orchestration.test.ts)
(cd packages/protocol && bun test test/session-orchestration.test.ts)
```

Expected: PASS.

- [ ] **Step 6: Regenerate Client and SDK surfaces**

```bash
(cd packages/client && bun run generate)
(cd packages/sdk/js && bun run build)
```

Update only hand-written contract tests to assert oversized calls are rejected before fetch where the generated decoder enforces it.

- [ ] **Step 7: Verify generated drift and package tests**

```bash
(cd packages/client && bun run check:generated)
(cd packages/client && bun test test/promise.test.ts test/effect.test.ts)
(cd packages/sdk/js && bun test test/session-history.test.ts)
```

Expected: PASS and no generated diff after regeneration.

- [ ] **Step 8: Commit**

```bash
git add packages/schema packages/protocol packages/client packages/sdk/js
git commit -m "fix(protocol): bound subagent orchestration payloads"
```

---

### Task 2: Align effective permissions and error identities

**Files:**
- Modify: `packages/core/src/permission.ts`
- Modify: `packages/core/src/session/orchestration.ts`
- Modify: `packages/core/src/tool/subagent.ts`
- Modify: `packages/core/test/permission.test.ts`
- Modify: `packages/core/test/session-orchestration.test.ts`
- Modify: `packages/core/test/tool-subagent.test.ts`

**Interfaces:**
- Produces: `PermissionV2.evaluateEffective(input): Effect<Permission.Effect, SessionNotFoundError>`.
- Produces: `SessionOrchestration.TaskNotFoundError { childID }` for child-internal operations.
- Consumers: subagent context hook, report tool, execution settlement, server/tool error mapping.

- [ ] **Step 1: Add failing effective-permission test**

Create a Session whose selected agent allows `subagent:reviewer` but whose Session ceiling denies it. Assert:

```ts
expect(
  yield* permission.evaluateEffective({
    sessionID,
    agent: AgentV2.ID.make("build"),
    action: "subagent",
    resource: "reviewer",
  }),
).toBe("deny")
```

Also cover saved allow rules and an ordinary ask result.

- [ ] **Step 2: Run permission test and verify RED**

```bash
cd packages/core
bun test test/permission.test.ts --test-name-pattern "effective permission"
```

Expected: FAIL because `evaluateEffective` is absent.

- [ ] **Step 3: Implement `evaluateEffective` from the same rule path as `assert`**

Add to the service interface and implementation:

```ts
readonly evaluateEffective: (input: {
  sessionID: SessionSchema.ID
  agent?: AgentV2.ID
  action: string
  resource: string
}) => Effect.Effect<Permission.Effect, SessionErrors.NotFoundError>
```

Implementation must call the existing effective rule loader and return the same deny/ask/allow result used by `assert`, including saved rules and deny ceilings. Refactor only enough to share the decision function; do not duplicate rule ordering.

- [ ] **Step 4: Add failing available-subagent filtering test**

In `tool-subagent.test.ts`, create two subagents, apply a Session deny ceiling to one, render the context hook, and assert the denied agent is absent from `Available subagents` while the allowed agent remains.

- [ ] **Step 5: Update the subagent context hook**

Replace direct `PermissionV2.evaluate(...selected.permissions)` filtering with:

```ts
const permitted = yield* Effect.forEach(agents, (candidate) =>
  permission
    .evaluateEffective({
      sessionID: event.sessionID,
      agent: event.agent,
      action: name,
      resource: candidate.id,
    })
    .pipe(Effect.map((effect) => ({ candidate, effect }))),
)
```

Keep only non-primary, visible candidates whose effect is not `deny`.

- [ ] **Step 6: Add failing child-only not-found tests**

Assert `progress`, `question`, `settle`, and `background` return:

```ts
{ _tag: "SessionOrchestration.TaskNotFoundError", childID }
```

and never fabricate a `parentID`.

- [ ] **Step 7: Implement `TaskNotFoundError` and update error unions**

```ts
export class TaskNotFoundError extends Schema.TaggedErrorClass<TaskNotFoundError>()(
  "SessionOrchestration.TaskNotFoundError",
  { childID: SessionSchema.ID },
) {}
```

Use it only for child-internal operations. Keep ownership errors for parent-facing controls.

- [ ] **Step 8: Run focused Core tests**

```bash
cd packages/core
bun test test/permission.test.ts test/session-orchestration.test.ts test/tool-subagent.test.ts
bun run typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/core/src/permission.ts packages/core/src/session/orchestration.ts packages/core/src/tool/subagent.ts packages/core/test/permission.test.ts packages/core/test/session-orchestration.test.ts packages/core/test/tool-subagent.test.ts
git commit -m "fix(core): align subagent permissions and errors"
```

---

### Task 3: Bound notification recovery and quarantine deterministic conflicts

**Files:**
- Modify: `packages/core/src/session/orchestration-notifier.ts`
- Modify: `packages/core/test/tool-subagent.test.ts`

**Interfaces:**
- Produces: `NotificationBatchSize = 100`.
- Produces: `dispatch: Effect<void>` that drains all work asynchronously in bounded queries.
- Deterministic `SyntheticConflictError` records are marked delivered after logging; missing-parent records remain undelivered.

- [ ] **Step 1: Add failing batch and poison-record tests**

Seed 205 undelivered notifications and instrument synthetic admission. Assert:

```ts
expect(maxConcurrentBatchRows).toBeLessThanOrEqual(100)
expect(admittedNotifications).toHaveLength(205)
```

Seed a deterministic notification ID conflict and assert a second dispatch does not retry it. Seed a missing-parent notification and assert it remains undelivered.

- [ ] **Step 2: Run notifier tests and verify RED**

```bash
cd packages/core
bun test test/tool-subagent.test.ts --test-name-pattern "notification batch|poison notification"
```

Expected: FAIL because the notifier uses one unbounded `.all()` query and retries deterministic conflicts forever.

- [ ] **Step 3: Implement bounded batch loading**

Add:

```ts
export const NotificationBatchSize = 100
```

Change the query to `.limit(NotificationBatchSize)`. Make one internal `dispatchBatch` return the loaded row count. `dispatch` repeatedly schedules another batch when the count equals the limit, yielding between batches so startup and event handling remain responsive.

- [ ] **Step 4: Make startup non-blocking**

Replace synchronous startup drain:

```ts
yield* dispatch
```

with a scoped background fork:

```ts
yield* dispatch.pipe(Effect.forkScoped({ startImmediately: true }))
```

The event subscription remains scoped and serialized through the existing keyed mutex.

- [ ] **Step 5: Quarantine deterministic conflicts**

Return a tagged dispatch outcome:

```ts
type Admission = "admitted" | "retry" | "quarantined"
```

- `Session.NotFoundError` => `retry` and leave undelivered.
- `Session.SyntheticConflictError` => log error, mark delivered with `time_delivered`, and return `quarantined`.
- successful admission => wake parent, mark delivered, return `admitted`.

- [ ] **Step 6: Run focused tests and typecheck**

```bash
cd packages/core
bun test test/tool-subagent.test.ts
bun run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/session/orchestration-notifier.ts packages/core/test/tool-subagent.test.ts
git commit -m "fix(core): bound subagent notification recovery"
```

---

### Task 4: Make the TUI use durable managed tasks

**Files:**
- Modify: `packages/tui/src/context/data.tsx`
- Modify: `packages/tui/src/routes/session/composer/subagents-tab.tsx`
- Modify: `packages/tui/test/cli/tui/subagents-tab.test.tsx`
- Modify or create fixture support under `packages/tui/test/fixture/`

**Interfaces:**
- Produces: `data.session.subagent.list(parentID)`, `.sync(parentID)`, `.invalidate(parentID)`.
- Store shape: `session.subagent: Record<string, SessionOrchestrationTask[]>`.
- The tab invokes `client.api.session.subagent.cancel({ parentID, childID })` only.

- [ ] **Step 1: Add failing data-store projection tests**

Create a TUI data-context test that returns two tasks from `session.subagent.list`, then emits `session.task.updated`. Assert the parent task list is resynchronized and contains durable `waiting`/terminal states.

- [ ] **Step 2: Run the focused TUI test and verify RED**

```bash
cd packages/tui
bun test test/cli/tui/subagents-tab.test.tsx
```

Expected: FAIL because Data has no durable subagent store and the tab reads ordinary Sessions.

- [ ] **Step 3: Add durable task storage to Data**

Import `SessionOrchestrationTask` and extend the store:

```ts
session: {
  // existing fields
  subagent: Record<string, SessionOrchestrationTask[]>
}
```

Add API methods:

```ts
subagent: {
  list(parentID: string) {
    return store.session.subagent[parentID] ?? []
  },
  sync(parentID: string) {
    return sync.run(`session.subagent:${parentID}`, async () => {
      setStore("session", "subagent", parentID, reconcile(await client.api.session.subagent.list({ parentID })))
    })
  },
  invalidate(parentID: string) {
    sync.invalidate(`session.subagent:${parentID}`)
  },
}
```

On `session.task.updated`, derive `parentID` from `change.type === "launched" ? change.parentID : store.session.info[sessionID]?.parentID` or a cached task lookup, invalidate, and asynchronously sync that parent.

- [ ] **Step 4: Rewrite Subagents tab entries from durable tasks**

Use:

```ts
const parentID = createMemo(() => session()?.parentID ?? props.sessionID)
const tasks = createMemo(() => data.session.subagent.list(parentID()))
```

Map task fields directly. Do not infer agent names from titles and do not include unmanaged child Sessions.

Use explicit labels:

```ts
const statusLabel = {
  starting: "Starting",
  running: "Running",
  waiting: "Waiting",
  cancelling: "Cancelling",
  cancelled: "Cancelled",
  completed: "Completed",
  failed: "Failed",
  lost: "Lost",
} as const
```

Show bounded progress or open-question indicators only when space permits; model/status remain one line.

- [ ] **Step 5: Replace generic interruption with durable cancellation**

Enable cancellation for `starting`, `running`, and `waiting`; ignore `cancelling` and terminal states. Execute:

```ts
void client.api.session.subagent
  .cancel({ parentID: parentID(), childID: entry.sessionID })
  .then(() => data.session.subagent.sync(parentID()))
```

Never call `client.api.session.interrupt` from this tab.

- [ ] **Step 6: Add TUI interaction coverage**

Tests must prove:

- only durable API tasks render;
- `Waiting`, `Failed`, `Lost`, and `Cancelled` render correctly;
- event-driven resync updates the row;
- `Ctrl+D` on a waiting task calls `session.subagent.cancel` with parent and child IDs;
- no generic Session interrupt call occurs;
- unmanaged child Sessions do not appear.

- [ ] **Step 7: Run TUI tests and typecheck**

```bash
cd packages/tui
bun test test/cli/tui/subagents-tab.test.tsx
bun run typecheck
bun test --timeout 30000
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/tui/src/context/data.tsx packages/tui/src/routes/session/composer/subagents-tab.tsx packages/tui/test
git commit -m "fix(tui): use durable subagent task state"
```

---

### Task 5: Add public route and compiled orchestration acceptance

**Files:**
- Modify: `packages/server/test/session-location.test.ts` or create `packages/server/test/session-subagent.test.ts`
- Modify: `packages/client/test/promise.test.ts`
- Modify: `packages/client/test/effect.test.ts`
- Modify: `packages/cli/script/runtime-smoke.ts`

**Interfaces:**
- Verifies: list, launch, cancel, and terminal durable state through public HTTP clients.
- Runtime smoke provider supports one delayed child response so cancellation wins deterministically.

- [ ] **Step 1: Add failing server-route test**

Start embedded routes with a temporary database and fake model services. Through the public client:

```ts
const launched = await client.session.subagent.launch({
  parentID,
  parentAssistantMessageID: "msg_parent",
  toolCallID: "call_1",
  agent: "reviewer",
  description: "Review",
  prompt: "Wait for cancellation",
  background: true,
})
expect((await client.session.subagent.list({ parentID })).map((task) => task.sessionID)).toContain(launched.sessionID)
const cancelled = await client.session.subagent.cancel({ parentID, childID: launched.sessionID })
expect(cancelled.state).toBe("cancelled")
```

Also assert oversized launch input returns a declared validation error.

- [ ] **Step 2: Run server test and verify RED**

```bash
cd packages/server
bun test test/session-subagent.test.ts
```

Expected: FAIL until the route fixture and bounded contracts are wired.

- [ ] **Step 3: Extend Client contract tests**

Assert Promise and Effect clients send exact paths and decode durable task states for list/cancel. Keep generated code untouched.

- [ ] **Step 4: Extend compiled runtime smoke**

Add a configured `reviewer` subagent and a provider response that delays when the child prompt contains `runtime-smoke-subagent-block`. Then:

```ts
const parent = await client.session.create({ model, location })
const task = await client.session.subagent.launch({
  parentID: parent.id,
  parentAssistantMessageID: "msg_runtime_smoke_parent",
  toolCallID: "call_runtime_smoke_child",
  agent: "reviewer",
  description: "Runtime smoke child",
  prompt: "runtime-smoke-subagent-block",
  background: true,
})
await eventually(async () =>
  (await client.session.subagent.list({ parentID: parent.id })).find((item) => item.sessionID === task.sessionID),
)
const cancelled = await client.session.subagent.cancel({ parentID: parent.id, childID: task.sessionID })
if (cancelled.state !== "cancelled") throw new Error(`Subagent cancellation failed: ${cancelled.state}`)
```

Include `subagent=cancelled` in the success line.

- [ ] **Step 5: Run route/client tests**

```bash
(cd packages/server && bun test)
(cd packages/client && bun test)
```

Expected: PASS.

- [ ] **Step 6: Build and run both artifact smokes**

```bash
bun run build:tui
bun run smoke:tui
bun run smoke:runtime
```

Expected runtime output includes `subagent=cancelled`, `yolo=round-trip`, and `goal=completed`.

- [ ] **Step 7: Commit**

```bash
git add packages/server/test packages/client/test packages/cli/script/runtime-smoke.ts
git commit -m "test(runtime): prove durable subagent orchestration"
```

---

### Task 6: Restore blocking lint gates and complete release verification

**Files:**
- Modify all files reported by `bun run lint:effect-patterns`.
- Modify: `packages/session-ui/src/v2/components/prompt-input/index.tsx`
- Test: `script/ast-grep/rules/**` only if rule behavior changes; otherwise no rule edits.

**Interfaces:**
- Produces: zero `lint:effect-patterns` diagnostics.
- Produces: zero blocking Oxc errors; non-blocking warnings may remain.

- [ ] **Step 1: Capture current blocking lint failures**

```bash
bun run lint:effect-patterns
bun run lint > /tmp/opencode-lint.out 2>&1; test $? -eq 0 || rg -n '^  x |^error:' /tmp/opencode-lint.out
```

Expected RED: current Effect-pattern errors and the prompt-input octal escape error.

- [ ] **Step 2: Remove value import aliases**

For modules that expose namespace exports and cannot import the same namespace name, import exact schema members without aliases. Example:

```ts
import {
  Change,
  Question,
  QuestionID,
  Task,
  TeamView,
  truncateUtf8,
  type State,
} from "@opencode-ai/schema/session-orchestration"
```

Apply the same no-alias pattern to `session.ts`, self-improvement files, `todo.ts`, `policy.ts`, and `config.ts` while preserving public exports.

- [ ] **Step 3: Replace JSON.parse casts with Schema decoding**

Use `Schema.UnknownFromJsonString` or a concrete record schema:

```ts
const JsonRecord = Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown))
const parsed = yield* Schema.decodeUnknown(JsonRecord)(value)
```

For synchronous boundaries, use `Schema.decodeUnknownSync` or `decodeUnknownOption` as appropriate. Preserve existing typed errors and fallback behavior.

- [ ] **Step 4: Replace string defects with Error objects**

Change every reported instance:

```ts
Effect.die(new Error("Generation lease ownership lost"))
```

Do not convert expected typed failures into defects.

- [ ] **Step 5: Fix the blocking CSS escape**

In `prompt-input/index.tsx`, represent the CSS zero-width-space escape without a JavaScript octal escape:

```tsx
empty:before:content-['\\200B']
```

Verify the rendered class still contains the intended CSS escape.

- [ ] **Step 6: Run lint gates**

```bash
bun run test:lint-rules
bun run lint:effect-patterns
bun run lint > /tmp/opencode-lint.out 2>&1
```

Expected:

- lint-rule tests pass;
- Effect-pattern scan exits 0;
- full lint exits 0 or contains warnings only and no blocking errors.

- [ ] **Step 7: Run complete sequential verification**

```bash
bun turbo typecheck --concurrency=3
(cd packages/schema && bun test)
(cd packages/protocol && bun test)
(cd packages/server && bun test)
(cd packages/client && bun test)
(cd packages/core && bun test --timeout 30000)
(cd packages/tui && bun test --timeout 30000)
(cd packages/cli && bun test --timeout 30000)
(cd packages/sdk/js && bun test)
(cd packages/client && bun run check:generated)
git diff --check
```

Run process-heavy suites sequentially. Use detached execution only to bypass the connector time limit, never to run suites concurrently.

- [ ] **Step 8: Rebuild exact final artifact and rerun smokes**

```bash
bun run build:tui
bun run smoke:tui
bun run smoke:runtime
```

Expected: artifact smoke passes and runtime output includes auth, YOLO, Goal, self-improvement evidence, cache ratio, and durable subagent cancellation.

- [ ] **Step 9: Commit lint cleanup**

```bash
git add packages/core packages/server packages/protocol packages/cli packages/session-ui
# Stage only files intentionally modified by this task.
git commit -m "fix: restore blocking lint gates"
```

- [ ] **Step 10: Merge and verify on main**

```bash
git checkout main
git merge --ff-only audit-fixes
bun run build:tui
bun run smoke:tui
bun run smoke:runtime
```

Restart the real-profile managed service from the rebuilt artifact, verify health/version/repository startup latency, and leave the user-owned `.gitignore` modification untouched.
