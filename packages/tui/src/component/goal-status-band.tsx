import type { Todo } from "@opencode-ai/sdk/v2"
import type { BoxRenderable } from "@opentui/core"
import { Show, createMemo, createSignal, onCleanup } from "solid-js"
import { useTheme } from "../context/theme"

export function summarizeGoal(todos: readonly Todo[]) {
  const resolved = todos.filter((todo) => todo.status === "completed" || todo.status === "cancelled").length
  const total = todos.length
  const percentage = total === 0 ? 0 : Math.max(0, Math.min(100, Math.round((resolved / total) * 100)))
  const target =
    todos.find((todo) => todo.status === "in_progress")?.content ??
    todos.find((todo) => todo.status === "pending")?.content ??
    "Preparing task list"
  return { resolved, total, percentage, target }
}

export function GoalStatusBand(props: {
  objective?: string
  starting: boolean
  phase?: "starting" | "running" | "stalled"
  todos: readonly Todo[]
}) {
  const { theme } = useTheme()
  const summary = createMemo(() => summarizeGoal(props.todos))
  const [barWidth, setBarWidth] = createSignal(1)
  const summaryText = createMemo(() => {
    const value = summary()
    const full = `${value.resolved} of ${value.total} resolved · ${value.percentage}%`
    if (Bun.stringWidth(full) <= barWidth()) return full
    return `${value.resolved}/${value.total} · ${value.percentage}%`
  })
  const filled = createMemo(() => Math.round((summary().percentage / 100) * barWidth()))

  return (
    <Show when={props.objective}>
      <box
        width="100%"
        flexShrink={0}
        backgroundColor={theme.backgroundPanel}
        border={["left"]}
        borderColor={theme.accent}
        paddingLeft={2}
        paddingRight={2}
        paddingTop={1}
        paddingBottom={1}
      >
        <box
          width="100%"
          minWidth={0}
          flexShrink={1}
          ref={(bar: BoxRenderable) => {
            const resize = () => setBarWidth(bar.width)
            bar.onSizeChange = resize
            onCleanup(() => (bar.onSizeChange = undefined))
          }}
        >
          <text wrapMode="none" truncate>
            <span style={{ fg: theme.accent }}>{"━".repeat(filled())}</span>
            <span style={{ fg: theme.border }}>{"━".repeat(barWidth() - filled())}</span>
          </text>
        </box>
        <box height={2} overflow="hidden">
          <text fg={theme.textMuted} wrapMode="word">
            Current goal · <span style={{ fg: theme.text }}>{props.objective}</span>
          </text>
        </box>
        <box height={2} overflow="hidden">
          <text fg={theme.textMuted} wrapMode="word">
            Current target · <span style={{ fg: theme.text }}>{summary().target}</span>
          </text>
        </box>
        <text fg={theme.textMuted} wrapMode="none" truncate>
          {props.starting || props.phase === "starting" ? "Starting · " : props.phase === "stalled" ? "Stalled · " : ""}
          {summaryText()}
        </text>
      </box>
    </Show>
  )
}
