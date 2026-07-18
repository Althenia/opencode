# Goal Requirements Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align TUI Goal startup, autonomous responses, recovery, compaction, and command-palette behavior with approved requirements R1-R6.

**Architecture:** Keep user-driven readiness and reopen recovery in the TUI. Keep durable lifecycle, structured question handling, continuation, and compaction behavior in Core. Reuse the existing Goal status/resume/stop interfaces; do not add API, protocol, persistence, or generated-code changes.

**Tech Stack:** TypeScript, SolidJS, Effect v4, Bun test, OpenTUI keymap.

## Global Constraints

- Work only in `.worktrees/goal-mode-review` on branch `goal-mode-review`.
- Follow `docs/superpowers/specs/2026-07-18-goal-requirements-alignment-design.md` R1-R6.
- `/goal <text>` is the sole Goal start path.
- The command palette shows only `Stop goal mode` while Goal is active; no Goal command is visible while inactive.
- Preserve `/goal` slash autocomplete.
- Permission prompts remain owned by permission/Yolo mode.
- Do not change public APIs, Protocol, generated clients, database schemas, dependencies, or the app client.
- Run tests and typechecks from package directories, never repository root.
- Do not stage or commit; no Git delivery action was requested.

---

### Task 1: TUI readiness, recovery, and stop-only palette

**Requirements:** R1, R4, R6

**Files:**
- Modify: `packages/tui/src/component/prompt/index.tsx`
- Modify: `packages/tui/src/component/command-palette.tsx`
- Modify: `packages/tui/src/context/goal.tsx`
- Test: `packages/tui/test/context/goal.test.tsx`
- Test: `packages/tui/test/app-lifecycle.test.tsx`

**Interfaces:**
- Consumes: `sdk.client.session.create`, `project.workspace.current/set`, `sync.bootstrap({ fatal: false })`, `editor.reconnect(directory)`, `sync.session.sync(sessionID)`, `goal.statusFor`, `goal.refresh`, `goal.resume`, `goal.stop`.
- Produces: no new exported interface. The existing `goal.start` keymap command remains available to slash autocomplete but is visible in the command palette only when its title is `Stop goal mode`.

- [ ] **Step 1: Change the existing Home hydration test into the failing full readiness assertion**

In `packages/tui/test/context/goal.test.tsx`, update `Home Goal waits for session hydration before starting` to submit through keyboard input and assert the route remains Home until synchronization resolves:

```ts
await app.mockInput.typeText("/goal ship task 6")
app.mockInput.pressEnter()
await waitFor(() => resolveHydration !== undefined)

expect(app.route.data).toEqual({ type: "home" })
expect(starts).toBe(0)

resolveHydration(json(session))
await waitFor(() => starts === 1)
expect(app.route.data).toEqual({ type: "session", sessionID: "session-hydration" })
```

Give the created session a non-current `workspaceID`. Record the workspace-scoped bootstrap request and assert it occurs before the held `/session/session-hydration` response and before `goal/start`. Keep the existing fallback responses from `mountGoalPrompt` for the other bootstrap requests.

- [ ] **Step 2: Run the Home readiness test and verify the new ordering assertion fails**

Run:

```sh
cd packages/tui
bun test test/context/goal.test.tsx --test-name-pattern "Home Goal waits for session hydration before starting"
```

Expected: FAIL because the current implementation navigates before synchronization and does not run the created session's workspace/bootstrap/editor preparation in the Home submission path.

- [ ] **Step 3: Add failing palette and automatic-reopen assertions**

In `packages/tui/test/app-lifecycle.test.tsx`:

1. Rename `Goal mode entry shows one Start action when inactive` to `Goal mode entry is absent when inactive`.
2. Open the command palette, wait for `Commands`, and assert:

```ts
const frame = await captureFrame(setup, (value) => value.includes("Commands"))
expect(frame).not.toMatch(/(?:Start|Stop|Resume) goal mode/)
```

3. Replace the running/stalled table with active phases that all expect Stop:

```ts
test.each(["starting", "running", "stalled"] as const)(
  "Goal mode entry shows only Stop for an active %s Goal",
  async (phase) => {
    // status returns { goal, active: true, iteration: 2, cap: 7, phase }
    // dispatch goal.start and expect only /goal/stop to be called
  },
)
```

In `packages/tui/test/context/goal.test.tsx`, replace the manual `resume requests a stalled Goal` flow with automatic reopen behavior:

```ts
test("reopening a recovered Goal resumes it once", async () => {
  let resumes = 0
  const app = await mountGoalPrompt((url) => {
    if (url.pathname === "/api/session/session-test/goal/status")
      return json({ data: { goal: "ship task 6", active: true, iteration: 2, cap: 7, phase: "stalled" } })
    if (url.pathname === "/api/session/session-test/goal/resume") {
      resumes++
      return json({ data: { goal: "ship task 6", active: true, iteration: 3, cap: 7, phase: "starting" } })
    }
  })

  try {
    await waitFor(() => resumes === 1)
    expect(app.goal.current()).toMatchObject({ active: true, phase: "starting", iteration: 3 })
    await Bun.sleep(0)
    expect(resumes).toBe(1)
  } finally {
    app.renderer.destroy()
  }
})
```

- [ ] **Step 4: Run the focused palette/recovery tests and verify they fail**

Run:

```sh
cd packages/tui
bun test test/context/goal.test.tsx --test-name-pattern "reopening a recovered Goal"
bun test test/app-lifecycle.test.tsx --test-name-pattern "Goal mode entry"
```

Expected: FAIL because stalled status is not resumed automatically and the palette still exposes Start/Resume.

- [ ] **Step 5: Complete created-session readiness before navigation and Goal start**

In `packages/tui/src/component/prompt/index.tsx`:

1. Add `Session` to the existing type import from `@opencode-ai/sdk/v2`.
2. Track the returned created session beside `sessionID`:

```ts
let sessionID = props.sessionID
let created: Session | undefined
```

3. After successful creation:

```ts
created = res.data
sessionID = created.id
```

4. Move Home ownership adoption after readiness. This keeps `homeOwnership` valid so a preparation failure can restore the Home command. Require the Home route, current prompt submission revision, and Home ownership before the first readiness mutation and after each awaited stage:

```ts
const ownsCreatedGoal = () =>
  route.data.type === "home" &&
  promptRef.submissionRevision === submissionRevision &&
  homeOwnership !== undefined &&
  goal.ownsHome(homeOwnership)

try {
  if (!ownsCreatedGoal()) return false
  if (created && created.workspaceID !== project.workspace.current()) {
    project.workspace.set(created.workspaceID)
    await sync.bootstrap({ fatal: false })
    if (!ownsCreatedGoal()) return false
  }
  if (created) editor.reconnect(created.directory)
  if (!ownsCreatedGoal()) return false
  await sync.session.sync(sessionID)
  if (!ownsCreatedGoal()) return false
} catch (error) {
  restoreGoalPrompt()
  toast.show({ title: "Failed to prepare Goal", message: errorMessage(error), variant: "error" })
  return false
}

if (!goal.adoptHome(sessionID, homeOwnership)) return false
route.navigate({ type: "session", sessionID })
```

`editor.reconnect` means synchronous reconnect initiation; it is not an awaited readiness stage. Recheck immediately afterward before starting session synchronization. Do not add a timer, route-ready service, or duplicate Goal admission. The existing route initialization may safely perform its idempotent refresh after navigation.

- [ ] **Step 6: Make the prompt Goal action stop-only when active**

In `packages/tui/src/component/prompt/index.tsx`, simplify state selection:

```ts
const goalAction = () => {
  if (!props.sessionID) return "start"
  if (goal.starting(props.sessionID)) return "stop"
  return goal.statusFor(props.sessionID)?.active ? "stop" : "start"
}
```

Keep command name `goal.start` and `slashName: "goal"` so slash autocomplete still works. Set its title to `Stop goal mode` only for the stop state; remove the Resume branch. Its run handler must stop and deselect for stop state, otherwise preserve the existing bare `/goal` text prompt path.

In `packages/tui/src/component/command-palette.tsx`, exclude inactive `goal.start` without changing slash discovery in `keymap.tsx`:

```ts
function isVisiblePaletteCommand(command: PaletteCommandEntry["command"]) {
  if (command.hidden === true || command.name === COMMAND_PALETTE_COMMAND) return false
  if (command.name === "goal.start") return command.title === "Stop goal mode"
  return true
}
```

- [ ] **Step 7: Auto-resume recovered stalled status through the existing serialized queue**

In the route polling effect in `packages/tui/src/context/goal.tsx`, keep one request in flight, cancel stale continuations, and reuse `refresh` plus `resume`:

```ts
let inFlight = false
let cancelled = false
const poll = async () => {
  if (cancelled || inFlight || presentation.has(id)) return
  inFlight = true
  try {
    const status = await refresh(id)
    if (cancelled || sessionID() !== id) return
    if (status?.active && status.phase === "stalled") await resume(id)
  } finally {
    inFlight = false
  }
}
```

Keep the current catch at the call site, five-second polling interval, generation checks, and serialized operations. Cleanup must set `cancelled = true` before clearing the timer and deleting presentation state. Do not add another retry timer.

- [ ] **Step 8: Run TUI focused and package checks**

Run:

```sh
cd packages/tui
bun test test/context/goal.test.tsx test/app-lifecycle.test.tsx
bun typecheck
```

Expected: all tests pass and typecheck exits 0.

- [ ] **Step 9: Record the TUI owner handoff**

Report changed paths, focused test counts, typecheck result, and any behavior difference from R1/R4/R6. Do not stage or commit.

---

### Task 2: Core autonomous responses and recoverable supervisor loop

**Requirements:** R2, R3, R4

**Files:**
- Modify: `packages/core/src/session/goal.ts`
- Test: `packages/core/test/session-goal.test.ts`
- Test: `packages/core/test/session-prompt.test.ts`

**Interfaces:**
- Consumes: existing `QuestionV2.Service.reply`, `SessionEvent.Step.Ended`, `SessionV2.prompt`, `SessionExecution.wake`, `GoalSupervisor.resume`.
- Produces: no new public interface. Internal supervisor failures leave active state at `phase: "stalled"` while the same event queue remains available for resume.

- [ ] **Step 1: Add missing structured-question fallback tests**

Beside the existing recommended multi-select test in `packages/core/test/session-goal.test.ts`, add:

```ts
it.effect("uses the first option for a single-selection question without recommendations", () =>
  Effect.gen(function* () {
    const events = yield* makeEvents
    const questions = makeQuestions(events)
    const locations = yield* makeQuestionLocationMap(questions.service)
    const fake = makeSession()
    const goals = yield* GoalSupervisor.make.pipe(
      Effect.provideService(SessionV2.Service, fake.service),
      Effect.provideService(EventV2.Service, events),
      Effect.provideService(LocationServiceMap.Service, locations),
    )
    yield* goals.start({ sessionID, goal: "finish" })
    expect(
      yield* questions.service.ask({
        sessionID,
        questions: [{
          question: "Which path?",
          header: "Path",
          options: [
            { label: "One", description: "First" },
            { label: "Two", description: "Second" },
          ],
        }],
      }),
    ).toEqual([["One"]])
  }),
)
```

Add the same shape with `multiple: true` and expect `[["One", "Two"]]`.

- [ ] **Step 2: Strengthen the free-text assistant question test**

Rename `continues after an assistant requests approval` to `continues after an assistant asks a free-text question at the idle boundary`. Use output `"Which implementation should I use?"` and assert:

```ts
expect(fake.prompts).toHaveLength(2)
expect(fake.prompts[1]).toMatchObject({ delivery: "queue", resume: true })
expect(fake.prompts[1]?.prompt.text).toContain("Which implementation should I use?")
expect(fake.prompts[1]?.prompt.text).toContain("Handle ordinary approval and clarification autonomously")
expect(yield* goals.status(sessionID)).toMatchObject({ active: true, iteration: 2 })
```

- [ ] **Step 3: Add a failing unexpected-loop-failure recovery test**

Add a test that fails `SessionV2.messages` after the first promoted turn, then proves status becomes stalled and resume can re-enter the same queue:

```ts
it.effect("stalls and remains resumable when the supervisor loop fails", () =>
  Effect.gen(function* () {
    const fake = makeSession(["not done"])
    const session = SessionV2.Service.of({
      ...fake.service,
      messages: () => Effect.die("message read failed"),
    })
    const events = yield* makeEvents
    const goals = yield* GoalSupervisor.make.pipe(
      Effect.provideService(SessionV2.Service, session),
      Effect.provideService(EventV2.Service, events),
    )

    yield* goals.start({ sessionID, goal: "finish" })
    yield* turnEnded(events, fake)
    yield* Effect.yieldNow
    expect(yield* goals.status(sessionID)).toMatchObject({ active: true, phase: "stalled" })

    expect(yield* goals.resume(sessionID)).toMatchObject({ active: true, phase: "starting" })
    expect(fake.prompts).toHaveLength(2)
    yield* fake.promoteNext(events)
    yield* stepStarted(events)
    yield* Effect.yieldNow
    expect(yield* goals.status(sessionID)).toMatchObject({ active: true, phase: "running" })
  }),
)
```

- [ ] **Step 4: Run the focused Core tests and verify only the new loop-failure test fails**

Run:

```sh
cd packages/core
bun test test/session-goal.test.ts --test-name-pattern "without recommendations|free-text question|supervisor loop fails"
```

Expected: question and free-text tests pass against existing behavior; the unexpected-loop-failure test fails because the current outer catch silently terminates the run loop without setting stalled.

- [ ] **Step 5: Keep the supervisor queue alive after an unexpected failure**

In `packages/core/src/session/goal.ts::attach`, replace the swallowing outer catch with a suspended recursive supervisor effect over the same queue and subscription:

```ts
const supervise: Effect.Effect<void> = Effect.suspend(() =>
  run(sessionID, active, queue).pipe(
    Effect.catchCause((cause) =>
      Effect.gen(function* () {
        if (goals.get(sessionID) !== active || !active.state.active) return
        yield* setState(sessionID, active, (state) => ({ ...state, phase: "stalled" }))
        yield* Effect.logWarning("Goal supervisor loop stalled", { sessionID, cause })
        yield* supervise
      }),
    ),
  ),
)
yield* supervise.pipe(
  Effect.ensuring(Fiber.interrupt(subscription)),
  Effect.forkIn(active.scope),
)
```

Keep `active.attached = true`. The recursive effect waits on the same queue; it must not issue a provider prompt until the existing resume interface is invoked.

- [ ] **Step 6: Repair the stale initial-Goal admission assertion**

In `packages/core/test/session-prompt.test.ts`, preserve the durable admission and wake assertions while matching the current supervised prompt:

```ts
const input = yield* admitted(id)
expect(input).toMatchObject({ sessionID, delivery: "steer" })
expect(input?.prompt.text).toContain("Original goal: ship task 6")
expect(wakeCalls).toEqual([sessionID])
```

- [ ] **Step 7: Run Core focused and package checks**

Run:

```sh
cd packages/core
bun test test/session-goal.test.ts test/session-prompt.test.ts
bun typecheck
```

Expected: all tests pass and typecheck exits 0.

- [ ] **Step 8: Record the Core owner handoff**

Report changed paths, focused test counts, typecheck result, and confirmation that permission events and public interfaces were untouched. Do not stage or commit.

---

### Task 3: Goal-supervisor compaction regression and integration

**Requirements:** R5 and assembled R1-R6 validation

**Files:**
- Test: `packages/core/test/session-runner.test.ts`
- Verify: all Task 1 and Task 2 paths
- Verify: `docs/superpowers/specs/2026-07-16-goal-progress-design.md`
- Verify: `docs/superpowers/specs/2026-07-17-goal-start-recovery-design.md`
- Verify: `docs/superpowers/specs/2026-07-18-goal-requirements-alignment-design.md`

**Interfaces:**
- Consumes: existing `GoalSupervisor.make/start`, `SessionV2.Service`, runner compaction events, durable Goal context.
- Produces: no runtime interface; adds assembled regression evidence.

- [ ] **Step 1: Extend automatic-compaction coverage through GoalSupervisor**

In `packages/core/test/session-runner.test.ts`, add a focused integration test beside `automatically compacts into a completed summary and retained recent turn with Goal context`:

```ts
it.effect("continues Goal supervision after automatic compaction", () =>
  Effect.gen(function* () {
    yield* setup
    const session = yield* SessionV2.Service
    const goals = yield* GoalSupervisor.make
    responses = [
      fragmentFixture("text", "goal-work", ["Still working"]).completeEvents,
      fragmentFixture("text", "goal-summary", ["## Objective\n- Ship the Goal"]).completeEvents,
      fragmentFixture("text", "goal-after-compact", ["Continued after compaction"]).completeEvents,
    ]

    yield* goals.start({ sessionID, goal: "Ship the Goal" })
    yield* session.resume(sessionID)

    expect(requests.some((request) =>
      request.system.map((part) => part.text).join("\n").includes("Ship the Goal"),
    )).toBe(true)
    expect(yield* goals.status(sessionID)).toMatchObject({ active: true })
  }),
)
```

Use the existing compact/recovery model setup and request-length fixture from the neighboring automatic-compaction test so the test deterministically produces one summary request and one retried provider turn. Assert the retried request includes durable Goal system context and the supervisor admits its next queued iteration.

- [ ] **Step 2: Run the new compaction integration test**

Run:

```sh
cd packages/core
bun test test/session-runner.test.ts --test-name-pattern "continues Goal supervision after automatic compaction"
```

Expected: PASS without production changes. If it fails, classify the exact failure before changing runtime code; do not add another Goal context source.

- [ ] **Step 3: Run assembled validation in parallel by package**

Run:

```sh
cd packages/tui
bun test test/context/goal.test.tsx test/app-lifecycle.test.tsx
bun typecheck
```

Run independently:

```sh
cd packages/core
bun test test/session-goal.test.ts test/session-runner.test.ts test/session-prompt.test.ts
bun typecheck
```

Expected: every command exits 0.

- [ ] **Step 4: Review the final diff and requirement closure**

Run from the worktree root:

```sh
git diff --check
git status --short
git diff --stat
```

Confirm:

- R1: no Goal start before Home readiness completes.
- R2: structured choice behavior remains deterministic.
- R3: assistant free-text questions produce queued autonomous continuation.
- R4: recovered and unexpected-failure Goals are stalled and automatically resumable on open.
- R5: compaction preserves Goal context and continuation.
- R6: inactive palette has no Goal entry; active palette has only Stop; `/goal` autocomplete remains.
- No generated, dependency, schema, Protocol, app-client, staged, or committed changes exist.

- [ ] **Step 5: Produce the Hermes integration ledger**

Report TUI owner evidence, Core owner evidence, integration results, deferred checks, and any defects by R1-R6. Mark the result `validated` only when all commands above pass.
