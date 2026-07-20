import { describe, expect, test } from "bun:test"
import { Cause, Effect, Exit, Redacted } from "effect"
import { SelfImprovementLifecycle } from "@opencode-ai/schema"
import { OpenApi } from "effect/unstable/httpapi"
import { ConfigSelfImprovement } from "../../src/config/self-improvement"
import {
  authorize,
  authorizeThen,
  createCursorCodec,
  resolvePrincipal,
} from "../../src/server/routes/instance/httpapi/middleware/self-improvement-authorization"
import { InstanceHttpApi } from "../../src/server/routes/instance/httpapi/api"
import { PrivateSelfImprovementApi } from "../../src/server/routes/instance/httpapi/groups/self-improvement"
import { PublicApi } from "../../src/server/routes/instance/httpapi/public"
import { selfImprovementHandlers } from "../../src/server/routes/instance/httpapi/handlers/self-improvement"

type OpenApiSpec = {
  readonly paths: Record<
    string,
    Record<
      string,
      {
        readonly parameters?: ReadonlyArray<{ readonly in: string; readonly name: string; readonly required?: boolean }>
        readonly responses?: Record<string, unknown>
      }
    >
  >
}

const locationID = SelfImprovementLifecycle.LocationID.make("a".repeat(64))
const otherLocationID = SelfImprovementLifecycle.LocationID.make("b".repeat(64))
const principal = new SelfImprovementLifecycle.Principal({
  id: SelfImprovementLifecycle.PrincipalID.make("operator"),
  kind: "first-party-user",
  locationID,
})

const routes = [
  "GET /private/self-improvement/artifacts",
  "POST /private/self-improvement/artifacts",
  "GET /private/self-improvement/artifacts/{artifactID}",
  "GET /private/self-improvement/artifacts/{artifactID}/versions",
  "POST /private/self-improvement/artifacts/{artifactID}/versions",
  "GET /private/self-improvement/artifacts/{artifactID}/versions/{versionID}",
  "POST /private/self-improvement/artifacts/{artifactID}/versions/{versionID}/archive",
  "POST /private/self-improvement/artifacts/{artifactID}/tombstone",
  "POST /private/self-improvement/approvals/{approvalRequestID}/approve",
  "POST /private/self-improvement/approvals/{approvalRequestID}/reject",
  "POST /private/self-improvement/observations",
  "POST /private/self-improvement/metric-runs",
  "POST /private/self-improvement/metric-runs/{runID}/samples",
  "POST /private/self-improvement/metric-runs/{runID}/decisions",
  "GET /private/self-improvement/baselines",
  "GET /private/self-improvement/metric-runs",
  "GET /private/self-improvement/evaluations",
  "GET /private/self-improvement/transitions",
  "GET /private/self-improvement/approvals",
  "GET /private/self-improvement/context-evidence",
  "GET /private/self-improvement/routing-decisions",
  "GET /private/self-improvement/audit",
]

function routeKeys(spec: OpenApiSpec) {
  return Object.entries(spec.paths).flatMap(([path, item]) =>
    Object.keys(item).map((method) => `${method.toUpperCase()} ${path}`),
  )
}

describe("private self-improvement HttpApi", () => {
  test("provides a private handler layer separately from the public API", () => {
    expect(selfImprovementHandlers).toBeDefined()
  })

  test("defines every Section 15 route without publishing it", () => {
    expect(routeKeys(OpenApi.fromApi(PrivateSelfImprovementApi) as OpenApiSpec)).toEqual(expect.arrayContaining(routes))
    expect(routeKeys(OpenApi.fromApi(PublicApi) as OpenApiSpec)).not.toEqual(expect.arrayContaining(routes))
    expect(routeKeys(OpenApi.fromApi(InstanceHttpApi) as OpenApiSpec)).not.toEqual(expect.arrayContaining(routes))
  })

  test("fails closed for missing or unknown bearer tokens", () => {
    expect(resolvePrincipal(undefined, new Map())).toBeUndefined()
    expect(resolvePrincipal("Bearer unknown", new Map())).toBeUndefined()
  })

  test("declares every private API error status for every endpoint", () => {
    const spec = OpenApi.fromApi(PrivateSelfImprovementApi) as OpenApiSpec

    for (const route of routes) {
      const [method, path] = route.split(" ")
      expect(Object.keys(spec.paths[path][method.toLowerCase()].responses ?? {})).toEqual(
        expect.arrayContaining(["400", "403", "404", "409", "503"]),
      )
    }
  })

  test("requires the exact Location grant headers", () => {
    const spec = OpenApi.fromApi(PrivateSelfImprovementApi) as OpenApiSpec

    for (const route of routes) {
      const [method, path] = route.split(" ")
      const headers = spec.paths[path][method.toLowerCase()].parameters
        ?.filter((parameter) => parameter.in === "header")
        .map((parameter) => ({ name: parameter.name, required: parameter.required }))
        .sort((a, b) => a.name.localeCompare(b.name))
      const artifactMutation = [
        "POST /private/self-improvement/artifacts/{artifactID}/versions",
        "POST /private/self-improvement/artifacts/{artifactID}/versions/{versionID}/archive",
        "POST /private/self-improvement/artifacts/{artifactID}/tombstone",
      ].includes(route)
      const mutation = method === "POST"

      expect(headers, route).toEqual(
        ["X-OpenCode-Location-ID", ...(mutation ? ["Idempotency-Key"] : []), ...(artifactMutation ? ["If-Match"] : [])]
          .sort()
          .map((name) => ({ name, required: true })),
      )
    }
  })

  test("decodes config tokens into a redacted immutable bearer map", () => {
    const tokens = ConfigSelfImprovement.tokens({ tokens: { secret: principal } })

    expect(resolvePrincipal("Bearer secret", tokens)).toEqual(principal)
    expect("set" in tokens).toBe(false)
    expect(resolvePrincipal("bearer secret", tokens)).toBeUndefined()
    expect(resolvePrincipal("Bearer secret extra", tokens)).toBeUndefined()
    expect(Array.from(ConfigSelfImprovement.tokens(undefined))).toEqual([])
    expect("set" in ConfigSelfImprovement.tokens(undefined)).toBe(false)
    expect(
      ConfigSelfImprovement.settings({ experimental: { self_improvement: { tokens: { secret: principal } } } }),
    ).toBeUndefined()
    const settings = ConfigSelfImprovement.settings({
      experimental: { self_improvement: { tokens: { secret: principal }, cursorSecret: "cursor-secret" } },
    })
    expect(settings && resolvePrincipal("Bearer secret", settings.tokens)).toEqual(principal)
    expect(settings && Redacted.value(settings.cursorSecret)).toBe("cursor-secret")
    expect(
      Array.from(
        ConfigSelfImprovement.tokens({
          tokens: { secret: { id: principal.id, kind: principal.kind, locationID: "invalid" } },
        }),
      ),
    ).toEqual([])
  })

  test("authorizes the Core operation matrix and conceals parent mismatches", async () => {
    const tokens = new Map([[Redacted.make("secret"), principal]])

    expect(
      await Effect.runPromise(
        authorize({ authorization: "Bearer secret", locationID, operation: "artifact.read", tokens }),
      ),
    ).toEqual(principal)
    expect(
      await Effect.runPromiseExit(
        authorize({ authorization: "Bearer secret", locationID, operation: "approval.decide", tokens }),
      ),
    ).toMatchObject({ _tag: "Failure" })
    const concealed = await Effect.runPromiseExit(
      authorize({
        authorization: "Bearer secret",
        locationID: otherLocationID,
        parentLocationID: locationID,
        operation: "artifact.read",
        tokens,
      }),
    )
    expect(Exit.isFailure(concealed)).toBe(true)
    if (Exit.isFailure(concealed)) expect(Cause.pretty(concealed.cause)).toContain("NotFound")
  })

  test("authorizes the Location grant before invoking downstream work", async () => {
    const tokens = new Map([[Redacted.make("secret"), principal]])
    const downstream = (granted: SelfImprovementLifecycle.Principal) => Effect.sync(() => granted)
    let runs = 0

    expect(
      await Effect.runPromise(
        authorizeThen({ authorization: "Bearer secret", locationID, operation: "artifact.read", tokens }, downstream),
      ),
    ).toEqual(principal)

    expect(
      await Effect.runPromiseExit(
        authorizeThen(
          {
            authorization: "Bearer secret",
            locationID: otherLocationID,
            operation: "artifact.read",
            tokens,
          },
          () => Effect.sync(() => ++runs),
        ),
      ),
    ).toMatchObject({ _tag: "Failure" })

    expect(
      await Effect.runPromiseExit(
        authorizeThen(
          {
            authorization: "Bearer secret",
            locationID,
            parentLocationID: otherLocationID,
            operation: "artifact.read",
            tokens,
          },
          () => Effect.sync(() => ++runs),
        ),
      ),
    ).toMatchObject({ _tag: "Failure" })
    expect(runs).toBe(0)
  })

  test("binds opaque cursors to their location and endpoint", () => {
    const codec = createCursorCodec(Redacted.make("cursor-secret"))
    const cursor = codec.encode({ locationID, endpoint: "listArtifacts", tuple: ["skill", "name", "artifact"] })

    expect(codec.decode(cursor, { locationID, endpoint: "listArtifacts" })).toEqual(["skill", "name", "artifact"])
    expect(codec.decode(cursor, { locationID: otherLocationID, endpoint: "listArtifacts" })).toBeUndefined()
    expect(codec.decode(cursor, { locationID, endpoint: "listVersions" })).toBeUndefined()
    expect(codec.decode(cursor + "x", { locationID, endpoint: "listArtifacts" })).toBeUndefined()
  })
})
