# Goal Start and Recovery Design

Date: 2026-07-17
Status: Approved design

## Context

This design extends and partially supersedes [Goal Live Progress and Skill Reference Design](./2026-07-16-goal-progress-design.md).

The current Home flow creates a session, starts Goal admission, and navigates without waiting for the new session to finish hydration. Goal admission persists state before the detached runner reaches a provider step, so a failed or unready run can leave an inert Goal with no visible execution progress. A later `Step.Failed` retires the Goal and makes status return no value, causing the band to disappear instead of showing a recoverable failure.

Compaction does not delete the durable `session_goal` row. However, the post-compaction runner reads history from the newest compaction checkpoint, and Goal is not a session-specific system-context source. If the summary and recent window omit the Goal, the immediate post-compaction provider turn can lose it.

The current band also shows only a derived target. It does not show the effective Goal after later user instructions change scope.

## Goals

- Start Goal from Home only after the created session is connected and fully hydrated.
- Show the effective current Goal above the current target.
- Let the existing Goal model turn update the effective Goal without an additional model call.
- Preserve active Goal context deterministically across compaction.
- Keep failed Goal state visible and resumable.
- Preserve ordinary `todowrite` behavior outside Goal mode.
- Reuse the existing `session_goal.goal` column without a database migration.

## Non-goals

- Adding a separate Goal-evaluation model request.
- Inferring the effective Goal from only the latest user message.
- Preserving the initial `/goal` text as a second authoritative Goal after the model reconciles later instructions.
- Changing legacy TaskTool provider or model precedence.
- Automatically retrying failed provider calls.
- Resuming an interrupted supervisor fiber after process restart.

## Superseded Behavior

This design replaces these rules from the 2026-07-16 design:

- Home no longer starts Goal admission immediately after session creation. It navigates and awaits session hydration first.
- `session_goal.goal` is no longer an immutable copy of the first `/goal` text. It stores the latest model-evaluated effective Goal.
- A provider-step failure no longer retires and hides an active Goal. It transitions the Goal to a stalled state.
- When no todo exists, the current target no longer repeats the Goal text. It displays `Preparing task list`.

All other progress calculation, skill-reference rendering, and todo-ordering behavior remains unchanged.

## User Experience

### Home start

Submitting `/goal <text>` from Home follows this sequence:

1. Capture and clear the submitted command.
2. Create the session with the selected agent, model, and variant.
3. Transfer Goal selection to the created session and navigate to it.
4. Await the existing session synchronization promise.
5. Start Goal admission with the captured text and attachments.

Goal is not persisted or submitted before session synchronization succeeds. If session creation, synchronization, or Goal start fails, the TUI clears pending state, restores the exact command and attachments when ownership is still current, and shows the existing error toast.

Starting Goal in an already hydrated session continues to admit immediately.

### Goal band

The compact band remains directly above the composer and renders:

1. The full-width progress bar.
2. `Current goal · <effective Goal>`.
3. `Current target · <in-progress or next pending todo>`.
4. The resolved-count and percentage summary.

Before the first todo update, the target is `Preparing task list`. The effective Goal initially equals the `/goal` text. Later Goal turns can replace it with a concise reconciliation of the original request, newer user instructions, and current evidence.

When Goal is stalled, the band remains visible and uses the existing accent treatment with a stalled status. It does not display a second instructional card or duplicate the sidebar todo list.

### Palette action

The command palette continues to expose one Goal action. Its label and action depend on state:

- No selected Goal: `Start goal mode`.
- Running Goal: `Stop goal mode`.
- Stalled Goal: `Resume goal mode`.

Resume submits a fresh supervised turn for the persisted effective Goal. It does not attempt to revive the previous fiber or automatically retry without user action.

## Architecture

### Session readiness boundary

The Prompt Home path uses the existing `sync.sync(sessionID)` promise as the readiness boundary. Goal start is invoked only after that promise resolves. This removes the race between Goal admission and session-route hydration without adding timers, polling, or a new readiness abstraction.

The existing Home ownership revision still protects command restoration from stale asynchronous responses.

### Effective Goal through `todowrite`

`todowrite` accepts an optional `goal` string alongside `todos`. The Goal supervision prompt requires the model to include a concise effective Goal when it creates or updates the Goal task list.

Within an active Goal session, one tool execution updates the todo list and the effective Goal through the same application operation. The Goal supervisor updates its in-memory state and persists the new value to the existing `session_goal.goal` column before the next provider turn.

Outside active Goal mode, todo-only input and output remain unchanged. An unexpected `goal` value without an active Goal does not create Goal mode.

The initial Goal text remains the fallback until the first accepted evaluated update. Once replaced, the evaluated Goal is authoritative for display, continuation prompts, verification prompts, resume, and compaction context.

### Goal phases

The client-visible Goal status distinguishes:

- `starting`: admission or resume has not reached a provider step.
- `running`: the supervisor has an active provider turn or is waiting at a normal continuation boundary.
- `stalled`: the latest provider turn failed or the Goal was recovered after process restart without its old supervisor fiber.

The durable row remains active while stalled. The phase is process state: recovered active rows are reconstructed as stalled, so no phase column or migration is required.

`Step.Failed` still records the existing self-improvement outcome signal. It then clears the failed turn and marks the Goal stalled instead of setting `active: false`, deleting status, or closing the supervisor scope. Explicit stop, verified completion, and iteration-cap retirement keep their existing terminal behavior.

### Resume

Resume resets the process phase to starting and admits a new supervised turn using the persisted effective Goal. The existing iteration cap remains authoritative. The old provider turn is not replayed, and completed todos remain available.

The public Goal contract exposes resume explicitly rather than overloading start or silently resetting Goal state. Maintained protocol sources are updated first; generated clients are regenerated through the repository command and are never edited manually.

### Compaction-safe Goal context

Each provider-turn request loads the active Goal for its session from durable Goal storage and appends a small privileged system part containing the effective Goal and Goal-mode continuation requirement.

This context is loaded by session ID at request construction time. It does not depend on the generic location-scoped System Context registry, the compaction summary, or the recent-history token window. A post-compaction retry therefore receives the same active Goal even when the summary omits every earlier Goal prompt.

The compaction summarizer does not need special Goal instructions because the runner restores Goal context independently afterward.

### TUI status retention

Transient Goal-status request failures preserve the last known client status. The TUI clears the band only after an explicit stop, verified completion, iteration-cap retirement, confirmed inactive status, or session deletion.

This separates temporary transport failure from an authoritative Goal lifecycle transition.

## Error and Lifecycle Handling

- Session synchronization failure prevents Goal admission and restores the submitted command.
- Goal admission failure before a provider step leaves no partially started Goal and restores the command when possible.
- Provider `Step.Failed` preserves active durable state, records the failure signal, and exposes stalled status.
- Resume failure returns to stalled status and keeps the effective Goal visible.
- Process recovery reconstructs active durable rows as stalled.
- A stale Home start, resume, status response, or tool update cannot overwrite a newer Goal revision.
- Compaction failure does not remove Goal state.
- A transient Goal-status polling error does not clear the last known band.
- Explicit stop and verified completion remain authoritative terminal transitions.

## Test Strategy

### TUI start and presentation

- Home creation navigates before Goal admission.
- `goalStart` is not called until `sync.sync(sessionID)` resolves.
- Session creation, synchronization, and Goal-start failures restore the exact owned command and clear pending state.
- The band renders Current goal above Current target.
- No todos renders `Preparing task list` and `0%` without duplicating the Goal.
- Stalled status remains visible.
- A transient status request failure preserves the last known status.
- The palette exposes exactly one Start, Stop, or Resume action for the current state.

### Goal and todo integration

- The first Goal turn seeds the effective Goal from `/goal` text.
- `todowrite` without `goal` preserves its existing contract.
- `todowrite` with `goal` updates both todos and active Goal state.
- A `goal` field outside active Goal mode does not create a Goal.
- Subsequent continuation and verification prompts use the evaluated Goal.

### Failure and recovery

- `Step.Failed` records the existing failure signal and transitions to stalled without retiring the durable row.
- Resume admits a fresh supervised turn and returns to running after `Step.Started`.
- Resume respects the iteration cap.
- Verified completion and explicit stop still clear Goal status.
- Recovered active rows report stalled and can resume.

### Compaction

- The immediate post-compaction provider request contains the active effective Goal when the summary omits it.
- Goal context reflects the latest accepted `todowrite.goal` value.
- Compaction does not mutate the Goal row or client phase by itself.
- A post-compaction provider failure leaves Goal stalled and visible.

## Acceptance Criteria

- `/goal <text>` from Home waits for session hydration before Goal admission and then starts provider execution.
- The Goal band appears with Current goal, Current target, and progress without duplicate objective text.
- Existing Goal turns can update the effective Goal through `todowrite` without another model call.
- The effective Goal is durable and appears in every provider request after compaction.
- Provider failure and process recovery leave Goal visible as stalled.
- A stalled Goal can be resumed explicitly without recreating the session or losing todos.
- Transient status polling failures do not hide Goal state.
- Ordinary todo-only sessions, progress calculation, skill display, and legacy TaskTool model routing remain unchanged.
