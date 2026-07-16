import type { Todo } from "@opencode-ai/sdk/v2"
import { useTerminalDimensions } from "@opentui/solid"
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
  const dimensions = useTerminalDimensions()
  const summary = createMemo(() => summarizeGoal(props.objective ?? "", props.todos))
  const barWidth = createMemo(() => Math.max(1, Math.min(BAR_WIDTH, dimensions().width - 6)))
  const filled = createMemo(() => Math.round((summary().percentage / 100) * barWidth()))

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
          <box width="100%" height={2} overflow="hidden" flexDirection="row" justifyContent="space-between" gap={1}>
            <text fg={theme.text} wrapMode="word" flexShrink={1}>
              <b>{props.starting ? "Starting" : "Goal"}</b> · {objective()}
            </text>
            <text fg={theme.accent} flexShrink={0}>
              {summary().percentage}%
            </text>
          </box>
          <text width="100%" wrapMode="none" truncate>
            <span style={{ fg: theme.accent }}>{"━".repeat(filled())}</span>
            <span style={{ fg: theme.border }}>{"━".repeat(barWidth() - filled())}</span>
          </text>
          <box height={2} overflow="hidden">
            <text fg={theme.textMuted} wrapMode="word">
              Current target · <span style={{ fg: theme.text }}>{summary().target}</span>
            </text>
          </box>
          <text fg={theme.textMuted}>
            {summary().resolved} of {summary().total} resolved
          </text>
        </box>
      )}
    </Show>
  )
}
