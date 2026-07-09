# Yolo Mode & `/goal` Autonomous Agent — Design

Date: 2026-07-09
Status: Approved (design)

## Goal

Add a Codex-style autonomous "yolo / goal" capability to opencode:

- **Phase A — Yolo mode**: extend the existing permission auto-approve (`--auto` / `--yolo`)
  to also auto-answer the agent's interactive *questions*, so the agent never blocks on
  permissions or questions.
- **Phase B — `/goal` command**: a slash command that sets a high-level goal, enables yolo,
  and runs a recursive **GoalSupervisor** that keeps the agent driving toward the goal
  (planning, executing, delegating to sub-agents, self-verifying) until the goal is met.

This spec covers **Phase A + Phase B only** (shippable MVP). Phases C/D are outlined as
follow-ups.

---

## Phase A — Yolo Mode (auto-approve permissions + questions)

### A.1 Behavior
When `permission.mode === "auto"` is active (via `--auto` / `--yolo` flag or the Ctrl+P
palette toggle), the TUI already auto-replies `permission.asked` events. This phase adds the
same treatment for `question.asked` events: the question is answered automatically and the
blocking `QuestionPrompt` never renders.

### A.2 Schema change — `recommended` option
File: `packages/sdk/js/src/v2/gen/types.gen.ts` (`QuestionOption`, ~line 695).

Add an optional marker so the asking agent can nominate a default:

```ts
export type QuestionOption = {
  label: string
  description: string
  recommended?: boolean
}
```

Add the field to the SDK **schema source** (the definition that generates
`types.gen.ts`), then regenerate the SDK types via the repo codegen (`bun run generate` from
`packages/client` after Protocol/SDK changes — see AGENTS.md). Do **not** edit the generated
`types.gen.ts` directly; it is overwritten on regen. No server/HttpApi change is required
because the field is optional and already carried by `QuestionInfo.options`.

### A.3 Auto-answer logic (TUI)
File: `packages/tui/src/context/sync.tsx`, the `question.asked` case (~line 237).

Mirror the existing `permission.asked` auto-reply. Build answers and reply, then `break`
**before** storing the request (so `QuestionPrompt`, which only renders when
`questions().length > 0`, never appears):

```ts
case "question.asked": {
  const request = event.properties
  if (permission.mode === "auto") {
    const answers = request.questions.map((q) => autoAnswer(q))
    void sdk.client.question.reply({
      requestID: request.id,
      directory,
      workspace,
      answers,
    })
    break
  }
  // ... existing store logic unchanged ...
}
```

Answer builder (new helper in `sync.tsx` or `util/`):

```ts
function autoAnswer(q: QuestionInfo): string[] {
  const opts = q.options ?? []
  if (opts.length === 0) return [""]            // custom-only: best-effort unblock
  const recommended = opts.filter((o) => o.recommended)
  const pick = recommended.length > 0 ? recommended : opts
  if (q.multiple) return pick.map((o) => o.label)   // accept full set
  return [pick[0].label]                             // first / first-recommended
}
```

Notes:
- `multiple: true` → answer with **all** (recommended-or-all) option labels.
- No options (custom-only) → answer `""` to unblock without inventing text.
- `sdk.client.question.reply` accepts `{ requestID, directory?, workspace?, answers? }`
  (confirmed in `packages/sdk/js/src/v2/gen/sdk.gen.ts`).

### A.4 Toggle rename
- `packages/tui/src/app.tsx` (~line 949): rename palette command title
  `"Enable/Disable auto-approve permissions"` → `"Enable/Disable yolo mode"`.
- `packages/tui/src/component/prompt/index.tsx` (~line 1447): rename the `"auto"` badge
  shown in the prompt bar to `"yolo"`.
- Flags `--auto` and `--yolo` already map to auto mode (`packages/opencode/src/cli/cmd/tui.ts`
  line 290: `auto: args.auto || args.yolo || args["dangerously-skip-permissions"]`).
  **No new flag.**

### A.5 Testing
- Unit test for `autoAnswer`: recommended selection, first-option fallback, multiple-choice
  returns all labels, no-options returns `[""]`.
- `sync.tsx` reducer test: in `auto` mode a `question.asked` triggers a `question.reply`
  call and stores nothing (prompt stays hidden).

---

## Phase B — `/goal` Command + GoalSupervisor

### B.1 Slash command `/goal [text]`
Register a palette command in `packages/tui/src/app.tsx` (mirror `session.new` → `/new`)
with `slashName: "goal"`, `slashAliases: ["goal-mode"]`. Handler:
1. If no `text`, open a small prompt dialog to capture the goal.
2. `local.permission.set("auto")` — turn on yolo (Phase A).
3. Persist the goal via `GoalSupervisor.start({ sessionID, goal })` (B.3).
4. Submit the first prompt wrapping the user's text with a goal instruction:

> Goal: <text>. Create a plan as todos, then execute autonomously. Delegate to sub-agents
> (general / explore) when useful. Do not stop until the goal is met; when met, end your
> message with the exact line `GOAL COMPLETE`.

`/goal stop` (or toggling yolo off) calls `GoalSupervisor.stop({ sessionID })`.

### B.2 Goal state
`GoalSupervisor` (B.3) holds per-session state keyed by `sessionID`:
`{ goal: string, active: boolean, iteration: number }`. Use `InstanceState`
(`packages/core/src/effect/instance-state.ts`) so each session gets its own state, cleaned up
on disposal — consistent with the repo's per-directory state pattern.

### B.3 GoalSupervisor (new core service)
File: `packages/core/src/session/goal.ts`.

Interface:
```ts
interface Interface {
  start(input: { sessionID: SessionSchema.ID; goal: string }): Effect<void>
  stop(input: { sessionID: SessionSchema.ID }): Effect<void>
}
```

Behavior:
- `start` sets `active = true`, `iteration = 0`, enables the session's auto-approve posture
  (relies on the TUI yolo mode for the interactive MVP; see B.6 limitation), and submits the
  first goal prompt (B.1 step 4) via `SessionV2.prompt({ sessionID, prompt, delivery: "steer", resume: true })`.
- A background fiber (`Effect.forkScoped` inside the `InstanceState.make` closure) subscribes
  to the session's durable event stream. When the agent's **turn completes** (final assistant
  message with no pending tool calls / session idle), it runs the stop-condition check (B.4).
- If not done and under the iteration cap, it re-prompts:
  `SessionV2.prompt({ sessionID, prompt: "<goal reminder> Continue. Next step?", delivery: "steer", resume: true })`,
  which re-wakes `SessionExecution` — this is the recursion. Increment `iteration`.
- `stop` sets `active = false` and interrupts the fiber.

This reuses `SessionV2.prompt` + `execution.wake` — **no changes to `SessionRunner` /
`SessionExecution` internals**.

### B.4 Stop condition (approved)
The supervisor stops when **all** hold:
1. The latest assistant message contains the `GOAL COMPLETE` sentinel, **and**
2. A **verify gate** passes: the supervisor issues one verification prompt —
   *"Re-read the goal: <goal>. Is it fully met? Answer only YES or NO."* — and the reply is
   `YES` (this is the stricter "verify by re-reading the goal" gate; Phase D's verification
   folded into the stop condition), **and**
3. `iteration < CAP` (constant `GOAL_MAX_ITERATIONS = 25`).

If the verify gate returns `NO`, the supervisor re-prompts with the gap noted. If `iteration`
hits the cap, it stops and surfaces a "goal not reached" notice. Hard blockers (unrecoverable
error, permission denied while not in yolo) also stop it.

### B.5 TUI surface
- Prompt-bar indicator (next to the yolo badge): `goal · <n>/25` while active.
- `/goal stop` cancels; toggling yolo off also cancels.

### B.6 Known limitation (follow-up, not in this spec)
For the MVP the supervisor assumes the **TUI is connected and in yolo mode**, so permission
and question auto-reply are handled client-side. True headless autonomy (supervisor survives
TUI disconnect and auto-approves permissions server-side) requires setting the session's
permission ruleset to allow-all (reusing `dangerously-skip-permissions` semantics) — a
hardening follow-up.

### B.7 Testing
- `GoalSupervisor` unit test (effect test with a fake `SessionV2`):
  - re-prompts after each completed turn until `GOAL COMPLETE` + verify `YES`.
  - stops at the iteration cap if the sentinel never appears.
  - verify gate requires `YES` before stopping (a `NO` triggers another re-prompt).
  - `stop` interrupts the loop.

---

## Out of scope (follow-up specs)

- **Phase C — Planning integration**: supervisor explicitly drives plan-mode / todo creation
  and treats "all todos done" as a goal-progress signal in the stop condition.
- **Phase D — Self-verification**: richer verification (spawn a `general` verification
  sub-agent, or run tests/builds as a completion check) beyond the re-read verify gate.
- **Headless permission auto-approve** (B.6).

## Risks

- The supervisor's "turn completed" detection depends on the existing session event stream;
  confirm the precise completion signal during implementation (likely a final assistant
  message with no pending tool calls, or a session-idle event).
- `recommended` requires the asking agent to set it; until agents do, behavior falls back to
  first-option (safe default).
- Auto-answering custom-only questions with `""` may be rejected by the server for some
  question shapes; monitor and adjust fallback if needed.
