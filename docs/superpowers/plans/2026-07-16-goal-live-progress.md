# Goal Live Progress and Skill Glyph Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/goal <text>` visibly start immediately, show deterministic todo progress and the current target in a compact TUI band, instruct the first provider turn to maintain todos, and render known timeline skill references with `✦` instead of `$`.

**Architecture:** Keep the original Goal objective and HTTP/database contracts unchanged. Add an optimistic presentation to the TUI Goal context, derive progress and target from the existing synchronized todo list, and render the band inside the shared Prompt so it works on Home and session routes. Reuse the existing `✦` skill glyph through a display-only formatter for known skills.

**Tech Stack:** TypeScript, Effect v4, SolidJS, OpenTUI, Bun test, existing session Goal/todo services.

## Global Constraints

- Preserve the first `/goal <text>` prompt as the durable objective.
- Progress is `round((completed + cancelled) / total * 100)` and is `0%` when no todos exist.
- Current target is first `in_progress`, then first `pending`, then the original objective.
- Show `Starting · 0%` immediately after Enter and restore the exact command if creation/start fails.
- Keep `$skill-name` in the composer; replace only confirmed skill references in submitted timeline user messages.
- Reuse the existing `✦` glyph; add no dependency, icon asset, generated-client change, API change, or database migration.
- Preserve the live model-routing work: OpenAI OAuth credentials whose method starts with `chatgpt-` route through `https://chatgpt.com/backend-api/codex` with `ChatGPT-Account-Id`; API keys and other OAuth methods retain their existing routes.
- Preserve legacy auth projection: disk-backed OpenAI `auth.json` credentials populate the V2 credential store, while `OPENCODE_AUTH_CONTENT` remains ephemeral and is never backfilled to disk.
- Preserve unrelated worktree changes, including the existing OpenAI OAuth work and `.agent-loop/`.
- Do not commit unless the user explicitly requests it; use diff-review checkpoints instead of the commit steps normally used by this workflow.

---

## File Map

- `packages/core/src/session/goal.ts`: use full supervision text for the initial provider turn.
- `packages/core/test/session-goal.test.ts`: prove initial steer contains todo/context instructions while preserving delivery and message identity.
- `packages/tui/src/context/goal.tsx`: own optimistic Home objective and expose pending presentation.
- `packages/tui/src/component/goal-status-band.tsx`: derive and render progress/current target.
- `packages/tui/src/component/prompt/index.tsx`: clear Goal input optimistically, transfer Home state to the created session, navigate before `goalStart` settles, restore on failure, and render the band.
- `packages/tui/src/routes/session/index.tsx`: remove the old top-of-session Goal label and format known skill references in timeline user messages.
- `packages/tui/src/prompt/display.ts`: display-only formatter for known `$skill-name` references.
- `packages/tui/test/app-lifecycle.test.tsx`: assert the Goal band is above the composer rather than above the timeline.
- `packages/tui/test/context/goal.test.tsx`: delayed-start, failure-restore, and compact-band integration coverage.
- `packages/tui/test/prompt/display.test.ts`: skill-reference formatter coverage.
- `packages/tui/test/component/goal-status-band.test.ts`: deterministic progress/target unit coverage.

---

### Task 1: Supervise the First Goal Turn

**Files:**
- Modify: `packages/core/test/session-goal.test.ts:489-533`
- Modify: `packages/core/src/session/goal.ts:222-245`

**Interfaces:**
- Consumes: existing `promptText(state: GoalState, active: ActiveGoal): string`.
- Preserves: initial `delivery: "steer"`, `resume: true`, caller-supplied message ID, and attachments.
- Produces: the same full Goal supervision text for initial and continuation prompts.

- [ ] **Step 1: Change the first-turn tests to require supervision text**

Replace the raw-goal expectations with:

```ts
it.effect("starts active state with a supervised first steer prompt", () =>
  Effect.gen(function* () {
    const fake = makeSession()
    const events = yield* makeEvents
    const goals = yield* GoalSupervisor.make.pipe(
      Effect.provideService(SessionV2.Service, fake.service),
      Effect.provideService(EventV2.Service, events),
    )

    yield* goals.start({ sessionID, goal: "ship task 4" })
    yield* Effect.yieldNow

    expect(yield* goals.status(sessionID)).toMatchObject({ active: true, goal: "ship task 4", iteration: 1 })
    expect(fake.prompts).toHaveLength(1)
    expect(fake.prompts[0]).toMatchObject({ sessionID, delivery: "steer", resume: true })
    expect(fake.prompts[0]?.id).toBeDefined()
    expect(fake.prompts[0]?.prompt.text).toContain("Original goal: ship task 4")
    expect(fake.prompts[0]?.prompt.text).toContain("Use todowrite to maintain a goal-oriented task list")
    expect(fake.prompts[0]?.prompt.text).toContain("When instructions conflict, follow the latest user instruction.")
  }),
)
```

In the supplied-message-ID test, preserve the ID assertions and replace the raw-text assertion with:

```ts
expect(fake.prompts[0]?.id).toBe(supplied)
expect(fake.prompts[0]?.prompt.text).toContain("Original goal: supplied")
expect(fake.prompts[0]?.prompt.text).toContain("Use todowrite to maintain a goal-oriented task list")
expect(fake.prompts[0]).toMatchObject({ delivery: "steer", resume: true })
```

- [ ] **Step 2: Run the focused test and verify RED**

Run from `packages/core`:

```bash
bun test test/session-goal.test.ts -t "supervised first steer|supplied message ID"
```

Expected: FAIL because the first prompt is still exactly the raw Goal text.

- [ ] **Step 3: Use the existing prompt builder for every Goal turn**

In `continueGoal`, replace the text argument passed to `prompt`:

```ts
return yield* prompt(
  sessionID,
  owner,
  promptText(state, owner),
  "work",
  initial ? "steer" : "queue",
  initial?.messageID,
  initial?.files,
)
```

Do not change message IDs, delivery, files, or wake behavior.

- [ ] **Step 4: Run the complete Goal service tests**

Run from `packages/core`:

```bash
bun test test/session-goal.test.ts
```

Expected: all tests pass. Update any remaining test that intentionally asserted raw initial provider text; do not weaken delivery, ownership, or continuation assertions.

- [ ] **Step 5: Review checkpoint**

Run from the repository root:

```bash
git diff --check -- packages/core/src/session/goal.ts packages/core/test/session-goal.test.ts
git diff -- packages/core/src/session/goal.ts packages/core/test/session-goal.test.ts
```

Expected: one production behavior change plus focused expectation updates; no unrelated diff.

---

### Task 2: Build the Derived Compact Goal Band

**Files:**
- Create: `packages/tui/src/component/goal-status-band.tsx`
- Create: `packages/tui/test/component/goal-status-band.test.ts`

**Interfaces:**
- Consumes: `Todo[]` from `@opencode-ai/sdk/v2`, objective text, and a starting flag.
- Produces: `summarizeGoal(objective, todos)` and `GoalStatusBand`.

- [ ] **Step 1: Write deterministic summary tests**

Create `packages/tui/test/component/goal-status-band.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { summarizeGoal } from "../../src/component/goal-status-band"

describe("GoalStatusBand", () => {
  test("uses the objective at zero percent before todos exist", () => {
    expect(summarizeGoal("Ship auth", [])).toEqual({
      resolved: 0,
      total: 0,
      percentage: 0,
      target: "Ship auth",
    })
  })

  test("counts completed and cancelled todos as resolved", () => {
    expect(
      summarizeGoal("Ship auth", [
        { content: "Inspect", status: "completed", priority: "high" },
        { content: "Discard obsolete path", status: "cancelled", priority: "low" },
        { content: "Verify source", status: "in_progress", priority: "high" },
        { content: "Review", status: "pending", priority: "medium" },
      ]),
    ).toEqual({ resolved: 2, total: 4, percentage: 50, target: "Verify source" })
  })

  test("prefers in-progress then pending work", () => {
    expect(
      summarizeGoal("Ship auth", [
        { content: "Next", status: "pending", priority: "high" },
        { content: "Now", status: "in_progress", priority: "medium" },
      ]).target,
    ).toBe("Now")
    expect(
      summarizeGoal("Ship auth", [{ content: "Next", status: "pending", priority: "high" }]).target,
    ).toBe("Next")
  })
})
```

- [ ] **Step 2: Run the new test and verify RED**

Run from `packages/tui`:

```bash
bun test test/component/goal-status-band.test.ts
```

Expected: FAIL because `goal-status-band.tsx` does not exist.

- [ ] **Step 3: Implement the summary and compact band**

Create `packages/tui/src/component/goal-status-band.tsx`:

```tsx
import type { Todo } from "@opencode-ai/sdk/v2"
import { Show, createMemo } from "solid-js"
import { useTheme } from "../context/theme"

const BAR_WIDTH = 24

export function summarizeGoal(objective: string, todos: readonly Todo[]) {
  const resolved = todos.filter((todo) => todo.status === "completed" || todo.status === "cancelled").length
  const total = todos.length
  const percentage = total === 0 ? 0 : Math.max(0, Math.min(100, Math.round((resolved / total) * 100)))
  const target =
    todos.find((todo) => todo.status === "in_progress")?.content ??
    todos.find((todo) => todo.status === "pending")?.content ??
    objective
  return { resolved, total, percentage, target }
}

export function GoalStatusBand(props: {
  objective?: string
  starting: boolean
  todos: readonly Todo[]
}) {
  const { theme } = useTheme()
  const summary = createMemo(() => summarizeGoal(props.objective ?? "", props.todos))
  const filled = createMemo(() => Math.round((summary().percentage / 100) * BAR_WIDTH))

  return (
    <Show when={props.objective}>
      {(objective) => (
        <box
          width="100%"
          flexShrink={0}
          backgroundColor={theme.backgroundPanel}
          border={["left"]}
          borderColor={theme.accent}
          paddingLeft={2}
          paddingRight={2}
          paddingTop={1}
          paddingBottom={1}
        >
          <box width="100%" flexDirection="row" justifyContent="space-between" gap={1}>
            <text fg={theme.text} wrapMode="word">
              <b>{props.starting ? "Starting" : "Goal"}</b> · {objective()}
            </text>
            <text fg={theme.accent}>{summary().percentage}%</text>
          </box>
          <text>
            <span style={{ fg: theme.accent }}>{"━".repeat(filled())}</span>
            <span style={{ fg: theme.border }}>{"━".repeat(BAR_WIDTH - filled())}</span>
          </text>
          <text fg={theme.textMuted} wrapMode="word">
            Current target · <span style={{ fg: theme.text }}>{summary().target}</span>
          </text>
          <text fg={theme.textMuted}>
            {summary().resolved} of {summary().total} resolved
          </text>
        </box>
      )}
    </Show>
  )
}
```

- [ ] **Step 4: Run unit tests and typecheck**

Run from `packages/tui`:

```bash
bun test test/component/goal-status-band.test.ts
bun typecheck
```

Expected: tests and typecheck pass. If the OpenTUI text span style expects a different color type, follow the existing span patterns in `routes/session/index.tsx`; do not replace the bar with a new dependency.

- [ ] **Step 5: Review checkpoint**

Run from the repository root:

```bash
git diff --check -- packages/tui/src/component/goal-status-band.tsx packages/tui/test/component/goal-status-band.test.ts
```

Expected: clean output.

---

### Task 3: Make Goal Submission Optimistic and Integrate the Band

**Files:**
- Modify: `packages/tui/src/context/goal.tsx`
- Modify: `packages/tui/src/component/prompt/index.tsx`
- Modify: `packages/tui/src/routes/session/index.tsx:199-205,1177-1194`
- Modify: `packages/tui/test/app-lifecycle.test.tsx:654-675`
- Modify: `packages/tui/test/context/goal.test.tsx`

**Interfaces:**
- Consumes: `GoalStatusBand` and synchronized `sync.data.todo[sessionID]`.
- Produces on Goal context:
  - `prepareHome(goal: string): void`
  - `clearHome(): void`
  - `pending(id?: string): string | undefined`
  - existing `adoptHome(sessionID: string): void`, now transferring and clearing Home presentation.

- [ ] **Step 1: Add a delayed Home-start regression test**

Add this test near the existing Home Goal tests in `packages/tui/test/context/goal.test.tsx`:

```tsx
test("Home Goal shows Starting and clears input before goalStart resolves", async () => {
  let resolveStart!: (response: Response) => void
  const app = await mountGoalPrompt(
    (url, request) => {
      if (url.pathname === "/session" && request?.method === "POST") {
        return json({
          id: "session-home",
          title: "Home Goal",
          slug: "session-home",
          projectID: "project-test",
          directory,
          version: "0.0.0-test",
          time: { created: 0, updated: 0 },
        })
      }
      if (url.pathname === "/api/session/session-home/goal/start") {
        return new Promise<Response>((resolve) => {
          resolveStart = resolve
        })
      }
    },
    { home: true },
  )

  try {
    await waitFor(() => !!app.promptRef)
    await waitFor(() => !!app.local.model.current())
    app.promptRef?.set({ input: "/goal ship task 6", parts: [] })
    app.promptRef?.submit()
    await waitFor(() => resolveStart !== undefined)

    expect(app.promptRef?.current.input).toBe("")
    expect(app.route.data).toMatchObject({ type: "session", sessionID: "session-home" })
    const frame = await captureFrame(app, (value) => value.includes("Starting · ship task 6"))
    expect(frame).toContain("Starting · ship task 6")
    expect(frame).toContain("0%")
    expect(frame).toContain("Current target · ship task 6")

    resolveStart(json({ data: { goal: "ship task 6", active: true, iteration: 1, cap: 7 } }))
    await waitFor(() => app.goal.active("session-home"))
  } finally {
    resolveStart?.(json({ data: { goal: "ship task 6", active: true, iteration: 1, cap: 7 } }))
    app.renderer.destroy()
  }
})
```

Extend the existing failed-start test with:

```ts
expect(app.goal.pending("session-test")).toBeUndefined()
```

Add Home session-creation failure coverage:

```tsx
test("failed Home session creation restores the Goal command", async () => {
  const app = await mountGoalPrompt(
    (url, request) => {
      if (url.pathname === "/session" && request?.method === "POST") {
        return json({ error: "create failed" }, { status: 500 })
      }
    },
    { home: true },
  )

  try {
    await waitFor(() => !!app.promptRef)
    await waitFor(() => !!app.local.model.current())
    app.promptRef?.set({ input: "/goal ship task 6", parts: [] })
    app.promptRef?.submit()
    await waitFor(() => app.promptRef?.current.input === "/goal ship task 6")

    expect(app.goal.pending()).toBeUndefined()
    expect(app.route.data.type).toBe("home")
  } finally {
    app.renderer.destroy()
  }
})
```

- [ ] **Step 2: Run the delayed-start test and verify RED**

Run from `packages/tui`:

```bash
bun test test/context/goal.test.tsx -t "Home Goal shows Starting"
```

Expected: FAIL because the composer remains populated, navigation waits, and no compact band exists.

- [ ] **Step 3: Add optimistic Home state to Goal context**

In `context/goal.tsx`, add a signal beside `homeSelected`:

```ts
const [homeGoal, setHomeGoal] = createSignal<string>()
```

Add these functions near `selected`/`starting`:

```ts
function prepareHome(goal: string) {
  setHomeGoal(goal)
  setHomeSelected(true)
}

function clearHome() {
  setHomeGoal(undefined)
  setHomeSelected(false)
}

function pending(id = sessionID()) {
  if (!id) return route.data.type === "home" ? homeGoal() : undefined
  if (!starting(id)) return
  return presentation.get(id)?.goal
}
```

Replace `adoptHome` with:

```ts
function adoptHome(sessionID: string) {
  setHomeGoal(undefined)
  setHomeSelected(false)
  advanceRevision(sessionID)
  setSelections(sessionID, true)
}
```

Clear both Home values when leaving Home:

```ts
createEffect(() => {
  if (route.data.type === "home") return
  setHomeGoal(undefined)
  setHomeSelected(false)
})
```

Return `prepareHome`, `clearHome`, and `pending` from the context value.

- [ ] **Step 4: Snapshot and clear Goal input before asynchronous work**

In `component/prompt/index.tsx`, import and initialize the global Prompt ref context:

```ts
import { usePromptRef } from "../../context/prompt"

const promptRef = usePromptRef()
```

Move the existing `inputText`, `nonTextParts`, `currentMode`, `editorSelection`, and `editorParts` calculations so they run after model/workspace validation but before `session.create`.

After computing `goalText`, snapshot the submitted prompt and optimistically clear Goal starts:

```ts
const submittedPrompt = {
  input: store.prompt.input,
  parts: [...store.prompt.parts],
}
const startsGoal = Boolean(goalText && goalText !== "stop")

if (startsGoal) {
  if (!props.sessionID) goal.prepareHome(goalText!)
  ref.reset()
}
```

When `session.create` fails, restore before returning:

```ts
if (startsGoal) {
  goal.clearHome()
  promptRef.current?.set(submittedPrompt)
  promptRef.current?.focus()
}
```

Track whether the session was created by this submission:

```ts
const createdSession = props.sessionID == null
```

Start Goal, transfer Home state, and navigate before waiting for the response:

```ts
if (goalText && goalText !== "stop") {
  const files = nonTextParts
    .filter((part) => part.type === "file")
    .map((part) => ({
      uri: part.url,
      name: part.filename,
      ...(part.source?.text
        ? { source: { start: part.source.text.start, end: part.source.text.end, text: part.source.text.value } }
        : {}),
    }))

  if (createdSession) goal.adoptHome(sessionID)
  const start = goal.start(goalText, sessionID, files.length > 0 ? files : undefined)
  if (createdSession) route.navigate({ type: "session", sessionID })

  try {
    await start
  } catch (error) {
    goal.clearHome()
    goal.clear(sessionID)
    promptRef.current?.set(submittedPrompt)
    promptRef.current?.focus()
    toast.show({ title: "Failed to start Goal", message: errorMessage(error), variant: "error" })
    return false
  }
}
```

At the shared completion block, append `submittedPrompt` to history. Only call `ref.reset()`/`input.clear()` for paths that were not already cleared optimistically. Preserve the existing normal prompt, shell, slash-command, move-progress, file, and editor-selection behavior.

Guard the existing delayed navigation block so Goal starts do not navigate twice:

```ts
if (!props.sessionID && !startsGoal) {
  if (editorParts.length > 0) editor.preserveSelectionFromNewSession()
  setTimeout(() => {
    route.navigate({ type: "session", sessionID })
  }, 50)
}
```

- [ ] **Step 5: Render the band in Prompt and remove the old label**

Import the component:

```ts
import { GoalStatusBand } from "../goal-status-band"
```

In Prompt, derive presentation:

```ts
const goalPending = createMemo(() => goal.pending(props.sessionID))
const goalObjective = createMemo(() => goalPending() ?? (props.sessionID ? goal.current()?.goal : undefined))
const goalTodos = createMemo(() => (props.sessionID ? (sync.data.todo[props.sessionID] ?? []) : []))
```

Render it immediately before the existing prompt-border `<box>`:

```tsx
<GoalStatusBand objective={goalObjective()} starting={Boolean(goalPending())} todos={goalTodos()} />
```

Delete `goalLabel` and its old block at `routes/session/index.tsx:199-205,1177-1194`. The compact band must have one owner and must not appear twice.

Update the Goal ordering assertion in `test/app-lifecycle.test.tsx` because the accepted band belongs above the composer, after the timeline:

```ts
const frame = await captureFrame(app, (value) => value.includes("Current target"))
const rows = frame.split("\n")
const goalRow = rows.findIndex((row) => row.includes(`Goal · ${goalText}`))
const messageRow = rows.findIndex((row) => row.includes("First timeline message"))
expect(goalRow).toBeGreaterThan(messageRow)
expect(frame).toContain("Current target")
expect(frame).toContain("0%")
```

- [ ] **Step 6: Add todo-driven frame coverage**

Expose the existing event source from `mountGoalPrompt` by changing its return to:

```ts
return { ...app, ...state, events }
```

Add a TUI test whose handler returns these todos for `/session/session-test/todo`:

```ts
return json({
  data: [
    { content: "Inspect", status: "completed", priority: "high" },
    { content: "Discard obsolete path", status: "cancelled", priority: "low" },
    { content: "Verify source", status: "in_progress", priority: "high" },
    { content: "Review", status: "pending", priority: "medium" },
  ],
})
```

After starting Goal, capture the frame and assert:

```ts
expect(frame).toContain("50%")
expect(frame).toContain("Current target · Verify source")
expect(frame).toContain("2 of 4 resolved")
```

Then emit a matching todo update and verify the band changes without polling:

```ts
app.events.emit({
  directory,
  project: "project-test",
  payload: {
    type: "todo.updated",
    properties: {
      sessionID: "session-test",
      todos: [
        { content: "Inspect", status: "completed", priority: "high" },
        { content: "Verify source", status: "completed", priority: "high" },
        { content: "Final review", status: "in_progress", priority: "medium" },
      ],
    },
  },
})

const updated = await captureFrame(app, (value) => value.includes("Current target · Final review"))
expect(updated).toContain("67%")
expect(updated).toContain("2 of 3 resolved")
```

- [ ] **Step 7: Run focused and full TUI Goal tests**

Run from `packages/tui`:

```bash
bun test test/component/goal-status-band.test.ts test/context/goal.test.tsx
bun typecheck
```

Expected: all tests and typecheck pass with no warnings.

- [ ] **Step 8: Review checkpoint**

Run from the repository root:

```bash
git diff --check -- packages/tui/src/context/goal.tsx packages/tui/src/component/goal-status-band.tsx packages/tui/src/component/prompt/index.tsx packages/tui/src/routes/session/index.tsx packages/tui/test/app-lifecycle.test.tsx packages/tui/test/context/goal.test.tsx
```

Expected: clean output.

---

### Task 4: Render Known Skill References with the Existing Glyph

**Files:**
- Modify: `packages/tui/src/prompt/display.ts`
- Modify: `packages/tui/src/routes/session/index.tsx:1377-1396`
- Modify: `packages/tui/test/prompt/display.test.ts`

**Interfaces:**
- Consumes: known skill names from `ctx.sync.data.command` entries whose `source === "skill"`.
- Produces: `displaySkillReferences(value: string, skills: ReadonlySet<string>): string`.

- [ ] **Step 1: Write formatter tests**

Extend `packages/tui/test/prompt/display.test.ts` imports with `displaySkillReferences`, then add:

```ts
test("renders only known timeline skill references with the skill glyph", () => {
  const skills = new Set(["writing-test", "effect"])
  expect(displaySkillReferences("$writing-test", skills)).toBe("✦ writing-test")
  expect(displaySkillReferences("Use $effect, then continue", skills)).toBe("Use ✦ effect, then continue")
  expect(displaySkillReferences("Pay $20 and keep $UNKNOWN", skills)).toBe("Pay $20 and keep $UNKNOWN")
  expect(displaySkillReferences("price$effect", skills)).toBe("price$effect")
})
```

- [ ] **Step 2: Run the formatter test and verify RED**

Run from `packages/tui`:

```bash
bun test test/prompt/display.test.ts -t "known timeline skill"
```

Expected: FAIL because `displaySkillReferences` is not exported.

- [ ] **Step 3: Implement a boundary-safe known-skill formatter**

Add to `packages/tui/src/prompt/display.ts`:

```ts
export function displaySkillReferences(value: string, skills: ReadonlySet<string>) {
  return value.replace(
    /(^|\s)\$([A-Za-z0-9][A-Za-z0-9._-]*)(?=\s|$|[.,!?;:])/g,
    (match, prefix: string, name: string) =>
      skills.has(name) ? `${prefix}${displaySkillReference(`$${name}`)}` : match,
  )
}
```

The known-skill set is the safety boundary; do not replace arbitrary dollar-prefixed text.

- [ ] **Step 4: Apply formatting only in timeline UserMessage rendering**

Import `displaySkillReferences` into `routes/session/index.tsx`. In `UserMessage`, add:

```ts
const skills = createMemo(
  () => new Set(ctx.sync.data.command.filter((command) => command.source === "skill").map((command) => command.name)),
)
```

Change only non-synthetic text rendering:

```ts
if (x.type === "text" && !x.synthetic) {
  return displaySkillReferences(x.text, skills())
}
```

Do not alter the stored part, composer extmark, autocomplete trigger, tool output, or exported transcript.

- [ ] **Step 5: Run tests and typecheck**

Run from `packages/tui`:

```bash
bun test test/prompt/display.test.ts test/context/goal.test.tsx
bun typecheck
```

Expected: all tests and typecheck pass.

- [ ] **Step 6: Review checkpoint**

Run from the repository root:

```bash
git diff --check -- packages/tui/src/prompt/display.ts packages/tui/src/routes/session/index.tsx packages/tui/test/prompt/display.test.ts
```

Expected: clean output and no icon asset or dependency changes.

---

### Task 5: Full Verification and Source Reproduction

**Files:**
- Verify only; do not add code unless a failing check identifies a scoped defect.

**Interfaces:**
- Consumes: all prior task outputs.
- Produces: test/typecheck/live evidence for the original bug and accepted design.

- [ ] **Step 1: Run all affected Core tests**

Run from `packages/core`:

```bash
bun test test/session-goal.test.ts test/session-runner-model.test.ts test/config/config.test.ts test/plugin/variant.test.ts
bun typecheck
```

Expected: all tests pass and typecheck exits 0.

- [ ] **Step 2: Run all affected TUI tests**

Run from `packages/tui`:

```bash
bun test test/component/goal-status-band.test.ts test/context/goal.test.tsx test/prompt/display.test.ts test/app-lifecycle.test.tsx
bun typecheck
```

Expected: all tests pass and typecheck exits 0.

- [ ] **Step 3: Re-run OpenCode integration coverage**

Run from `packages/opencode`:

```bash
bun test test/auth/auth.test.ts
bun test test/server/httpapi-goal.test.ts
bun typecheck
```

Run the two test files sequentially because they share process/global resources and previously timed out when run concurrently.

- [ ] **Step 4: Verify source TUI behavior**

`tmux` is unavailable in the current environment, so use installed `screen` without installing anything:

```bash
screen -dmS opencode-goal-live zsh -lc 'bun dev'
```

From the opened source TUI:

1. Submit `/goal Verify the Goal progress band` from Home.
2. Confirm the composer clears and `Starting · 0%` appears immediately.
3. Confirm the session opens while the provider turn is still pending.
4. Confirm the band changes target/percentage after `todowrite` updates.
5. Submit a later steering prompt and confirm the original objective remains while current target changes.
6. Submit a known skill reference and confirm the timeline shows `✦ skill-name` while the composer used `$skill-name`.
7. Stop the Goal with `/goal stop`.

Stop only the process started for this check:

```bash
screen -S opencode-goal-live -X quit
```

If the Bun child survives screen teardown, inspect its exact PID and terminate only that child/parent pair.

- [ ] **Step 5: Final scope review**

Run from the repository root:

```bash
git diff --check
git status --short
git diff -- packages/core/src/session/goal.ts packages/core/test/session-goal.test.ts packages/tui/src/context/goal.tsx packages/tui/src/component/goal-status-band.tsx packages/tui/src/component/prompt/index.tsx packages/tui/src/routes/session/index.tsx packages/tui/src/prompt/display.ts packages/tui/test/context/goal.test.tsx packages/tui/test/component/goal-status-band.test.ts packages/tui/test/prompt/display.test.ts
```

Expected: only the requested Goal/OAuth-adjacent work, tests, approved spec/plan, and already-existing unrelated files appear. Do not stage or commit without an explicit request.
