# TUI V2 Runtime Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix OpenRouter authentication, MCP OAuth guidance, redundant session chrome, and real keymap behavior in the V2 TUI.

**Architecture:** Preserve the existing integration credential store and MCP OAuth backend. Fix only the boundaries that fail to pass credentials or route users into the existing OAuth flow, remove the redundant header slot, and add physical-input regression coverage.

**Tech Stack:** Bun, TypeScript, Effect, Solid/OpenTUI, MCP SDK, OpenRouter AI SDK.

## Global Constraints

- Follow red → green → refactor for every behavior change.
- Do not restore `packages/opencode` or any legacy runtime dependency.
- Do not expose API keys, OAuth tokens, or authorization codes in logs or snapshots.
- Preserve TUI-only build isolation from desktop/app entrypoints.
- Keep existing MCP PKCE, state validation, callback, persistence, cancellation, and expiry behavior.

---

### Task 1: Prove and fix OpenRouter request authentication

**Files:**
- Modify: `packages/core/test/session-runner-model.test.ts` or `packages/core/test/plugin/provider-openrouter.test.ts`
- Modify only if required: `packages/core/src/session/runner/model.ts`, `packages/core/src/aisdk.ts`, `packages/core/src/plugin/provider/openrouter.ts`, or credential/integration resolution code

**Interfaces:**
- Consumes: `Integration.connection.active`, `Integration.connection.resolve`, `SessionRunnerModel.fromCatalogModel`, `AISDK.model`
- Produces: an outgoing OpenRouter request containing `Authorization: Bearer <stored key>`

- [ ] Add a test that captures the actual OpenRouter HTTP request headers after resolving a stored key credential.
- [ ] Run the focused test and verify it fails for the reported missing-auth behavior.
- [ ] Trace the credential from integration storage through model resolution and SDK creation.
- [ ] Implement the smallest root-cause fix.
- [ ] Run the focused test, provider tests, integration tests, and session model tests.

### Task 2: Route MCP `needs_auth` into OAuth

**Files:**
- Modify: `packages/tui/src/component/dialog-mcp.tsx`
- Modify/refactor: `packages/tui/src/component/dialog-integration.tsx`
- Test: create `packages/tui/test/cli/tui/dialog-mcp.test.tsx` or focused pure-flow tests

**Interfaces:**
- Consumes: `McpServer.integrationID`, integration OAuth method metadata, `client.api.integration.oauth.*`
- Produces: an interactive authorization URL and existing OAuth completion flow

- [ ] Add a failing test showing `needs_auth` invokes OAuth rather than `mcp.connect`.
- [ ] Export or extract the existing integration OAuth launcher for reuse.
- [ ] Route `needs_auth` servers with an OAuth method into that launcher.
- [ ] Report a precise error when an OAuth integration/method is missing.
- [ ] Verify status refresh after successful authorization.

### Task 3: Remove the redundant session header

**Files:**
- Modify: `packages/tui/src/routes/session/index.tsx`
- Test: add a focused source/layout regression assertion

**Interfaces:**
- Produces: transcript layout without the `session.header` slot; sidebar content remains unchanged

- [ ] Add a failing assertion that the session transcript does not render `session.header`.
- [ ] Remove the slot and preserve surrounding spacing.
- [ ] Run session/TUI layout tests.

### Task 4: Re-evaluate keymap behavior through real input

**Files:**
- Modify: `packages/tui/test/keymap.test.tsx`
- Modify only if required: `packages/tui/src/context/keymap.tsx`, `packages/tui/src/config/v1/keybind.ts`, dialog keymap layers

**Interfaces:**
- Produces: working leader, direct, custom override, and modal bindings from terminal events

- [ ] Test the default leader sequence through `mockInput`.
- [ ] Test a custom leader override through `mockInput`.
- [ ] Test a direct global binding through `mockInput`.
- [ ] Test modal selection/prompt bindings and their overrides.
- [ ] Audit `Definitions` → `CommandMap` → registered command IDs for gaps.
- [ ] Fix only demonstrated defects and rerun all keymap/dialog tests.

### Task 5: Final gap audit and artifact verification

**Files:**
- Update tests/docs only when a newly demonstrated gap requires it

**Interfaces:**
- Produces: a verified standalone TUI artifact with no known remaining gaps in the requested flows

- [ ] Run TUI, Core, Server, Client, and CLI typechecks.
- [ ] Run focused provider, integration, MCP, session-model, keymap, and dialog tests.
- [ ] Run full TUI tests and relevant Core suites.
- [ ] Build with `bun run build:tui`.
- [ ] Smoke with `bun run smoke:tui`.
- [ ] Audit for stale `session.header`, `needs_auth` reconnect-only behavior, missing provider authorization, and unregistered keybind mappings.
- [ ] Review the final diff and commit cohesive changes without pushing.
