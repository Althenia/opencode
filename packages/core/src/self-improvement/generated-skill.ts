export * as SelfImprovementGeneratedSkill from "./generated-skill"

import path from "path"
import { Context, Effect, Layer, Schema } from "effect"
import { SelfImprovementLearning, SelfImprovementLifecycle } from "@opencode-ai/schema"
import { FSUtil } from "../fs-util"
import { Global } from "../global"
import { Hash } from "../util/hash"
import { makeLocationNode } from "../effect/app-node"
import { SelfImprovementArtifactStore } from "./artifact-store"

export class Unavailable extends Schema.TaggedErrorClass<Unavailable>()("SelfImprovementGeneratedSkill.Unavailable", {
  message: Schema.String,
}) {}

type Filesystem = {
  readonly exists: (path: string) => Effect.Effect<boolean, unknown>
  readonly read: (path: string) => Effect.Effect<string | undefined, unknown>
  readonly write: (path: string, content: string) => Effect.Effect<void, unknown>
  readonly rename: (from: string, to: string) => Effect.Effect<void, unknown>
  readonly remove: (path: string) => Effect.Effect<void, unknown>
}

type Artifacts = Pick<SelfImprovementArtifactStore.Interface, "getArtifact" | "getVersion">

type Dependencies = {
  readonly root: string
  readonly filesystem: Filesystem
  readonly artifacts: Artifacts
  readonly token?: () => string
}

export interface Interface {
  readonly directory: (
    locationID: SelfImprovementLifecycle.LocationID,
    artifactID: SelfImprovementLifecycle.ArtifactID,
    name: string,
  ) => string
  readonly reconcile: (desired: SelfImprovementLearning.ContextDesiredState) => Effect.Effect<void, Unavailable>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SelfImprovementGeneratedSkill") {}

const markerName = ".opencode-generated.json"
const skillName = "SKILL.md"

const safeName = (value: string) => {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return normalized || "generated-skill"
}

const parseMarker = (value: string | undefined) => {
  if (!value) return undefined
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>
    if (
      parsed.generated !== true ||
      typeof parsed.locationID !== "string" ||
      typeof parsed.artifactID !== "string" ||
      typeof parsed.versionID !== "string"
    )
      return undefined
    return parsed as {
      generated: true
      locationID: string
      artifactID: string
      versionID: string
      versionDigest?: string
    }
  } catch {
    return undefined
  }
}

const quote = (value: string) => JSON.stringify(value)

const render = (input: {
  readonly artifactID: string
  readonly versionID: string
  readonly versionDigest: string
  readonly source: string
  readonly name: string
  readonly description: string
  readonly content: string
}) =>
  [
    "---",
    `name: ${quote(input.name)}`,
    `description: ${quote(input.description)}`,
    "x-opencode-generated: true",
    `x-opencode-artifact-id: ${quote(input.artifactID)}`,
    `x-opencode-version-id: ${quote(input.versionID)}`,
    `x-opencode-version-digest: ${quote(input.versionDigest)}`,
    `x-opencode-source: ${quote(input.source)}`,
    "---",
    input.content,
    "",
  ].join("\n")

const unavailable = (message: string) => new Unavailable({ message })

export const make = (dependencies: Dependencies): Interface => {
  const filesystem = dependencies.filesystem
  const token = dependencies.token ?? crypto.randomUUID
  const directory = (
    locationID: SelfImprovementLifecycle.LocationID,
    artifactID: SelfImprovementLifecycle.ArtifactID,
    name: string,
  ) => path.join(dependencies.root, `${safeName(name)}-${Hash.sha256(`${locationID}\0${artifactID}`).slice(0, 12)}`)

  const reconcile = Effect.fn("SelfImprovementGeneratedSkill.reconcile")(function* (
    desired: SelfImprovementLearning.ContextDesiredState,
  ) {
    if (desired.rolloutSlot !== "active") return
    const artifact = yield* dependencies.artifacts
      .getArtifact({ locationID: desired.locationID, artifactID: desired.artifactID })
      .pipe(Effect.mapError(() => unavailable("Generated skill artifact lookup failed")))
    if (
      artifact?.id !== desired.artifactID ||
      artifact.key.locationID !== desired.locationID ||
      artifact.key.kind !== "skill"
    )
      return yield* unavailable("Generated skill artifact is unavailable")

    const root = directory(desired.locationID, desired.artifactID, artifact.key.name)
    const markerPath = path.join(root, markerName)
    const existing = yield* filesystem.exists(root).pipe(Effect.mapError(() => unavailable("Generated skill lookup failed")))
    const marker = existing
      ? yield* filesystem.read(markerPath).pipe(Effect.mapError(() => unavailable("Generated skill marker read failed")))
      : undefined
    const owner = parseMarker(marker)
    const owned =
      owner?.locationID === desired.locationID && owner.artifactID === desired.artifactID && owner.generated === true

    if (desired.desired.state === "absent") {
      if (!existing || !owned) return
      yield* filesystem.remove(root).pipe(Effect.mapError(() => unavailable("Generated skill removal failed")))
      return
    }

    if (existing && !owned) return yield* unavailable("Generated skill directory is not owned by OpenCode")
    const version = yield* dependencies.artifacts
      .getVersion({ locationID: desired.locationID, versionID: desired.desired.versionID })
      .pipe(Effect.mapError(() => unavailable("Generated skill version lookup failed")))
    if (
      version?.id !== desired.desired.versionID ||
      version.source !== "generated" ||
      version.generated === undefined ||
      version.artifactID !== desired.artifactID ||
      version.versionDigest !== desired.desired.versionDigest ||
      version.proposal.kind !== "skill" ||
      version.proposal.name !== artifact.key.name
    )
      return yield* unavailable("Generated skill version is unavailable")

    const id = token()
    const staging = `${root}.tmp-${id}`
    const backup = `${root}.old-${id}`
    const metadata = JSON.stringify(
      {
        generated: true,
        locationID: desired.locationID,
        artifactID: desired.artifactID,
        versionID: version.id,
        versionDigest: version.versionDigest,
      },
      null,
      2,
    )
    const markdown = render({
      artifactID: artifact.id,
      versionID: version.id,
      versionDigest: version.versionDigest,
      source: version.source,
      name: version.proposal.name,
      description: version.proposal.definition.description,
      content: version.proposal.definition.content,
    })

    yield* Effect.gen(function* () {
      yield* filesystem.write(path.join(staging, skillName), markdown)
      yield* filesystem.write(path.join(staging, markerName), metadata)
      yield* Effect.uninterruptible(
        Effect.gen(function* () {
          if (existing) yield* filesystem.rename(root, backup)
          yield* filesystem.rename(staging, root).pipe(
            Effect.catch((error) =>
              Effect.gen(function* () {
                if (existing) yield* filesystem.rename(backup, root).pipe(Effect.ignore)
                return yield* Effect.fail(error)
              }),
            ),
          )
          if (existing) yield* filesystem.remove(backup).pipe(Effect.ignore)
        }),
      )
    }).pipe(
      Effect.mapError(() => unavailable("Generated skill projection failed")),
      Effect.ensuring(filesystem.remove(staging).pipe(Effect.ignore)),
    )
  })

  return { directory, reconcile }
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const global = yield* Global.Service
    return Service.of(
      make({
        root: path.join(global.config, "generated"),
        artifacts: yield* SelfImprovementArtifactStore.Service,
        filesystem: {
          exists: fs.existsSafe,
          read: fs.readFileStringSafe,
          write: fs.writeWithDirs,
          rename: fs.rename,
          remove: (target) => fs.remove(target, { recursive: true, force: true }),
        },
      }),
    )
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [FSUtil.node, Global.node, SelfImprovementArtifactStore.node],
})
