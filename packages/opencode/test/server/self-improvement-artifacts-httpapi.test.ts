import { describe, expect, test } from "bun:test"
import { Effect, Layer, Redacted, Ref } from "effect"
import { HttpServerRequest } from "effect/unstable/http"
import { SelfImprovement, SelfImprovementLifecycle } from "@opencode-ai/schema"
import { SelfImprovementPrivateArtifactCommand } from "@opencode-ai/core/self-improvement/private-artifact-command"
import { SelfImprovementPrivateQuery } from "@opencode-ai/core/self-improvement/private-query"
import { Config } from "../../src/config/config"
import { makeSelfImprovementArtifactHandlers } from "../../src/server/routes/instance/httpapi/handlers/self-improvement-artifacts"
import { createCursorCodec } from "../../src/server/routes/instance/httpapi/middleware/self-improvement-authorization"

const locationID = SelfImprovementLifecycle.LocationID.make("a".repeat(64))
const principal = new SelfImprovementLifecycle.Principal({
  id: SelfImprovementLifecycle.PrincipalID.make("operator"),
  kind: "first-party-user",
  locationID,
})

describe("self-improvement artifact HttpApi", () => {
  test("binds artifact cursors to an authorized Location", async () => {
    const receivedCursor = Ref.makeUnsafe<ReadonlyArray<string> | undefined>(undefined)
    const response = await Effect.runPromise(
      Effect.gen(function* () {
        const handlers = makeSelfImprovementArtifactHandlers({
          tokens: new Map([[Redacted.make("secret"), principal]]),
          cursor: createCursorCodec(Redacted.make("cursor-secret")),
        })
        return yield* handlers.listArtifacts({
          headers: { "X-OpenCode-Location-ID": locationID },
          query: { limit: 1 },
        })
      }).pipe(
        Effect.provideService(
          HttpServerRequest.HttpServerRequest,
          HttpServerRequest.fromWeb(
            new Request("http://localhost/private/self-improvement/artifacts", {
              headers: { authorization: "Bearer secret" },
            }),
          ),
        ),
        Effect.provide(
          Layer.mock(Config.Service)({
            getGlobal: () =>
              Effect.succeed({
                experimental: { self_improvement: { tokens: { secret: principal }, cursorSecret: "cursor-secret" } },
              }),
          }),
        ),
        Effect.provide(
          Layer.mock(SelfImprovementPrivateQuery.Service)({
            listArtifacts: (input) =>
              Ref.set(receivedCursor, input.cursor).pipe(
                Effect.as({
                  items: [],
                  nextCursor: [
                    "skill",
                    SelfImprovement.CandidateName.make("artifact"),
                    SelfImprovementLifecycle.ArtifactID.make("si_art_cursor"),
                  ],
                }),
              ),
          }),
        ),
        Effect.provide(Layer.mock(SelfImprovementPrivateArtifactCommand.Service)({})),
      ),
    )

    expect(response.status).toBe(200)
    expect(await Effect.runPromise(Ref.get(receivedCursor))).toBeUndefined()
  })
})
