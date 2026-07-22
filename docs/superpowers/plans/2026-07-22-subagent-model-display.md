# Subagent Model Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Display each child session's provider, model, and optional variant in the TUI Subagents tab.

**Architecture:** Derive one display label from the model persisted on each child session, then render it in a focused right-side metadata component beside the existing status. Keep model formatting synchronous and local; do not add API calls or change session contracts.

**Tech Stack:** TypeScript, SolidJS, OpenTUI, Bun test.

## Global Constraints

- Use the persisted child-session model, not current agent configuration or latest-message inference.
- Keep one visual row per subagent.
- Preserve `Running` at the far right.
- Do not change session, protocol, server, or generated client contracts.
- Do not modify or revert unrelated dirty-worktree files.
- Run tests and type checking from `packages/tui`, never from the repository root.
- Do not stage or commit changes unless the user explicitly requests it.

---

## File Structure

- `packages/tui/src/routes/session/composer/subagents-tab.tsx`: Derive model labels and render the compact metadata region.
- `packages/tui/test/cli/tui/subagents-tab.test.tsx`: Cover label formatting and one-line metadata rendering at normal and constrained widths.

### Task 1: Render Child-Session Model Metadata

**Files:**
- Modify: `packages/tui/src/routes/session/composer/subagents-tab.tsx`
- Create: `packages/tui/test/cli/tui/subagents-tab.test.tsx`

**Interfaces:**
- Consumes: child session `model?: { providerID: string; id: string; variant?: string }`.
- Produces: `formatSubagentModel(model): string | undefined` and `SubagentMetadata` rendering `providerID/modelID#variant · Running`.

- [ ] **Step 1: Add failing formatter and metadata rendering tests**

Create `packages/tui/test/cli/tui/subagents-tab.test.tsx` with focused tests that:

```tsx
/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { TestTuiContexts } from "../../fixture/tui-environment"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"

const module = await import("../../../src/routes/session/composer/subagents-tab")

async function renderMetadata(input: { model?: string; status?: string; width?: number }) {
  const [{ ConfigProvider }, { ThemeProvider }] = await Promise.all([
    import("../../../src/config"),
    import("../../../src/context/theme"),
  ])

  const app = await testRender(
    () => (
      <TestTuiContexts>
        <ConfigProvider config={createTuiResolvedConfig()}>
          <ThemeProvider mode="dark" source={{ discover: () => Promise.resolve({}) }}>
            <box flexDirection="row">
              <box flexGrow={1}>
                <text>Task</text>
              </box>
              <module.SubagentMetadata model={input.model} status={input.status} active={false} />
            </box>
          </ThemeProvider>
        </ConfigProvider>
      </TestTuiContexts>
    ),
    { width: input.width ?? 80, height: 3 },
  )
  app.renderer.start()
  await app.renderOnce()
  return app
}

test("formats provider, model, and optional variant", () => {
  expect(module.formatSubagentModel({ providerID: "openai", id: "gpt-5.6-luna", variant: "high" })).toBe(
    "openai/gpt-5.6-luna#high",
  )
  expect(module.formatSubagentModel({ providerID: "openai", id: "gpt-5.6-sol" })).toBe(
    "openai/gpt-5.6-sol",
  )
  expect(module.formatSubagentModel(undefined)).toBeUndefined()
})

test("renders model and running status on one row", async () => {
  const app = await renderMetadata({ model: "openai/gpt-5.6-luna#high", status: "Running" })
  try {
    const frame = app.captureCharFrame()
    expect(frame).toContain("openai/gpt-5.6-luna#high · Running")
    expect(frame.split("\n").find((line) => line.includes("Running"))?.trimEnd().endsWith("Running")).toBe(true)
  } finally {
    app.renderer.destroy()
  }
})

test("renders model metadata for a completed row without status", async () => {
  const app = await renderMetadata({ model: "openai/gpt-5.6-sol" })
  try {
    const frame = app.captureCharFrame()
    expect(frame).toContain("openai/gpt-5.6-sol")
    expect(frame).not.toContain("Running")
  } finally {
    app.renderer.destroy()
  }
})

test("omits model metadata when the session has no model", async () => {
  const app = await renderMetadata({ status: "Running" })
  try {
    const frame = app.captureCharFrame()
    expect(frame).not.toContain("·")
    expect(frame.split("\n").find((line) => line.includes("Running"))?.trimEnd().endsWith("Running")).toBe(true)
  } finally {
    app.renderer.destroy()
  }
})

test("clips a long model label while preserving running status", async () => {
  const model = `provider/${"model".repeat(16)}#variant`
  const app = await renderMetadata({ model, status: "Running", width: 48 })
  try {
    const frame = app.captureCharFrame()
    expect(frame).not.toContain(model)
    expect(frame.split("\n").find((line) => line.includes("Running"))?.trimEnd().endsWith("Running")).toBe(true)
  } finally {
    app.renderer.destroy()
  }
})
```

- [ ] **Step 2: Run the targeted test and verify RED**

Run from `packages/tui`:

```sh
bun test test/cli/tui/subagents-tab.test.tsx
```

Expected: FAIL because `formatSubagentModel` and `SubagentMetadata` are not exported.

- [ ] **Step 3: Implement model formatting and metadata rendering**

In `subagents-tab.tsx`, add:

```tsx
export function formatSubagentModel(model: { providerID: string; id: string; variant?: string } | undefined) {
  if (!model) return
  return `${model.providerID}/${model.id}${model.variant ? `#${model.variant}` : ""}`
}

export function SubagentMetadata(props: { model?: string; status?: string; active: boolean }) {
  const { themeV2 } = useTheme()
  const color = () => (props.active ? themeV2.text.action.primary.focused : themeV2.text.subdued)

  return (
    <box flexDirection="row" minWidth={0} gap={1}>
      <Show when={props.model}>
        <box minWidth={0} maxWidth={40} flexShrink={1}>
          <text fg={color()} wrapMode="none">
            {props.model}
          </text>
        </box>
      </Show>
      <Show when={props.model && props.status}>
        <text fg={color()}>·</text>
      </Show>
      <Show when={props.status}>
        <text fg={color()} wrapMode="none">
          {props.status}
        </text>
      </Show>
    </box>
  )
}
```

Extend `SubagentEntry` with `model?: string`. In both sibling and child entry construction, set:

```ts
model: formatSubagentModel(session.model),
```

Use `sibling.model` for sibling entries and `child.model` for child entries.

Replace the existing status-only `<Show>` block with:

```tsx
<SubagentMetadata model={entry.model} status={status()} active={active()} />
```

- [ ] **Step 4: Run the targeted test and verify GREEN**

Run from `packages/tui`:

```sh
bun test test/cli/tui/subagents-tab.test.tsx
```

Expected: 5 tests pass.

- [ ] **Step 5: Run package validation**

Run from `packages/tui`:

```sh
bun typecheck
bun test
```

Expected: type checking succeeds and the TUI test suite passes. If an unrelated dirty-worktree test fails, preserve its output and isolate the targeted test result without modifying that unrelated file.

- [ ] **Step 6: Inspect the scoped diff**

Run from the repository root:

```sh
git diff --check
git status --short -- packages/tui/src/routes/session/composer/subagents-tab.tsx packages/tui/test/cli/tui/subagents-tab.test.tsx
git diff -- packages/tui/src/routes/session/composer/subagents-tab.tsx packages/tui/test/cli/tui/subagents-tab.test.tsx
```

Expected: no whitespace errors; only the implementation and focused test are changed within this scope.
