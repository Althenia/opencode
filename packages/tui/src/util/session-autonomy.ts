import type { SessionAutonomyState } from "@opencode-ai/client"

export function autonomyModeLabel(state: SessionAutonomyState) {
  if (state.mode === "yolo") return "YOLO"
  if (state.mode === "goal") return "Goal"
  return "Normal"
}

export function autonomyProgressLabel(state: SessionAutonomyState) {
  const goal = state.goal
  if (!goal || state.mode !== "goal") return
  return `${goal.iteration}/${goal.maxIterations} · no progress ${goal.noProgress}/${goal.maxNoProgress}`
}
