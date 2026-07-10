# Yolo Mode & `/goal` Autonomous Agent - Design

Date: 2026-07-09 (revised 2026-07-10)
Status: Approved design; implementation acceptance is gated by the controls in this document

## Source Summary

This revision records the final approved behavior and reconciles it with the existing Goal public
API. Goal and Yolo remain independent toggles. Goal owns autonomous continuation and answers
questions only while a Goal run is starting or active. Yolo owns permission approval and, when Goal
is not answering, selectable-question defaults. Goal state remains process-local.

## Scope

This design covers:

- Yolo permission handling and selectable-question defaults.
- Goal toggle behavior, next-free-text capture, autonomous steering, verification, and exhaustion.
- Required changes to the existing Goal supervisor loop without changing its public API.
- TUI badges, failure recovery, concurrency, and focused acceptance tests.

A visible attempt counter, a Goal sidebar, durable cross-process recovery, and new public Goal APIs
are out of scope.

## Normative Requirements

| ID | Requirement | Acceptance gate |
|---|---|---|
| REQ-001 | Goal and Yolo MUST be independently toggled. Changing either MUST NOT change the other. | Every Goal/Yolo combination is reachable, and each toggle mutates only its own mode. |
| REQ-002 | Bare `/goal`, bare `/goal-mode`, and the Goal palette action MUST toggle Goal. The first invocation selects Goal and waits for the next submitted free-text prompt; a repeat invocation deselects Goal and stops any active run. | Toggle tests cover off-to-on awaiting input and on-to-off cleanup from awaiting, active, completed, and exhausted states. |
| REQ-003 | Goal follow-up steering MUST adapt to the stable goal, transcript, latest assistant result, tool results, and current verification evidence. A fixed `Continue working toward the goal` reminder MUST NOT be the follow-up implementation. | Follow-up tests prove distinct unresolved work produces distinct steering and the stored goal remains unchanged. |
| REQ-004 | Verified completion MUST leave Goal selected-idle. | The run becomes inactive, its event resources are finalized, no follow-up is queued, and the `goal` badge remains visible until Goal is toggled off. |
| REQ-005 | Every `question.asked` request MUST be auto-answered only while a Goal run is starting or active. Awaiting the initial goal, verified selected-idle, failed selected-idle, and exhausted selected-paused states MUST NOT receive Goal automatic answers. | Lifecycle tests assert Goal answering is true only for `starting || (active && iteration < cap)`. |
| REQ-006 | With Yolo selected and Goal not answering, selectable-only questions MUST be auto-answered; any request containing a free-text/custom-only question MUST remain pending. | Selectable-only requests bypass `QuestionPrompt`; free-text and mixed requests render it. |
| REQ-007 | Permission decisions MUST be controlled solely by Yolo and configured permission rules. Goal MUST NOT alter, bypass, or synthesize permission rules. | Goal-only `ask` requests remain pending; Yolo `ask` requests use existing automatic permission replies in every Goal lifecycle state. |
| REQ-008 | The internal default cap MUST remain `GOAL_MAX_ITERATIONS = 25`. The cap and iteration MUST NOT be displayed. External steering during a run MUST reset `iteration` to `0` without replacing the stored goal. | State tests assert the default cap, reset behavior, and stable goal; rendering tests assert no counter or sidebar. |
| REQ-009 | Exhaustion MUST occur only after a clean non-completing turn consumes the final allowed attempt and yields inactive `iteration === cap`. It MUST be presented exactly once as a TUI-owned `DialogSelect` with `Continue`, `Revise`, and `Stop`; it MUST NOT use `question.asked`, so Yolo cannot answer it. | Dialog tests prove exact cap equality, clean-turn eligibility, ownership, one-shot rendering, duplicate-event coalescing, and explicit user selection. |
| REQ-010 | The prompt bar MUST render `yolo` with `theme.error` and `goal` with `theme.warning`, without an attempt suffix. | Rendering tests assert the exact labels and theme tokens. |
| REQ-011 | The complete existing Goal public API and `GoalState` shape MUST remain unchanged. | Type and route tests preserve `start({ sessionID, goal, cap? })`, `stop(sessionID)`, `status(sessionID)`, and all four state fields. |
| REQ-012 | Goal supervision MUST remain continuously ready for relevant session events while a run is starting or active. Verified completion, `Step.Failed`, exhaustion, explicit stop, replacement start, and process-scope disposal are terminal paths that MUST finalize that run's event subscription and coordinator. | Event tests prove readiness throughout starting/active work and resource finalization on every terminal path. |
| REQ-013 | Goal revisions MUST invalidate stale completion, verification, and queued follow-up evidence. External steering is guidance for the current goal, not a goal revision. | Revision tests ignore late older-revision results; external-steer tests preserve `GoalState.goal`. |
| REQ-014 | Goal selection and run state MAY remain process-local and MAY be lost on process restart. | Restart behavior is documented and no durable recovery or post-crash continuation claim is made. |
| REQ-015 | `SessionEvent.Step.Failed` MUST win over cap exhaustion at every attempt, including the final allowed attempt. Core MUST mark the run internally failed, stop continuation, finalize run resources, and make `status(sessionID)` return `undefined` without changing the public `GoalState` or API. The TUI MUST remain selected-idle and use the existing session error surface; it MUST NOT open exhaustion controls. | Failure tests cover ordinary and final-attempt failures, undefined public status, retained TUI selection, existing error presentation, finalized resources, no exhaustion dialog, and restart only after new user free text or explicit restart. |

## Independent Mode Matrix

| Goal selection / run | Yolo | Permissions | Questions | Autonomous steering |
|---|---|---|---|---|
| Off | Off | Existing configured behavior | User answers all | Off |
| Off | On | Existing Yolo automatic replies | Auto-answer selectable-only requests; user answers free-text and mixed requests | Off |
| On, awaiting initial goal / verified selected-idle / failed selected-idle | Off | Existing configured behavior; `ask` remains pending | User answers all | Off until new free text or explicit restart |
| On, awaiting initial goal / verified selected-idle / failed selected-idle | On | Existing Yolo automatic replies | Auto-answer selectable-only requests; user answers free-text and mixed requests | Off until new free text or explicit restart |
| On, exhausted selected-paused | Off | Existing configured behavior; `ask` remains pending | User answers all | Paused for exhaustion decision |
| On, exhausted selected-paused | On | Existing Yolo automatic replies | Auto-answer selectable-only requests; user answers free-text and mixed requests | Paused for exhaustion decision |
| On, run starting or active | Off | Existing configured behavior; `ask` remains pending | Goal auto-answers every question shape | On |
| On, run starting or active | On | Existing Yolo automatic replies | Goal auto-answers every question shape | On |

Configured permission rules remain authoritative. They define which operations are destructive or
require `ask`; Goal does not maintain a second destructiveness list.

## Yolo Behavior

### Permissions

The existing `permission.mode === "auto"` path remains the sole automatic permission path.
`--auto`, `--yolo`, and `--dangerously-skip-permissions` continue to select that posture. Goal does
not enable Yolo, disable Yolo, or change permission rules.

An automatic permission reply failure restores the request to pending state and shows:

> Automatic reply failed; user input is required.

The notification plugin remains pending-only. Successfully handled requests stay quiet, and the
failure path does not send a second OS notification.

### Selectable questions

Add `recommended?: boolean` to `QuestionV1.Option` and `QuestionV2.Option`:

```ts
export type QuestionOption = {
  label: string
  description: string
  recommended?: boolean
}
```

Regenerate the legacy JavaScript SDK with `./packages/sdk/js/script/build.ts`; generated SDK files
MUST NOT be edited directly. `QuestionInfo.options` already carries the optional field, so this
change does not require a Protocol/Server `HttpApi` or `packages/client` generation change.

For each selectable question:

- Single-choice selects the first recommended option, or the first option when none is recommended.
- Multiple-choice selects all recommended options, or all options when none is recommended.
- With Yolo alone, no-options/free-text questions have no automatic answer; the whole request stays pending.

## Goal Interaction

### Toggle and goal capture

Bare `/goal`, bare `/goal-mode`, and the Goal palette action call the same toggle:

- When Goal is off, toggle it on and wait for the next submitted free-text prompt.
- When Goal is on, stop any current run, clear local Goal status, and deselect Goal.
- Neither transition changes Yolo.

Selecting Goal does not start the supervisor with a default prompt. The next eligible free-text
submission is consumed as the goal and calls the existing public `start` API. Attachments and editor
context remain rejected for that goal-start submission.

`/goal <text>` and `/goal stop` remain ordinary prompts; they are not Goal control syntax.

After verified completion, Goal remains selected-idle. The next eligible free-text prompt starts a
new goal. Toggling Goal before that prompt deselects it.

### TUI-owned lifecycle

The TUI derives presentation and question-answering behavior from its process-local selection,
starting flag, and the public `GoalState`:

- `awaiting initial goal`: selected, no status, not starting.
- `starting`: selected and an outstanding `start` request exists.
- `active`: `status.active === true && status.iteration < status.cap`.
- `verified selected-idle`: selected, inactive, sub-cap status after successful verification, and no live run resources.
- `failed selected-idle`: selected, `status()` returns `undefined` after internal `Step.Failed`, no live run resources, and the existing session error surface remains authoritative.
- `exhausted selected-paused`: selected, inactive, `status.iteration === status.cap` after a clean non-completing turn, no live run resources, and the exhaustion dialog awaits an explicit choice.
- `off`: not selected; any active Goal has been stopped.

Only `starting` and `active` are Goal-answering states. Selection alone is insufficient.

This state is process-local, cleaned up with its process scope, and not restored after restart or
ownership movement. That limitation is accepted for this release.

## Goal Question Answers

While `goal.answering(sessionID)` is true, Goal takes precedence over Yolo-only question handling and
answers every question in a request:

```ts
function autoAnswer(question: QuestionInfo, goalAnswering: boolean): string[] | undefined {
  const options = question.options ?? []
  if (options.length === 0) {
    if (!goalAnswering) return
    return ["Use your best judgment from the goal and current context, then continue."]
  }
  const recommended = options.filter((option) => option.recommended)
  const selected = recommended.length > 0 ? recommended : options
  if (question.multiple) return selected.map((option) => option.label)
  return [selected[0].label]
}
```

The exact free-text answer is:

> Use your best judgment from the goal and current context, then continue.

Build every answer before replying. Goal replies only when every question has an answer. When Goal
is not answering, Yolo-alone mixed requests remain wholly pending rather than partially answered.
A failed automatic question reply restores the unresolved request and shows the same warning toast
as permission failure. Per-request in-flight guards coalesce duplicate events and prevent a late
transport failure from restoring an already resolved request.

The exhaustion decision is not part of this path. It is a local `DialogSelect`, never a
`question.asked` request.

## Goal Supervisor

### Existing unchanged public API

The complete public API and state contract are:

```ts
export interface GoalState {
  readonly goal: string
  readonly active: boolean
  readonly iteration: number
  readonly cap: number
}

export interface StartInput {
  readonly sessionID: SessionSchema.ID
  readonly goal: string
  readonly cap?: number
}

export interface Interface {
  readonly start: (input: StartInput) => Effect.Effect<GoalState, PromptError>
  readonly stop: (sessionID: SessionSchema.ID) => Effect.Effect<void>
  readonly status: (sessionID: SessionSchema.ID) => Effect.Effect<GoalState | undefined>
}
```

In behavioral notation:

- `start({ sessionID, goal, cap? }) -> GoalState`
- `stop(sessionID) -> void`
- `status(sessionID) -> GoalState | undefined`

`start` defaults `cap` to 25. `stop` removes process-local state. `status` returns a snapshot when
public Goal state exists and returns `undefined` after an internally failed run. The failure marker
is Core-internal and does not add a method, input, return variant, or `GoalState` field.

### Required supervisor changes

The existing public contract stays fixed, but the internal supervisor MUST change in five areas:

1. **Adaptive steering:** replace the fixed continuation prompt with a steer derived from the stable
   goal, unresolved requirements, transcript, latest assistant result, tool/test evidence, and the
   current verification gap.
2. **Stable goal and revision invalidation:** external steering MUST reset `iteration` to `0` and
   inform the next adaptive steer without assigning the external prompt text to `GoalState.goal`.
   Only an explicit new start or `Revise` creates a new goal revision. A new revision invalidates all
   prior completion claims, verification results, and queued follow-ups; late older-revision results
   MUST be ignored.
3. **Continuous event readiness:** after a successful start, the event subscription and coordinator
   MUST remain continuously ready while the run is starting or active. Every terminal path MUST
   finalize both resources: verified completion, `Step.Failed`, exhaustion, explicit
   `stop(sessionID)`, replacement `start`, or process-scope disposal.
4. **One-shot exhaustion:** only a clean non-completing turn may consume the final attempt and set
   inactive `iteration === cap`, leaving status for one TUI exhaustion decision. The supervisor MUST
   NOT enqueue a question or autonomously restart, and MUST finalize that run's event resources.
5. **Terminal step failure precedence:** process `Step.Failed` before completion or cap evaluation at
   every iteration, including the final allowed attempt. Core marks that run internally failed,
   removes its public Goal status so `status(sessionID)` returns `undefined`, and finalizes run
   resources. The TUI selection remains set and the existing session error surface presents the
   failure. A new user free-text prompt or explicit restart starts another run; failure MUST NOT
   continue, verify, become exhaustion, or open exhaustion UI.

These are required implementation changes, not descriptions of the current fixed-reminder loop.
The fixed reminder and fixed-goal replacement behavior are forbidden by this design.

### Attempt and verification flow

The TUI starts ordinary runs without a `cap`, preserving the hidden default of 25. Each supervisor
follow-up increments `iteration`. An external steer admitted during the current run resets
`iteration` to `0`, preserves the goal and cap, invalidates in-flight verification for the previous
turn, and becomes context for the next adaptive decision.

For each terminal event or safe session-idle boundary, apply this precedence:

1. If `Step.Failed` arrives, mark the run internally failed, remove public Goal status, finalize run resources, and present failed selected-idle through the existing session error surface. Stop; do not evaluate completion or cap.
2. Otherwise, if the latest clean result claims completion, issue internal verification against the current revision.
3. If verification passes, set `active` false, finalize run resources, and present verified selected-idle.
4. If verification fails or clean work remains below cap, issue the adaptive follow-up.
5. Only when a clean non-completing turn consumes the final attempt, retain inactive `iteration === cap`, finalize run resources, and present exhausted selected-paused.

Verified completion, `Step.Failed`, and exhaustion are distinct terminal outcomes. None retains a
live event subscription or coordinator for that run. Failed Core state is internal and `status`
returns `undefined`; the TUI selection and existing session error surface preserve the user-facing
failed selected-idle state. Verified and failed outcomes accept the next eligible user free-text
prompt as a new Goal run; exhaustion requires `Continue`, `Revise`, or `Stop` from the TUI dialog
before another run begins.

There remains one explicit `llm.stream(request)` call per provider turn. The supervisor reuses
durable `SessionV2.prompt` admission and `SessionExecution.wake`; it does not add an in-memory tool
loop.

## Exhaustion Dialog

Exhaustion is owned by the TUI. When the current selected session first observes inactive
`status.iteration === status.cap` from a clean non-completing turn, it opens one `DialogSelect`
titled `Goal iteration limit reached`:

- `Continue`: call `start` with the same stored goal and no cap override, creating a fresh 25-attempt run.
- `Revise`: call `stop`, keep Goal selected, focus the prompt, and use the next eligible free text as a new goal revision.
- `Stop`: call `stop` and deselect Goal.

The TUI keys the displayed decision by session, goal, iteration, and cap so duplicate polling or
event delivery cannot reopen it for the same exhausted run. `Continue` creates a new run that may
later reach its own one-shot exhaustion dialog.

This dialog MUST NOT be represented as `question.asked`. Yolo question automation therefore cannot
select `Continue`, `Revise`, or `Stop`.

## TUI Surface

- Rename the permission palette title to `Enable/Disable yolo mode`.
- Render the Yolo prompt badge as exact label `yolo` with `theme.error`.
- Render the Goal prompt badge as exact label `goal` with `theme.warning` whenever Goal is selected.
- Do not render attempts, cap, completion state, or Goal progress in a badge or sidebar.
- Goal and Yolo toggles update only their own selection.

## Failure and Concurrency Rules

- Automatic permission or question reply failure restores only unresolved pending requests.
- Duplicate `question.asked`, permission, idle, completion, and exhaustion observations are coalesced.
- Toggle-off and `stop(sessionID)` interrupt local Goal work and ignore late results without changing Yolo.
- A replacement start or revision supersedes queued steering and verification from older revisions.
- External steering resets the current budget but does not replace the goal.
- `Step.Failed` is evaluated before cap exhaustion, including on the final allowed attempt; it marks Core run state internally failed, clears public Goal status, finalizes run resources, and keeps Goal selected-idle on the existing session error surface.
- `Step.Failed` is not exhaustion and cannot open or key the exhaustion dialog; only a clean non-completing final attempt may retain inactive `iteration === cap`.
- Goal-only permission denial or an unresolved `ask` pauses progress for user input; it does not enable Yolo.
- Process exit loses Goal selection and run state; no post-crash continuation is attempted.

## Implementation Areas

- `packages/schema/src/v1/question.ts` and `packages/schema/src/question.ts`: optional `recommended` marker.
- `packages/tui/src/util/question.ts`: deterministic single, multiple, and Goal free-text answers.
- `packages/tui/src/context/sync.tsx`: `goal.answering` question routing and reply recovery.
- `packages/tui/src/context/goal.tsx`: independent toggle, lifecycle derivation, and unchanged API consumption.
- `packages/tui/src/app.tsx`: toggle command and TUI-owned one-shot exhaustion `DialogSelect`.
- `packages/tui/src/component/prompt/index.tsx`: next-free-text Goal capture and exact badge tokens.
- `packages/core/src/session/goal.ts`: adaptive steering, stable goal, revision invalidation, active-run readiness, terminal resource finalization, and hidden cap behavior.

## Acceptance Tests

- Cover every row of the independent mode matrix for permissions and question shapes.
- Verify single-choice recommended/first fallback and multiple-choice recommended/all semantics.
- Verify Goal answers every question shape only during starting/active and uses the exact free-text fallback.
- Verify awaiting initial goal, verified selected-idle, failed selected-idle, and exhausted selected-paused states fall back to Yolo-only or manual question behavior.
- Verify `/goal`, `/goal-mode`, and the palette toggle on first invocation, toggle off on repeat, and never alter Yolo.
- Verify goal capture consumes the next eligible free-text prompt and calls `start({ sessionID, goal })`.
- Verify the full unchanged API, optional cap, return types, status behavior, and four `GoalState` fields.
- Verify adaptive steers incorporate unresolved work and current evidence; reject the fixed reminder.
- Verify external steering resets iteration, preserves goal and cap, and invalidates in-flight turn verification.
- Verify a revised goal invalidates stale completion, verification, and queued follow-ups.
- Verify event readiness remains continuous while starting/active and resources finalize on verified completion, `Step.Failed`, exhaustion, stop, replacement start, and disposal.
- Verify completion becomes verified selected-idle, retains sub-cap status and selection, finalizes resources, and emits no autonomous follow-up.
- Verify ordinary `Step.Failed` becomes failed selected-idle, makes `status` return `undefined`, retains TUI selection, uses the existing session error surface, finalizes resources, and starts no new run until user free text or explicit restart.
- Verify final-attempt `Step.Failed` wins before cap evaluation, makes `status` return `undefined`, and never opens or keys the exhaustion dialog.
- Verify only a clean non-completing final attempt becomes selected-paused with inactive `iteration === cap`, finalizes resources, and opens its one-shot dialog.
- Verify exhaustion opens one TUI `DialogSelect`, never emits `question.asked`, and each option has the specified transition.
- Verify default and continued runs use hidden cap 25; assert no counter or sidebar.
- Verify exact badge pairs: `yolo` / `theme.error` and `goal` / `theme.warning`.
- Verify process disposal loses Goal state and no durable recovery is claimed.

## Normative Audit and Acceptance Gates

Implementation acceptance requires evidence that every control below passes. A control is not
considered resolved merely because it is documented.

| ID | Severity | Evidence | Risk | Required Control / Acceptance Gate |
|---|---|---|---|---|
| AUD-001 | Critical | REQ-007 and the mode matrix assign permissions solely to Yolo plus configured permission rules. | A second Goal destructiveness list could approve operations that policy classifies as `ask` or `deny`. | Configured permission rules define destructiveness; tests MUST prove Goal never classifies or approves permissions. |
| AUD-002 | Critical | The active Goal+Yolo matrix row combines autonomous work with Yolo automatic permission replies. | The combination intentionally removes interactive permission checkpoints for Yolo-approved `ask` requests. | Goal+Yolo intentionally auto-approves `ask` through Yolo only; acceptance requires independent toggles and the exact red Yolo badge. |
| AUD-003 | High | REQ-005 limits Goal auto-answering to `starting` or active below cap. | Selection-only answering could auto-answer while the user is composing an initial/revised goal, after completion or failure, or at exhaustion. | Tests MUST prove awaiting, verified-idle, failed-idle, and exhausted-paused states do not use Goal answers; Yolo behavior still applies independently. |
| AUD-004 | High | REQ-003 forbids the current fixed continuation reminder. | A generic prompt can repeat completed work and ignore verification or tool evidence. | Acceptance requires adaptive follow-up tests that fail for fixed reminder output. |
| AUD-005 | High | REQ-008 and REQ-013 preserve `GoalState.goal` across external steering. | Replacing the goal with a steer silently changes completion criteria and makes verification target the wrong objective. | External steering MUST reset iteration and update context without assigning to `goal`; stable-goal tests are mandatory. |
| AUD-006 | High | REQ-013 assigns revisions to explicit new starts and `Revise`. | Late completion or verification from an older goal could complete a revised goal. | Revision MUST invalidate stale completion, verification, and queued follow-ups; late older-revision results MUST be ignored in tests. |
| AUD-007 | High | REQ-012 limits continuous readiness to starting/active and defines all terminal cleanup paths. | Early teardown can lose active-run events; retaining resources after terminal state can process stale events or leak fibers. | Tests MUST prove uninterrupted starting/active readiness and finalization on verified completion, `Step.Failed`, exhaustion, stop, replacement start, and scope disposal. |
| AUD-008 | High | REQ-009 assigns exhaustion only to a clean non-completing final attempt and a one-shot TUI `DialogSelect`. | Using `question.asked` would let Yolo choose an action; broad `>= cap` detection could misclassify failed or stale state as exhaustion. | Exhaustion MUST require inactive `iteration === cap` from a clean turn, never emit `question.asked`, render once, and require explicit `Continue`, `Revise`, or `Stop`. |
| AUD-009 | Medium | REQ-008 fixes the hidden default cap at 25 and resets it on external steering. | A visible counter changes the approved UI; failure to reset can exhaust immediately after user guidance. | Tests MUST assert `GOAL_MAX_ITERATIONS = 25`, external reset to zero, and no counter/sidebar rendering. |
| AUD-010 | High | REQ-002 defines Goal controls as toggles. | Treating repeat invocation as idempotent selection prevents users from stopping Goal through the advertised control. | Toggle tests MUST cover first-select and repeat-deselect from every lifecycle state without changing Yolo. |
| AUD-011 | Medium | REQ-004 leaves verified completion selected-idle. | Deselecting on completion removes the badge and changes next-free-text handling. | Completion MUST end autonomous work without clearing selection; the yellow Goal badge remains until toggle-off. |
| AUD-012 | High | REQ-011 records the existing `start`, `stop`, `status`, and `GoalState` contract. | A start/stop-only implementation claim could delete used status and cap behavior or trigger unnecessary protocol churn. | API acceptance MUST preserve `start({sessionID, goal, cap?})->GoalState`, `stop(sessionID)`, `status(sessionID)->GoalState|undefined`, and fields `goal`, `active`, `iteration`, `cap`. |
| AUD-013 | Medium | REQ-014 accepts process-local selection and run state. | Restart or ownership movement loses selected-idle and active Goal state. | Acceptance permits process-local persistence only; docs and tests MUST make no durable recovery or post-crash continuation claim. |
| AUD-014 | Medium | REQ-010 fixes exact prompt-bar presentation. | Neutral or ambiguous badges could hide Yolo risk posture or regress into removed progress UI. | Render exactly `yolo` with `theme.error` and `goal` with `theme.warning`; render no suffix, counter, or Goal sidebar. |
| AUD-015 | High | REQ-005 allows all question shapes to be answered during starting/active runs. | The deterministic fallback can choose an unintended option or infer poor free text without review. | This risk is accepted only for starting/active Goal runs; recommended/first/all selection and the exact free-text fallback MUST pass tests. |
| AUD-016 | Critical | REQ-015 gives `Step.Failed` precedence over cap exhaustion and keeps failure outside the public `GoalState` contract. | A final-attempt failure misclassified as exhaustion could offer `Continue` after a failed operation and hide the existing session error surface. | At every attempt, failure handling MUST run before completion/cap checks, mark Core state internally failed, make `status` return `undefined`, retain TUI selection and the existing error surface, finalize resources, open no exhaustion controls, and require new free text or explicit restart. |

## Self-Review

- Source integrity: the unchanged live API is separated from required internal supervisor changes.
- Consistency: Goal and Yolo remain independent; `Step.Failed` wins before cap evaluation, while only a clean final attempt produces exhausted selected-paused.
- Required changes: adaptive steering, stable goal, revision invalidation, active-run readiness, terminal resource finalization, and one-shot TUI exhaustion are explicit acceptance gates.
- Risk disposition: process-local persistence and active-run all-question answering are accepted only under their stated gates.
- Implementation acceptance requires passing evidence for every `REQ-*` and `AUD-*` gate.
