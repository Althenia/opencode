# Subagent Model Display

## Goal

Show the provider, model, and optional variant used by each child session in the TUI Subagents composer tab without reducing the list to multiple lines.

## Current Behavior

`packages/tui/src/routes/session/composer/subagents-tab.tsx` builds each row from the child session ID, agent, title, and status. It renders the agent and task title on the left and `Running` on the right. The child session already stores its selected model as `model.providerID`, `model.id`, and optional `model.variant`.

The subagent creation path records `agent.model ?? parent.model` on the child session. Reading the child session is therefore more accurate than resolving the current agent configuration and requires no additional API request or message lookup.

## Design

Extend each `SubagentEntry` with an optional model label derived directly from the corresponding child or sibling session.

Format the label as:

```text
providerID/modelID#variant
```

Omit `#variant` when the session has no variant. Omit the complete label when a legacy session has no model metadata.

Render a right-aligned metadata group containing the subdued model label and the existing status. When both values exist, separate them visually while retaining `Running` at the far right. Keep each subagent on one row. Constrain the model region so long identifiers clip rather than displacing the complete row; the left title remains the flexible region and uses the remaining width.

Example:

```text
General: Fix review findings          openai/gpt-5.6-luna#high  Running
Explore: Review permission task       openai/gpt-5.6-sol
```

## Data Flow

1. Read child or sibling sessions from the existing reactive session list.
2. Build the model label from each session's persisted `model` reference.
3. Store the optional label on `SubagentEntry`.
4. Render the label from the memoized entry; no network request or message loading is introduced.

## Failure and Compatibility Behavior

- A missing model produces no placeholder and preserves the current row layout.
- A missing variant produces `providerID/modelID` without a trailing separator.
- Running and completed rows both show model metadata when available.
- Existing selection, navigation, interruption, scrolling, and status behavior remain unchanged.

## Files

- Modify `packages/tui/src/routes/session/composer/subagents-tab.tsx`.
- Add or update focused tests under `packages/tui/test` following the nearest composer rendering-test pattern.

## Validation

Automated tests must cover:

1. Provider and model rendering.
2. Optional variant rendering.
3. Missing model behavior.
4. Running and completed rows.
5. Constrained-width rendering with a long model identifier.

Run the targeted test and `bun typecheck` from `packages/tui`, never from the repository root.

## Constraints

- Use the persisted child-session model, not current agent configuration or latest-message inference.
- Keep one visual row per subagent.
- Preserve `Running` at the far right.
- Do not change session, protocol, server, or generated client contracts.
- Do not modify or revert unrelated dirty-worktree files.
