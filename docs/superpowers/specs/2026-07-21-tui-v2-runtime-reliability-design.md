# TUI V2 Runtime Reliability Design

## Goal

Make the V2 TUI reliable for real provider and MCP workflows while removing redundant session chrome and proving keymaps work through actual terminal input.

## Scope

- OpenRouter API keys entered through the TUI must reach the outgoing OpenRouter request as `Authorization: Bearer <key>`.
- MCP servers in `needs_auth` must start their registered OAuth integration flow and present the authorization URL instead of retrying an unauthenticated connection.
- Remove the top `session.header` slot because the same project/session context already appears in the sidebar.
- Re-evaluate keymap behavior using physical key events, not command-dispatch-only tests.
- Audit nearby provider, integration, MCP, dialog, and keymap paths for unresolved gaps.

## Architecture

Provider credentials remain stored in the global integration credential store. Model resolution must read the active connection and inject the credential into the provider runtime before the provider SDK is created. Regression coverage will assert the actual HTTP request header.

MCP OAuth remains owned by the existing integration and `MCPOAuth` implementation. The MCP dialog will route `needs_auth` servers into that existing OAuth flow, avoiding duplicated token, PKCE, callback, and persistence logic. Normal connected/disabled/failed behavior remains unchanged.

The session transcript no longer renders the optional top header slot. Sidebar slots remain available.

Keymap verification will simulate terminal keypresses for leader sequences, direct bindings, custom overrides, and modal actions. Command reachability and binding consistency will also be audited.

## Error Handling

- Provider auth tests fail with the captured request headers when authorization is missing.
- MCP OAuth startup failures remain visible through the existing toast/error flow.
- `needs_auth` without a registered OAuth integration reports a precise error rather than silently retrying.
- MCP OAuth attempts retain existing cancellation, expiry, and callback behavior.

## Verification

- Focused red-green tests for OpenRouter request auth, MCP OAuth routing, session layout, and physical key input.
- TUI, Core, Server, Client, and CLI typechecks.
- Focused provider/integration/MCP/keymap suites, then full TUI and relevant Core suites.
- Rebuild and smoke the standalone TUI artifact.
- Run a final grep and behavior audit for stale `session.header`, unauthenticated MCP retry logic, and unregistered keybind mappings.
