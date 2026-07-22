# TUI Runtime Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Load the user's valid global runtime settings, bind agent cycling to plain Tab, and restore persistent V2 session todos through Core, Protocol, Server, generated Client, and TUI.

**Architecture:** Provider capabilities become field-level overlays instead of requiring a complete runtime capability record, which keeps the complete global config document available to MCP, self-improvement, and model diagnostics. Todos use one Location-scoped Core service backed by ordered session rows, one built-in tool, current Protocol endpoints/events, and one TUI read model/sidebar projection.

**Tech Stack:** TypeScript, Effect v4, Drizzle SQLite, Effect HttpApi, Bun test, Solid/OpenTUI, generated `@opencode-ai/client`.

## Global Constraints

- Work only in `.worktrees/fix-tui-startup` on `fix-tui-startup`, based on `main` at `52b59b377c1b0451f81dc9cc4442d083c05ea34d`.
- Do not modify `packages/opencode`.
- Do not add or change dependencies.
- Use the Core migration generator; do not hand-edit `schema.json`, `schema.gen.ts`, or `migration.gen.ts`.
- After Protocol or Server `HttpApi` changes, run `bun run generate` from `packages/client`; do not directly edit generated clients.
- Do not create commits unless the user explicitly requests them.
- Run tests and typechecks from package directories, never the repository root.

---

### Task 1: Decode Partial Provider Capability Overlays

**Files:**

- Modify: `packages/core/src/config/provider.ts`
- Modify: `packages/core/src/config/plugin/provider.ts`
- Test: `packages/core/test/config/provider.test.ts`
- Test: `packages/core/test/config/config.test.ts`

**Interfaces:**

- Produces: provider model `capabilities?: { tools?: boolean; input?: string[]; output?: string[] }`.
- Preserves: complete runtime `ModelV2.Capabilities` in catalog models.

- [ ] **Step 1: Add RED schema coverage**

Add a config decode case with a model overlay containing `input` and `output` but no `tools`. Assert decoding succeeds and unrelated `mcp`, `experimental.self_improvement`, and `limit.context: 400000` fields remain present.

```ts
const info = decode({
  experimental: { self_improvement: { automatic: true } },
  mcp: { servers: { memory: { type: "local", command: ["memory"] } } },
  providers: {
    openai: {
      models: {
        custom: {
          capabilities: { input: ["text"], output: ["text"] },
          limit: { context: 400_000 },
        },
      },
    },
  },
})
expect(info.experimental?.self_improvement?.automatic).toBe(true)
expect(info.mcp?.servers?.memory).toBeDefined()
expect(info.providers?.openai?.models?.custom?.limit?.context).toBe(400_000)
```

- [ ] **Step 2: Run RED test**

Run: `bun test test/config/config.test.ts` from `packages/core`.
Expected: FAIL because `capabilities.tools` is required.

- [ ] **Step 3: Define a partial config-only capability schema**

In `packages/core/src/config/provider.ts`, replace the runtime contract at the config boundary:

```ts
class Capabilities extends Schema.Class<Capabilities>("ConfigV2.Model.Capabilities")({
  tools: Schema.Boolean.pipe(Schema.optional),
  input: Schema.Array(Schema.String).pipe(Schema.optional),
  output: Schema.Array(Schema.String).pipe(Schema.optional),
}) {}
```

Use `Capabilities.pipe(Schema.optional)` in `Model`.

- [ ] **Step 4: Merge only supplied capability fields**

In `ConfigProviderPlugin`, preserve existing catalog fields:

```ts
if (config.capabilities !== undefined) {
  if (config.capabilities.tools !== undefined) model.capabilities.tools = config.capabilities.tools
  if (config.capabilities.input !== undefined) model.capabilities.input = [...config.capabilities.input]
  if (config.capabilities.output !== undefined) model.capabilities.output = [...config.capabilities.output]
}
```

- [ ] **Step 5: Add overlay behavior coverage**

In `provider.test.ts`, apply an overlay that changes input/output only and assert the existing `tools` value remains unchanged. Apply a tools-only overlay and assert input/output remain unchanged.

- [ ] **Step 6: Run GREEN checks**

Run from `packages/core`:

```sh
bun test test/config/config.test.ts test/config/provider.test.ts
bun typecheck
```

Expected: all tests pass; typecheck exits 0.

---

### Task 2: Restore Plain Tab Agent Cycling

**Files:**

- Modify: `packages/tui/src/config/v1/keybind.ts`
- Test: `packages/tui/test/config.test.tsx`
- Test: `packages/tui/test/keymap.test.tsx`

**Interfaces:**

- Produces: default `agent_cycle` binding `tab` mapped to command `agent.cycle`.
- Preserves: explicit user keybind overrides.

- [ ] **Step 1: Add RED default-resolution test**

```ts
test("cycles agents with plain tab by default", () => {
  const config = resolve({}, { terminalSuspend: true })
  expect(config.keybinds.get("agent.cycle")).toMatchObject([{ key: "tab" }])
})
```

- [ ] **Step 2: Run RED test**

Run: `bun test test/config.test.tsx` from `packages/tui`.
Expected: FAIL with the current `shift+tab` binding.

- [ ] **Step 3: Change the default binding**

```ts
agent_cycle: keybind("tab", "Next agent"),
```

- [ ] **Step 4: Prove real terminal dispatch**

Add a keymap harness to `keymap.test.tsx`, press plain Tab through `mockInput`, and assert `agent.cycle` runs exactly once. Add an explicit override case proving `shift+tab` works only when configured.

- [ ] **Step 5: Run GREEN checks**

Run from `packages/tui`:

```sh
bun test test/config.test.tsx test/keymap.test.tsx
bun typecheck
```

Expected: all tests pass; typecheck exits 0.

---

### Task 3: Restore the V2 Todo Domain, Persistence, and Tool

**Files:**

- Create: `packages/schema/src/session-todo.ts`
- Modify: `packages/schema/src/index.ts`
- Modify: `packages/schema/src/event-manifest.ts`
- Test: `packages/schema/test/session-todo.test.ts`
- Modify: `packages/core/src/session/sql.ts`
- Create via generator: `packages/core/src/database/migration/<generated>_add_session_todo.ts`
- Regenerate: `packages/core/schema.json`
- Regenerate: `packages/core/src/database/schema.gen.ts`
- Regenerate: `packages/core/src/database/migration.gen.ts`
- Create: `packages/core/src/session/todo.ts`
- Create: `packages/core/src/tool/todowrite.ts`
- Modify: `packages/core/src/location-services.ts`
- Modify: `packages/core/src/plugin/internal.ts`
- Test: `packages/core/test/session-todo.test.ts`
- Test: `packages/core/test/tool-todowrite.test.ts`

**Interfaces:**

- Produces: `SessionTodo.Info`, `SessionTodo.Event.Updated`, and `SessionTodo.Service` with `get(sessionID)` and `update({ sessionID, todos })`.
- Produces: built-in native tool `todowrite` with validated ordered items.

- [ ] **Step 1: Add RED contract tests**

Define expected item validation:

```ts
const item = SessionTodo.Info.make({ content: "Run tests", status: "in_progress", priority: "high" })
expect(item.status).toBe("in_progress")
expect(() => SessionTodo.Info.make({ content: "x", status: "unknown", priority: "high" })).toThrow()
expect(SessionTodo.Event.Updated.type).toBe("todo.updated")
```

Use literals `pending | in_progress | completed | cancelled` and `high | medium | low`. Register the ephemeral event in current server definitions.

- [ ] **Step 2: Run RED schema test**

Run: `bun test test/session-todo.test.ts` from `packages/schema`.
Expected: FAIL because `session-todo.ts` does not exist.

- [ ] **Step 3: Implement the current schema contract**

Create `SessionTodo.Info` and `todo.updated` using the package's `ephemeral` and `inventory` helpers. Export the namespace from `packages/schema/src/index.ts`; include its definition in both `EventManifest.ServerDefinitions` and `EventManifest.Definitions`.

- [ ] **Step 4: Add RED persistence tests**

Cover ordered replacement, empty-list clearing, event payload, and session cascade deletion using the real temporary SQLite fixture. Assert a second update replaces rather than appends rows.

- [ ] **Step 5: Add the Drizzle table and generate migration artifacts**

Add `SessionTodoTable` to `packages/core/src/session/sql.ts` with composite primary key `(session_id, position)`, `todo_session_idx`, and cascade FK to `SessionTable`.

Run from `packages/core`:

```sh
bun run migration --name add_session_todo
```

Review generated SQL and confirm it only creates `session_todo` and its index.

- [ ] **Step 6: Implement `SessionTodo.Service`**

Use one transaction to delete existing rows and insert the ordered replacement. Publish `todo.updated` after commit. Validate session existence before write/read through the existing Session service boundary so unknown sessions return the canonical not-found error.

- [ ] **Step 7: Run persistence GREEN test**

Run: `bun test test/session-todo.test.ts` from `packages/core`.
Expected: PASS.

- [ ] **Step 8: Add RED tool test**

Materialize real built-in tools, settle a `todowrite` call, then assert `SessionTodo.Service.get(sessionID)` returns the ordered input and the model output contains the same validated list.

- [ ] **Step 9: Implement and register the tool**

Use current tool context names:

```ts
source: { type: "tool", messageID: context.messageID, callID: context.callID }
```

Register with `{ codemode: false }`, capture `SessionTodo.Service` and `PermissionV2.Service` in the built-in plugin layer, and expose `todowrite` through `PluginInternal.pre`.

- [ ] **Step 10: Run domain GREEN checks**

Run from `packages/core`:

```sh
bun test test/session-todo.test.ts test/tool-todowrite.test.ts
bun run migration --check
bun typecheck
```

Run from `packages/schema`:

```sh
bun test test/session-todo.test.ts test/event-manifest.test.ts
bun typecheck
```

Expected: all commands exit 0.

---

### Task 4: Expose Todos Through Protocol, Server, and Generated Client

**Files:**

- Modify: `packages/protocol/src/groups/session.ts`
- Test: `packages/protocol/test/session-todo.test.ts`
- Modify: `packages/server/src/handlers/session.ts`
- Test: `packages/server/test/session-todo.test.ts`
- Regenerate: `packages/client/src/generated/**`
- Regenerate: `packages/client/src/generated-effect/**`
- Regenerate: `packages/client/src/promise/generated/**`
- Regenerate: `packages/client/src/effect/generated/**`

**Interfaces:**

- Produces: `GET /api/session/:sessionID/todo` operation `session.todo.list` returning `{ data: SessionTodo.Info[] }`.
- Produces: `PUT /api/session/:sessionID/todo` operation `session.todo.update`, payload `{ todos: SessionTodo.Info[] }`, returning `{ data: SessionTodo.Info[] }`.

- [ ] **Step 1: Add RED Protocol endpoint test**

Inspect the session group's endpoints and assert both operation IDs, methods, paths, payload, response, middleware, and `SessionNotFoundError` are present.

- [ ] **Step 2: Run RED Protocol test**

Run: `bun test test/session-todo.test.ts` from `packages/protocol`.
Expected: FAIL because the operations are absent.

- [ ] **Step 3: Add maintained HttpApi endpoints**

Import `SessionTodo` from Schema. Add GET and PUT endpoints immediately after session diagnostics. Apply `sessionLocationMiddleware` to both.

- [ ] **Step 4: Add RED Server integration test**

Use the existing server test layer and temporary database to create a session, PUT two items, GET them in order, PUT an empty list, and GET an empty array. Assert an unknown session returns the canonical 404 body.

- [ ] **Step 5: Implement thin handlers**

Yield `SessionTodo.Service` inside each request handler. Delegate reads/writes and map only the canonical session not-found error to `SessionNotFoundError`.

- [ ] **Step 6: Run GREEN Protocol/Server tests**

Run:

```sh
cd packages/protocol && bun test test/session-todo.test.ts && bun typecheck
cd ../server && bun test test/session-todo.test.ts && bun typecheck
```

Expected: all commands exit 0.

- [ ] **Step 7: Regenerate client surfaces**

Run: `bun run generate` from `packages/client`.
Review generated diffs and retain only generator-owned todo API/type additions.

- [ ] **Step 8: Validate generated client**

Run from `packages/client`:

```sh
bun test
bun typecheck
```

Expected: all commands exit 0.

---

### Task 5: Project Todos Into TUI State and Sidebar

**Files:**

- Create: `packages/tui/src/component/todo-item.tsx`
- Create: `packages/tui/src/feature-plugins/sidebar/todo.tsx`
- Modify: `packages/tui/src/plugin/builtins.ts`
- Modify: `packages/tui/src/context/data.tsx`
- Test: `packages/tui/test/feature-plugins/todo.test.tsx`
- Test: `packages/tui/test/cli/tui/data.test.tsx`

**Interfaces:**

- Consumes: generated `SessionTodoInfo`, `todo.updated`, and `client.api.session.todo.list`.
- Produces: `data.session.todo.get(sessionID)`, `sync(sessionID)`, and `invalidate(sessionID)` plus `internal:sidebar-todo`.

- [ ] **Step 1: Add RED data projection test**

Seed no todos, sync a session list response, apply a `todo.updated` event, and assert ordered replacement. Verify reconnect invalidates the cached list.

- [ ] **Step 2: Run RED data test**

Run: `bun test test/cli/tui/data.test.tsx` from `packages/tui`.
Expected: FAIL because session todo state does not exist.

- [ ] **Step 3: Add the todo read model**

Add `todo: Record<string, SessionTodoInfo[]>` under session store. On `todo.updated`, replace the session list from the event. Expose `get`, `sync`, and `invalidate` using the existing sync coordinator and generated client.

- [ ] **Step 4: Add RED sidebar tests**

Assert the plugin hides for empty/all-completed lists, shows pending/in-progress/cancelled items in order, renders stable status symbols, and collapses lists longer than two items.

- [ ] **Step 5: Implement and register the sidebar**

Create an accessible status renderer using the current V2 theme and add `SidebarTodo` between MCP and self-improvement in `packages/tui/src/plugin/builtins.ts`. The plugin performs initial sync for its session and renders only when at least one item is not completed.

- [ ] **Step 6: Run TUI GREEN checks**

Run from `packages/tui`:

```sh
bun test test/feature-plugins/todo.test.tsx test/cli/tui/data.test.tsx test/config.test.tsx test/keymap.test.tsx
bun typecheck
```

Expected: all tests pass; typecheck exits 0.

---

### Task 6: End-to-End Runtime Verification

**Files:**

- Test only; no production files.

**Interfaces:**

- Verifies all approved user-visible behaviors against one runtime.

- [ ] **Step 1: Validate package scopes**

Run targeted tests, then `bun typecheck` from `packages/schema`, `packages/core`, `packages/protocol`, `packages/server`, `packages/client`, and `packages/tui`.

- [ ] **Step 2: Validate the user's global config without exposing values**

Decode the global config through `Config.Info` and assert it succeeds. Query the effective catalog and assert the selected OpenAI model reports context `400000`; query MCP and assert all configured server names are present; query self-improvement status and assert `enabled === true`.

- [ ] **Step 3: Exercise automatic evidence**

Run one disposable terminal session with `experimental.self_improvement.automatic: true`, complete it, and assert the location's status evidence count increases by one.

- [ ] **Step 4: Exercise TUI input and todos with OpenCode Drive**

Run an isolated TUI script that presses plain Tab and observes the primary agent label change, executes `todowrite` through the simulated model, and observes the sidebar list. Typecheck the drive script before execution and remove its temporary artifacts after success.

- [ ] **Step 5: Inspect final scope**

Run:

```sh
git status --short
git diff --check
git diff --stat main...HEAD
```

Expected: only approved source, tests, migration artifacts, generated clients, design, and plan files are changed; `git diff --check` exits 0.
