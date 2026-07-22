# TUI Runtime Recovery Design

## Goal

Make valid global configuration effective when provider model capabilities are partial, restore plain Tab agent cycling, and restore persistent session todos in the V2 runtime and TUI.

## Root Cause

The global configuration contains five model overlays with `capabilities.input` and `capabilities.output` but no `capabilities.tools`. `ConfigProvider.Model` currently decodes capabilities as the complete runtime `ModelV2.Capabilities` contract. Those missing keys invalidate the whole configuration document, so unrelated MCP, self-improvement, and model-limit settings are discarded. The TUI separately binds agent cycling to Shift+Tab. Todos were intentionally removed from V2, including storage, runtime, API, client, and TUI state.

## Design

Provider model configuration treats capabilities as an overlay. Each capability field is optional. The provider config plugin updates only supplied fields and preserves discovered catalog values for omitted fields. A custom model without discovered values continues to inherit `Model.Info.empty` defaults.

The default `agent_cycle` keybind becomes plain Tab. Shift+Tab remains available only when explicitly configured.

Todos return as a current V2 domain. A forward-only migration creates durable per-session todo rows. Core owns todo persistence and the agent tool. Protocol exposes current read/write operations and update events; Server delegates to Core; generated clients are regenerated from the maintained contract. TUI data sync consumes the API and events, and a sidebar plugin renders active todos. This does not re-enable or modify `packages/opencode` V1 code.

## Data Flow

1. Config discovery decodes partial provider capability overlays, retaining the complete document.
2. MCP and self-improvement location services read their enabled global settings during startup.
3. Provider catalog overlays apply the configured OpenAI context limit, which session diagnostics project to the sidebar.
4. The todo tool replaces a session's ordered todo list transactionally and publishes one update event.
5. TUI initial sync reads the list; subsequent events refresh it; the sidebar hides when no active items exist.

## Error Handling

Config capability values still validate their supplied types. Todo operations reject unknown sessions through the existing Session boundary and preserve transaction atomicity. Server handlers map domain not-found failures through existing HTTP error conventions.

## Acceptance Checks

- A config document with capability input/output but omitted tools decodes and preserves unrelated MCP, self-improvement, and model-limit settings.
- Omitted capability fields preserve catalog defaults.
- Configured MCP servers are present after location startup.
- `experimental.self_improvement.automatic: true` records terminal session evidence and reports enabled automation.
- The configured OpenAI context limit is 400,000 in effective diagnostics and sidebar state.
- Plain Tab cycles visible primary agents.
- The todo tool persists ordered items; API reads them; update events refresh the TUI; the sidebar shows active items.
- Focused tests, package typechecks, generated-client validation, and affected builds pass.

## Migration and Generation

The approved non-destructive migration adds the current todo table without altering historical dropped data. Public Protocol/Server API changes require `bun run generate` from `packages/client`. No dependencies change.
