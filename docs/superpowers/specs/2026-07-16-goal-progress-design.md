# Goal Live Progress and Skill Reference Design

Date: 2026-07-16
Status: Approved design

## Context

This design extends [Goal Command Design](./2026-07-14-goal-command-design.md). The current TUI waits for the Goal start request before clearing the composer and navigating from Home, so `/goal <text>` can appear inert after Enter. Goal state also exposes only the original objective, activity, and iteration count even though the existing session todo service already tracks concrete work.

Skill references have a related display inconsistency: autocomplete renders `$writing-test` as `✦ writing-test`, but submitted user messages show the raw `$` prefix in the timeline.

## Goals

- Give immediate visual feedback after submitting `/goal <text>`.
- Show compact, deterministic Goal progress above the composer.
- Keep the first Goal prompt as durable direction while the current target follows live todo state and later user context.
- Render known skill references with the existing `✦` skill glyph in submitted timeline messages.
- Expose one context-sensitive Goal action in the command palette instead of separate Start and Stop entries.
- Reuse current Goal, todo, sync, and theme infrastructure without adding a database migration or icon dependency.

## Non-goals

- Rewriting the original Goal as context changes.
- Model-estimated progress percentages.
- A second todo list inside the Goal band.
- Persisting derived progress or current-target fields.
- Replacing `$` inside the composer, logs, exports, code samples, currency, or unknown references.
- Downloading or bundling a new icon asset.

## User Experience

### Immediate Goal start

Submitting `/goal <text>` captures the command before any asynchronous work, clears the composer, and presents a compact Goal band immediately:

- State: `Starting`
- Progress: `0%`
- Current target: the original Goal text

When submission begins on Home, the optimistic state exists before session creation and transfers to the newly created session. The TUI navigates as soon as the session exists instead of waiting for the Goal start request to finish. The session view therefore shows `Starting` while durable prompt admission is still in progress.

If session creation or Goal start fails, the optimistic state is removed, the original `/goal <text>` command is restored to the focused composer, and the existing error toast reports the failure.

### Compact status band

The selected layout is a full-width compact band directly above the composer. It contains:

1. A progress bar spanning the available content width.
2. `Starting · <original objective>` while admission is pending, otherwise `Current target · <derived target>`.
3. A summary such as `5 of 8 resolved · 63%`, shortened to `5/8 · 63%` when the available row is too narrow.

The band does not repeat the original Goal as a separate header and does not duplicate the full todo list already available in the sidebar. It remains stable in height as values change and fits narrow terminals by wrapping the target before truncating meaningful text.

### Command palette

Superseded by [Goal Requirements Alignment Design](./2026-07-18-goal-requirements-alignment-design.md): the palette exposes only `Stop goal mode` while Goal is active and no Goal action while inactive. `/goal <text>` is the sole start path.

### Progress calculation

Progress is derived exclusively from the current session todo list:

```text
resolved = completed + cancelled
progress = resolved / total
```

- No todos: `0%`.
- All todos resolved: `100%`.
- The displayed percentage is rounded to the nearest whole number.
- Progress is clamped to `0...100` for defensive rendering.

Cancelled work counts as resolved because it is no longer remaining work. The band updates from the existing `todo.updated` event flow; no polling or separate progress event is added.

### Current target and evolving context

The first `/goal <text>` prompt remains the durable objective. The displayed current target is derived in this order:

1. First todo with status `in_progress`.
2. First todo with status `pending`.
3. Original objective when no actionable todo exists.

The Goal supervisor continues treating later user prompts as steering context. Its first provider turn must include the same supervision instructions used by continuation turns, including the requirement to create and maintain the goal-oriented todo list. The visible timeline still presents only the user's original objective, not internal supervision instructions.

As later prompts change direction, the model updates the existing todo list through `todowrite`; the band then changes target and percentage from that authoritative todo state. The original objective remains durable session direction and is used as the target fallback, but is not repeated as a separate band header.

Before starting or delegating work, the Goal supervisor marks the matching todo `in_progress`. Delegated work remains `in_progress` until its result has been reviewed and accepted. The supervisor must not advance the current target to future work while an earlier delegated item is still executing or awaiting review.

### Skill references

Submitted user-message text renders a reference to a currently known skill as:

```text
✦ writing-test
```

The composer continues using `$writing-test` because `$` is the autocomplete trigger and serialized prompt syntax. Timeline formatting only replaces boundary-delimited references whose name matches a known skill command. Unknown `$text`, currency, shell variables, and code content remain unchanged.

The implementation reuses the existing `✦` glyph and display helper; no icon download is necessary.

## Architecture

### Goal context

The TUI Goal context owns one additional optimistic Home presentation containing the original objective and start state. It can:

- begin an optimistic Home start before session creation;
- transfer that presentation to a concrete session ID;
- clear it after success, stop, navigation invalidation, or failure;
- expose the pending objective to the compact band.

The existing per-session serialized request queue remains responsible for ordering Goal status, start, and stop calls.

### Derived presentation

The compact band is a TUI presentation component. It consumes:

- the current Goal status or optimistic start presentation;
- the existing session todo list from synchronized TUI state;
- the current theme.

Progress and target selection remain pure derived calculations in the TUI. The HTTP Goal status contract and `session_goal` table do not change.

### Goal supervision

Initial and continuation turns share the same Goal supervision prompt builder. The initial turn keeps its `steer` delivery, caller-provided message ID, and attachments, but sends the complete supervision text to the provider so todo maintenance begins on the first turn. The supervision text explicitly keeps the todo representing active delegated work `in_progress` until review completes.

The existing prompted-event presentation marker continues replacing that internal text with the original objective for the legacy TUI timeline.

### Timeline skill formatting

User-message rendering receives the current known skill-command names and applies a display-only formatter to non-synthetic text parts. The formatter recognizes standalone `$name` references and replaces only confirmed skill names with `✦ name`.

## Error and Lifecycle Handling

- Session creation failure restores the original command and clears optimistic Home state.
- Goal start failure restores the original command, clears optimistic session state, and leaves no stale selected Goal.
- Goal stop or context disposal clears optimistic presentation.
- A delayed response from an older start cannot overwrite a newer Goal revision.
- An empty todo list never divides by zero and displays `0%`.
- Todo events for another session cannot update the current Goal band.
- Missing or removed skills render with their original `$name` text.

## Test Strategy

### TUI Goal submission

- A delayed Home `goalStart` response still clears the composer and exposes `Starting · 0%` before resolution.
- The TUI navigates after session creation without waiting for `goalStart` completion.
- Session creation and Goal start failures restore the exact original command and remove optimistic state.
- Rapid or overlapping starts preserve revision ownership and cannot display stale objectives.
- The command palette shows exactly one Goal mode entry whose title and action follow active state.

### Progress and target

- No todos produces `0%` and uses the original objective as target.
- Completed and cancelled todos count as resolved.
- `in_progress` wins over `pending`; `pending` wins over the original objective.
- `todo.updated` changes percentage and target for the matching session only.
- Long objectives and targets fit the compact band without overlapping metadata.
- The progress bar spans the available width and the Goal objective is not rendered as a separate header.

### Goal supervision

- The first admitted provider prompt contains todo-maintenance and latest-context instructions.
- Active delegated work remains the `in_progress` todo until its result is reviewed.
- The visible prompted event still displays only the original objective.
- Later external steering remains reflected in subsequent supervision prompts.

### Skill references

- A known `$writing-test` reference renders as `✦ writing-test` in a submitted user message.
- The composer retains `$writing-test`.
- Unknown names, currency, shell variables, and embedded `$` text are unchanged.

## Acceptance Criteria

- Pressing Enter on `/goal <text>` produces visible `Starting · 0%` feedback without waiting for Goal start completion.
- The compact band shows a full-width progress bar, resolved count, percentage, and current target without a duplicate Goal header.
- The first provider turn is explicitly instructed to create and maintain a goal-oriented todo list using full Goal supervision instructions.
- Later user context can change the current target through todo updates without rewriting the original objective.
- Known skill references use `✦` in timeline user messages and `$` in the composer.
- The command palette never shows separate Start and Stop Goal entries together.
- No database schema, Goal HTTP contract, generated client, dependency, or icon asset changes are required.
