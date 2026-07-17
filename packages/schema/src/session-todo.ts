export * as SessionTodo from "./session-todo"

import { Schema } from "effect"
import { define, inventory } from "./event"
import { SessionID } from "./session-id"
import { SessionMessage } from "./session-message"

export const Info = Schema.Struct({
  content: Schema.String.annotate({ description: "Brief description of the task" }),
  status: Schema.String.annotate({
    description: "Current status of the task: pending, in_progress, completed, cancelled",
  }),
  priority: Schema.String.annotate({
    description: "Priority level of the task: high, medium, low",
  }),
}).annotate({ identifier: "Todo" })
export interface Info extends Schema.Schema.Type<typeof Info> {}

export const Goal = Schema.Trim.pipe(Schema.check(Schema.isNonEmpty()))

const Updated = define({
  type: "todo.updated",
  schema: {
    sessionID: SessionID,
    todos: Schema.Array(Info),
    goal: Goal.pipe(Schema.optional),
    assistantMessageID: SessionMessage.ID.pipe(Schema.optional),
  },
})
export const Event = { Updated, Definitions: inventory(Updated) }
