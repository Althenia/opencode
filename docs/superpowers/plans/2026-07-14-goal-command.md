# Goal Command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Require goal text to start Goal supervision and make stopping explicit.

**Architecture:** Parse the TUI-only `/goal` command before session creation, start the existing Goal API with the command argument, and reserve `stop` as the only subcommand. Remove the zero-argument palette toggle. The protocol trims and rejects blank goal payloads at the API boundary.

**Tech Stack:** TypeScript, Solid TUI, Effect Schema, Bun test.

## Global Constraints

- Preserve GoalSupervisor persistence and yolo independence.
- Do not add dependencies.
- Regenerate client artifacts through the documented protocol generator.

---

### Task 1: Lock down the command contract

**Files:**
- Modify: `packages/tui/test/context/goal.test.tsx`
- Modify: `packages/opencode/test/server/httpapi-goal.test.ts`

**Interfaces:**
- Consumes: `GoalProvider.start(goal, sessionID)` and `GoalProvider.stop(sessionID)`.
- Produces: regression coverage for direct start, direct stop, and bare-command rejection.

- [ ] **Step 1: Write failing TUI tests**

```ts
test("/goal with text starts Goal instead of sending a normal prompt", async () => {
  app.promptRef?.set({ input: "/goal focus on auth and tests", parts: [] })
  await app.promptRef?.submit()
  expect(calls[0]?.method).toBe("goalStart")
  expect(calls[0]?.body).toMatchObject({ goal: "focus on auth and tests" })
})

test("bare /goal preserves the prompt and does not mutate Goal", async () => {
  app.promptRef?.set({ input: "/goal", parts: [] })
  await app.promptRef?.submit()
  expect(app.promptRef?.current.input).toBe("/goal")
  expect(calls).toEqual([])
})

test("/goal stop stops the active Goal", async () => {
  app.promptRef?.set({ input: "/goal stop", parts: [] })
  await app.promptRef?.submit()
  expect(calls).toContain("stop")
})
```

- [ ] **Step 2: Verify the tests fail**

Run: `bun test test/context/goal.test.tsx`

Expected: `/goal <text>` is sent as a normal prompt and bare `/goal` toggles selection.

- [ ] **Step 3: Write a failing API test for blank goals**

```ts
const response = yield* request(`/api/session/${sessionID}/goal/start`, {
  method: "POST",
  headers,
  body: JSON.stringify({ goal: "   " }),
})
expect(response.status).toBe(400)
```

- [ ] **Step 4: Verify the API test fails**

Run: `bun test test/server/httpapi-goal.test.ts`

Expected: a whitespace-only goal is accepted.

### Task 2: Parse and execute the TUI command

**Files:**
- Modify: `packages/tui/src/component/prompt/index.tsx`
- Modify: `packages/tui/src/app.tsx`
- Modify: `packages/tui/src/context/goal.tsx`
- Modify: `packages/tui/src/prompt/part.ts`
- Modify: `packages/tui/test/context/goal.test.tsx`
- Modify: `packages/tui/test/prompt/part.test.ts`

**Interfaces:**
- Consumes: `/goal <goal text>` and `/goal stop` from prompt input.
- Produces: `GoalProvider.start` only for nonempty goals and `GoalProvider.stop` only for the explicit stop subcommand.

- [ ] **Step 1: Parse `/goal` before session creation**

```ts
const goalCommand = /^\/goal(?:\s+([\s\S]*))?$/.exec(trimmed)
if (goalCommand && !goalCommand[1]?.trim()) {
  toast.show({ variant: "warning", message: "Usage: /goal <goal>, or /goal stop" })
  return false
}
```

- [ ] **Step 2: Start or stop after resolving the session**

```ts
if (goalCommand?.[1]?.trim() === "stop") {
  await goal.stop(sessionID)
  goal.deselect(sessionID)
  return clearSubmittedPrompt()
}
if (goalCommand?.[1]) {
  void goal.start(goalCommand[1].trim(), sessionID).catch(showGoalStartError)
  return clearSubmittedPrompt()
}
```

- [ ] **Step 3: Remove the public toggle entrypoint**

```ts
{
  name: "goal.stop",
  title: "Stop goal mode",
  category: "Session",
  run: async () => {
    const sessionID = route.data.type === "session" ? route.data.sessionID : undefined
    if (!sessionID || !goal.active(sessionID)) return
    await goal.stop(sessionID)
    goal.deselect(sessionID)
    dialog.clear()
  },
}
```

- [ ] **Step 4: Remove stale prompt-building and arming coverage**

```ts
export function buildGoalPrompt(input: string) {
  // Remove this unused arming helper.
}
```

- [ ] **Step 5: Verify focused TUI tests pass**

Run: `bun test test/context/goal.test.tsx test/prompt/part.test.ts`

Expected: 0 failures.

### Task 3: Reject invalid API payloads

**Files:**
- Modify: `packages/protocol/src/groups/session.ts`
- Regenerate: `packages/client/src/generated`, `packages/client/src/generated-effect`
- Modify: `packages/opencode/test/server/httpapi-goal.test.ts`

**Interfaces:**
- Consumes: `POST /api/session/:sessionID/goal/start` payload `goal`.
- Produces: a trimmed, nonempty `goal` string or HTTP 400.

- [ ] **Step 1: Validate and normalize goal text in the protocol**

```ts
goal: Schema.Trim.pipe(Schema.NonEmptyString),
```

- [ ] **Step 2: Regenerate maintained client artifacts**

Run: `bun run generate`

Working directory: `packages/client`

Expected: generated client contracts reflect the nonempty goal schema.

- [ ] **Step 3: Verify focused API tests pass**

Run: `bun test test/server/httpapi-goal.test.ts`

Expected: 0 failures.

### Task 4: Verify integration

**Files:**
- Verify only.

- [ ] **Step 1: Run TUI typecheck**

Run: `bun typecheck`

Working directory: `packages/tui`

Expected: exit 0.

- [ ] **Step 2: Run protocol/client typechecks as required by generated changes**

Run: `bun typecheck`

Working directory: `packages/client`

Expected: exit 0.
