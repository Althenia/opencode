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

export function parseGoalCommand(input: string) {
  const match = input.match(/^\/goal(?=\s|$)(?:\s+([\s\S]*))?$/)
  if (!match) return
  return { goal: (match[1] ?? "").trim() }
}

export type SessionSubmissionRetry<T = unknown> = {
  key: string
  promptID: string
  syntheticID: string
  skillIDs: string[]
  payload: T
  sessionID: string
  creationConfirmed: boolean
}

export function createSessionMessageID() {
  return `msg_${crypto.randomUUID()}`
}

export function createSessionID() {
  return `ses_${crypto.randomUUID()}`
}

export function retainSessionSubmission<T>(
  current: SessionSubmissionRetry<T> | undefined,
  key: string,
  skillCount: number,
  payload: T,
  sessionID?: string,
) {
  if (current) return current
  return {
    key,
    promptID: createSessionMessageID(),
    syntheticID: createSessionMessageID(),
    skillIDs: Array.from({ length: skillCount }, createSessionMessageID),
    payload: structuredClone(payload),
    sessionID: sessionID ?? createSessionID(),
    creationConfirmed: sessionID !== undefined,
  }
}

export async function confirmSessionCreation<T>(
  submission: SessionSubmissionRetry,
  create: (sessionID: string) => Promise<T>,
) {
  if (submission.creationConfirmed) return
  const created = await create(submission.sessionID)
  submission.creationConfirmed = true
  return created
}

export function restoreSessionSubmission<T>(
  submission: SessionSubmissionRetry<{ history: T; cursor: number }>,
  current: T,
  stash: (prompt: T) => void,
  isEmpty: (prompt: T) => boolean,
) {
  const prompt = structuredClone(submission.payload.history)
  if (!isEmpty(current) && JSON.stringify(current) !== JSON.stringify(prompt)) stash(current)
  return { prompt, cursor: submission.payload.cursor }
}

export type SessionAutonomyResponse = {
  sessionID: string
  state: SessionAutonomyState
}

export function currentSessionAutonomy(
  sessionID: string,
  connected: boolean,
  response: SessionAutonomyResponse | undefined,
): SessionAutonomyState {
  if (!connected || response?.sessionID !== sessionID) return { mode: "normal" }
  return response.state
}

export async function submitSessionPrompt(input: {
  prompt: (resume: boolean) => Promise<unknown>
  skills: Array<() => Promise<unknown>>
}) {
  await input.prompt(false)
  for (const skill of input.skills) await skill()
  await input.prompt(true)
}

export async function activateGoal(input: {
  sessionID: string
  id: string
  goal: string
  get: () => Promise<SessionAutonomyState>
  set: (input: { mode: "goal"; goal: string }) => Promise<SessionAutonomyState>
  prompt: (input: { sessionID: string; id: string; text: string; resume?: boolean }) => Promise<unknown>
}) {
  await input.prompt({ sessionID: input.sessionID, id: input.id, text: input.goal, resume: false })
  const current = await input.get()
  const state =
    current.mode === "goal" && current.goal?.status === "active" && current.goal.text === input.goal
      ? current
      : await input.set({ mode: "goal", goal: input.goal })
  await input.prompt({ sessionID: input.sessionID, id: input.id, text: input.goal })
  return state
}
