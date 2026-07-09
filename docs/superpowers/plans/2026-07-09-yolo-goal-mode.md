# Yolo Mode & `/goal` Autonomous Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add yolo-mode auto-answering for questions and a `/goal` command that starts a session-scoped GoalSupervisor loop until the goal is complete.

**Architecture:** Phase A stays client-side: the question schema gains an optional recommendation hint, the TUI auto-answers questions before storing them, and the existing auto/yolo labels are renamed. Phase B adds a small core GoalSupervisor service keyed by session ID, exposes it through protocol/server RPCs, and keeps the TUI thin: command handling, goal start/stop, and a live status badge. Regenerate the client contract after every schema/protocol change and never hand-edit generated SDK files.

**Tech Stack:** TypeScript, Effect, Bun, schema/protocol codegen, Solid-based TUI, HttpApi group/handler wiring, Bun tests.

## Global Constraints

- Scope is Phase A + Phase B only; defer headless permission auto-approve and the later spec phases.
- Do not edit `packages/client/src/generated*` or `packages/client/src/generated-effect*` directly; regenerate them.
- After schema / Protocol / HttpApi changes, run `bun run generate` from `packages/client`.
- TUI permission mode remains `"auto" | "normal"`; yolo is the renamed user-facing label for auto mode.
- Goal prompting must use `SessionV2.prompt({ sessionID, prompt, delivery: "steer", resume: true })`.
- The new core service uses a minimal service-owned `Map<SessionSchema.ID, GoalState>` plus a scoped fiber; keep it local to the service.
- Validation runs from package directories only; never run root-level tests.

---

### Task 1: Add `recommended` to question options and regenerate the client contract

**Files:**
- Modify: `packages/schema/src/question.ts`
- Modify: `packages/core/test/question.test.ts`
- Regenerated: `packages/client/src/generated/**/*`, `packages/client/src/generated-effect/**/*` (via `bun run generate`; no direct edits)

**Interfaces:**
- Consumes: `Question.Option` in `packages/schema/src/question.ts`
- Produces: `QuestionV2.Option.recommended?: boolean` in the schema and the regenerated client contract

- [ ] **Step 1: Add the failing regression case**

  Extend `packages/core/test/question.test.ts` with an option that includes `recommended: true`, then assert the asked request still contains that field when the question service publishes it.

  Run: `bun test test/question.test.ts`
  
  Expected: FAIL before the schema change because the option shape does not carry `recommended`.

- [ ] **Step 2: Add the schema field**

  Update `packages/schema/src/question.ts` so `Option` becomes:

  ```ts
  export const Option = Schema.Struct({
    label: Schema.String.annotate({ description: "Display text (1-5 words, concise)" }),
    description: Schema.String.annotate({ description: "Explanation of choice" }),
    recommended: Schema.Boolean.pipe(optional),
  }).annotate({ identifier: "QuestionV2.Option" })
  ```

- [ ] **Step 3: Regenerate the client surface**

  Run: `bun run generate` (from `packages/client`)

  Expected: the generated question option types pick up `recommended?: boolean`.

- [ ] **Step 4: Verify the contract**

  Run: `bun typecheck` (from `packages/schema`)
  
  Run: `bun typecheck` (from `packages/client`)

- [ ] **Step 5: Commit the task once green**

  ```bash
  git add packages/schema/src/question.ts packages/core/test/question.test.ts packages/client/src/generated packages/client/src/generated-effect
  git commit -m "feat(schema): add question recommendation hint"
  ```

### Task 2: Auto-answer questions in yolo mode

**Files:**
- Create: `packages/tui/src/util/question.ts`
- Modify: `packages/tui/src/context/sync.tsx`
- Modify: `packages/tui/test/cli/cmd/tui/sync.test.tsx`
- Create: `packages/tui/test/util/question.test.ts`

**Interfaces:**
- Consumes: `QuestionInfo`, `permission.mode`, and `sdk.client.question.reply`
- Produces: `autoAnswer(question): string[]` and a `question.asked` branch that replies immediately and does not store the request

- [ ] **Step 1: Write the pure helper test first**

  Create `packages/tui/test/util/question.test.ts` with cases for:
  - recommended option(s) win over the rest
  - non-multiple questions pick the first recommended / first option
  - `multiple: true` returns all selected labels
  - custom-only questions fall back to `['']`

  Run: `bun test test/util/question.test.ts`
  
  Expected: FAIL until `autoAnswer` exists.

- [ ] **Step 2: Implement the helper**

  Add `packages/tui/src/util/question.ts` with a single pure function:

  ```ts
  export function autoAnswer(question: QuestionInfo): string[]
  ```

  Keep the logic tiny: recommended labels first, otherwise the full option list, `multiple` means return all labels, and no options means `['']`.

- [ ] **Step 3: Wire auto-reply into sync**

  Update the `question.asked` branch in `packages/tui/src/context/sync.tsx` so that when `permission.mode === "auto"` it:
  1. maps each question through `autoAnswer`
  2. calls `sdk.client.question.reply({ requestID, directory, workspace, answers })`
  3. `break`s before the request is stored

  Keep the existing non-auto storage path unchanged.

- [ ] **Step 4: Add the integration test**

  Extend `packages/tui/test/cli/cmd/tui/sync.test.tsx` with a `question.asked` case that runs in auto mode and asserts:
  - the reply RPC is sent
  - the request never lands in the local question store
  - the blocking `QuestionPrompt` stays hidden

  Run: `bun test test/cli/cmd/tui/sync.test.tsx`

- [ ] **Step 5: Verify the package**

  Run: `bun typecheck` (from `packages/tui`)

- [ ] **Step 6: Commit the task once green**

  ```bash
  git add packages/tui/src/util/question.ts packages/tui/src/context/sync.tsx packages/tui/test/util/question.test.ts packages/tui/test/cli/cmd/tui/sync.test.tsx
  git commit -m "fix(tui): auto-answer questions in yolo mode"
  ```

### Task 3: Rename the user-facing auto labels to yolo

**Files:**
- Modify: `packages/tui/src/app.tsx`
- Modify: `packages/tui/src/component/prompt/index.tsx`
- Modify: `packages/tui/test/app-lifecycle.test.tsx`

**Interfaces:**
- Consumes: the existing permission toggle and prompt chrome
- Produces: palette text `Enable/Disable yolo mode` and prompt badge text `yolo`

- [ ] **Step 1: Add the UI assertion first**

  Update `packages/tui/test/app-lifecycle.test.tsx` to assert the copy shown in the palette and prompt chrome uses `yolo`, not `auto`.

  Run: `bun test test/app-lifecycle.test.tsx`
  
  Expected: FAIL until the copy changes.

- [ ] **Step 2: Rename the palette command title**

  Change the command title in `packages/tui/src/app.tsx` from `Enable/Disable auto-approve permissions` to `Enable/Disable yolo mode`.

- [ ] **Step 3: Rename the prompt badge**

  Change the badge text in `packages/tui/src/component/prompt/index.tsx` from `auto` to `yolo`.

- [ ] **Step 4: Verify the UI package**

  Run: `bun test test/app-lifecycle.test.tsx`
  
  Run: `bun typecheck` (from `packages/tui`)

- [ ] **Step 5: Commit the task once green**

  ```bash
  git add packages/tui/src/app.tsx packages/tui/src/component/prompt/index.tsx packages/tui/test/app-lifecycle.test.tsx
  git commit -m "refactor(tui): rename auto labels to yolo"
  ```

### Task 4: Build the core GoalSupervisor service

**Files:**
- Create: `packages/core/src/session/goal.ts`
- Create: `packages/core/test/session-goal.test.ts`

**Interfaces:**
- Consumes: `SessionV2`, `EventV2`, `SessionSchema.ID`, and `SessionEvent` durable turn-complete signals
- Produces: `GoalSupervisor.Service` with `start`, `stop`, and `status`, plus an internal `GoalState` record for `goal`, `active`, `iteration`, and `cap`

- [ ] **Step 1: Write the fake-service tests first**

  Create `packages/core/test/session-goal.test.ts` with a fake `SessionV2` and event stream. Cover:
  - `start` stores active state and emits the first `SessionV2.prompt`
  - the loop re-prompts after completed turns until the goal is done
  - `status` reports `active`, `goal`, `iteration`, and `cap`
  - `stop` clears state and interrupts the loop
  - the iteration cap stops runaway loops
  - the verify gate requires `YES` before stopping

  Run: `bun test test/session-goal.test.ts`
  
  Expected: FAIL until the service exists.

- [ ] **Step 2: Implement the service layer**

  Add `packages/core/src/session/goal.ts` with a scoped service that keeps a `Map<SessionSchema.ID, GoalState>` and a forked fiber per active session.

  The loop should:
  1. call `SessionV2.prompt({ sessionID, prompt, delivery: "steer", resume: true })`
  2. watch the confirmed turn-complete durable event (`SessionEvent.Step.Ended` if that is the actual sentinel)
  3. stop when the latest assistant output includes `GOAL COMPLETE` and the verify gate answers `YES`
  4. re-prompt otherwise until `GOAL_MAX_ITERATIONS` is reached

- [ ] **Step 3: Keep the service small**

  Do not add a global coordinator; keep the state local to the service and tear it down when `stop` runs or the scope closes.

- [ ] **Step 4: Verify the core package**

  Run: `bun test test/session-goal.test.ts`
  
  Run: `bun typecheck` (from `packages/core`)

- [ ] **Step 5: Commit the task once green**

  ```bash
  git add packages/core/src/session/goal.ts packages/core/test/session-goal.test.ts
  git commit -m "feat(core): add goal supervisor"
  ```

### Task 5: Expose goal start/stop/status through protocol and server handlers

**Files:**
- Modify: `packages/protocol/src/groups/session.ts`
- Modify: `packages/server/src/handlers/session.ts`
- Create: `packages/opencode/test/server/httpapi-goal.test.ts`
- Regenerated: `packages/client/src/generated/**/*`, `packages/client/src/generated-effect/**/*` (via `bun run generate`; no direct edits)

**Interfaces:**
- Consumes: `GoalSupervisor.Service` from core
- Produces: `session.goal.start`, `session.goal.stop`, and `session.goal.status` protocol endpoints plus server handlers wired to them

- [ ] **Step 1: Add the contract test first**

  Create `packages/opencode/test/server/httpapi-goal.test.ts` with a fake goal service and assert the three endpoints call the right service methods and return the expected status payload through the HttpApi wiring.

  Run: `bun test test/server/httpapi-goal.test.ts`
  
  Expected: FAIL until the handlers exist.

- [ ] **Step 2: Extend the session protocol group**

  Add the new endpoints to `packages/protocol/src/groups/session.ts` under the `session.goal.*` namespace, keeping the shapes minimal:
  - `start`: session ID + goal text
  - `stop`: session ID
  - `status`: session ID → current goal state

- [ ] **Step 3: Wire the server handler**

  Update `packages/server/src/handlers/session.ts` to delegate each endpoint to the core GoalSupervisor service.

- [ ] **Step 4: Regenerate the client contract**

  Run: `bun run generate` (from `packages/client`)

- [ ] **Step 5: Verify the exposed surface**

  Run: `bun test test/server/httpapi-goal.test.ts` (from `packages/opencode`)
  
  Run: `bun typecheck` (from `packages/protocol`)
  
  Run: `bun typecheck` (from `packages/server`)
  
  Run: `bun typecheck` (from `packages/client`)

- [ ] **Step 6: Commit the task once green**

  ```bash
  git add packages/protocol/src/groups/session.ts packages/server/src/handlers/session.ts packages/opencode/test/server/httpapi-goal.test.ts packages/client/src/generated packages/client/src/generated-effect
  git commit -m "feat(protocol): expose goal supervisor"
  ```

### Task 6: Add the `/goal` command, goal status plumbing, and the live badge

**Files:**
- Create: `packages/tui/src/context/goal.tsx`
- Modify: `packages/tui/src/app.tsx`
- Modify: `packages/tui/src/component/prompt/index.tsx`
- Modify: `packages/tui/test/app-lifecycle.test.tsx`
- Create: `packages/tui/test/context/goal.test.tsx`

**Interfaces:**
- Consumes: `sdk.client.sessions.goalStart/goalStop/goalStatus`, the existing permission toggle, and `DialogPrompt`
- Produces: a `/goal` slash command, `/goal stop`, a goal status context, and a prompt-bar badge that reads `goal · <iteration>/25` while active

- [ ] **Step 1: Add the TUI contract test first**

  Create `packages/tui/test/context/goal.test.tsx` to cover:
  - `/goal` with inline text sets yolo, starts supervision, and submits the first goal prompt
  - `/goal` with no text opens `DialogPrompt` and uses the entered text
  - `/goal stop` stops supervision and clears the active badge
  - status polling renders `goal · <n>/25` when active

  Run: `bun test test/context/goal.test.tsx`
  
  Expected: FAIL until the context and command wiring exist.

- [ ] **Step 2: Add the goal context**

  Create `packages/tui/src/context/goal.tsx` as the single place that talks to `sdk.client.sessions.goalStart/goalStop/goalStatus` and exposes:

  ```ts
  start(goal: string): Promise<void>
  stop(): Promise<void>
  status(): Promise<GoalStatus | undefined>
  ```

  Keep the state local to the TUI session; do not push the goal loop into the UI layer.

- [ ] **Step 3: Wire the slash command**

  Update `packages/tui/src/app.tsx` so `/goal [text]`:
  1. prompts for text with `DialogPrompt` when missing
  2. flips permission mode to `auto`
  3. calls `goal.start(text)` and lets the core service emit the first steering prompt
  4. supports `/goal stop` as the shutdown path

- [ ] **Step 4: Render the live badge**

  Update `packages/tui/src/component/prompt/index.tsx` so the badge still shows yolo mode, and append `goal · <iteration>/25` when the goal context reports an active goal.

- [ ] **Step 5: Add the app-level check**

  Extend `packages/tui/test/app-lifecycle.test.tsx` to assert the badge copy and the goal indicator appear in the prompt chrome.

- [ ] **Step 6: Verify the TUI package**

  Run: `bun test test/context/goal.test.tsx`
  
  Run: `bun test test/app-lifecycle.test.tsx`
  
  Run: `bun typecheck` (from `packages/tui`)

- [ ] **Step 7: Commit the task once green**

  ```bash
  git add packages/tui/src/context/goal.tsx packages/tui/src/app.tsx packages/tui/src/component/prompt/index.tsx packages/tui/test/context/goal.test.tsx packages/tui/test/app-lifecycle.test.tsx
  git commit -m "feat(tui): add goal command"
  ```

### Task 7: Run the package-scoped validation sweep

**Files:**
- Validate: `packages/schema/package.json`
- Validate: `packages/client/package.json`
- Validate: `packages/core/package.json`
- Validate: `packages/protocol/package.json`
- Validate: `packages/server/package.json`
- Validate: `packages/tui/package.json`
- Validate: `packages/opencode/package.json`

**Interfaces:**
- Consumes: the regenerated client contract, the new core service, the protocol/server handlers, and the TUI command/badge wiring
- Produces: a green package-level validation record before any merge/PR work

- [ ] **Step 1: Run codegen once more from the client package**

  Run: `bun run generate` (from `packages/client`)

- [ ] **Step 2: Run package-scoped typechecks**

  Run: `bun typecheck` (from `packages/schema`)
  
  Run: `bun typecheck` (from `packages/client`)
  
  Run: `bun typecheck` (from `packages/core`)
  
  Run: `bun typecheck` (from `packages/protocol`)
  
  Run: `bun typecheck` (from `packages/server`)
  
  Run: `bun typecheck` (from `packages/tui`)
  
  Run: `bun typecheck` (from `packages/opencode`)

- [ ] **Step 3: Run the targeted tests again**

  Run: `bun test test/question.test.ts` (from `packages/core`)
  
  Run: `bun test test/util/question.test.ts` (from `packages/tui`)
  
  Run: `bun test test/cli/cmd/tui/sync.test.tsx` (from `packages/tui`)
  
  Run: `bun test test/session-goal.test.ts` (from `packages/core`)
  
  Run: `bun test test/server/httpapi-goal.test.ts` (from `packages/opencode`)
  
  Run: `bun test test/context/goal.test.tsx` (from `packages/tui`)
  
  Run: `bun test test/app-lifecycle.test.tsx` (from `packages/tui`)

- [ ] **Step 4: Capture the final diff for review**

  Run: `git status --short`
  
  Run: `git diff --stat`

### Acceptance Criteria

- `Question.Option` supports `recommended?: boolean`, and the regenerated client types expose it.
- `permission.mode === "auto"` auto-answers questions and prevents `QuestionPrompt` from rendering.
- The TUI copy says `yolo`, not `auto`.
- `GoalSupervisor` can start, stop, report status, and loop with a hard iteration cap.
- `session.goal.start`, `session.goal.stop`, and `session.goal.status` are available through protocol/server and the regenerated client.
- `/goal` starts yolo mode, prompts for text when needed, and shows `goal · <iteration>/25` while active.
- All package-scoped validation commands pass.

### Risks

- Turn-complete detection may need one live check against the durable event stream; confirm the exact completion sentinel before finalizing the loop.
- Custom-only questions that answer with `""` may be rejected by some question shapes; keep that fallback covered by tests.
- The goal loop can become noisy if the verify gate keeps returning `NO`; the iteration cap must stay enforced.
