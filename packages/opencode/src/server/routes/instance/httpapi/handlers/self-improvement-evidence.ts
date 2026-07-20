import { SelfImprovement, SelfImprovementApi, SelfImprovementLifecycle } from "@opencode-ai/schema"
import { SelfImprovementPrivateEvidenceCommand } from "@opencode-ai/core/self-improvement/private-evidence-command"
import { SelfImprovementPrivateQuery } from "@opencode-ai/core/self-improvement/private-query"
import { SelfImprovementAuditStore } from "@opencode-ai/core/self-improvement/audit-store"
import { SelfImprovementAuthorization } from "@opencode-ai/core/self-improvement/authorization"
import { SelfImprovementEvaluator } from "@opencode-ai/core/self-improvement/evaluator"
import { SelfImprovementIngressStore } from "@opencode-ai/core/self-improvement/ingress-store"
import { DateTime, Effect, Schema } from "effect"
import { HttpServerRequest } from "effect/unstable/http"
import { HttpApiError } from "effect/unstable/httpapi"
import { authorize, type Tokens, type createCursorCodec } from "../middleware/self-improvement-authorization"

type CursorCodec = ReturnType<typeof createCursorCodec>

export function makeSelfImprovementEvidenceHandlers(input: { readonly tokens: Tokens; readonly cursor: CursorCodec }) {
  const location = (headers: SelfImprovementApi.LocationHeaders) => headers["X-OpenCode-Location-ID"]
  const mutationLocation = (headers: SelfImprovementApi.MutationHeaders) => headers["X-OpenCode-Location-ID"]
  const now = Effect.map(DateTime.nowAsDate, (value) => SelfImprovementLifecycle.TimestampMillis.make(value.getTime()))

  const principal = Effect.fn("SelfImprovementEvidenceHttpApi.principal")(function* (
    locationID: SelfImprovementLifecycle.LocationID,
    operation: SelfImprovementLifecycle.Operation,
  ) {
    const request = yield* HttpServerRequest.HttpServerRequest
    return yield* authorize({
      authorization: request.headers.authorization,
      locationID,
      operation,
      tokens: input.tokens,
    })
  })

  const readCursor = <A>(
    cursor: SelfImprovementApi.Cursor | undefined,
    locationID: SelfImprovementLifecycle.LocationID,
    endpoint: string,
    decode: (tuple: ReadonlyArray<string>) => A | undefined,
  ): Effect.Effect<A | undefined, HttpApiError.BadRequest> => {
    if (!cursor) return Effect.succeed(undefined)
    const result = input.cursor.decode(cursor, { locationID, endpoint })
    const value = result ? decode(result) : undefined
    if (value === undefined) return Effect.fail(new HttpApiError.BadRequest({}))
    return Effect.succeed(value)
  }

  const page = <A, C extends ReadonlyArray<unknown>>(
    result: SelfImprovementPrivateQuery.Page<A, C>,
    locationID: SelfImprovementLifecycle.LocationID,
    endpoint: string,
  ) => ({
    items: result.items,
    ...(result.nextCursor
      ? {
          nextCursor: SelfImprovementApi.Cursor.make(
            input.cursor.encode({ locationID, endpoint, tuple: result.nextCursor.map(String) }),
          ),
        }
      : {}),
  })

  const timestampCursor = (tuple: ReadonlyArray<string>): SelfImprovementPrivateQuery.Cursor | undefined => {
    const timestamp = Number(tuple[0])
    if (tuple.length !== 2 || !Number.isSafeInteger(timestamp) || timestamp < 0 || !tuple[1]) return undefined
    return [SelfImprovementLifecycle.TimestampMillis.make(timestamp), tuple[1]] as const
  }

  const mapCommandErrors = <A, R>(
    effect: Effect.Effect<
      A,
      | SelfImprovementAuthorization.Forbidden
      | SelfImprovementPrivateEvidenceCommand.NotFound
      | SelfImprovementPrivateEvidenceCommand.Conflict
      | SelfImprovementIngressStore.InvalidInput
      | SelfImprovementIngressStore.Conflict
      | SelfImprovementEvaluator.InvalidEvidence
      | SelfImprovementAuditStore.InvalidInput
      | SelfImprovementAuditStore.Conflict,
      R
    >,
  ) =>
    effect.pipe(
      Effect.catchTags({
        "SelfImprovementAuthorization.Forbidden": () => new HttpApiError.Forbidden({}),
        "SelfImprovementPrivateEvidenceCommand.NotFound": () => new HttpApiError.NotFound({}),
        "SelfImprovementPrivateEvidenceCommand.Conflict": () => new HttpApiError.Conflict({}),
        "SelfImprovementIngressStore.InvalidInput": () => new HttpApiError.BadRequest({}),
        "SelfImprovementIngressStore.Conflict": () => new HttpApiError.Conflict({}),
        "SelfImprovementEvaluator.InvalidEvidence": () => new HttpApiError.BadRequest({}),
        "SelfImprovementAuditStore.InvalidInput": () => new HttpApiError.BadRequest({}),
        "SelfImprovementAuditStore.Conflict": () => new HttpApiError.Conflict({}),
      }),
    )

  const createObservation = Effect.fn("SelfImprovementEvidenceHttpApi.createObservation")(function* (ctx: {
    readonly headers: SelfImprovementApi.MutationHeaders
    readonly payload: SelfImprovementApi.CreateObservationRequest
  }) {
    const locationID = mutationLocation(ctx.headers)
    const granted = yield* principal(locationID, "evidence.ingest")
    const command = yield* SelfImprovementPrivateEvidenceCommand.Service
    return yield* mapCommandErrors(
      command.createObservation(
        { principal: granted, locationID, now: yield* now, idempotencyKey: ctx.headers["Idempotency-Key"] },
        ctx.payload,
      ),
    )
  })

  const createObservationRaw = Effect.fn("SelfImprovementEvidenceHttpApi.createObservationRaw")(function* (ctx: {
    readonly headers: SelfImprovementApi.MutationHeaders
    readonly request: HttpServerRequest.HttpServerRequest
  }) {
    const payload = yield* ctx.request.json.pipe(
      Effect.mapError(() => new HttpApiError.BadRequest({})),
      Effect.flatMap(
        Schema.decodeUnknownEffect(SelfImprovementApi.CreateObservationRequest, { onExcessProperty: "error" }),
      ),
      Effect.mapError(() => new HttpApiError.BadRequest({})),
    )
    return yield* createObservation({ headers: ctx.headers, payload })
  })

  const createMetricRun = Effect.fn("SelfImprovementEvidenceHttpApi.createMetricRun")(function* (ctx: {
    readonly headers: SelfImprovementApi.MutationHeaders
    readonly payload: SelfImprovementApi.CreateMetricRunRequest
  }) {
    const locationID = mutationLocation(ctx.headers)
    const granted = yield* principal(locationID, "evidence.ingest")
    const command = yield* SelfImprovementPrivateEvidenceCommand.Service
    const run = yield* mapCommandErrors(
      command.createMetricRun(
        { principal: granted, locationID, now: yield* now, idempotencyKey: ctx.headers["Idempotency-Key"] },
        ctx.payload,
      ),
    )
    return new SelfImprovementApi.CreateMetricRunResponse({ run })
  })

  const requireRun = Effect.fn("SelfImprovementEvidenceHttpApi.requireRun")(function* (
    locationID: SelfImprovementLifecycle.LocationID,
    runID: SelfImprovementLifecycle.EvaluationRunID,
    operation: SelfImprovementLifecycle.Operation,
  ) {
    const granted = yield* principal(locationID, operation)
    const query = yield* SelfImprovementPrivateQuery.Service
    const run = yield* query.getRun({ locationID, runID })
    if (!run || run.locationID !== locationID) return yield* new HttpApiError.NotFound({})
    return { granted, run }
  })

  const addMetricSample = Effect.fn("SelfImprovementEvidenceHttpApi.addMetricSample")(function* (ctx: {
    readonly headers: SelfImprovementApi.MutationHeaders
    readonly params: { readonly runID: SelfImprovementLifecycle.EvaluationRunID }
    readonly payload: SelfImprovementApi.AddMetricSampleRequest
  }) {
    const locationID = mutationLocation(ctx.headers)
    const required = yield* requireRun(locationID, ctx.params.runID, "evidence.ingest")
    const command = yield* SelfImprovementPrivateEvidenceCommand.Service
    return yield* mapCommandErrors(
      command.addMetricSample(
        { principal: required.granted, locationID, now: yield* now, idempotencyKey: ctx.headers["Idempotency-Key"] },
        new SelfImprovementApi.AddMetricSampleRequest({ ...ctx.payload, runID: ctx.params.runID }),
      ),
    )
  })

  const decideMetricRun = Effect.fn("SelfImprovementEvidenceHttpApi.decideMetricRun")(function* (ctx: {
    readonly headers: SelfImprovementApi.MutationHeaders
    readonly params: { readonly runID: SelfImprovementLifecycle.EvaluationRunID }
    readonly payload: SelfImprovementApi.DecideMetricRunRequest
  }) {
    const locationID = mutationLocation(ctx.headers)
    const required = yield* requireRun(locationID, ctx.params.runID, "evaluation.decide")
    const command = yield* SelfImprovementPrivateEvidenceCommand.Service
    return yield* mapCommandErrors(
      command.decideMetricRun(
        { principal: required.granted, locationID, now: yield* now, idempotencyKey: ctx.headers["Idempotency-Key"] },
        new SelfImprovementApi.DecideMetricRunRequest({ ...ctx.payload, runID: ctx.params.runID }),
      ),
    )
  })

  const listArtifacts = Effect.fn("SelfImprovementEvidenceHttpApi.listArtifacts")(function* (ctx: {
    readonly headers: SelfImprovementApi.LocationHeaders
    readonly query: SelfImprovementApi.ListArtifactsRequest
  }) {
    const locationID = location(ctx.headers)
    yield* principal(locationID, "artifact.read")
    const query = yield* SelfImprovementPrivateQuery.Service
    const cursor = yield* readCursor(ctx.query.cursor, locationID, "listArtifacts", (tuple) =>
      tuple.length === 3 && tuple.every(Boolean)
        ? ([
            tuple[0] as SelfImprovement.ArtifactKind,
            SelfImprovement.CandidateName.make(tuple[1]),
            SelfImprovementLifecycle.ArtifactID.make(tuple[2]),
          ] as SelfImprovementPrivateQuery.ArtifactCursor)
        : undefined,
    )
    return page(
      yield* query.listArtifacts({
        ...ctx.query,
        locationID,
        cursor,
      }),
      locationID,
      "listArtifacts",
    )
  })

  const getArtifact = Effect.fn("SelfImprovementEvidenceHttpApi.getArtifact")(function* (ctx: {
    readonly headers: SelfImprovementApi.LocationHeaders
    readonly params: { readonly artifactID: SelfImprovementLifecycle.ArtifactID }
  }) {
    const locationID = location(ctx.headers)
    yield* principal(locationID, "artifact.read")
    const query = yield* SelfImprovementPrivateQuery.Service
    const result = yield* query.getArtifact({ locationID, artifactID: ctx.params.artifactID })
    if (!result) return yield* new HttpApiError.NotFound({})
    return result
  })

  const listVersions = Effect.fn("SelfImprovementEvidenceHttpApi.listVersions")(function* (ctx: {
    readonly headers: SelfImprovementApi.LocationHeaders
    readonly params: { readonly artifactID: SelfImprovementLifecycle.ArtifactID }
    readonly query: SelfImprovementApi.ListVersionsRequest
  }) {
    const locationID = location(ctx.headers)
    yield* principal(locationID, "artifact.read")
    const query = yield* SelfImprovementPrivateQuery.Service
    const artifact = yield* query.getArtifact({ locationID, artifactID: ctx.params.artifactID })
    if (!artifact) return yield* new HttpApiError.NotFound({})
    const cursor = yield* readCursor(ctx.query.cursor, locationID, "listVersions", (tuple) => {
      const version = Number(tuple[0])
      if (tuple.length !== 2 || !Number.isSafeInteger(version) || version < 1 || !tuple[1]) return undefined
      return [
        version,
        SelfImprovementLifecycle.ArtifactVersionID.make(tuple[1]),
      ] as SelfImprovementPrivateQuery.VersionCursor
    })
    return page(
      yield* query.listVersions({
        ...ctx.query,
        artifactID: ctx.params.artifactID,
        locationID,
        cursor,
      }),
      locationID,
      "listVersions",
    )
  })

  const getVersion = Effect.fn("SelfImprovementEvidenceHttpApi.getVersion")(function* (ctx: {
    readonly headers: SelfImprovementApi.LocationHeaders
    readonly params: {
      readonly artifactID: SelfImprovementLifecycle.ArtifactID
      readonly versionID: SelfImprovementLifecycle.ArtifactVersionID
    }
  }) {
    const locationID = location(ctx.headers)
    yield* principal(locationID, "artifact.read")
    const query = yield* SelfImprovementPrivateQuery.Service
    const result = yield* query.getVersion({ locationID, ...ctx.params })
    if (!result) return yield* new HttpApiError.NotFound({})
    return result
  })

  const listBaselines = readList("listBaselines", "audit.read", (query, locationID, ctx) =>
    Effect.gen(function* () {
      const cursor = yield* readCursor(ctx.query.cursor, locationID, "listBaselines", timestampCursor)
      return yield* query.listBaselines({ ...ctx.query, locationID, cursor })
    }),
  )

  const listMetricRuns = readList<
    SelfImprovementApi.MetricRunView,
    SelfImprovementPrivateQuery.Cursor,
    SelfImprovementApi.ListMetricRunsRequest
  >("listMetricRuns", "audit.read", (query, locationID, ctx, granted) =>
    Effect.gen(function* () {
      if (ctx.query.includeSamples && granted.kind !== "audit-reader") return yield* new HttpApiError.Forbidden({})
      const cursor = yield* readCursor(ctx.query.cursor, locationID, "listMetricRuns", timestampCursor)
      return yield* query.listMetricRuns({ ...ctx.query, locationID, cursor })
    }),
  )

  const listEvaluations = readList("listEvaluations", "audit.read", (query, locationID, ctx) =>
    Effect.gen(function* () {
      const cursor = yield* readCursor(ctx.query.cursor, locationID, "listEvaluations", timestampCursor)
      return yield* query.listEvaluations({ ...ctx.query, locationID, cursor })
    }),
  )

  const listTransitions = readList("listTransitions", "audit.read", (query, locationID, ctx) =>
    Effect.gen(function* () {
      const cursor = yield* readCursor(ctx.query.cursor, locationID, "listTransitions", timestampCursor)
      return yield* query.listTransitions({ ...ctx.query, locationID, cursor })
    }),
  )

  const listApprovals = readList("listApprovals", "audit.read", (query, locationID, ctx) =>
    Effect.gen(function* () {
      const cursor = yield* readCursor(ctx.query.cursor, locationID, "listApprovals", timestampCursor)
      return yield* query.listApprovals({ ...ctx.query, locationID, cursor })
    }),
  )

  const listContextEvidence = readList("listContextEvidence", "audit.read", (query, locationID, ctx) =>
    Effect.gen(function* () {
      const cursor = yield* readCursor(ctx.query.cursor, locationID, "listContextEvidence", timestampCursor)
      return yield* query.listContextEvidence({ ...ctx.query, locationID, cursor })
    }),
  )

  const listRoutingDecisions = readList("listRoutingDecisions", "audit.read", (query, locationID, ctx) =>
    Effect.gen(function* () {
      const cursor = yield* readCursor(ctx.query.cursor, locationID, "listRoutingDecisions", timestampCursor)
      return yield* query.listRoutingDecisions({ ...ctx.query, locationID, cursor })
    }),
  )

  const listAudit = Effect.fn("SelfImprovementEvidenceHttpApi.listAudit")(function* (ctx: {
    readonly headers: SelfImprovementApi.LocationHeaders
    readonly query: SelfImprovementApi.ListAuditRequest
  }) {
    const locationID = location(ctx.headers)
    const granted = yield* principal(locationID, "audit.read")
    const command = yield* SelfImprovementPrivateEvidenceCommand.Service
    yield* mapCommandErrors(
      command.auditReadAccess({ principal: granted, locationID, now: yield* now }, { eventType: ctx.query.eventType }),
    )
    const query = yield* SelfImprovementPrivateQuery.Service
    const cursor = yield* readCursor(ctx.query.cursor, locationID, "listAudit", timestampCursor)
    return page(
      yield* query.listAudit({
        ...ctx.query,
        locationID,
        cursor,
      }),
      locationID,
      "listAudit",
    )
  })

  function readList<
    A,
    C extends ReadonlyArray<unknown>,
    Q extends { readonly cursor?: SelfImprovementApi.Cursor; readonly limit: number },
  >(
    endpoint: string,
    operation: SelfImprovementLifecycle.Operation,
    list: (
      query: SelfImprovementPrivateQuery.Interface,
      locationID: SelfImprovementLifecycle.LocationID,
      ctx: { readonly headers: SelfImprovementApi.LocationHeaders; readonly query: Q },
      granted: SelfImprovementLifecycle.Principal,
    ) => Effect.Effect<SelfImprovementPrivateQuery.Page<A, C>, HttpApiError.BadRequest | HttpApiError.Forbidden>,
  ) {
    return Effect.fn(`SelfImprovementEvidenceHttpApi.${endpoint}`)(function* (ctx: {
      readonly headers: SelfImprovementApi.LocationHeaders
      readonly query: Q
    }) {
      const locationID = location(ctx.headers)
      const granted = yield* principal(locationID, operation)
      const query = yield* SelfImprovementPrivateQuery.Service
      return page(yield* list(query, locationID, ctx, granted), locationID, endpoint)
    })
  }

  return {
    createObservation,
    createObservationRaw,
    createMetricRun,
    addMetricSample,
    decideMetricRun,
    listArtifacts,
    getArtifact,
    listVersions,
    getVersion,
    listBaselines,
    listMetricRuns,
    listEvaluations,
    listTransitions,
    listApprovals,
    listContextEvidence,
    listRoutingDecisions,
    listAudit,
  }
}

export * as SelfImprovementEvidenceHandlers from "./self-improvement-evidence"
