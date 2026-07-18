# Goal Requirements Alignment Design

Date: 2026-07-18
Status: Approved baseline

## Context

Goal mode already persists active state, supervises provider turns, answers structured questions, and restores Goal context after compaction. This design closes the remaining gaps between that implementation and the required TUI behavior.

It supersedes the session-readiness, manual-recovery, and command-palette rules in [Goal Start and Recovery Design](./2026-07-17-goal-start-recovery-design.md).

## Behavior and Acceptance

| ID | Required observable behavior | Edge or failure behavior | Acceptance check | Non-goal |
|---|---|---|---|---|
| R1 | From Home, `/goal <text>` creates a session, completes workspace bootstrap, synchronously initiates editor reconnection, and completes session synchronization, then starts Goal supervision exactly once. | Any failed or stale readiness step prevents Goal admission, restores the owned command when still current, and shows the existing error toast only for readiness failure. | TUI tests hold readiness stages and prove stale submissions or navigation cannot continue to `goalStart`; keyboard Enter covers the Home path. | Redesigning general session navigation. |
| R2 | An active Goal answers structured single-choice and multi-choice questions on the user's behalf. | Recommended options win; otherwise one option is selected for single choice and all options for multiple choice. A question with no options receives the autonomous fallback answer. | Focused Core tests cover recommended and fallback answers. | Automatically approving permission requests. |
| R3 | When an assistant asks a free-text question in the timeline and the turn becomes idle, Goal supervision submits the next autonomous continuation without user input. | A continuation failure leaves the Goal active and stalled so reopening can recover it. | A Core test ends a turn with an assistant question and verifies the queued continuation, assistant context, and execution wake. | Parsing arbitrary assistant prose into a new question protocol. |
| R4 | Reopening a session with a durable active Goal resumes supervision automatically. | Recovered Goals begin stalled; status/resume operations remain serialized and stale responses cannot overwrite newer state. | A TUI test returns an active stalled status and verifies one automatic resume. A Core test verifies controller failure transitions to stalled. | Starting provider work at process boot before a user opens the session. |
| R5 | Goal supervision continues across automatic and overflow compaction. | Compaction failure does not delete or deactivate Goal state. | A runner integration test verifies the post-compaction provider request contains the active Goal and the supervisor advances after the retried turn. | Changing compaction policy or summaries. |
| R6 | The command palette has no Goal action while inactive. While Goal is active, starting, or stalled, it shows only `Stop goal mode`. `/goal <text>` is the sole start path. | Stalled Goals auto-resume on reopen; the palette never exposes Start or Resume. | TUI palette tests cover inactive absence and active/starting/stalled Stop behavior. | Adding a persistent Goal preference or an inactive ON state. |

## Architecture

### Home readiness boundary

The Home submission path uses the session returned by creation to complete the same prerequisites required by the session route before navigation and Goal admission. Before the first readiness mutation, and after every awaited readiness stage, it requires the Home route, the current prompt submission revision, and the original Home Goal ownership to still match:

1. Adopt the created session's workspace when it differs from the current workspace, then complete the existing non-fatal workspace bootstrap.
2. Recheck lifecycle ownership after bootstrap.
3. Synchronously initiate editor reconnection to the created session directory, then recheck before session synchronization.
4. Complete the existing session synchronization for metadata, messages, todos, diffs, and parts, then recheck ownership.
5. Adopt the Home Goal, navigate to the session, and call Goal start.

The session route remains idempotent and may repeat its normal synchronization after navigation. No timer or new readiness service is introduced.

### Autonomous question handling

`GoalSupervisor` remains the authority for structured Goal questions. It listens for matching `QuestionV2.Event.Asked` events and replies through the existing `QuestionV2` service.

Assistant free-text questions remain ordinary assistant output. At `SessionEvent.Step.Ended`, the supervisor includes the latest assistant result in its existing queued continuation prompt and wakes session execution. Permission events remain owned by permission and Yolo configuration.

### Recovery

Core recovery continues to reconstruct durable active rows as stalled without starting provider work at process boot. When the TUI opens a session, one polling request may be in flight at a time. After refresh and before calling the existing Goal resume endpoint, polling requires that cleanup has not cancelled the effect and that the same session is still current. Cleanup marks the effect cancelled before clearing its timer and presentation state.

Unexpected supervisor-loop failure records a warning and owner-safely transitions the active Goal to stalled instead of swallowing the error while leaving an unrecoverable running state.

### Compaction

The runner keeps its existing behavior: each rebuilt provider request reloads durable Goal context after compaction. The change adds integration coverage rather than another context mechanism.

### Command palette

The visible Goal command is a stop-only action. The command-palette filter hides the prompt's `goal.start` command unless its current action is Stop, while slash autocomplete continues to expose `/goal`. The action invokes the existing stop operation for active, starting, or stalled state. Bare `/goal` may still request goal text inside the prompt flow; `/goal <text>` remains the only admission path.

## Implementation Map

| Requirement IDs | Exact paths and symbols | Reused code | Change | Owner | Dependencies | Focused check |
|---|---|---|---|---|---|---|
| R1, R6 | `packages/tui/src/component/prompt/index.tsx` — `Prompt.submitInner`, `promptCommands`; `packages/tui/src/component/command-palette.tsx` — `isVisiblePaletteCommand` | `project.workspace`, `sync.bootstrap`, `sync.session.sync`, `editor.reconnect`, `goal.stop`, existing slash-command selector | Complete Home readiness before Goal start; expose active-only Stop without removing `/goal` autocomplete. | TUI owner | Existing session-create result and Goal API | TUI Goal and lifecycle tests |
| R4 | `packages/tui/src/context/goal.tsx` — route polling effect, `refresh`, `resume` | Existing serialized Goal request queue | Resume active stalled status after open. | TUI owner | Existing status/resume endpoints | TUI recovery test |
| R2, R3, R4 | `packages/core/src/session/goal.ts` — `run`, `attach` | Existing question service, continuation prompt, `setState` | Preserve question behavior; make loop failure recoverably stalled. | Core owner | Existing Goal lifecycle lock and event stream | Core Goal tests |
| R5 | `packages/core/test/session-runner.test.ts` | Existing compaction and Goal context fixtures | Add supervisor-plus-compaction regression coverage. | Core owner | Existing runner behavior | Focused runner test |
| R1-R4 | `packages/core/test/session-prompt.test.ts`, `packages/core/test/session-goal.test.ts`, `packages/tui/test/context/goal.test.tsx`, `packages/tui/test/app-lifecycle.test.tsx` | Existing harnesses | Replace stale prompt assertion and add missing acceptance cases. | Respective owner | Production changes above | Package-scoped tests |
| R1-R6 | This document and the supersession note in the 2026-07-17 design | Existing approved requirements | Keep documentation aligned with the accepted behavior. | Integrator | Owner handoffs | Document review |

## Interfaces

No public API or protocol changes are required.

| Interface | Producer | Consumer | Existing shape | Wave |
|---|---|---|---|---|
| Goal status | Core/Server | TUI Goal context | `{ goal, active, iteration, cap, phase }` | 1 |
| Goal resume | Core/Server | TUI Goal context | `resume(sessionID) -> GoalState | undefined` | 1 |
| Goal stop | Core/Server | TUI prompt command | `stop(sessionID) -> void` | 1 |
| Structured question reply | Core Question service | Goal supervisor | `{ requestID, answers: string[][] }` | 1 |

Generated clients, schemas, migrations, dependencies, and the app client remain unchanged.

## Dependency Waves

| Wave | Owners | Requirements | Prerequisites | Fan-in condition |
|---|---|---|---|---|
| 1 | TUI owner and Core owner in parallel | TUI: R1, R4, R6. Core: R2, R3, R4, R5. | This approved design | Each owner reports exclusive-path changes and focused checks. |
| Integration | Integrator | R1-R6 | Both Wave 1 handoffs | Conflicts resolved, docs aligned, assembled checks complete. |

## Validation

Run tests from package directories:

```sh
cd packages/tui
bun test test/context/goal.test.tsx test/app-lifecycle.test.tsx
bun typecheck

cd packages/core
bun test test/session-goal.test.ts test/session-runner.test.ts test/session-prompt.test.ts
bun typecheck
```

Baseline evidence before implementation:

- TUI Goal/lifecycle tests: 66 passed.
- Core Goal/runner tests: 130 passed.
- The focused initial-Goal wake test fails only because it expects raw Goal text instead of the current supervised prompt; its wake assertion is not reached.
- The worktree is clean on `goal-mode-review`.

## Closure

- [x] Complete destination and non-goals are explicit.
- [x] Every requirement has observable acceptance behavior.
- [x] Every requirement maps to exact change locations, one owner, dependencies, and checks.
- [x] Every changed path has one owner or the integrator.
- [x] Every cross-owner interface is existing and available in Wave 1.
- [x] Shared documentation is integrator-owned; no generated path changes.
- [x] No material assumption, contradiction, or unresolved decision remains.

## Approval Baseline

- Approved requirement IDs: R1-R6.
- Approved approach: boundary-owned TUI recovery with Core recoverable failure state.
- Approved waves: parallel TUI and Core owners, then one integration fan-in.
- Approved deferral: no process-boot provider execution and no app-client expansion.
- Approved non-goals: permission auto-approval, API changes, dependencies, migrations, generated clients, and compaction redesign.
