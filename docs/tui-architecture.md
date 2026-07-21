# TUI Architecture and Extraction Boundary

## Product boundary

The supported product is the V2 terminal application. Desktop, web, console, website, and Storybook packages are outside the TUI release path.

Build and verify the current platform artifact from the repository root:

```sh
bun run build:tui
bun run smoke:tui
```

The build writes `dist/tui/tui-<platform>-<arch>/bin/opencode2`. The public command exposes only TUI arguments. A hidden `serve` command remains in the same binary because managed and `--standalone` modes start the V2 API server by executing the current binary with `serve --stdio --port 0`.

`packages/cli/test/import-boundaries.test.ts` verifies that this entrypoint includes only the default TUI and hidden server handlers and does not include inputs from:

- `packages/desktop`
- `packages/app`
- `packages/console`
- `packages/www`
- `packages/storybook`
- normal CLI command handlers such as `run`, `mini`, `mcp`, `auth`, `debug`, and service-management commands

## Runtime package graph

```text
packages/cli (TUI entrypoint and process ownership)
  -> packages/tui (terminal presentation)
  -> packages/client (typed V2 API and service discovery)
  -> packages/core (global paths, installation metadata, process helpers)
  -> packages/server (hidden local V2 server)

packages/tui (presentation and interaction)
  -> packages/client (all runtime state and mutations)
  -> packages/plugin (TUI extension contracts)
  -> packages/schema (shared prompt/message value types)
  -> packages/ui / packages/simulation (presentation helpers)
  -> OpenTUI / Solid

packages/server (HTTP boundary)
  -> packages/protocol (routes and public schemas)
  -> packages/core (execution services)

packages/core (single execution engine)
  -> packages/ai (provider protocol lowering)
  -> packages/schema (durable contracts)
  -> packages/plugin (tool and lifecycle hooks)
  -> persistence, filesystem, process, and provider dependencies

packages/client
  -> packages/protocol
  -> packages/schema

packages/protocol
  -> packages/schema
```

The execution engine must remain singular. Do not restore `packages/opencode`, copy session/model/tool logic into the TUI, or create a second local runtime behind the client API.

## Allowed dependency directions

The long-term extraction target is:

```text
TUI presentation -> Client / Plugin contracts / Schema
CLI shell        -> TUI presentation / Client / Server bootstrap
Server           -> Protocol / Core
Core             -> AI / Schema / Plugin contracts
Client           -> Protocol / Schema
Protocol         -> Schema
```

Rules:

1. `packages/tui` reads and changes runtime state only through `packages/client`.
2. `packages/tui` must not import server handlers, database tables, provider SDKs, or Core session services.
3. `packages/server` translates public protocol requests into Core service calls; it contains no TUI behavior.
4. `packages/core` owns sessions, tools, permissions, compaction, caching, self-improvement, shell execution, and persistence.
5. `packages/ai` owns provider-specific request lowering and usage parsing.
6. `packages/schema` and `packages/protocol` must not depend on Core, Server, CLI, or TUI.
7. Desktop and web packages may consume public APIs later, but the TUI release path must never depend on them.

## Current presentation-layer exceptions

The TUI is API-driven for session and runtime behavior, but these utility imports still point directly to Core:

- `packages/tui/src/app.tsx` and `packages/tui/src/context/theme.tsx`: `Global` path resolution
- `packages/tui/src/clipboard.ts`: executable lookup helper
- `packages/tui/src/component/dialog-debug.tsx`, `error-component.tsx`, and `feature-plugins/home/footer.tsx`: installation metadata
- `packages/tui/src/component/dialog-project-copy-name.tsx`: slug utility

These are not execution-engine dependencies, but they are extraction blockers. Before moving `packages/tui` into an independent repository, replace them with injected host capabilities or small presentation-owned utilities:

```text
TuiHost.paths
TuiHost.installation
TuiHost.which
TuiHost.slug
```

Do not solve these exceptions by exposing broader Core modules to the TUI.

## Extraction units

A later repository split should preserve four units:

### 1. Terminal presentation

Move `packages/tui` plus its OpenTUI/Solid assets and presentation tests. It receives:

- an `OpenCodeClient`
- configuration read/update callbacks
- package/plugin resolution callbacks
- terminal lifecycle hooks
- small host capabilities listed above

It must be runnable against a remote V2 server without Core or Server in the same process.

### 2. TUI process shell

Move the TUI-only parts of `packages/cli`:

- `src/tui.ts`
- `src/commands/tui.ts`
- TUI-specific handler bindings and shared TUI/server execution functions
- service discovery, standalone process ownership, updater/config adapters
- `script/build.ts` TUI mode and `script/tui-smoke.ts`

The hidden `serve` command is an implementation detail required for a self-contained binary. It must remain hidden from public help.

### 3. V2 runtime server

Keep `packages/server`, `packages/protocol`, `packages/core`, `packages/ai`, `packages/schema`, and runtime plugin packages together until their public interfaces are independently versioned. The TUI communicates with this unit only through the generated client.

### 4. Optional frontends

Desktop and web frontends remain separate consumers. They are not workspace or build prerequisites for the TUI artifact.

## Release-path validation

A TUI release is acceptable only when all of the following pass:

```sh
bun run --cwd packages/cli typecheck
bun test packages/cli/test/import-boundaries.test.ts
bun run build:tui
bun run smoke:tui
```

The artifact smoke verifies:

- the compiled binary starts and prints TUI-only help
- excluded normal CLI commands are absent from public help
- the hidden server starts and emits a loopback readiness URL

The import-boundary test is the authoritative proof that desktop and unrelated CLI inputs are absent from the compiled TUI graph.
