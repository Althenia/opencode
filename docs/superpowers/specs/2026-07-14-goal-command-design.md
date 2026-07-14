# Goal Command Design

## Contract

- `/goal <goal text>` starts supervised Goal execution immediately.
- `/goal stop` stops the active Goal for the current session.
- Bare or whitespace-only `/goal` does not create, select, stop, or otherwise mutate Goal state; the TUI retains the prompt and displays usage.
- Goal state exists only while a start request is pending or the Goal is active. The former selected-but-idle arming mode is not user reachable.
- The command palette exposes a stop action only when the current session has an active Goal. It does not expose a Goal toggle.
- The HTTP API rejects blank and whitespace-only goals so non-TUI clients cannot create invalid Goal records.

## Scope

The change is confined to the TUI prompt/parser and palette registration, plus protocol validation and its generated client artifacts. Existing Goal supervision, persistence, iteration, and yolo behavior remain unchanged.
