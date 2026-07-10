# Yolo Mode & `/goal` Autonomous Agent — Design

Date: 2026-07-09 (revised 2026-07-10)
Status: Approved (revised design)

## Goal

Add a Codex-style autonomous "yolo / goal" capability to opencode:

- **Phase A — Yolo mode**: extend the existing permission auto-approve (`--auto` / `--yolo`)
  to also auto-answer selectable interactive *questions*. Free-text/custom-only questions
  remain pending unless Goal mode is active.
- **Phase B — Goal mode**: bare `/goal`, bare `/goal-mode`, and the command-palette Goal
  action toggle supervision through the shared Goal context. The recursive
  **GoalSupervisor** keeps the agent driving toward the goal (planning, executing,
  delegating to sub-agents, self-verifying) until the goal is met.

This spec covers **Phase A + Phase B only** (shippable MVP). Phases C/D are outlined as
follow-ups.

---

## Phase A — Yolo Mode (auto-approve permissions + questions)

### A.1 Behavior
When `permission.mode === "auto"` is active (via `--auto` / `--yolo` flag or the Ctrl+P
palette toggle), the TUI already auto-replies `permission.asked` events. This phase adds the
same treatment for selectable `question.asked` events: the question is answered
automatically and the blocking `QuestionPrompt` never renders. Ordinary Yolo
free-text/custom-only questions remain pending for user input; Yolo does not submit an
empty-string answer. While Goal mode is active, free-text/custom-only questions are answered
exactly:

> Use your best judgment from the goal and current context, then continue.

If an automatic permission or question reply fails, the TUI restores the request to pending
state and shows the warning toast `Automatic reply failed; user input is required.` This
toast is the explicit failure notification; the automatic-reply failure path does not send a
second OS notification. The existing notification plugin remains pending-only, and
successfully auto-handled requests stay quiet.

### A.2 Schema change — `recommended` option
Files: `packages/schema/src/v1/question.ts` (`QuestionV1.Option`) and
`packages/schema/src/question.ts` (`QuestionV2.Option`).

Add an optional marker so the asking agent can nominate a default:

```ts
export type QuestionOption = {
  label: string
  description: string
  recommended?: boolean
}
```

Both V1 and V2 option contracts carry the optional marker. After changing the V1 schema,
regenerate the legacy JavaScript SDK from the repository root with
`./packages/sdk/js/script/build.ts`. Do **not** edit generated SDK files directly; they are
overwritten on regeneration. The build script also applies guarded patches for the required
flat Goal start payload and nullable Goal status response until the upstream generator
preserves those protocol shapes directly. This optional field is already carried by
`QuestionInfo.options`, so no Protocol/Server `HttpApi` or `packages/client` generation
change is required.

### A.3 Auto-answer logic (TUI)
File: `packages/tui/src/context/sync.tsx`, the `question.asked` case (~line 237).

Mirror the existing `permission.asked` auto-reply. Build answers before replying. If every
question has an automatic answer, reply without storing the request (so `QuestionPrompt`,
which only renders when `questions().length > 0`, never appears). If any question in the
request is free-text/custom-only and Goal mode is inactive, store the whole request for user
input:

```ts
case "question.asked": {
  const request = event.properties
  if (permission.mode === "auto") {
    const fallback = goal.active(request.sessionID)
      ? "Use your best judgment from the goal and current context, then continue."
      : undefined
    const answers = request.questions.map((q) => autoAnswer(q, fallback))
    if (answers.some((answer) => answer === undefined)) {
      upsertQuestion(request)
      break
    }
    void sdk.client.question.reply({
      requestID: request.id,
      directory,
      workspace,
      answers: answers.filter((answer): answer is string[] => answer !== undefined),
    }, { throwOnError: true }).catch(() => {
      upsertQuestion(request)
      warnAutomaticReplyFailed()
    })
    break
  }
  // ... existing store logic unchanged ...
}
```

Answer builder (`packages/tui/src/util/question.ts`):

```ts
function autoAnswer(q: QuestionInfo, fallback?: string): string[] | undefined {
  const opts = q.options ?? []
  if (opts.length === 0) return fallback === undefined ? undefined : [fallback]
  const recommended = opts.filter((o) => o.recommended)
  const pick = recommended.length > 0 ? recommended : opts
  if (q.multiple) return pick.map((o) => o.label)
  return [pick[0].label]
}
```

Notes:
- Selectable single-choice questions use the first recommended option, or the first option
  when none is recommended.
- `multiple: true` uses all recommended option labels when present, otherwise all option
  labels.
- No options (free-text/custom-only) returns no automatic answer in ordinary Yolo mode and
  uses the exact Goal fallback only while Goal mode is active.
- A failed automatic permission or question reply restores the pending request and displays
  the warning toast requiring user input; this path does not send a second OS notification.
- Per-session/request in-flight guards coalesce duplicate asked events, clear on matching
  replies or rejections, and prevent late transport failures from restoring resolved requests.
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
- Unit tests for `autoAnswer`: recommended selection, first-option fallback,
  multiple-choice recommended/all semantics, no automatic answer for custom-only questions,
  and the exact Goal fallback when supplied.
- `sync.tsx` reducer tests: selectable Yolo questions reply and remain absent from pending
  state; ordinary custom-only and mixed requests remain pending; active Goal mode replies to
  custom-only questions with the exact fallback.
- Failure tests restore rejected automatic permission and question replies to pending state
  and show a warning requiring user input.
- Notification tests cover pending-only delivery: pending requests notify, while requests
  absent from pending state remain quiet.

---

## Phase B — `/goal` Command + GoalSupervisor

### B.1 Goal mode controls
Register one palette command in `packages/tui/src/app.tsx` with `slashName: "goal"` and
`slashAliases: ["goal-mode"]`. Bare `/goal` and bare `/goal-mode` toggle supervision
immediately through the shared Goal context. The command-palette Goal action calls the same
toggle immediately and does not prefill the prompt.

Starting through the toggle uses the shared Goal context's default goal prompt and enables
Yolo mode. Stopping through the toggle calls the existing Goal stop API. `/goal <text>` and
`/goal stop` are ordinary prompts sent to the agent; they are not Goal control syntax.

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
  first goal prompt via
  `SessionV2.prompt({ sessionID, prompt, delivery: "steer", resume: true })`.
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
- Prompt-bar indicator (next to the yolo badge): `goal · <iteration>/<cap>` while active.
- Bare `/goal`, bare `/goal-mode`, and the command-palette Goal action toggle supervision.
- Toggling yolo off also cancels active Goal supervision.

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
- TUI Goal context tests verify bare `/goal` and `/goal-mode` toggle immediately, while
  `/goal <text>` and `/goal stop` are submitted as ordinary prompts.
- App lifecycle tests verify the command-palette action toggles immediately without prompt
  prefill and disabling Yolo stops active Goal supervision.
- Prompt rendering tests verify the active badge is `goal · <iteration>/<cap>`.

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
- Automatic reply failures return the request to pending state, so the user can answer it
  after the warning instead of losing the request.
