# Goal Start and Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Home `/goal` wait for session hydration, keep failed Goals visible and resumable, show the model-evaluated current Goal above the current target, and restore Goal context after compaction.

**Architecture:** Reuse `session_goal.goal` as the authoritative effective Goal. Existing Goal turns update it through an optional `todowrite.goal` value carried by the todo event, while the Goal supervisor validates the active assistant message and persists the update. Provider requests load active Goal context directly by session ID; the TUI waits on `sync.sync`, retains status across transient polling failures, and renders Start/Stop/Resume from the Goal phase.

**Tech Stack:** TypeScript, Effect v4, Drizzle SQLite, Solid/OpenTUI, Bun tests, Effect HttpApi/client generation.

## Global Constraints

- Do not add a model call, dependency, database column, or migration.
- Preserve todo-only `todowrite` input/output behavior.
- Preserve progress as `(completed + cancelled) / total`, rounded and clamped to `0...100`.
- Preserve current unrelated smart-self-improvement changes, especially `SelfImprovementSignal` recording in `packages/core/src/session/goal.ts`.
- Do not stage or commit unrelated dirty-worktree files or whole files containing unrelated hunks.
- Update maintained Protocol/Server sources before running `bun run generate` in `packages/client`; never edit generated client files manually.
- Run tests from package directories, never from the repository root.
- Use `bun typecheck`, never direct `tsc`.

---

## File Map

- `packages/schema/src/session-todo.ts`: optional evaluated Goal and assistant-message identity on `todo.updated`.
- `packages/core/src/session/todo.ts`: carry optional Goal update metadata through the existing todo transaction/event operation.
- `packages/core/src/tool/todowrite.ts`: accept and return optional evaluated Goal without changing todo-only output.
- `packages/core/src/session/goal.ts`: Goal phases, validated evaluated-Goal updates, stalled failure handling, resume, and recovered stalled state.
- `packages/core/src/session/goal-context.ts`: session-specific durable Goal lookup and provider system text.
- `packages/core/src/session/runner/llm.ts`: append active Goal context to every provider request.
- `packages/protocol/src/groups/session.ts`: Goal phase in status and explicit resume endpoint.
- `packages/server/src/handlers/session.ts`: delegate resume to `GoalSupervisor`.
- `packages/client/src/generated/**`, `packages/client/src/generated-effect/**`: regenerated client artifacts only.
- `packages/tui/src/context/goal.tsx`: phase-aware state, resume request, and polling retention.
- `packages/tui/src/component/prompt/index.tsx`: await session hydration and expose Start/Stop/Resume.
- `packages/tui/src/component/goal-status-band.tsx`: Current goal, Current target, phase summary, and non-duplicating empty target.
- Core and TUI tests adjacent to each behavior.

---

### Task 1: Update the effective Goal through `todowrite`

**Files:**
- Modify: `packages/schema/src/session-todo.ts`
- Modify: `packages/core/src/session/todo.ts`
- Modify: `packages/core/src/tool/todowrite.ts`
- Modify: `packages/core/src/session/goal.ts`
- Test: `packages/core/test/tool-todowrite.test.ts`
- Test: `packages/core/test/session-goal.test.ts`

**Interfaces:**
- Produces: `SessionTodo.UpdateInput` with optional `goal` and `assistantMessageID`.
- Produces: `TodoWriteTool.Input` and `Output` with optional `goal`.
- Produces: Goal supervisor handling for accepted `todo.updated` Goal values.
- Preserves: todo-only model output remains the existing JSON array.

- [ ] **Step 1: Add failing todo-tool contract tests**

Extend the test call helper so the input may include an evaluated Goal:

```ts
const call = (
  todos: ReadonlyArray<SessionTodo.Info>,
  input: { readonly id?: string; readonly goal?: string } = {},
) => ({
  sessionID,
  ...toolIdentity,
  call: {
    type: "tool-call" as const,
    id: input.id ?? "call-todowrite",
    name: TodoWriteTool.name,
    input: { todos, ...(input.goal ? { goal: input.goal } : {}) },
  },
})
```

Add assertions that todo-only output is unchanged and Goal input returns structured `{ todos, goal }` output while publishing the assistant message identity from `toolIdentity`.

- [ ] **Step 2: Run the focused tool test and verify RED**

Run from `packages/core`:

```bash
bun test test/tool-todowrite.test.ts
```

Expected: FAIL because the tool schema rejects or drops `goal`.

- [ ] **Step 3: Add failing Goal-supervisor event tests**

In `session-goal.test.ts`, start a Goal, promote it, publish `Step.Started`, then publish:

```ts
yield* events.publish(SessionTodo.Event.Updated, {
  sessionID,
  todos: [{ content: "Implement", status: "in_progress", priority: "high" }],
  goal: "Ship the reconciled implementation",
  assistantMessageID,
})
```

Assert status changes from `finish` to `Ship the reconciled implementation`. Publish a second update with a different assistant message ID and assert it cannot overwrite the Goal.

- [ ] **Step 4: Run the focused Goal test and verify RED**

```bash
bun test test/session-goal.test.ts
```

Expected: FAIL because `todo.updated` does not carry or apply Goal state.

- [ ] **Step 5: Extend todo schemas and service input minimally**

In `packages/schema/src/session-todo.ts`, import `SessionMessage` from `./session-message` and add optional fields to `Updated`:

```ts
goal: Schema.NonEmptyString.pipe(Schema.optional),
assistantMessageID: SessionMessage.ID.pipe(Schema.optional),
```

Import the maintained message ID schema. In `packages/core/src/session/todo.ts`, export and consume:

```ts
export interface UpdateInput {
  readonly sessionID: SessionSchema.ID
  readonly todos: ReadonlyArray<Info>
  readonly goal?: string
  readonly assistantMessageID?: SessionMessage.ID
}
```

Keep the existing todo transaction unchanged and publish the complete input afterward.

- [ ] **Step 6: Extend `todowrite` without changing ordinary output**

Use optional Goal fields:

```ts
export const Input = Schema.Struct({
  todos: Schema.Array(SessionTodo.Info).annotate({ description: "The updated todo list" }),
  goal: Schema.NonEmptyString.annotate({
    description: "The concise effective Goal after reconciling current session context",
  }).pipe(Schema.optional),
})

export const Output = Schema.Struct({
  todos: Schema.Array(SessionTodo.Info),
  goal: Schema.NonEmptyString.pipe(Schema.optional),
})
```

Pass `context.assistantMessageID` only when `input.goal` exists. Preserve array-only text output when Goal is absent:

```ts
export const toModelOutput = (output: Output) =>
  JSON.stringify(output.goal ? output : output.todos, null, 2)
```

- [ ] **Step 7: Apply validated Goal updates in the supervisor**

Add `activeAssistantMessageID` to `ActiveGoal`. Include `SessionTodo.Event.Updated` in the observed Goal events. Before other turn handling:

```ts
if (event.type === SessionTodo.Event.Updated.type) {
  if (!event.data.goal || event.data.assistantMessageID !== active.activeAssistantMessageID) continue
  yield* setState(sessionID, owner, (state) => ({ ...state, goal: event.data.goal! }))
  yield* persistActive(sessionID, owner)
  continue
}
```

Set the active assistant ID on `Step.Started` and clear it on terminal step handling. Update supervision text so every Goal todo write includes the effective `goal` field.

- [ ] **Step 8: Run focused tests and typecheck GREEN**

```bash
bun test test/tool-todowrite.test.ts test/session-goal.test.ts
bun typecheck
```

Expected: all focused tests pass and typecheck exits 0.

- [ ] **Step 9: Scope-review the diff**

```bash
git diff -- packages/schema/src/session-todo.ts packages/core/src/session/todo.ts packages/core/src/tool/todowrite.ts packages/core/src/session/goal.ts packages/core/test/tool-todowrite.test.ts packages/core/test/session-goal.test.ts
```

Confirm the existing `SelfImprovementSignal` import and outcome recording remain intact. Do not stage unrelated Goal-file hunks.

---

### Task 2: Keep failed Goals stalled and resumable

**Files:**
- Modify: `packages/core/src/session/goal.ts`
- Modify: `packages/protocol/src/groups/session.ts`
- Modify: `packages/server/src/handlers/session.ts`
- Test: `packages/core/test/session-goal.test.ts`
- Test: `packages/opencode/test/server/httpapi-goal.test.ts`
- Regenerate: `packages/client/src/generated/**`
- Regenerate: `packages/client/src/generated-effect/**`

**Interfaces:**
- Produces: `GoalPhase = "starting" | "running" | "stalled"`.
- Produces: `GoalSupervisor.resume(sessionID): Effect<GoalState | undefined, PromptError>`.
- Produces: `POST /api/session/:sessionID/goal/resume`.

- [ ] **Step 1: Replace failure expectations with stalled-state RED tests**

Update the existing `stops automatic continuation when a step fails` test to assert:

```ts
expect(yield* goals.status(sessionID)).toMatchObject({
  active: true,
  phase: "stalled",
  goal: "finish",
  iteration: 1,
})
expect(yield* Deferred.isDone(tracked.finalized)).toBe(false)
```

Add a resume test that fails a turn, calls `goals.resume(sessionID)`, observes a second queued prompt, publishes `Step.Started`, and expects phase `running`.

- [ ] **Step 2: Run Goal tests and verify RED**

```bash
bun test test/session-goal.test.ts
```

Expected: FAIL because failures retire Goal and no resume method exists.

- [ ] **Step 3: Add process-local Goal phase**

Keep persisted fields unchanged and add phase to snapshots:

```ts
export type GoalPhase = "starting" | "running" | "stalled"

export interface GoalState {
  readonly goal: string
  readonly active: boolean
  readonly iteration: number
  readonly cap: number
  readonly phase: GoalPhase
}
```

Store phase on `ActiveGoal`, omit it from `persistGoal`, initialize starts as `starting`, set `running` on the matching `Step.Started`, and reconstruct database rows as `stalled`.

- [ ] **Step 4: Keep the supervisor loop alive after failure**

Preserve existing self-improvement signal recording, then replace retirement with:

```ts
active.activeAssistantMessageID = undefined
activeAssistantMessageID = undefined
activeTurn = undefined
active.phase = "stalled"
continue
```

Status must return snapshots for stalled Goals. Explicit stop, verified completion, and cap retirement remain terminal.

- [ ] **Step 5: Add resume with subscription recovery**

Extract the existing queue/subscription setup into one internal attachment function used by start and by recovered Goals. Resume must:

```ts
if (!active || !active.state.active) return
if (active.phase !== "stalled") return snapshot(active)
active.phase = "starting"
yield* ensureSupervisorAttached(sessionID, active)
yield* continueGoal(sessionID, active)
return snapshot(active)
```

Guard attachment with process-local ownership so repeated Resume cannot create duplicate event consumers.

- [ ] **Step 6: Add protocol and server RED tests**

Extend HTTP Goal tests to call `/api/session/:sessionID/goal/resume` and assert the handler delegates to `GoalSupervisor.resume`. Add `phase` to existing Goal response fixtures.

Run from `packages/opencode`:

```bash
bun test test/server/httpapi-goal.test.ts
```

Expected: FAIL because the endpoint and schema field do not exist.

- [ ] **Step 7: Add maintained protocol and handler code**

Add `phase: Schema.Literals(["starting", "running", "stalled"])` to `GoalState`, then add:

```ts
HttpApiEndpoint.post("session.goal.resume", "/api/session/:sessionID/goal/resume", {
  params: { sessionID: Session.ID },
  success: Schema.Struct({ data: Schema.NullOr(GoalState) }),
  error: [ConflictError, SessionNotFoundError],
})
```

The server handler returns `{ data: (yield* goals.resume(sessionID)) ?? null }` with the same prompt-error mapping used by start.

- [ ] **Step 8: Regenerate clients and run focused checks**

Run from `packages/client`:

```bash
bun run generate
```

Then run:

```bash
cd ../core && bun test test/session-goal.test.ts && bun typecheck
cd ../opencode && bun test test/server/httpapi-goal.test.ts && bun typecheck
```

Expected: generation exits 0; focused tests and typechecks pass.

---

### Task 3: Inject durable Goal context into every provider turn

**Files:**
- Create: `packages/core/src/session/goal-context.ts`
- Modify: `packages/core/src/session/runner/llm.ts`
- Test: `packages/core/test/session-runner.test.ts`

**Interfaces:**
- Produces: `GoalContext.load(db, sessionID): Effect<string | undefined>`.
- Consumes: the existing `GoalTable` row; no GoalSupervisor service dependency.

- [ ] **Step 1: Add a failing post-compaction provider-request test**

Insert an active Goal row before the existing automatic-compaction flow:

```ts
yield* db.insert(GoalTable).values({
  session_id: sessionID,
  goal: "Ship durable Goal recovery",
  active: true,
  iteration: 1,
  cap: 25,
}).run()
```

Make the compaction summary omit Goal text and assert the final request system text contains `Ship durable Goal recovery`.

- [ ] **Step 2: Run the runner test and verify RED**

```bash
bun test test/session-runner.test.ts --test-name-pattern "Goal context"
```

Expected: FAIL because Goal is absent from request system parts.

- [ ] **Step 3: Add the narrow durable lookup module**

Create `goal-context.ts` with a single query and renderer:

```ts
export const load = Effect.fnUntraced(function* (db: Database.Interface["db"], sessionID: SessionSchema.ID) {
  const goal = yield* db
    .select({ goal: GoalTable.goal })
    .from(GoalTable)
    .where(and(eq(GoalTable.session_id, sessionID), eq(GoalTable.active, true)))
    .get()
    .pipe(Effect.orDie)
  if (!goal) return
  return `<goal-context>\nCurrent goal: ${goal.goal}\nContinue supervised Goal execution until verified complete.\n</goal-context>`
})

export * as GoalContext from "./goal-context"
```

- [ ] **Step 4: Append Goal context when constructing the request**

In `runTurnAttempt`, load by session ID after session/model resolution and append it after the regular system baseline:

```ts
const goalContext = yield* GoalContext.load(db, session.id)
system: [agent.info?.system, system.baseline, goalContext]
  .filter((part): part is string => part !== undefined && part.length > 0)
  .map(SystemPart.make),
```

- [ ] **Step 5: Verify normal, compacted, and inactive cases GREEN**

```bash
bun test test/session-runner.test.ts --test-name-pattern "Goal context|compaction"
bun typecheck
```

Expected: active Goal appears before and after compaction; inactive/missing Goal adds no system part.

---

### Task 4: Wait for hydration and retain Goal status in the TUI

**Files:**
- Modify: `packages/tui/src/context/goal.tsx`
- Modify: `packages/tui/src/component/prompt/index.tsx`
- Test: `packages/tui/test/context/goal.test.tsx`
- Test: `packages/tui/test/app-lifecycle.test.tsx`

**Interfaces:**
- Consumes: generated `sessions.goalResume` and Goal `phase`.
- Produces: `goal.resume(sessionID?)` and phase-aware palette action.

- [ ] **Step 1: Add a deferred-hydration RED test**

In the Home Goal test harness, hold the `/session/:id` hydration response in a promise. Submit `/goal ship task 6`, assert navigation occurs, assert `goalStart` has not been called, release hydration, then assert `goalStart` occurs.

- [ ] **Step 2: Add polling-retention and resume RED tests**

Seed an active status, make the next status request reject, and assert `app.goal.current()` retains the prior Goal. Add a stalled response and assert `goal.resume()` calls `/goal/resume` and stores the returned starting/running status.

- [ ] **Step 3: Run focused TUI tests and verify RED**

Run from `packages/tui`:

```bash
bun test test/context/goal.test.tsx test/app-lifecycle.test.tsx
```

Expected: hydration ordering, polling retention, and Resume assertions fail.

- [ ] **Step 4: Await existing synchronization before Goal start**

In the Home branch, navigate after ownership transfer, then:

```ts
if (createdSession && ownsHome) {
  route.navigate({ type: "session", sessionID })
  try {
    await sync.sync(sessionID)
  } catch (error) {
    goal.clear(sessionID)
    restoreGoalPrompt(sessionID)
    toast.show({ title: "Failed to prepare Goal", message: errorMessage(error), variant: "error" })
    return false
  }
}
await goal.start(goalText, sessionID, files.length > 0 ? files : undefined)
```

Do not add timers or another readiness API.

- [ ] **Step 5: Add resume and retain status on transient errors**

Add `resume` beside start/stop, serialized by session ID. Change polling error handling from clearing status to retaining it:

```ts
return refresh(id).catch(() => undefined)
```

Expose per-session status without depending on the current route:

```ts
function statusFor(id = sessionID()) {
  return id ? statuses[id] : undefined
}

function current() {
  return statusFor()
}
```

Return `statusFor` from the Goal context. Only an authoritative null/inactive response, stop, completion, cap retirement, deselection, or session deletion clears presentation.

- [ ] **Step 6: Make the one palette action phase-aware**

Use the current Goal phase:

```ts
const goalPhase = () => (props.sessionID ? goal.statusFor(props.sessionID)?.phase : undefined)
```

Render one title: stalled → `Resume goal mode`, active → `Stop goal mode`, otherwise → `Start goal mode`. Resume calls `goal.resume`; running/starting calls stop.

- [ ] **Step 7: Verify TUI state tests GREEN**

```bash
bun test test/context/goal.test.tsx test/app-lifecycle.test.tsx
bun typecheck
```

Expected: all focused tests pass and typecheck exits 0.

---

### Task 5: Render Current goal above Current target

**Files:**
- Modify: `packages/tui/src/component/goal-status-band.tsx`
- Modify: `packages/tui/src/component/prompt/index.tsx`
- Test: `packages/tui/test/component/goal-status-band.test.ts`
- Test: `packages/tui/test/context/goal.test.tsx`

**Interfaces:**
- Consumes: Goal `phase`, effective `goal`, and synchronized todos.
- Produces: `summarizeGoal(todos)` with `Preparing task list` fallback.

- [ ] **Step 1: Change the pure-summary test to RED**

Replace the zero-todo expectation with:

```ts
expect(summarizeGoal([])).toEqual({
  resolved: 0,
  total: 0,
  percentage: 0,
  target: "Preparing task list",
})
```

Add a rendered frame assertion ordering `Current goal` before `Current target` and showing `Stalled` in the summary row for a stalled status.

- [ ] **Step 2: Run component/context tests and verify RED**

```bash
bun test test/component/goal-status-band.test.ts test/context/goal.test.tsx
```

Expected: FAIL because the band has no separate current-Goal line or phase display.

- [ ] **Step 3: Implement the minimal presentation change**

Make summary derive only todo progress and use the non-duplicating fallback. Pass `phase` to `GoalStatusBand`. Render stable rows:

```tsx
<text fg={theme.textMuted} wrapMode="word">
  Current goal · <span style={{ fg: theme.text }}>{props.objective}</span>
</text>
<text fg={theme.textMuted} wrapMode="word">
  Current target · <span style={{ fg: theme.text }}>{summary().target}</span>
</text>
<text fg={theme.textMuted} wrapMode="none" truncate>
  {props.phase === "stalled" ? `Stalled · ${summaryText()}` : summaryText()}
</text>
```

Use `starting` only to prefix the summary with `Starting`; keep Current goal and Current target labels stable.

- [ ] **Step 4: Verify focused and full TUI suites GREEN**

```bash
bun test test/component/goal-status-band.test.ts test/context/goal.test.tsx
bun test
bun typecheck
```

Expected: focused tests, full TUI suite, and typecheck pass.

---

### Task 6: Integrated verification and manual reproduction

**Files:**
- Review all files changed by Tasks 1-5.
- Do not alter unrelated dirty-worktree files.

- [ ] **Step 1: Run Core verification**

From `packages/core`:

```bash
bun test test/tool-todowrite.test.ts test/session-goal.test.ts test/session-runner.test.ts
bun typecheck
```

Expected: 0 failures and typecheck exit 0.

- [ ] **Step 2: Run Protocol/Server verification**

From `packages/opencode`:

```bash
bun test test/server/httpapi-goal.test.ts
bun typecheck
```

Expected: 0 failures and typecheck exit 0.

- [ ] **Step 3: Run TUI verification**

From `packages/tui`:

```bash
bun test
bun typecheck
```

Expected: 0 failures apart from existing explicit skips.

- [ ] **Step 4: Review generated and source scope**

```bash
git diff --check
git status --short
git diff -- packages/schema/src/session-todo.ts packages/core/src/session packages/core/src/tool/todowrite.ts packages/protocol/src/groups/session.ts packages/server/src/handlers/session.ts packages/tui/src packages/core/test packages/opencode/test/server/httpapi-goal.test.ts packages/tui/test packages/client/src/generated packages/client/src/generated-effect
```

Confirm no self-improvement, migration, lockfile, hook, or `.lean-ctx` work was reverted or staged.

- [ ] **Step 5: Reproduce in the live TUI**

Start the TUI in tmux from `packages/opencode`:

```bash
tmux new-session -d -s opencode-goal-recovery 'bun dev'
```

Open Home, submit `/goal <test objective>`, and verify session navigation/hydration precedes Goal execution; Current goal appears above Current target; todos advance progress; compacting retains Goal; a simulated/reproducible provider failure leaves Resume available. Capture with:

```bash
tmux capture-pane -pt opencode-goal-recovery
tmux kill-session -t opencode-goal-recovery
```

Do not claim manual behavior verified unless these observations are captured.

- [ ] **Step 6: Leave implementation uncommitted unless scoped staging is explicitly requested**

The current worktree contains overlapping user changes in `packages/core/src/session/goal.ts`. Report changed files and command evidence. Do not stage whole shared files or include unrelated hunks in a commit.
