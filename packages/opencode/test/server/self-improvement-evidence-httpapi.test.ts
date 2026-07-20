import { NodeHttpServer } from "@effect/platform-node"
import { describe, expect, test } from "bun:test"
import { Effect, Layer, Redacted, Ref } from "effect"
import { HttpClient, HttpClientRequest, HttpRouter, HttpServerRequest } from "effect/unstable/http"
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiError, HttpApiGroup } from "effect/unstable/httpapi"
import {
  SelfImprovement,
  SelfImprovementApi,
  SelfImprovementEvaluation,
  SelfImprovementLearning,
  SelfImprovementLifecycle,
} from "@opencode-ai/schema"
import { SelfImprovementPrivateEvidenceCommand } from "@opencode-ai/core/self-improvement/private-evidence-command"
import { SelfImprovementPrivateQuery } from "@opencode-ai/core/self-improvement/private-query"
import { makeSelfImprovementEvidenceHandlers } from "../../src/server/routes/instance/httpapi/handlers/self-improvement-evidence"
import { createCursorCodec } from "../../src/server/routes/instance/httpapi/middleware/self-improvement-authorization"
import { testEffect } from "../lib/effect"

const locationID = SelfImprovementLifecycle.LocationID.make("a".repeat(64))
const principal = new SelfImprovementLifecycle.Principal({
  id: SelfImprovementLifecycle.PrincipalID.make("audit-reader"),
  kind: "audit-reader",
  locationID,
})
const evidencePrincipal = new SelfImprovementLifecycle.Principal({
  id: SelfImprovementLifecycle.PrincipalID.make("runtime-evidence"),
  kind: "runtime-evidence-service",
  locationID,
})

const persistedObservations = Ref.makeUnsafe(0)
const mountedApi = HttpApi.make("mounted-self-improvement").add(
  HttpApiGroup.make("mounted-self-improvement").add(
    HttpApiEndpoint.post("createObservation", "/private/self-improvement/observations", {
      headers: SelfImprovementApi.MutationHeaders,
      payload: SelfImprovementApi.CreateObservationRequest,
      success: SelfImprovementApi.CreateObservationResponse,
      error: [HttpApiError.BadRequest, HttpApiError.Forbidden, HttpApiError.NotFound, HttpApiError.Conflict],
    }),
  ),
)
const mountedHandlers = HttpApiBuilder.group(mountedApi, "mounted-self-improvement", (handlers) => {
  const evidence = makeSelfImprovementEvidenceHandlers({
    tokens: new Map([[Redacted.make("secret"), evidencePrincipal]]),
    cursor: createCursorCodec(Redacted.make("cursor-secret")),
  })
  return handlers.handleRaw("createObservation", evidence.createObservationRaw)
})
const mountedEvidence = Layer.succeed(
  SelfImprovementPrivateEvidenceCommand.Service,
  SelfImprovementPrivateEvidenceCommand.Service.of({
    createObservation: () =>
      Ref.update(persistedObservations, (count) => count + 1).pipe(
        Effect.andThen(Effect.die("Rejected raw observation reached persistence")),
      ),
    createMetricRun: () => Effect.die("unused"),
    addMetricSample: () => Effect.die("unused"),
    decideMetricRun: () => Effect.die("unused"),
    auditReadAccess: () => Effect.die("unused"),
  }),
)
const mountedSelfImprovementLayer = HttpRouter.serve(
  HttpApiBuilder.layer(mountedApi).pipe(Layer.provide(mountedHandlers.pipe(Layer.provide(mountedEvidence)))),
  { disableListenLog: true, disableLogger: true },
).pipe(Layer.provideMerge(NodeHttpServer.layerTest), Layer.provide(mountedEvidence))
const mounted = testEffect(mountedSelfImprovementLayer)

describe("self-improvement evidence HTTP handlers", () => {
  test("authorizes before querying and decodes endpoint-bound cursors", async () => {
    let calls = 0
    let cursor: unknown
    const codec = createCursorCodec(Redacted.make("cursor-secret"))
    const handlers = makeSelfImprovementEvidenceHandlers({
      tokens: new Map([[Redacted.make("secret"), principal]]),
      cursor: codec,
    })
    const request = (authorization?: string) =>
      HttpServerRequest.fromWeb(
        new Request("http://localhost/private/self-improvement/metric-runs", {
          headers: authorization ? { authorization } : {},
        }),
      )
    const invoke = (authorization?: string) =>
      handlers
        .listMetricRuns({
          headers: { "X-OpenCode-Location-ID": locationID },
          query: new SelfImprovementApi.ListMetricRunsRequest({
            includeSamples: false,
            limit: 1,
            cursor: SelfImprovementApi.Cursor.make(
              codec.encode({ locationID, endpoint: "listMetricRuns", tuple: ["2", "si_run_1"] }),
            ),
          }),
        })
        .pipe(
          Effect.provideService(HttpServerRequest.HttpServerRequest, request(authorization)),
          Effect.provide(
            Layer.mock(SelfImprovementPrivateQuery.Service)({
              listMetricRuns: (input: { readonly cursor?: unknown }) =>
                Effect.sync(() => {
                  calls++
                  cursor = input.cursor
                  return { items: [] }
                }),
            }),
          ),
        )

    expect(await Effect.runPromiseExit(invoke())).toMatchObject({ _tag: "Failure" })
    expect(calls).toBe(0)
    expect(await Effect.runPromise(invoke("Bearer secret"))).toEqual({ items: [] })
    expect(calls).toBe(1)
    expect(cursor).toEqual([2, "si_run_1"])
  })

  test("strictly decodes raw observations before invoking the command", async () => {
    let calls = 0
    const response = new SelfImprovementApi.CreateObservationResponse({
      observation: new SelfImprovementLearning.Observation({
        id: SelfImprovementLifecycle.ObservationID.make("si_obs_raw"),
        locationID,
        patternDigest: SelfImprovement.Digest.make("b".repeat(64)),
        identityDigest: SelfImprovement.Digest.make("c".repeat(64)),
        workload: SelfImprovementEvaluation.Workload.make("typescript"),
        workloadRevision: SelfImprovementLifecycle.Revision.make(1),
        errorClass: "type-error",
        orderedToolSymbolDigest: SelfImprovement.Digest.make("d".repeat(64)),
        outcomeClass: "failure",
        taskIDDigest: SelfImprovement.Digest.make("a".repeat(64)),
        producerID: evidencePrincipal.id,
        occurredAt: SelfImprovementLifecycle.TimestampMillis.make(0),
        expiresAt: SelfImprovementLifecycle.TimestampMillis.make(30 * 86_400_000),
      }),
      matchingCount: 1,
      generationEligible: true,
    })
    const handlers = makeSelfImprovementEvidenceHandlers({
      tokens: new Map([[Redacted.make("secret"), evidencePrincipal]]),
      cursor: createCursorCodec(Redacted.make("cursor-secret")),
    })
    const invoke = (body: unknown) => {
      const request = HttpServerRequest.fromWeb(
        new Request("http://localhost/private/self-improvement/observations", {
          method: "POST",
          headers: { authorization: "Bearer secret", "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
      )
      return handlers
        .createObservationRaw({
          headers: {
            "X-OpenCode-Location-ID": locationID,
            "Idempotency-Key": SelfImprovementLearning.IdempotencyKey.make("observation"),
          },
          request,
        })
        .pipe(
          Effect.provideService(HttpServerRequest.HttpServerRequest, request),
          Effect.provide(
            Layer.mock(SelfImprovementPrivateEvidenceCommand.Service)({
              createObservation: () =>
                Effect.sync(() => {
                  calls++
                }).pipe(Effect.as(response)),
            }),
          ),
        )
    }
    const valid = {
      workload: SelfImprovementEvaluation.Workload.make("typescript"),
      workloadRevision: SelfImprovementLifecycle.Revision.make(1),
      errorClass: "type-error",
      orderedToolSymbolIDs: ["tool-a"],
      outcomeClass: "failure",
      taskIDDigest: "a".repeat(64),
    }

    expect(await Effect.runPromise(invoke(valid))).toEqual(response)
    expect(calls).toBe(1)
    expect(await Effect.runPromiseExit(invoke({ ...valid, transcript: "must-not-pass" }))).toMatchObject({
      _tag: "Failure",
    })
    expect(calls).toBe(1)
  })

  mounted.live("returns HTTP 400 for excess observation fields without reaching persistence", () =>
    Effect.gen(function* () {
      yield* Ref.set(persistedObservations, 0)
      const response = yield* HttpClientRequest.post("/private/self-improvement/observations").pipe(
        HttpClientRequest.setHeaders({
          authorization: "Bearer secret",
          "X-OpenCode-Location-ID": locationID,
          "Idempotency-Key": "mounted-observation",
        }),
        HttpClientRequest.bodyJson({
          workload: "typescript",
          workloadRevision: 1,
          errorClass: "type-error",
          orderedToolSymbolIDs: ["tool-a"],
          outcomeClass: "failure",
          taskIDDigest: "a".repeat(64),
          transcript: "must-not-persist",
        }),
        Effect.flatMap(HttpClient.execute),
      )

      expect(response.status).toBe(400)
      expect(yield* Ref.get(persistedObservations)).toBe(0)
    }),
  )
})
