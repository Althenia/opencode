import { expect, test } from "bun:test"
import { Cause, Effect, Exit, Schema } from "effect"
import { SelfImprovement, SelfImprovementLearning, SelfImprovementLifecycle } from "@opencode-ai/schema"
import { SelfImprovementGeneratedSkill } from "@opencode-ai/core/self-improvement/generated-skill"

const locationID = SelfImprovementLifecycle.LocationID.make("a".repeat(64))
const artifactID = SelfImprovementLifecycle.ArtifactID.make("si_art_generated")
const versionID = SelfImprovementLifecycle.ArtifactVersionID.make("si_ver_generated")
const digest = SelfImprovement.Digest.make("b".repeat(64))

const artifact = new SelfImprovementLifecycle.Artifact({
  id: artifactID,
  key: new SelfImprovementLifecycle.ArtifactKey({
    locationID,
    kind: "skill",
    name: SelfImprovement.CandidateName.make("generated-helper"),
  }),
  status: "live",
  createdBy: SelfImprovementLifecycle.PrincipalID.make("owner"),
  createdAt: SelfImprovementLifecycle.TimestampMillis.make(0),
  revision: SelfImprovementLifecycle.Revision.make(1),
})

const makeVersion = (content = "Use generated guidance", source: SelfImprovementLifecycle.ArtifactSource = "generated") =>
  new SelfImprovementLifecycle.ArtifactVersion({
    id: versionID,
    artifactID,
    versionNumber: 1,
    source,
    behaviorClass: "instruction-only",
    proposal: Schema.decodeUnknownSync(SelfImprovement.SkillProposal)({
      kind: "skill",
      name: "generated-helper",
      definition: { description: "Generated helper", content },
      references: [],
    }),
    canonicalJson: SelfImprovement.CanonicalJson.make("{}"),
    proposalDigest: digest,
    inputSnapshotDigest: digest,
    versionDigest: digest,
    capabilityManifest: new SelfImprovementLifecycle.CapabilityManifest({
      toolIDs: [],
      filesystemScopeIDs: [],
      networkOriginIDs: [],
      modelRoutes: [],
      childAgentTargets: [],
      artifactReferences: [],
      denies: [],
    }),
    capabilityManifestDigest: digest,
    creatorID: SelfImprovementLifecycle.PrincipalID.make("owner"),
    createdAt: SelfImprovementLifecycle.TimestampMillis.make(0),
    ...(source === "generated"
      ? {
          generated: new SelfImprovementLifecycle.GeneratedContentMetadata({
            generationLeaseID: SelfImprovementLifecycle.GenerationLeaseID.make("si_les_generated"),
            strategyPullID: SelfImprovementLifecycle.PullEventID.make("si_pul_generated"),
            originatingTaskIDDigest: digest,
            modelRequestDigest: digest,
            modelOutputDigest: digest,
            retentionDeadline: SelfImprovementLifecycle.TimestampMillis.make(1),
          }),
        }
      : {}),
  })

const desired = (state: "present" | "absent") =>
  new SelfImprovementLearning.ContextDesiredState({
    locationID,
    artifactID,
    rolloutSlot: "active",
    desired:
      state === "present"
        ? { state, versionID, versionDigest: digest, stage: "active" }
        : { state },
    desiredRevision: SelfImprovementLifecycle.Revision.make(1),
  })

type Memory = Map<string, string>
const filesystem = (memory: Memory) => ({
  exists: (path: string) => Effect.succeed([...memory.keys()].some((key) => key === path || key.startsWith(`${path}/`))),
  read: (path: string) => Effect.succeed(memory.get(path)),
  write: (path: string, content: string) => Effect.sync(() => void memory.set(path, content)),
  rename: (from: string, to: string) =>
    Effect.sync(() => {
      for (const [key, value] of [...memory]) {
        if (key !== from && !key.startsWith(`${from}/`)) continue
        memory.delete(key)
        memory.set(`${to}${key.slice(from.length)}`, value)
      }
    }),
  remove: (path: string) =>
    Effect.sync(() => {
      for (const key of [...memory.keys()]) if (key === path || key.startsWith(`${path}/`)) memory.delete(key)
    }),
})

const projection = (memory: Memory, version = makeVersion()) =>
  SelfImprovementGeneratedSkill.make({
    root: "/config/generated",
    filesystem: filesystem(memory),
    artifacts: {
      getArtifact: () => Effect.succeed(artifact),
      getVersion: () => Effect.succeed(version),
    },
    token: () => "fixed",
  })

test("materializes an active generated skill with provenance frontmatter", async () => {
  const memory = new Map<string, string>()
  await Effect.runPromise(projection(memory).reconcile(desired("present")))

  const skill = [...memory.entries()].find(([path]) => path.endsWith("/SKILL.md"))
  expect(skill?.[1]).toContain('name: "generated-helper"')
  expect(skill?.[1]).toContain('x-opencode-artifact-id: "si_art_generated"')
  expect(skill?.[1]).toContain('x-opencode-version-id: "si_ver_generated"')
  expect(skill?.[1]).toContain("Use generated guidance")
})

test("atomically updates an owned generated skill and removes stale content", async () => {
  const memory = new Map<string, string>()
  await Effect.runPromise(projection(memory).reconcile(desired("present")))
  await Effect.runPromise(projection(memory, makeVersion("Updated guidance")).reconcile(desired("present")))

  const skills = [...memory.entries()].filter(([path]) => path.endsWith("/SKILL.md"))
  expect(skills).toHaveLength(1)
  expect(skills[0]?.[1]).toContain("Updated guidance")
  expect(skills[0]?.[1]).not.toContain("Use generated guidance")
  expect([...memory.keys()].some((path) => path.includes(".tmp-") || path.includes(".old-"))).toBe(false)
})

test("removes only a matching owned generated skill", async () => {
  const memory = new Map<string, string>()
  const service = projection(memory)
  await Effect.runPromise(service.reconcile(desired("present")))
  await Effect.runPromise(service.reconcile(desired("absent")))
  expect(memory.size).toBe(0)
})

test("refuses to overwrite an unowned colliding directory", async () => {
  const memory = new Map<string, string>()
  const service = projection(memory)
  const root = service.directory(locationID, artifactID, "generated-helper")
  memory.set(`${root}/SKILL.md`, "user-authored")

  const exit = await Effect.runPromiseExit(service.reconcile(desired("present")))
  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) expect(Cause.squash(exit.cause)).toBeInstanceOf(SelfImprovementGeneratedSkill.Unavailable)
  expect(memory.get(`${root}/SKILL.md`)).toBe("user-authored")
})

test("refuses to materialize a human-authored active version", async () => {
  const memory = new Map<string, string>()
  const exit = await Effect.runPromiseExit(projection(memory, makeVersion("Human guidance", "human")).reconcile(desired("present")))
  expect(Exit.isFailure(exit)).toBe(true)
  expect(memory.size).toBe(0)
})

test("ignores non-active desired slots", async () => {
  const memory = new Map<string, string>()
  const shadow = new SelfImprovementLearning.ContextDesiredState({
    ...desired("present"),
    rolloutSlot: "shadow",
    desired: { state: "present", versionID, versionDigest: digest, stage: "shadow" },
  })
  await Effect.runPromise(projection(memory).reconcile(shadow))
  expect(memory.size).toBe(0)
})
