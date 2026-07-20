# TUI Self-Improvement Closed Loop Design

## Goal

Make `opencode` TUI usage feed the existing self-improvement engine automatically. A user enables `experimental.self_improvement.automatic`, prompts normally, and the location-scoped runtime records governed evidence, establishes a trusted control baseline, evaluates generated candidates, and automatically approves governed gates when configured.

## Scope

This design covers every normal local session path that uses the Core `SessionRunner`, including the default TUI, `opencode run`, desktop, and the in-process server. It does not add a TUI-specific implementation or require `opencode serve`.

The implementation must not persist prompt text, assistant text, tool inputs, tool outputs, file contents, or raw errors in self-improvement tables.

## Considered Approaches

### 1. TUI-only event adapter

Listen to TUI SDK events and call the private HTTP API. This is rejected because it misses `opencode run`, desktop, and server-driven sessions, duplicates authorization/configuration, and makes the feature depend on a UI process.

### 2. Core session terminal observer — selected

Add a location-scoped Core service invoked at each terminal prompt-cycle boundary. The observer reads durable projected session messages, derives privacy-safe evidence, persists control evidence, bootstraps a baseline, and submits samples to eligible evaluation runs. This covers every frontend with one implementation and survives process restarts through idempotent task digests.

### 3. External telemetry processor

Publish session telemetry to a separate worker that feeds the private API. This preserves isolation but adds deployment, ordering, authentication, and failure-recovery complexity that is unnecessary for the local MVP.

## Architecture

### `SelfImprovementSessionObserver`

A location-scoped Core service receives `{ sessionID, exit }` after one promoted prompt cycle reaches a terminal state. It loads the latest durable user message and subsequent assistant messages.

It derives:

- `taskIDDigest`: SHA-256 of the location ID and latest user message ID.
- `workload`: `agent:<selected-agent-id>`.
- `workloadRevision`: revision `1`.
- `outcomeClass`: `success`, `failure`, or `cancelled`.
- `errorClass`: a stable class such as `none`, `session.interrupted`, `tool.<name>.failed`, `provider.failed`, or a typed Effect error tag. Raw error messages are never stored.
- `orderedToolSymbolIDs`: unique tool names in first-call order.
- deterministic metrics from terminal timestamps, tool outcomes, and accumulated token usage.

The observer invokes the existing governed evidence command for observations. It also persists a redacted session-evidence row containing only digests, metric JSON, outcome, timestamps, workload, revision, and producer ID.

### Frozen baseline bootstrap

For a workload without a baseline, the observer uses the earliest 20 unique non-cancelled session-evidence rows to create:

- one deterministic suite revision;
- one deterministic baseline;
- aggregate totals and metrics through the existing `SelfImprovementMetrics.aggregate` implementation.

The baseline is immutable after creation. Later sessions cannot rewrite it.

### Evaluation sample emission

For every open run matching the workload and revision whose acceptance window contains the session terminal timestamp, the observer submits one idempotent metric sample using the existing private evidence command. Cancelled cycles are observation-only and never become evaluation samples.

### Generation readiness

When automatic mode is enabled, automation initialization idempotently seeds one location-scoped default generation-strategy arm. Eligible failure patterns include stable metadata—workload, revision, error class, tool-symbol digest, and outcome—when requesting generation. Prompt text and raw tool data remain unavailable to generation.

### Automatic approval

Add optional `experimental.self_improvement.auto_approve`. When `true`, the automation coordinator lists pending approval requests and approves them through `SelfImprovementPrivateArtifactCommand.approve` using a dedicated `location-approver` principal. Existing approval binding, idempotency, audit, consumption, context reconciliation, and rollback rules remain authoritative.

## Session Data Flow

1. TUI promotes a durable user prompt.
2. `SessionRunner` executes provider and tool turns.
3. The prompt cycle reaches success, failure, or interruption.
4. `SelfImprovementSessionObserver` derives and persists privacy-safe evidence exactly once.
5. The observer records an observation.
6. The observer bootstraps the frozen baseline after 20 unique control samples.
7. The observer appends a sample to matching open shadow/canary runs.
8. The existing automation loop generates candidates, opens runs, decides expired runs, optionally approves pending requests, and reconciles context.

## Error Handling

- Session completion must never fail because self-improvement evidence failed. Observer failures are logged and isolated.
- Evidence writes are idempotent by stable task digest and request digest.
- Duplicate baseline/suite creation is treated as successful concurrent initialization.
- Invalid or late samples are skipped with a warning; they do not alter session results.
- Automatic approval uses the existing command boundary and fails closed.

## Configuration

```jsonc
{
  "experimental": {
    "self_improvement": {
      "automatic": true,
      "auto_approve": true,
      "interval_seconds": 60,
      "evaluation_window_minutes": 60
    }
  }
}
```

`automatic: false` or absent keeps the observer side-effect free.

## Verification

The implementation is complete only when all of these pass:

- observer RED/GREEN tests for success, failure, cancellation, idempotency, baseline bootstrap, and run sample emission;
- automation tests for strategy seeding and governed automatic approval;
- session-runner integration test proving a normal prompt cycle invokes the observer;
- all Core self-improvement tests;
- all OpenCode self-improvement HTTP/E2E tests;
- Core and OpenCode typechecks;
- `bun run build --single --skip-install` with native `--version` smoke test.
