status: implemented

changed files:
- packages/tui/src/context/goal.tsx
- packages/tui/src/context/sdk.tsx
- packages/tui/src/app.tsx
- packages/tui/src/component/prompt/index.tsx
- packages/tui/test/context/goal.test.tsx
- packages/tui/test/app-lifecycle.test.tsx

commit: 6c1ab08fd

validations:
- packages/tui: `bun test test/context/goal.test.tsx` passed, 4 tests.
- packages/tui: `bun test test/app-lifecycle.test.tsx` passed, 4 tests.
- packages/tui: `bun typecheck` failed only on known unrelated `../core/src/cross-spawn-spawner.ts(235,11)` Encoding/BufferEncoding mismatch.

concerns:
- `@opencode-ai/sdk/v2` runtime client did not expose the generated `sessions` group, so TUI SDK context now adapts the requested `sdk.client.sessions.goalStart/goalStop/goalStatus` shape for goal endpoints.

reviewer fix validation:
- packages/tui: `bun test test/context/goal.test.tsx` passed, 5 tests.
- packages/tui: `bun test test/app-lifecycle.test.tsx` passed, 4 tests.
- packages/tui: `bun typecheck` failed only on known unrelated `../core/src/cross-spawn-spawner.ts(235,11)` Encoding/BufferEncoding mismatch.

reviewer fix validation 2:
- packages/tui: `bun test test/context/goal.test.tsx` failed before adapter fix with wrapped `{ data }` mocks, missing `goal · 3/7` / `goal · 2/7` badge text.
- packages/tui: `bun test test/context/goal.test.tsx` passed, 5 tests.
- packages/tui: `bun test test/app-lifecycle.test.tsx` passed, 4 tests.
- packages/tui: `bun typecheck` failed only on known unrelated `../core/src/cross-spawn-spawner.ts(235,11)` Encoding/BufferEncoding mismatch.
