import { expect, test } from "bun:test"
import { SqliteClient } from "@effect/sql-sqlite-bun"
import { EffectDrizzleSqlite } from "@opencode-ai/effect-drizzle-sqlite"
import { SelfImprovement, SelfImprovementLifecycle } from "@opencode-ai/schema"
import { Database } from "@opencode-ai/core/database/database"
import { SelfImprovementArtifactStore } from "@opencode-ai/core/self-improvement/artifact-store"
import { Effect, Layer, Schema } from "effect"
import { sql } from "drizzle-orm"

const strictDecodeOptions = { errors: "all", onExcessProperty: "error" } as const
const makeDb = EffectDrizzleSqlite.makeWithDefaults()

const locationID = SelfImprovementLifecycle.LocationID.make("a".repeat(64))
const otherLocationID = SelfImprovementLifecycle.LocationID.make("b".repeat(64))
const artifact = new SelfImprovementLifecycle.Artifact({
  id: SelfImprovementLifecycle.ArtifactID.make("si_art_1"),
  key: new SelfImprovementLifecycle.ArtifactKey({
    locationID,
    kind: "skill",
    name: SelfImprovement.CandidateName.make("artifact"),
  }),
  status: "live",
  createdBy: SelfImprovementLifecycle.PrincipalID.make("owner"),
  createdAt: SelfImprovementLifecycle.TimestampMillis.make(1),
  revision: SelfImprovementLifecycle.Revision.make(0),
})

const version = (id = "si_ver_1", number = 1, artifactID = artifact.id) => {
  const generated = number === 2
  return new SelfImprovementLifecycle.ArtifactVersion({
    id: SelfImprovementLifecycle.ArtifactVersionID.make(id),
    artifactID,
    versionNumber: number,
    source: generated ? "generated" : "human",
    behaviorClass: "instruction-only",
    proposal: Schema.decodeUnknownSync(
      SelfImprovement.SkillProposal,
      strictDecodeOptions,
    )({
      kind: "skill",
      name: "artifact",
      definition: { description: "Artifact", content: "Use the artifact" },
      references: [],
    }),
    canonicalJson: SelfImprovement.CanonicalJson.make(
      '{"definition":{"content":"Use the artifact","description":"Artifact"},"kind":"skill","name":"artifact","references":[]}',
    ),
    proposalDigest: SelfImprovement.Digest.make("1".repeat(64)),
    inputSnapshotDigest: SelfImprovement.Digest.make("2".repeat(64)),
    versionDigest: SelfImprovement.Digest.make(String(number).repeat(64)),
    capabilityManifest: new SelfImprovementLifecycle.CapabilityManifest({
      toolIDs: [],
      filesystemScopeIDs: [],
      networkOriginIDs: [],
      modelRoutes: [],
      childAgentTargets: [],
      artifactReferences: [],
      denies: [],
    }),
    capabilityManifestDigest: SelfImprovement.Digest.make("3".repeat(64)),
    creatorID: SelfImprovementLifecycle.PrincipalID.make("creator"),
    createdAt: SelfImprovementLifecycle.TimestampMillis.make(number),
    ...(generated
      ? {
          generated: new SelfImprovementLifecycle.GeneratedContentMetadata({
            generationLeaseID: SelfImprovementLifecycle.GenerationLeaseID.make("si_les_1"),
            strategyPullID: SelfImprovementLifecycle.PullEventID.make("si_pul_1"),
            originatingTaskIDDigest: SelfImprovement.Digest.make("4".repeat(64)),
            modelRequestDigest: SelfImprovement.Digest.make("5".repeat(64)),
            modelOutputDigest: SelfImprovement.Digest.make("6".repeat(64)),
            retentionDeadline: SelfImprovementLifecycle.TimestampMillis.make(3),
          }),
        }
      : {}),
  })
}

const setup = Effect.gen(function* () {
  const db = yield* makeDb
  yield* db.run(sql`
    CREATE TABLE self_improvement_artifact (
      id TEXT PRIMARY KEY,
      location_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      name TEXT NOT NULL,
      status TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      revision INTEGER NOT NULL,
      tombstone_actor_id TEXT,
      tombstone_reason TEXT,
      tombstone_at INTEGER,
      UNIQUE (location_id, kind, name)
    )
  `)
  yield* db.run(sql`
    CREATE TABLE self_improvement_artifact_version (
      id TEXT PRIMARY KEY,
      artifact_id TEXT NOT NULL,
      version_number INTEGER NOT NULL,
      source TEXT NOT NULL,
      behavior_class TEXT NOT NULL,
      proposal_json TEXT NOT NULL,
      canonical_json TEXT NOT NULL,
      proposal_digest TEXT NOT NULL,
      input_snapshot_digest TEXT NOT NULL,
      version_digest TEXT NOT NULL,
      capability_manifest_json TEXT NOT NULL,
      capability_manifest_digest TEXT NOT NULL,
      creator_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      generation_lease_id TEXT,
      strategy_pull_id TEXT,
      originating_task_id_digest TEXT,
      model_request_digest TEXT,
      model_output_digest TEXT,
      retention_deadline INTEGER
    )
  `)
  yield* db.run(sql`
    CREATE TABLE self_improvement_context_desired_state (
      location_id TEXT NOT NULL, artifact_id TEXT NOT NULL, rollout_slot TEXT NOT NULL,
      desired_state TEXT NOT NULL, version_id TEXT, version_digest TEXT, desired_revision INTEGER NOT NULL,
      PRIMARY KEY (location_id, artifact_id, rollout_slot)
    )
  `)
  return yield* SelfImprovementArtifactStore.Service.use((store) =>
    Effect.gen(function* () {
      const conflictingLocation = yield* store
        .create({ locationID: otherLocationID, artifact, version: version() })
        .pipe(Effect.flip)
      expect(conflictingLocation._tag).toBe("SelfImprovementArtifactStore.InvalidInput")

      const conflictingArtifact = yield* store
        .create({
          locationID,
          artifact,
          version: version("si_ver_1", 1, SelfImprovementLifecycle.ArtifactID.make("si_art_2")),
        })
        .pipe(Effect.flip)
      expect(conflictingArtifact._tag).toBe("SelfImprovementArtifactStore.InvalidInput")

      yield* store.create({ locationID, artifact, version: version() })
      expect(yield* store.getArtifactByKey({ key: artifact.key })).toEqual(artifact)
      expect(yield* store.getArtifact({ locationID: otherLocationID, artifactID: artifact.id })).toBeUndefined()
      expect(yield* store.getVersion({ locationID: otherLocationID, versionID: version().id })).toBeUndefined()

      const stored = yield* store.getVersion({ locationID, versionID: version().id })
      expect(stored).toEqual(version())
      const unorderedManifest = new SelfImprovementLifecycle.CapabilityManifest({
        toolIDs: ["z", "a"],
        filesystemScopeIDs: ["z", "a"],
        networkOriginIDs: ["z", "a"],
        modelRoutes: [],
        childAgentTargets: [SelfImprovement.CandidateName.make("z"), SelfImprovement.CandidateName.make("a")],
        artifactReferences: [],
        denies: [
          new SelfImprovementLifecycle.CapabilityDeny({ capability: "tool", resourceID: "z" }),
          new SelfImprovementLifecycle.CapabilityDeny({ capability: "tool", resourceID: "a" }),
        ],
      })
      const canonicalArtifact = new SelfImprovementLifecycle.Artifact({
        id: SelfImprovementLifecycle.ArtifactID.make("si_art_canonical"),
        key: new SelfImprovementLifecycle.ArtifactKey({
          locationID,
          kind: "skill",
          name: SelfImprovement.CandidateName.make("canonical"),
        }),
        status: artifact.status,
        createdBy: artifact.createdBy,
        createdAt: artifact.createdAt,
        revision: artifact.revision,
      })
      const baseVersion = version("si_ver_canonical", 1, canonicalArtifact.id)
      const canonicalVersion = new SelfImprovementLifecycle.ArtifactVersion({
        id: baseVersion.id,
        artifactID: baseVersion.artifactID,
        versionNumber: baseVersion.versionNumber,
        source: baseVersion.source,
        behaviorClass: baseVersion.behaviorClass,
        proposal: baseVersion.proposal,
        canonicalJson: baseVersion.canonicalJson,
        proposalDigest: baseVersion.proposalDigest,
        inputSnapshotDigest: baseVersion.inputSnapshotDigest,
        versionDigest: baseVersion.versionDigest,
        capabilityManifest: unorderedManifest,
        capabilityManifestDigest: baseVersion.capabilityManifestDigest,
        creatorID: baseVersion.creatorID,
        createdAt: baseVersion.createdAt,
      })
      yield* store.create({ locationID, artifact: canonicalArtifact, version: canonicalVersion })
      expect(
        (yield* store.getVersion({ locationID, versionID: canonicalVersion.id }))?.capabilityManifest,
      ).toMatchObject({
        toolIDs: ["a", "z"],
        filesystemScopeIDs: ["a", "z"],
        networkOriginIDs: ["a", "z"],
        childAgentTargets: ["a", "z"],
        denies: [
          { capability: "tool", resourceID: "a" },
          { capability: "tool", resourceID: "z" },
        ],
      })
      expect(
        yield* store.appendVersion({
          locationID,
          artifactID: artifact.id,
          expectedRevision: artifact.revision,
          version: version("si_ver_2", 2),
        }),
      ).toBe(true)
      expect(
        (yield* store.listVersions({ locationID, artifactID: artifact.id })).map((entry) => entry.versionNumber),
      ).toEqual([1, 2])
      expect(
        yield* store.getVersion({ locationID, versionID: SelfImprovementLifecycle.ArtifactVersionID.make("si_ver_2") }),
      ).toEqual(version("si_ver_2", 2))
      yield* db.run(sql`
        INSERT INTO self_improvement_context_desired_state VALUES (
          ${locationID}, ${artifact.id}, 'active', 'present', 'si_ver_2', ${version("si_ver_2", 2).versionDigest}, 1
        )
      `)
      expect(yield* store.getActiveArtifactVersionByKey({ key: artifact.key })).toMatchObject({
        artifact: { id: artifact.id, revision: 1 },
        version: { id: "si_ver_2", source: "generated" },
      })
      expect(
        yield* store.getActiveArtifactVersionByKey({
          key: new SelfImprovementLifecycle.ArtifactKey({
            locationID: otherLocationID,
            kind: artifact.key.kind,
            name: artifact.key.name,
          }),
        }),
      ).toBeUndefined()
      expect(
        yield* store.getActiveArtifactVersionByKey({
          key: new SelfImprovementLifecycle.ArtifactKey({
            locationID,
            kind: "skill",
            name: SelfImprovement.CandidateName.make("missing"),
          }),
        }),
      ).toBeUndefined()
      yield* db.run(sql`
        UPDATE self_improvement_context_desired_state SET desired_state = 'absent'
        WHERE location_id = ${locationID} AND artifact_id = ${artifact.id} AND rollout_slot = 'active'
      `)
      expect(yield* store.getActiveArtifactVersionByKey({ key: artifact.key })).toBeUndefined()
      yield* db.run(sql`
        UPDATE self_improvement_context_desired_state SET desired_state = 'present'
        WHERE location_id = ${locationID} AND artifact_id = ${artifact.id} AND rollout_slot = 'active'
      `)
      yield* db.run(sql`UPDATE self_improvement_artifact SET status = 'tombstoned' WHERE id = ${artifact.id}`)
      expect(yield* store.getActiveArtifactVersionByKey({ key: artifact.key })).toBeUndefined()
      yield* db.run(sql`UPDATE self_improvement_artifact SET status = 'live' WHERE id = ${artifact.id}`)
      yield* db.run(sql`
        DELETE FROM self_improvement_context_desired_state
        WHERE location_id = ${locationID} AND artifact_id = ${artifact.id} AND rollout_slot = 'active'
      `)
      expect(yield* store.getActiveArtifactVersionByKey({ key: artifact.key })).toBeUndefined()

      const tombstoned = new SelfImprovementLifecycle.Artifact({
        id: SelfImprovementLifecycle.ArtifactID.make("si_art_tombstoned"),
        key: new SelfImprovementLifecycle.ArtifactKey({
          locationID,
          kind: "skill",
          name: SelfImprovement.CandidateName.make("tombstone"),
        }),
        status: "tombstoned",
        createdBy: artifact.createdBy,
        createdAt: artifact.createdAt,
        revision: artifact.revision,
        tombstone: new SelfImprovementLifecycle.Tombstone({
          actorID: SelfImprovementLifecycle.PrincipalID.make("owner"),
          reason: "removed",
          timestamp: SelfImprovementLifecycle.TimestampMillis.make(4),
        }),
      })
      const tombstonedVersion = version("si_ver_tombstoned", 1, tombstoned.id)
      yield* store.create({ locationID, artifact: tombstoned, version: tombstonedVersion })
      const reserved = yield* store
        .create({
          locationID,
          artifact: new SelfImprovementLifecycle.Artifact({
            id: SelfImprovementLifecycle.ArtifactID.make("si_art_reserved"),
            key: tombstoned.key,
            status: artifact.status,
            createdBy: artifact.createdBy,
            createdAt: artifact.createdAt,
            revision: artifact.revision,
          }),
          version: version("si_ver_reserved", 1, SelfImprovementLifecycle.ArtifactID.make("si_art_reserved")),
        })
        .pipe(Effect.flip)
      expect(reserved._tag).toBe("SelfImprovementArtifactStore.Conflict")
    }),
  ).pipe(Effect.provide(SelfImprovementArtifactStore.layer), Effect.provide(Layer.succeed(Database.Service, { db })))
})

test("stores location-scoped immutable artifact versions", async () => {
  await Effect.runPromise(
    setup.pipe(Effect.provide(SqliteClient.layer({ filename: ":memory:", disableWAL: true })), Effect.scoped),
  )
})
