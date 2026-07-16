import type { Todo } from "@opencode-ai/sdk/v2"
import { Show, createMemo } from "solid-js"
import { useTheme } from "../context/theme"

const BAR_WIDTH = 24

export function summarizeGoal(objective: string, todos: readonly Todo[]) {
  const resolved = todos.filter((todo) => todo.status === "completed" || todo.status === "cancelled").length
  const total = todos.length
  const percentage = total === 0 ? 0 : Math.max(0, Math.min(100, Math.round((resolved / total) * 100)))
  const target =
    todos.find((todo) => todo.status === "in_progress")?.content ??
    todos.find((todo) => todo.status === "pending")?.content ??
    objective
  return { resolved, total, percentage, target }
}

export function GoalStatusBand(props: {
  objective?: string
  starting: boolean
  todos: readonly Todo[]
}) {
  const { theme } = useTheme()
  const summary = createMemo(() => summarizeGoal(props.objective ?? "", props.todos))
  const filled = createMemo(() => Math.round((summary().percentage / 100) * BAR_WIDTH))

  return (
    <Show when={props.objective}>
      {(objective) => (
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
          <box width="100%" flexDirection="row" justifyContent="space-between" gap={1}>
            <text fg={theme.text} wrapMode="word">
              <b>{props.starting ? "Starting" : "Goal"}</b> · {objective()}
            </text>
            <text fg={theme.accent}>{summary().percentage}%</text>
          </box>
          <text>
            <span style={{ fg: theme.accent }}>{"━".repeat(filled())}</span>
            <span style={{ fg: theme.border }}>{"━".repeat(BAR_WIDTH - filled())}</span>
          </text>
          <text fg={theme.textMuted} wrapMode="word">
            Current target · <span style={{ fg: theme.text }}>{summary().target}</span>
          </text>
          <text fg={theme.textMuted}>
            {summary().resolved} of {summary().total} resolved
          </text>
        </box>
      )}
    </Show>
  )
}
