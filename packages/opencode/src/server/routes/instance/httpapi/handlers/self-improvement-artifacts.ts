import { SelfImprovementPrivateArtifactCommand } from "@opencode-ai/core/self-improvement/private-artifact-command"
import { SelfImprovementPrivateQuery } from "@opencode-ai/core/self-improvement/private-query"
import { SelfImprovement, SelfImprovementApi, SelfImprovementLifecycle } from "@opencode-ai/schema"
import { Clock, Effect, Option, Schema } from "effect"
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import {
  authorize,
  type Tokens,
  type createCursorCodec,
  resolvePrincipal,
} from "../middleware/self-improvement-authorization"

type CursorCodec = ReturnType<typeof createCursorCodec>

const decodeArtifactCursor = Schema.decodeUnknownOption(
  Schema.Tuple([SelfImprovement.ArtifactKind, SelfImprovement.CandidateName, SelfImprovementLifecycle.ArtifactID]),
)
const decodeVersionCursor = Schema.decodeUnknownOption(
  Schema.Tuple([Schema.Number, SelfImprovementLifecycle.ArtifactVersionID]),
)

export function makeSelfImprovementArtifactHandlers(input: { readonly tokens: Tokens; readonly cursor: CursorCodec }) {
  const principal = Effect.fn("SelfImprovementArtifactHttpApi.principal")(function* (
    headers: { readonly "X-OpenCode-Location-ID": SelfImprovementLifecycle.LocationID },
    operation: SelfImprovementLifecycle.Operation,
  ) {
    const request = yield* HttpServerRequest.HttpServerRequest
    const authorization = request.headers.authorization
    return yield* authorize({
      authorization,
      locationID: headers["X-OpenCode-Location-ID"],
      parentLocationID: resolvePrincipal(authorization, input.tokens)?.locationID,
      operation,
      tokens: input.tokens,
    })
  })

  const commandResponse = (result: {
    readonly response: SelfImprovementApi.StoredResponse
    readonly replayed?: boolean
  }) =>
    HttpServerResponse.jsonUnsafe(result.response.body, {
      status: result.response.status,
      headers: result.replayed ? { "Idempotency-Replayed": "true" } : undefined,
    })

  const runCommand = <A extends { readonly response: SelfImprovementApi.StoredResponse; readonly replayed?: boolean }>(
    effect: Effect.Effect<A, SelfImprovementPrivateArtifactCommand.Failure>,
  ) =>
    effect.pipe(
      Effect.map(commandResponse),
      Effect.catchTag("SelfImprovementPrivateArtifactCommand.Failure", ({ response }) =>
        Effect.succeed(commandResponse({ response })),
      ),
    )

  const invalidPage = () =>
    HttpServerResponse.jsonUnsafe(
      new SelfImprovementApi.ApiError({
        code: "invalid-page",
        message: "Invalid cursor",
        requestID: "self-improvement-artifacts",
        details: new SelfImprovementApi.ApiErrorDetails({}),
      }),
      { status: 400 },
    )

  const notFound = () =>
    HttpServerResponse.jsonUnsafe(
      new SelfImprovementApi.ApiError({
        code: "artifact-not-found",
        message: "Artifact was not found",
        requestID: "self-improvement-artifacts",
        details: new SelfImprovementApi.ApiErrorDetails({}),
      }),
      { status: 404 },
    )

  const listArtifacts = Effect.fn("SelfImprovementArtifactHttpApi.listArtifacts")(function* (ctx: {
    readonly headers: SelfImprovementApi.LocationHeaders
    readonly query: SelfImprovementApi.ListArtifactsRequest
  }) {
    yield* principal(ctx.headers, "artifact.read")
    const query = yield* SelfImprovementPrivateQuery.Service
    const codec = input.cursor
    const decoded = ctx.query.cursor
      ? codec.decode(ctx.query.cursor, {
          locationID: ctx.headers["X-OpenCode-Location-ID"],
          endpoint: "listArtifacts",
        })
      : undefined
    const cursor = decoded === undefined ? Option.none() : decodeArtifactCursor(decoded)
    if (ctx.query.cursor && Option.isNone(cursor)) return invalidPage()
    const page = yield* query.listArtifacts({
      locationID: ctx.headers["X-OpenCode-Location-ID"],
      kind: ctx.query.kind,
      status: ctx.query.status,
      namePrefix: ctx.query.namePrefix,
      limit: ctx.query.limit,
      ...(Option.isSome(cursor) ? { cursor: cursor.value } : {}),
    })
    const nextCursor = page.nextCursor
      ? codec.encode({
          locationID: ctx.headers["X-OpenCode-Location-ID"],
          endpoint: "listArtifacts",
          tuple: page.nextCursor.map(String),
        })
      : undefined
    return HttpServerResponse.jsonUnsafe(
      { items: page.items, ...(nextCursor ? { nextCursor } : {}) },
      {
        headers: nextCursor
          ? { "Access-Control-Expose-Headers": "X-Next-Cursor", "X-Next-Cursor": nextCursor }
          : undefined,
      },
    )
  })

  const getArtifact = Effect.fn("SelfImprovementArtifactHttpApi.getArtifact")(function* (ctx: {
    readonly headers: SelfImprovementApi.LocationHeaders
    readonly params: { readonly artifactID: SelfImprovementLifecycle.ArtifactID }
  }) {
    yield* principal(ctx.headers, "artifact.read")
    const query = yield* SelfImprovementPrivateQuery.Service
    const artifact = yield* query.getArtifact({
      locationID: ctx.headers["X-OpenCode-Location-ID"],
      artifactID: ctx.params.artifactID,
    })
    return artifact ?? notFound()
  })

  const listVersions = Effect.fn("SelfImprovementArtifactHttpApi.listVersions")(function* (ctx: {
    readonly headers: SelfImprovementApi.LocationHeaders
    readonly params: { readonly artifactID: SelfImprovementLifecycle.ArtifactID }
    readonly query: SelfImprovementApi.ListVersionsRequest
  }) {
    yield* principal(ctx.headers, "artifact.read")
    const query = yield* SelfImprovementPrivateQuery.Service
    const codec = input.cursor
    const decoded = ctx.query.cursor
      ? codec.decode(ctx.query.cursor, {
          locationID: ctx.headers["X-OpenCode-Location-ID"],
          endpoint: "listVersions",
        })
      : undefined
    const cursor = decoded === undefined ? Option.none() : decodeVersionCursor(decoded)
    if (ctx.query.cursor && Option.isNone(cursor)) return invalidPage()
    const page = yield* query.listVersions({
      artifactID: ctx.params.artifactID,
      locationID: ctx.headers["X-OpenCode-Location-ID"],
      limit: ctx.query.limit,
      ...(Option.isSome(cursor) ? { cursor: cursor.value } : {}),
    })
    const nextCursor = page.nextCursor
      ? codec.encode({
          locationID: ctx.headers["X-OpenCode-Location-ID"],
          endpoint: "listVersions",
          tuple: page.nextCursor.map(String),
        })
      : undefined
    return HttpServerResponse.jsonUnsafe(
      { items: page.items, ...(nextCursor ? { nextCursor } : {}) },
      {
        headers: nextCursor
          ? { "Access-Control-Expose-Headers": "X-Next-Cursor", "X-Next-Cursor": nextCursor }
          : undefined,
      },
    )
  })

  const getVersion = Effect.fn("SelfImprovementArtifactHttpApi.getVersion")(function* (ctx: {
    readonly headers: SelfImprovementApi.LocationHeaders
    readonly params: {
      readonly artifactID: SelfImprovementLifecycle.ArtifactID
      readonly versionID: SelfImprovementLifecycle.ArtifactVersionID
    }
  }) {
    yield* principal(ctx.headers, "artifact.read")
    const query = yield* SelfImprovementPrivateQuery.Service
    const version = yield* query.getVersion({
      locationID: ctx.headers["X-OpenCode-Location-ID"],
      artifactID: ctx.params.artifactID,
      versionID: ctx.params.versionID,
    })
    return version ?? notFound()
  })

  const createArtifact = Effect.fn("SelfImprovementArtifactHttpApi.createArtifact")(function* (ctx: {
    readonly headers: SelfImprovementApi.MutationHeaders
    readonly payload: SelfImprovementApi.CreateArtifactRequest
  }) {
    const actor = yield* principal(ctx.headers, "artifact.create")
    const command = yield* SelfImprovementPrivateArtifactCommand.Service
    return yield* runCommand(
      command.createArtifact({
        locationID: ctx.headers["X-OpenCode-Location-ID"],
        principal: actor,
        request: ctx.payload,
        idempotencyKey: ctx.headers["Idempotency-Key"],
        now: SelfImprovementLifecycle.TimestampMillis.make(yield* Clock.currentTimeMillis),
      }),
    )
  })

  const createVersion = Effect.fn("SelfImprovementArtifactHttpApi.createVersion")(function* (ctx: {
    readonly headers: SelfImprovementApi.ArtifactMutationHeaders
    readonly params: { readonly artifactID: SelfImprovementLifecycle.ArtifactID }
    readonly payload: SelfImprovementApi.CreateVersionRequest
  }) {
    const actor = yield* principal(ctx.headers, "artifact.create")
    const command = yield* SelfImprovementPrivateArtifactCommand.Service
    return yield* runCommand(
      command.createVersion({
        locationID: ctx.headers["X-OpenCode-Location-ID"],
        principal: actor,
        request: new SelfImprovementApi.CreateVersionRequest({
          artifactID: ctx.params.artifactID,
          proposalBytes: ctx.payload.proposalBytes,
          behaviorClass: ctx.payload.behaviorClass,
          capabilityManifest: ctx.payload.capabilityManifest,
          expectedRevision: ctx.headers["If-Match"],
        }),
        idempotencyKey: ctx.headers["Idempotency-Key"],
        now: SelfImprovementLifecycle.TimestampMillis.make(yield* Clock.currentTimeMillis),
      }),
    )
  })

  const archiveVersion = Effect.fn("SelfImprovementArtifactHttpApi.archiveVersion")(function* (ctx: {
    readonly headers: SelfImprovementApi.ArtifactMutationHeaders
    readonly params: {
      readonly artifactID: SelfImprovementLifecycle.ArtifactID
      readonly versionID: SelfImprovementLifecycle.ArtifactVersionID
    }
    readonly payload: SelfImprovementApi.ArchiveVersionRequest
  }) {
    const actor = yield* principal(ctx.headers, "artifact.archive")
    const command = yield* SelfImprovementPrivateArtifactCommand.Service
    return yield* runCommand(
      command.archiveVersion({
        locationID: ctx.headers["X-OpenCode-Location-ID"],
        principal: actor,
        request: new SelfImprovementApi.ArchiveVersionRequest({
          artifactID: ctx.params.artifactID,
          versionID: ctx.params.versionID,
          reason: ctx.payload.reason,
          expectedRevision: ctx.headers["If-Match"],
        }),
        idempotencyKey: ctx.headers["Idempotency-Key"],
        now: SelfImprovementLifecycle.TimestampMillis.make(yield* Clock.currentTimeMillis),
      }),
    )
  })

  const tombstoneArtifact = Effect.fn("SelfImprovementArtifactHttpApi.tombstoneArtifact")(function* (ctx: {
    readonly headers: SelfImprovementApi.ArtifactMutationHeaders
    readonly params: { readonly artifactID: SelfImprovementLifecycle.ArtifactID }
    readonly payload: SelfImprovementApi.TombstoneArtifactRequest
  }) {
    const actor = yield* principal(ctx.headers, "artifact.tombstone")
    const command = yield* SelfImprovementPrivateArtifactCommand.Service
    return yield* runCommand(
      command.tombstoneArtifact({
        locationID: ctx.headers["X-OpenCode-Location-ID"],
        principal: actor,
        request: new SelfImprovementApi.TombstoneArtifactRequest({
          artifactID: ctx.params.artifactID,
          reason: ctx.payload.reason,
          expectedRevision: ctx.headers["If-Match"],
        }),
        idempotencyKey: ctx.headers["Idempotency-Key"],
        now: SelfImprovementLifecycle.TimestampMillis.make(yield* Clock.currentTimeMillis),
      }),
    )
  })

  const approve = Effect.fn("SelfImprovementArtifactHttpApi.approve")(function* (ctx: {
    readonly headers: SelfImprovementApi.MutationHeaders
    readonly params: { readonly approvalRequestID: SelfImprovementLifecycle.ApprovalRequestID }
    readonly payload: SelfImprovementApi.ApproveRequest
  }) {
    const actor = yield* principal(ctx.headers, "approval.decide")
    const command = yield* SelfImprovementPrivateArtifactCommand.Service
    return yield* runCommand(
      command.approve({
        locationID: ctx.headers["X-OpenCode-Location-ID"],
        principal: actor,
        request: new SelfImprovementApi.ApproveRequest({
          approvalRequestID: ctx.params.approvalRequestID,
          binding: ctx.payload.binding,
        }),
        idempotencyKey: ctx.headers["Idempotency-Key"],
        now: SelfImprovementLifecycle.TimestampMillis.make(yield* Clock.currentTimeMillis),
      }),
    )
  })

  const reject = Effect.fn("SelfImprovementArtifactHttpApi.reject")(function* (ctx: {
    readonly headers: SelfImprovementApi.MutationHeaders
    readonly params: { readonly approvalRequestID: SelfImprovementLifecycle.ApprovalRequestID }
    readonly payload: SelfImprovementApi.RejectRequest
  }) {
    const actor = yield* principal(ctx.headers, "approval.decide")
    const command = yield* SelfImprovementPrivateArtifactCommand.Service
    return yield* runCommand(
      command.reject({
        locationID: ctx.headers["X-OpenCode-Location-ID"],
        principal: actor,
        request: new SelfImprovementApi.RejectRequest({
          approvalRequestID: ctx.params.approvalRequestID,
          binding: ctx.payload.binding,
          reason: ctx.payload.reason,
        }),
        idempotencyKey: ctx.headers["Idempotency-Key"],
        now: SelfImprovementLifecycle.TimestampMillis.make(yield* Clock.currentTimeMillis),
      }),
    )
  })

  return {
    listArtifacts,
    getArtifact,
    listVersions,
    getVersion,
    createArtifact,
    createVersion,
    archiveVersion,
    tombstoneArtifact,
    approve,
    reject,
  }
}
