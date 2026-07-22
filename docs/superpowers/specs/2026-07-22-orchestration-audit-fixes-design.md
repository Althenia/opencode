# Orchestration Audit Fixes Design

## Goal

Close every actionable finding from the `main` branch audit without broad unrelated cleanup. The result must make durable subagent state authoritative from Core through Protocol, Client, and TUI, bound all newly introduced orchestration payloads, make notification recovery predictable, and restore blocking repository quality gates.

## Approved Scope

1. The TUI Subagents tab lists only durable managed tasks from `session.subagent.list`.
2. The TUI renders durable task states and cancels through `session.subagent.cancel`; it never uses generic Session interruption for managed children.
3. Orchestration payloads use UTF-8 byte limits:
   - description: 4 KiB
   - prompt, parent message, and answer text: 64 KiB
   - question/answer JSON: 8 KiB encoded
   - failure/error text: 16 KiB
   - tool-call ID: 512 bytes
4. Available-subagent descriptions use the same effective permission rules as execution, including Session permission ceilings and saved rules.
5. Internal not-found errors carry the correct parent identity or use a child-only error where no parent exists.
6. Notification recovery drains bounded batches and does not block server startup on the entire backlog.
7. Add route-level and compiled-artifact orchestration acceptance coverage.
8. Fix all blocking lint errors plus orchestration-introduced Effect-pattern violations. The 4,151 non-blocking legacy warnings remain out of scope.

## Architecture

### Durable TUI task source

Add a location-scoped durable subagent task store to the TUI data context. It initially synchronizes with `session.subagent.list(parentID)` and updates from `session.task.updated` events. The Subagents tab reads this store instead of inferring task state from child Sessions.

For a root parent route, the tab shows direct tasks owned by that parent. While viewing a child, it resolves the direct parent and shows that parent's direct managed tasks, preserving sibling navigation. Task metadata comes from the durable `SessionOrchestration.Task` projection: state, description, agent, model, progress, question, and timestamps.

The cancel command is enabled for `starting`, `running`, `waiting`, and `cancelling` states as appropriate. It calls `session.subagent.cancel({ parentID, childID })`. Terminal rows remain visible and show `Completed`, `Failed`, `Cancelled`, or `Lost`; waiting rows show `Waiting`.

### Contract limits

Define reusable byte-bounded schemas in `@opencode-ai/schema/session-orchestration`. Protocol launch/message/answer DTOs reuse those contracts instead of unrestricted `Schema.String` and `Schema.Json` fields. Core truncates only internally generated failure text; public inputs are rejected when oversized so callers receive a deterministic validation error rather than silent mutation.

Persisted `Change.failed.error`, launch description, tool-call ID, task description, parent controls, and answers are all bounded by construction.

### Effective permission discovery

Expose a permission-service operation that evaluates an action/resource pair using the exact effective rules used by `assert`: selected agent rules, Session deny ceiling, and saved rules. The subagent context hook uses this operation when building the available-agent list. Enforcement remains unchanged and authoritative.

### Error identity

Operations that already know the parent continue returning the existing ownership errors. Child-internal operations (`progress`, `question`, `settle`, `background`) use a new child-only `TaskNotFoundError`, avoiding fabricated `parentID: childID` diagnostics. Tool-level mapping remains concise.

### Notification recovery

The notifier drains a fixed batch, ordered by creation time and ID. Startup forks background draining instead of awaiting the complete backlog. Event-triggered dispatch remains serialized. A successful batch schedules another drain when it was full, allowing backlog progress without monopolizing startup. Deterministic conflicts are marked terminally failed or quarantined rather than retried on every task event; missing parents remain retryable only when recovery is plausible.

The batch size is a small constant (100) and covered by tests.

### Acceptance coverage

Add tests at these boundaries:

- Schema: exact UTF-8 and JSON byte limits, including multibyte characters.
- Protocol: launch/message/answer limit enforcement.
- Core: effective permission discovery, child-only errors, bounded notification batches, poison notification handling.
- Server: launch/list/cancel route behavior with location middleware and declared errors.
- Client: durable task list/cancel contracts.
- TUI: initial durable list, event update, status rendering, waiting cancellation, and no generic interrupt call.
- Compiled runtime smoke: launch one background subagent through HTTP, observe durable task state, cancel it through the subagent endpoint, and verify terminal `cancelled` state.

## Error Handling

- Oversized public inputs fail schema decoding with HTTP 400.
- Oversized internal failure causes are truncated to 16 KiB before durable publication.
- TUI synchronization failures preserve the last known task list and expose a non-fatal log/toast path consistent with existing data synchronization.
- Cancellation is idempotent for an already-cancelled task; incompatible terminal states return conflict.
- Notification dispatch failures increment diagnostics and leave retryable records undelivered; deterministic conflicts are quarantined to prevent hot loops.

## Migration and Compatibility

The database schema needs a notification delivery outcome only if poison-record quarantine cannot be represented safely with the existing columns. Prefer adding a nullable delivery error/status column through a new migration rather than changing an existing migration.

Public endpoints remain additive. Existing generated clients are regenerated from Protocol. The generic Session interrupt endpoint is unchanged; only the TUI managed-subagent action moves to the correct endpoint.

## Rollout and Verification

Run sequentially:

1. Focused red/green tests for each slice.
2. Package typechecks and generated-client drift check.
3. Full Core, TUI, CLI, Client, Server, Protocol, Schema, and SDK suites.
4. `lint:effect-patterns`, lint blocking-error check, and lint-rule tests.
5. Deterministic TUI build, artifact smoke, and expanded runtime smoke.
6. Merge to `main`, rebuild there, rerun artifact gates, and restart the managed service.

## Out of Scope

- Cleaning all non-blocking legacy lint warnings.
- Showing unmanaged child/fork Sessions in the Subagents tab.
- Multi-machine orchestration or clustered execution ownership.
- Automatic replay of in-flight provider attempts.
- Redesigning the existing TUI layout beyond durable state correctness.
