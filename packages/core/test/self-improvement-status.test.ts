import { expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import {
  SelfImprovement,
  SelfImprovementEvaluation,
  SelfImprovementLifecycle,
} from "@opencode-ai/schema"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Database } from "@opencode-ai/core/database/database"
import { Location } from "@opencode-ai/core/location"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Project } from "@opencode-ai/core/project"
import { SelfImprovementAutomation } from "@opencode-ai/core/self-improvement/automation"
import { SelfImprovementStatus } from "@opencode-ai/core/self-improvement/status"
import { SelfImprovementArtifactTable, SelfImprovementArtifactVersionTable } from "@opencode-ai/core/self-improvement/artifact.sql"
import { SelfImprovementContextDesiredStateTable } from "@opencode-ai/core/self-improvement/context.sql"
import { locationID as makeLocationID } from "@opencode-ai/core/self-improvement/contracts"
import { SelfImprovementSessionEvidenceTable } from "@opencode-ai/core/self-improvement/session-evidence.sql"
import { testEffect } from "./lib/effect"

const timestamp = SelfImprovementLifecycle.TimestampMillis.make(1_000)
const result: SelfImprovementAutomation.TickResult = {
  eligiblePatterns: 2,
  generated: 1,
  prepared: 1,
  runsCreated: 1,
  runsDecided: 0,
  reconciled: 1,
  failures: 0,
}
const settings: SelfImprovementAutomation.Settings = {
  enabled: true,
  autoApprove: true,
  intervalSeconds: 60,
  evaluationWindowMillis: 3_600_000,
}

const automation = (overrides: Partial<SelfImprovementAutomation.RuntimeStatus> = {}) =>
  Effect.succeed<SelfImprovementAutomation.RuntimeStatus>({
    settings,
    running: false,
    lastStartedAt: timestamp,
    lastCompletedAt: timestamp,
    lastResult: result,
    ...overrides,
  })

const slot = {
  slot: "active" as const,
  artifactID: SelfImprovementLifecycle.ArtifactID.make("si_art_status"),
  versionID: SelfImprovementLifecycle.ArtifactVersionID.make("si_ver_status"),
  name: SelfImprovement.CandidateName.make("generated-review"),
  desiredRevision: SelfImprovementLifecycle.Revision.make(3),
}

test("returns aggregate engine status without raw evidence", async () => {
  const service = SelfImprovementStatus.make({
    automation: automation(),
    evidence: Effect.succeed({ count: 4, lastObservedAt: timestamp }),
    slots: Effect.succeed([slot]),
  })

  const status = await Effect.runPromise(service.get)

  expect(status).toEqual({
    enabled: true,
    autoApprove: true,
    intervalSeconds: 60,
    evaluationWindowMinutes: 60,
    evidence: { count: 4, lastObservedAt: timestamp },
    automation: {
      running: false,
      lastStartedAt: timestamp,
      lastCompletedAt: timestamp,
      lastResult: result,
    },
    generatedSlots: [slot],
  })
  expect(JSON.stringify(status)).not.toContain("metrics")
  expect(JSON.stringify(status)).not.toContain("task_id")
  expect(JSON.stringify(status)).not.toContain("prompt")
})

test("explains why evidence is empty when automatic observation is enabled", async () => {
  const service = SelfImprovementStatus.make({
    automation: automation({ lastStartedAt: undefined, lastCompletedAt: undefined, lastResult: undefined }),
    evidence: Effect.succeed({ count: 0 }),
    slots: Effect.succeed([]),
  })

  expect((await Effect.runPromise(service.get)).evidence.reason).toEqual({
    code: "no-terminal-evidence",
    message:
      "No terminal session evidence has been recorded. Complete a TUI prompt cycle and verify the configured evidence principal is authorized.",
  })
})

const directory = AbsolutePath.make("/project")
const location = Location.Service.of({ directory, project: { id: Project.ID.global, directory } })
const statusIt = testEffect(
  AppNodeBuilder.build(LayerNode.group([Database.node, SelfImprovementStatus.node]), [
    [Location.node, Layer.succeed(Location.Service, location)],
    [
      SelfImprovementAutomation.node,
      Layer.succeed(
        SelfImprovementAutomation.Service,
        SelfImprovementAutomation.Service.of({ tick: Effect.succeed(result), status: automation() }),
      ),
    ],
  ]),
)

statusIt.effect("reads aggregate evidence and generated slots from migrated tables", () =>
  Effect.gen(function* () {
    const db = (yield* Database.Service).db
    const id = makeLocationID(Location.Ref.make({ directory }))
    const artifactID = SelfImprovementLifecycle.ArtifactID.make("si_art_status_db")
    const versionID = SelfImprovementLifecycle.ArtifactVersionID.make("si_ver_status_db")
    const digest = SelfImprovement.Digest.make("a".repeat(64))
    const at = SelfImprovementLifecycle.TimestampMillis.make(2_000)

    yield* db.insert(SelfImprovementSessionEvidenceTable).values({
      id: "evidence-status",
      location_id: id,
      task_id_digest: digest,
      sample_id_digest: digest,
      request_digest: digest,
      workload: SelfImprovementEvaluation.Workload.make("backend-fix"),
      workload_revision: SelfImprovementLifecycle.Revision.make(1),
      producer_id: SelfImprovementLifecycle.PrincipalID.make("runtime-evidence"),
      outcome_class: "failure",
      outcome: "failure",
      metrics_json: "{}",
      started_at: SelfImprovementLifecycle.TimestampMillis.make(1_000),
      terminal_at: at,
      created_at: at,
    }).run()
    yield* db.insert(SelfImprovementArtifactTable).values({
      id: artifactID,
      location_id: id,
      kind: "skill",
      name: SelfImprovement.CandidateName.make("generated-db-review"),
      status: "live",
      created_by: SelfImprovementLifecycle.PrincipalID.make("generator"),
      created_at: at,
      revision: SelfImprovementLifecycle.Revision.make(1),
    }).run()
    yield* db.insert(SelfImprovementArtifactVersionTable).values({
      id: versionID,
      artifact_id: artifactID,
      version_number: 1,
      source: "generated",
      behavior_class: "instruction-only",
      proposal_json: "{}",
      canonical_json: SelfImprovement.CanonicalJson.make("{}"),
      proposal_digest: digest,
      input_snapshot_digest: digest,
      version_digest: digest,
      capability_manifest_json: "{}",
      capability_manifest_digest: digest,
      creator_id: SelfImprovementLifecycle.PrincipalID.make("generator"),
      created_at: at,
      generation_lease_id: SelfImprovementLifecycle.GenerationLeaseID.make("si_les_status"),
      strategy_pull_id: SelfImprovementLifecycle.PullEventID.make("si_pul_status"),
      originating_task_id_digest: digest,
      model_request_digest: digest,
      model_output_digest: digest,
      retention_deadline: SelfImprovementLifecycle.TimestampMillis.make(3_000),
    }).run()
    yield* db.insert(SelfImprovementContextDesiredStateTable).values({
      location_id: id,
      artifact_id: artifactID,
      rollout_slot: "active",
      desired_state: "present",
      version_id: versionID,
      version_digest: digest,
      desired_revision: SelfImprovementLifecycle.Revision.make(2),
    }).run()

    expect(yield* SelfImprovementStatus.Service.use((service) => service.get)).toMatchObject({
      evidence: { count: 1, lastObservedAt: at },
      generatedSlots: [
        {
          slot: "active",
          artifactID,
          versionID,
          name: "generated-db-review",
          desiredRevision: 2,
        },
      ],
    })
  }),
)

test("explains that automatic self-improvement is disabled", async () => {
  const service = SelfImprovementStatus.make({
    automation: automation({ settings: { ...settings, enabled: false }, lastStartedAt: undefined, lastCompletedAt: undefined, lastResult: undefined }),
    evidence: Effect.succeed({ count: 0 }),
    slots: Effect.succeed([]),
  })

  expect((await Effect.runPromise(service.get)).evidence.reason).toEqual({
    code: "automatic-disabled",
    message:
      "Automatic self-improvement is disabled. Set experimental.self_improvement.automatic to true for this location.",
  })
})
