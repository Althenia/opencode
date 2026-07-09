import { afterEach, beforeEach, describe, expect } from "bun:test"
import { NodeHttpServer, NodeServices } from "@effect/platform-node"
import { Api } from "@opencode-ai/server/api"
import { ServerAuth } from "@opencode-ai/server/auth"
import { handlers } from "@opencode-ai/server/handlers"
import { layer as locationLayer } from "@opencode-ai/server/location"
import { authorizationLayer } from "@opencode-ai/server/middleware/authorization"
import { schemaErrorLayer } from "@opencode-ai/server/middleware/schema-error"
import { sessionLocationLayer } from "@opencode-ai/server/middleware/session-location"
import { PtyEnvironment } from "@opencode-ai/server/pty-environment"
import { Credential } from "@opencode-ai/core/credential"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { httpClient } from "@opencode-ai/core/effect/app-node-platform"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { LocationServiceMap, buildLocationServiceMap } from "@opencode-ai/core/location-services"
import { PermissionSaved } from "@opencode-ai/core/permission/saved"
import { PtyTicket } from "@opencode-ai/core/pty/ticket"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionExecutionLocal } from "@opencode-ai/core/session/execution/local"
import { GoalSupervisor } from "@opencode-ai/core/session/goal"
import { ToolOutputStore } from "@opencode-ai/core/tool-output-store"
import { Effect, Layer, Option } from "effect"
import { HttpClient, HttpClientRequest, HttpRouter, HttpServer } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { layerWebSocketConstructorGlobal } from "effect/unstable/socket/Socket"
import { resetDatabase } from "../fixture/db"
import { testEffect } from "../lib/effect"

const calls: Array<{ method: "start"; sessionID: string; goal: string } | { method: "stop" | "status"; sessionID: string }> = []
const locationServiceMap = buildLocationServiceMap()
const serviceLayer = AppNodeBuilder.build(
  LayerNode.group([
    Database.node,
    EventV2.node,
    httpClient,
    ToolOutputStore.cleanupNode,
    SessionV2.node,
    PermissionSaved.node,
    PtyTicket.node,
    Credential.node,
  ]),
  [
    [LocationServiceMap.node, locationServiceMap],
    [SessionExecution.node, SessionExecutionLocal.node],
  ],
)
const goalLayer = Layer.succeed(
  GoalSupervisor.Service,
  GoalSupervisor.Service.of({
    start: (input) =>
      Effect.sync(() => {
        calls.push({ method: "start", sessionID: input.sessionID, goal: input.goal })
        return { goal: input.goal, active: true, iteration: 1, cap: 10 }
      }),
    stop: (sessionID) =>
      Effect.sync(() => {
        calls.push({ method: "stop", sessionID })
      }),
    status: (sessionID) =>
      Effect.sync(() => {
        calls.push({ method: "status", sessionID })
        return { goal: "ship task 5", active: true, iteration: 1, cap: 10 }
      }),
  }),
)
const apiRoutes = HttpApiBuilder.layer(Api).pipe(
  Layer.provide(handlers),
  Layer.provide(sessionLocationLayer),
  Layer.provide(locationLayer),
  Layer.provide(authorizationLayer),
  Layer.provide(schemaErrorLayer),
  Layer.provide(PtyEnvironment.layer),
  Layer.provide(ServerAuth.Config.configLayer({ username: "opencode", password: Option.none() })),
  Layer.provide(locationServiceMap),
)
const httpApiLayer = HttpRouter.serve(apiRoutes, { disableListenLog: true, disableLogger: true }).pipe(
  Layer.provide(layerWebSocketConstructorGlobal),
  Layer.provideMerge(NodeHttpServer.layerTest),
  Layer.provideMerge(NodeServices.layer),
)
const it = testEffect(Layer.provideMerge(httpApiLayer, Layer.mergeAll(serviceLayer, goalLayer)))

function request(path: string, init?: RequestInit) {
  const url = new URL(path, "http://localhost")
  return HttpClientRequest.fromWeb(new Request(url, init)).pipe(
    HttpClientRequest.setUrl(url.pathname),
    HttpClient.execute,
  )
}

function json<T>(response: { readonly status: number; readonly json: Effect.Effect<unknown, unknown, HttpServer.HttpServer> }) {
  expect(response.status).toBe(200)
  return response.json.pipe(Effect.map((value) => value as T))
}

beforeEach(() => {
  calls.length = 0
})

afterEach(async () => {
  await resetDatabase()
})

describe("goal HttpApi", () => {
  it.live("wires session goal endpoints to the goal supervisor", () =>
    Effect.gen(function* () {
      const headers = { "content-type": "application/json" }
      const session = yield* json<{ data: { id: string } }>(
        yield* request("/api/session", { method: "POST", headers, body: "{}" }),
      )
      const sessionID = session.data.id

      expect(
        yield* json<{ data: GoalSupervisor.GoalState }>(
          yield* request(`/api/session/${sessionID}/goal/start`, {
            method: "POST",
            headers,
            body: JSON.stringify({ goal: "ship task 5" }),
          }),
        ),
      ).toEqual({ data: { goal: "ship task 5", active: true, iteration: 1, cap: 10 } })

      expect(
        yield* json<{ data: GoalSupervisor.GoalState | null }>(
          yield* request(`/api/session/${sessionID}/goal/status`),
        ),
      ).toEqual({ data: { goal: "ship task 5", active: true, iteration: 1, cap: 10 } })

      const stopped = yield* request(`/api/session/${sessionID}/goal/stop`, { method: "POST" })
      expect(stopped.status).toBe(204)
      expect(calls).toEqual([
        { method: "start", sessionID, goal: "ship task 5" },
        { method: "status", sessionID },
        { method: "stop", sessionID },
      ])
    }),
  )
})
