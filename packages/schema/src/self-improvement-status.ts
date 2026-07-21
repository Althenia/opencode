export * as SelfImprovementStatus from "./self-improvement-status.js"

import { Schema } from "effect"
import { NonNegativeInt, PositiveInt, optional } from "./schema.js"
import { SelfImprovement } from "./self-improvement.js"
import { SelfImprovementLifecycle } from "./self-improvement-lifecycle.js"

export const EmptyReasonCode = Schema.Literals(["automatic-disabled", "no-terminal-evidence"]).annotate({
  identifier: "SelfImprovementStatus.EmptyReasonCode",
})
export type EmptyReasonCode = typeof EmptyReasonCode.Type

export const EmptyReason = Schema.Struct({
  code: EmptyReasonCode,
  message: Schema.NonEmptyString,
}).annotate({ identifier: "SelfImprovementStatus.EmptyReason" })
export interface EmptyReason extends Schema.Schema.Type<typeof EmptyReason> {}

export const TickResult = Schema.Struct({
  eligiblePatterns: NonNegativeInt,
  generated: NonNegativeInt,
  prepared: NonNegativeInt,
  runsCreated: NonNegativeInt,
  runsDecided: NonNegativeInt,
  reconciled: NonNegativeInt,
  failures: NonNegativeInt,
}).annotate({ identifier: "SelfImprovementStatus.TickResult" })
export interface TickResult extends Schema.Schema.Type<typeof TickResult> {}

export const GeneratedSlot = Schema.Struct({
  slot: Schema.Literals(["active", "shadow", "canary"]),
  artifactID: SelfImprovementLifecycle.ArtifactID,
  versionID: SelfImprovementLifecycle.ArtifactVersionID,
  name: SelfImprovement.CandidateName,
  desiredRevision: SelfImprovementLifecycle.Revision,
}).annotate({ identifier: "SelfImprovementStatus.GeneratedSlot" })
export interface GeneratedSlot extends Schema.Schema.Type<typeof GeneratedSlot> {}

export const Info = Schema.Struct({
  enabled: Schema.Boolean,
  autoApprove: Schema.Boolean,
  intervalSeconds: PositiveInt,
  evaluationWindowMinutes: PositiveInt,
  evidence: Schema.Struct({
    count: NonNegativeInt,
    lastObservedAt: SelfImprovementLifecycle.TimestampMillis.pipe(optional),
    reason: EmptyReason.pipe(optional),
  }),
  automation: Schema.Struct({
    running: Schema.Boolean,
    lastStartedAt: SelfImprovementLifecycle.TimestampMillis.pipe(optional),
    lastCompletedAt: SelfImprovementLifecycle.TimestampMillis.pipe(optional),
    lastResult: TickResult.pipe(optional),
  }),
  generatedSlots: Schema.Array(GeneratedSlot),
}).annotate({ identifier: "SelfImprovementStatus.Info" })
export interface Info extends Schema.Schema.Type<typeof Info> {}
