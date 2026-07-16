# Goal Band Simplification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the duplicate Goal header, expand the progress bar to the available terminal width, keep delegated work aligned with the todo-derived current target, and expose one Goal palette action.

**Architecture:** Keep the session todo list as the only progress and target source. Simplify `GoalStatusBand` to a bar, one state/target row, and one resolved/percentage row; strengthen the existing Goal supervision prompt instead of adding a second subagent-to-todo synchronization system.

**Tech Stack:** TypeScript, Effect v4, SolidJS, OpenTUI, Bun test.

## Global Constraints

- Keep progress as `round((completed + cancelled) / total * 100)` and `0%` for no todos.
- Keep target priority as first `in_progress`, first `pending`, then the original objective.
- Do not add a subagent event bridge, database field, API, generated-client change, dependency, or icon.
- Preserve Goal concurrency, rollback, navigation, model routing, and authentication behavior.
- Edit the current `main` checkout in place; do not create a worktree.
- Do not commit unless the user explicitly requests it.

---

### Task 1: Simplify and Expand the Goal Band

**Files:**
- Modify: `packages/tui/src/component/goal-status-band.tsx`
- Modify: `packages/tui/test/context/goal.test.tsx`
- Modify: `packages/tui/test/app-lifecycle.test.tsx:664-674`

**Interfaces:**
- Consumes: existing `objective?: string`, `starting: boolean`, and `todos: readonly Todo[]` props.
- Preserves: `summarizeGoal(objective, todos)` and its percentage/target semantics.
- Produces: a compact bar with no separate Goal header.

- [ ] **Step 1: Change frame assertions to the simplified layout**

Update the Goal frame tests to require:

```ts
expect(frame).not.toContain("Goal ·")
expect(frame).toContain("Starting · ship task 6")
expect(frame).toContain("0 of 0 resolved · 0%")
```

For active todos, require:

```ts
expect(frame).toContain("Current target · Verify source")
expect(frame).toContain("2 of 4 resolved · 50%")
expect(frame).not.toContain("Goal · ship task 6")
```

In the width-24 regression, capture the `Current target` frame and require one bar row containing 19 bar characters, the content width after the left border and four columns of horizontal padding:

```ts
const bar = frame.split("\n").find((row) => row.includes("━"))
expect(bar?.match(/━/g)).toHaveLength(19)
expect(frame).not.toContain("Goal ·")
```

- [ ] **Step 2: Run focused tests and verify RED**

Run from `packages/tui`:

```bash
bun test test/context/goal.test.tsx -t "Home Goal shows Starting|todo-driven progress|Goal band stays compact"
```

Expected: FAIL because the old Goal header remains, the percentage has its own header row, and the bar is capped at 24 columns.

- [ ] **Step 3: Render the minimal full-width layout**

In `GoalStatusBand`, remove `BAR_WIDTH` and the header row. Measure a dedicated 100%-width bar container so sidebars and constrained Home layouts use their actual content width rather than total terminal width:

```tsx
const [barWidth, setBarWidth] = createSignal(1)
let bar: BoxRenderable

onMount(() => {
  const resize = () => setBarWidth(Math.max(1, bar.width))
  bar.on(LayoutEvents.RESIZED, resize)
  resize()
  onCleanup(() => bar.off(LayoutEvents.RESIZED, resize))
})

const filled = createMemo(() => Math.round((summary().percentage / 100) * barWidth()))
```

Render the remaining rows in this order:

```tsx
<box width="100%" ref={(element: BoxRenderable) => (bar = element)}>
  <text width="100%" wrapMode="none" truncate>
    <span style={{ fg: theme.accent }}>{"━".repeat(filled())}</span>
    <span style={{ fg: theme.border }}>{"━".repeat(barWidth() - filled())}</span>
  </text>
</box>
<box height={2} overflow="hidden">
  <text fg={theme.textMuted} wrapMode="word">
    {props.starting ? "Starting" : "Current target"} ·{" "}
    <span style={{ fg: theme.text }}>{summary().target}</span>
  </text>
</box>
<text fg={theme.textMuted}>
  {summary().resolved} of {summary().total} resolved · {summary().percentage}%
</text>
```

Update the lifecycle ordering test to locate the `Current target` row instead of the removed `Goal ·` row.

Keep the summary to one row. Build the full and compact forms, then select the full form only when it fits the measured bar width:

```ts
const summaryText = createMemo(() => {
  const full = `${summary().resolved} of ${summary().total} resolved · ${summary().percentage}%`
  if (Bun.stringWidth(full) <= barWidth()) return full
  return `${summary().resolved}/${summary().total} · ${summary().percentage}%`
})
```

Render `summaryText()` with `wrapMode="none"` and `truncate`. At width 24, assert `0/1 · 0%` is present and the resolved summary occupies exactly one row.

- [ ] **Step 4: Run TUI verification**

Run from `packages/tui`:

```bash
bun test test/component/goal-status-band.test.ts test/context/goal.test.tsx test/app-lifecycle.test.tsx
bun typecheck
```

Expected: all tests pass and typecheck exits 0.

- [ ] **Step 5: Review checkpoint**

Run from the repository root:

```bash
git diff --check -- packages/tui/src/component/goal-status-band.tsx packages/tui/test/context/goal.test.tsx
```

Expected: clean output. Do not commit.

---

### Task 2: Keep Delegated Work as the Current Todo Target

**Files:**
- Modify: `packages/core/src/session/goal.ts:158-174`
- Modify: `packages/core/test/session-goal.test.ts:489-535`

**Interfaces:**
- Consumes: existing `promptText(state, active)` for initial and continuation Goal turns.
- Produces: stronger todo-maintenance instructions without changing Goal state, events, or tool contracts.

- [ ] **Step 1: Add supervision assertions**

In the initial and continuation prompt tests, require:

```ts
expect(fake.prompts[0]?.prompt.text).toContain(
  "keep its parent todo in_progress until the subagent result is reviewed and accepted",
)
expect(fake.prompts[0]?.prompt.text).toContain("do not advance the current target to later work early")
```

After the continuation prompt is produced, require the same instruction there:

```ts
expect(fake.prompts[1]?.prompt.text).toContain(
  "keep its parent todo in_progress until the subagent result is reviewed and accepted",
)
```

- [ ] **Step 2: Run focused tests and verify RED**

Run from `packages/core`:

```bash
bun test test/session-goal.test.ts -t "supervised first steer|supplied message ID"
```

Expected: FAIL because current supervision only asks for generic todo maintenance.

- [ ] **Step 3: Strengthen the existing supervision prompt**

Add these lines immediately after the existing `todowrite` instruction in `promptText`:

```ts
"Before starting or delegating work, use todowrite to mark the matching item in_progress and keep future work pending.",
"When a subagent is implementing, testing, or reviewing an item, keep its parent todo in_progress until the subagent result is reviewed and accepted; do not advance the current target to later work early.",
```

- [ ] **Step 4: Run Core verification**

Run from `packages/core`:

```bash
bun test test/session-goal.test.ts
bun typecheck
```

Expected: all tests pass and typecheck exits 0.

- [ ] **Step 5: Review checkpoint**

Run from the repository root:

```bash
git diff --check -- packages/core/src/session/goal.ts packages/core/test/session-goal.test.ts
```

Expected: clean output. Do not commit.

---

### Task 3: Collapse Goal Palette Actions

**Files:**
- Modify: `packages/tui/src/component/prompt/index.tsx:363-397`
- Modify: `packages/tui/src/app.tsx:1028-1039`
- Modify: `packages/tui/test/app-lifecycle.test.tsx`

**Interfaces:**
- Preserves: the existing `goal.start` command name and `/goal` slash alias.
- Preserves: the low-level `goal.stop` command for programmatic keymap dispatch.
- Produces: exactly one visible Goal mode action in the command palette.

- [ ] **Step 1: Add palette regressions**

Add an inactive-session assertion:

```ts
api?.keymap.dispatchCommand("command.palette.show")
const inactive = await captureFrame(setup, (frame) => frame.includes("Start goal mode"))
expect(inactive.match(/Start goal mode/g)).toHaveLength(1)
expect(inactive).not.toContain("Stop goal mode")
```

Add an active-session case whose Goal status endpoint returns an active Goal, wait until the Goal band is visible, then assert:

```ts
api?.keymap.dispatchCommand("command.palette.show")
const active = await captureFrame(setup, (frame) => frame.includes("Stop goal mode"))
expect(active.match(/Stop goal mode/g)).toHaveLength(1)
expect(active).not.toContain("Start goal mode")
```

- [ ] **Step 2: Run the palette tests and verify RED**

Run from `packages/tui`:

```bash
bun test test/app-lifecycle.test.tsx -t "Goal mode entry"
```

Expected: FAIL because `goal.start` is always visible and `goal.stop` is separately visible while active.

- [ ] **Step 3: Make the prompt-owned command context-sensitive**

Keep `name: "goal.start"` and `slashName: "goal"`, but derive the title and behavior from the current session:

```ts
const goalAnswering = () => Boolean(props.sessionID && goal.answering(props.sessionID))

{
  name: "goal.start",
  title: goalAnswering() ? "Stop goal mode" : "Start goal mode",
  category: "Session",
  slashName: "goal",
  run: async () => {
    if (props.sessionID && goal.answering(props.sessionID)) {
      await goal.stop(props.sessionID)
      goal.deselect(props.sessionID)
      dialog.clear()
      return
    }
    if (!(await requestGoalText())) return
    void submit()
  },
}
```

- [ ] **Step 4: Hide the low-level stop command from the palette**

Keep `goal.stop` registered in `packages/tui/src/app.tsx` and add:

```ts
hidden: true,
```

This preserves existing lifecycle and keymap dispatches without presenting a duplicate command.

- [ ] **Step 5: Run TUI verification**

Run from `packages/tui`:

```bash
bun test test/app-lifecycle.test.tsx test/context/goal.test.tsx
bun typecheck
```

Expected: all tests pass and typecheck exits 0.

- [ ] **Step 6: Final scope check**

Run from the repository root:

```bash
git diff --check
git status --short
```

Expected: only the design/plan, five TUI files, and two Core files are modified; existing `.agent-loop/` remains untouched. Do not commit.
