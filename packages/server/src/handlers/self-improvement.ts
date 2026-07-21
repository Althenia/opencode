import { SelfImprovementStatus } from "@opencode-ai/core/self-improvement/status"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { response } from "../location"

export const SelfImprovementHandler = HttpApiBuilder.group(Api, "server.selfImprovement", (handlers) =>
  Effect.succeed(
    handlers.handle(
      "selfImprovement.status",
      Effect.fn(function* () {
        const status = yield* SelfImprovementStatus.Service
        return yield* response(status.get)
      }),
    ),
  ),
)
