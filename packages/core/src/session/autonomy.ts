export * as SessionAutonomy from "./autonomy"

import { eq } from "drizzle-orm"
import { Context, Effect, Layer, Schema } from "effect"
import { Database } from "../database/database"
import { makeGlobalNode } from "../effect/app-node"
import { Hash } from "../util/hash"
import { SessionSchema } from "./schema"
import { SessionTable } from "./sql"

const MetadataKey = "autonomy"

export const Mode = Schema.Literals(["normal", "yolo", "goal"])
export type Mode = typeof Mode.Type

export const GoalStatus = Schema.Literals(["active", "completed", "stopped", "exhausted"])
export type GoalStatus = typeof GoalStatus.Type

const NonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
const PositiveInt = Schema.Int.check(Schema.isGreaterThan(0))

export const Goal = Schema.Struct({
  text: Schema.String,
  status: GoalStatus,
  iteration: NonNegativeInt,
  maxIterations: PositiveInt,
  noProgress: NonNegativeInt,
  maxNoProgress: PositiveInt,
  lastProgressDigest: Schema.String.pipe(Schema.optional),
})
export type Goal = typeof Goal.Type

export const State = Schema.Struct({
  mode: Mode,
  goal: Goal.pipe(Schema.optional),
})
export type State = typeof State.Type

export const defaultState: State = { mode: "normal" }
const decode = Schema.decodeUnknownOption(State)

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("SessionAutonomy.NotFound", {
  sessionID: SessionSchema.ID,
}) {}

export interface Interface {
  readonly get: (sessionID: SessionSchema.ID) => Effect.Effect<State, NotFoundError>
  readonly setMode: (input: {
    sessionID: SessionSchema.ID
    mode: Exclude<Mode, "goal">
  }) => Effect.Effect<State, NotFoundError>
  readonly setGoal: (input: {
    sessionID: SessionSchema.ID
    text: string
    maxIterations?: number
    maxNoProgress?: number
  }) => Effect.Effect<State, NotFoundError>
  readonly stop: (sessionID: SessionSchema.ID) => Effect.Effect<State, NotFoundError>
  readonly advance: (input: {
    sessionID: SessionSchema.ID
    progress: string
    completed?: boolean
  }) => Effect.Effect<State, NotFoundError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionAutonomy") {}

export const read = (metadata: Record<string, unknown> | null | undefined): State => {
  const value = metadata?.[MetadataKey]
  const parsed = decode(value)
  return parsed._tag === "Some" ? parsed.value : defaultState
}

export const write = (metadata: Record<string, unknown> | null | undefined, state: State) => ({
  ...(metadata ?? {}),
  [MetadataKey]: state,
})

export const CompletionMarker = "<goal-complete/>"

export const progressDigest = (value: string) => Hash.sha256(value.trim())

export function isCompleted(progress: string) {
  return progress.includes(CompletionMarker)
}

export function continuationPrompt(goal: Goal) {
  return [
    "Continue autonomously toward the active user goal.",
    `Goal: ${goal.text}`,
    `Continuation: ${goal.iteration + 1}/${goal.maxIterations}`,
    "Use the conversation and current repository state to choose the next useful action.",
    "Answer routine blockers yourself using the safest reasonable default.",
    `When the goal is actually achieved, include exactly ${CompletionMarker} in the final response.`,
    "Do not claim completion without verification evidence.",
  ].join("\n")
}

export function make(input: { db: Database.Interface["db"] }): Interface {
  const load = (sessionID: SessionSchema.ID) =>
    input.db
      .select({ metadata: SessionTable.metadata })
      .from(SessionTable)
      .where(eq(SessionTable.id, sessionID))
      .get()
      .pipe(
        Effect.orDie,
        Effect.flatMap((row) =>
          row
            ? Effect.succeed({ metadata: row.metadata, state: read(row.metadata) })
            : Effect.fail(new NotFoundError({ sessionID })),
        ),
      )

  const save = (sessionID: SessionSchema.ID, state: State) =>
    Effect.gen(function* () {
      const current = yield* load(sessionID)
      yield* input.db
        .update(SessionTable)
        .set({ metadata: write(current.metadata, state), time_updated: Date.now() })
        .where(eq(SessionTable.id, sessionID))
        .run()
        .pipe(Effect.orDie)
      return state
    })

  return {
    get: (sessionID) => load(sessionID).pipe(Effect.map((item) => item.state)),
    setMode: ({ sessionID, mode }) => save(sessionID, { mode }),
    setGoal: ({ sessionID, text, maxIterations = 24, maxNoProgress = 3 }) =>
      save(sessionID, {
        mode: "goal",
        goal: {
          text: text.trim(),
          status: "active",
          iteration: 0,
          maxIterations: Math.max(1, Math.trunc(maxIterations)),
          noProgress: 0,
          maxNoProgress: Math.max(1, Math.trunc(maxNoProgress)),
        },
      }),
    stop: (sessionID) =>
      load(sessionID).pipe(
        Effect.flatMap(({ state }) =>
          save(sessionID, {
            mode: "normal",
            ...(state.goal ? { goal: { ...state.goal, status: "stopped" as const } } : {}),
          }),
        ),
      ),
    advance: ({ sessionID, progress, completed = false }) =>
      load(sessionID).pipe(
        Effect.flatMap(({ state }) => {
          const goal = state.goal
          if (state.mode !== "goal" || !goal || goal.status !== "active") return Effect.succeed(state)
          const digest = progressDigest(progress)
          const iteration = goal.iteration + 1
          const noProgress = goal.lastProgressDigest === digest ? goal.noProgress + 1 : 0
          const status: GoalStatus = completed
            ? "completed"
            : iteration >= goal.maxIterations || noProgress >= goal.maxNoProgress
              ? "exhausted"
              : "active"
          return save(sessionID, {
            mode: status === "active" ? "goal" : "normal",
            goal: { ...goal, status, iteration, noProgress, lastProgressDigest: digest },
          })
        }),
      ),
  }
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    return Service.of(make({ db }))
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [Database.node] })
