export * as SelfImprovementStatus from "./status"

import { and, asc, count, eq, max } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import { SelfImprovementStatus as StatusSchema, SelfImprovementLifecycle } from "@opencode-ai/schema"
import { Database } from "../database/database"
import { makeLocationNode } from "../effect/app-node"
import { Location } from "../location"
import { SelfImprovementAutomation } from "./automation"
import { SelfImprovementArtifactTable, SelfImprovementArtifactVersionTable } from "./artifact.sql"
import { SelfImprovementContextDesiredStateTable } from "./context.sql"
import { locationID as makeLocationID } from "./contracts"
import { SelfImprovementSessionEvidenceTable } from "./session-evidence.sql"

export interface EvidenceSummary {
  readonly count: number
  readonly lastObservedAt?: SelfImprovementLifecycle.TimestampMillis
}

export interface Dependencies {
  readonly automation: Effect.Effect<SelfImprovementAutomation.RuntimeStatus>
  readonly evidence: Effect.Effect<EvidenceSummary>
  readonly slots: Effect.Effect<ReadonlyArray<StatusSchema.GeneratedSlot>>
}

export interface Interface {
  readonly get: Effect.Effect<StatusSchema.Info>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SelfImprovementStatus") {}

const emptyReason = (enabled: boolean): StatusSchema.EmptyReason =>
  enabled
    ? {
        code: "no-terminal-evidence",
        message:
          "No terminal session evidence has been recorded. Complete a TUI prompt cycle and verify the configured evidence principal is authorized.",
      }
    : {
        code: "automatic-disabled",
        message:
          "Automatic self-improvement is disabled. Set experimental.self_improvement.automatic to true for this location.",
      }

export function make(dependencies: Dependencies): Interface {
  return {
    get: Effect.all({
      automation: dependencies.automation,
      evidence: dependencies.evidence,
      generatedSlots: dependencies.slots,
    }).pipe(
      Effect.map(({ automation, evidence, generatedSlots }) => ({
        enabled: automation.settings.enabled,
        autoApprove: automation.settings.autoApprove,
        intervalSeconds: automation.settings.intervalSeconds,
        evaluationWindowMinutes: Math.max(1, Math.round(automation.settings.evaluationWindowMillis / 60_000)),
        evidence: {
          count: evidence.count,
          ...(evidence.lastObservedAt === undefined ? {} : { lastObservedAt: evidence.lastObservedAt }),
          ...(evidence.count === 0 ? { reason: emptyReason(automation.settings.enabled) } : {}),
        },
        automation: {
          running: automation.running,
          ...(automation.lastStartedAt === undefined ? {} : { lastStartedAt: automation.lastStartedAt }),
          ...(automation.lastCompletedAt === undefined ? {} : { lastCompletedAt: automation.lastCompletedAt }),
          ...(automation.lastResult === undefined ? {} : { lastResult: automation.lastResult }),
        },
        generatedSlots: [...generatedSlots].toSorted((left, right) => {
          const order = { active: 0, shadow: 1, canary: 2 } as const
          return order[left.slot] - order[right.slot] || String(left.name).localeCompare(String(right.name))
        }),
      } satisfies StatusSchema.Info)),
    ),
  }
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const db = (yield* Database.Service).db
    const location = yield* Location.Service
    const automation = yield* SelfImprovementAutomation.Service
    const locationID = makeLocationID(
      Location.Ref.make({ directory: location.directory, workspaceID: location.workspaceID }),
    )

    return Service.of(
      make({
        automation: automation.status,
        evidence: db
          .select({
            count: count(),
            lastObservedAt: max(SelfImprovementSessionEvidenceTable.terminal_at),
          })
          .from(SelfImprovementSessionEvidenceTable)
          .where(eq(SelfImprovementSessionEvidenceTable.location_id, locationID))
          .get()
          .pipe(
            Effect.orDie,
            Effect.map((row) => ({
              count: Number(row?.count ?? 0),
              ...(row?.lastObservedAt === null || row?.lastObservedAt === undefined
                ? {}
                : { lastObservedAt: SelfImprovementLifecycle.TimestampMillis.make(row.lastObservedAt) }),
            })),
          ),
        slots: db
          .select({
            slot: SelfImprovementContextDesiredStateTable.rollout_slot,
            artifactID: SelfImprovementContextDesiredStateTable.artifact_id,
            versionID: SelfImprovementContextDesiredStateTable.version_id,
            name: SelfImprovementArtifactTable.name,
            desiredRevision: SelfImprovementContextDesiredStateTable.desired_revision,
          })
          .from(SelfImprovementContextDesiredStateTable)
          .innerJoin(
            SelfImprovementArtifactTable,
            eq(SelfImprovementArtifactTable.id, SelfImprovementContextDesiredStateTable.artifact_id),
          )
          .innerJoin(
            SelfImprovementArtifactVersionTable,
            eq(SelfImprovementArtifactVersionTable.id, SelfImprovementContextDesiredStateTable.version_id),
          )
          .where(
            and(
              eq(SelfImprovementContextDesiredStateTable.location_id, locationID),
              eq(SelfImprovementContextDesiredStateTable.desired_state, "present"),
              eq(SelfImprovementArtifactTable.kind, "skill"),
              eq(SelfImprovementArtifactVersionTable.source, "generated"),
            ),
          )
          .orderBy(
            asc(SelfImprovementContextDesiredStateTable.rollout_slot),
            asc(SelfImprovementArtifactTable.name),
          )
          .all()
          .pipe(
            Effect.orDie,
            Effect.map((rows) =>
              rows.flatMap((row) =>
                row.versionID === null
                  ? []
                  : [
                      {
                        slot: row.slot,
                        artifactID: row.artifactID,
                        versionID: row.versionID,
                        name: row.name,
                        desiredRevision: row.desiredRevision,
                      } satisfies StatusSchema.GeneratedSlot,
                    ],
              ),
            ),
          ),
      }),
    )
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [Database.node, Location.node, SelfImprovementAutomation.node],
})
