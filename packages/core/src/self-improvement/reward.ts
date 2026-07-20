export * as SelfImprovementReward from "./reward"

import { SelfImprovement, SelfImprovementLearning, SelfImprovementLifecycle } from "@opencode-ai/schema"
import { Effect } from "effect"
import { SelfImprovementLearningStore } from "./learning-store"

export type Outcome =
  | "model-unavailable"
  | "model-failure"
  | "invalid-model-output"
  | "hard-rejection"
  | "insufficient-evidence"
  | "shadow-failure"
  | "canary-regression"
  | "approval-rejected"
  | "passing-evidence"

export interface OutcomeInput {
  readonly pull: SelfImprovementLearning.PullEvent
  readonly outcome: Outcome
  readonly evidenceDigest: SelfImprovement.Digest
  readonly timestamp: SelfImprovementLifecycle.TimestampMillis
  readonly reward?: number
  readonly append: (
    event: SelfImprovementLearning.RewardEvent,
  ) => Effect.Effect<void, SelfImprovementLearningStore.Conflict>
  readonly recordCanaryRegression: (input: {
    readonly reward: SelfImprovementLearning.RewardEvent
    readonly locationID: SelfImprovementLifecycle.LocationID
    readonly bucketDigest: SelfImprovement.Digest
    readonly derivationRevision: SelfImprovementLifecycle.Revision
    readonly allowlistRevision: SelfImprovementLifecycle.Revision
    readonly armID: SelfImprovementLifecycle.ModelRouteArmID
  }) => Effect.Effect<void, SelfImprovementLearningStore.Conflict>
}

export const recordOutcome = (
  input: OutcomeInput,
): Effect.Effect<SelfImprovementLearning.RewardEvent | undefined, SelfImprovementLearningStore.Conflict> => {
  if (input.outcome === "model-unavailable") return Effect.succeed(undefined)
  const reward = new SelfImprovementLearning.RewardEvent({
    id: SelfImprovementLifecycle.RewardEventID.create(),
    locationID: input.pull.locationID,
    pullEventID: input.pull.id,
    outcomeClass: outcomeClass(input.outcome),
    numericReward: numericReward(input),
    evidenceDigest: input.evidenceDigest,
    timestamp: input.timestamp,
  })
  return Effect.gen(function* () {
    if (input.outcome === "canary-regression") {
      yield* input.recordCanaryRegression({
        reward,
        locationID: input.pull.locationID,
        bucketDigest: input.pull.bucketDigest,
        derivationRevision: input.pull.derivationRevision,
        allowlistRevision: input.pull.allowlistRevision,
        armID: SelfImprovementLifecycle.ModelRouteArmID.make(input.pull.selectedArmID),
      })
      return reward
    }
    yield* input.append(reward)
    return reward
  })
}

function outcomeClass(outcome: Exclude<Outcome, "model-unavailable">): SelfImprovementLearning.RewardOutcomeClass {
  if (outcome === "model-failure") return "no-reward-model-failure"
  if (outcome === "hard-rejection") return "no-reward-hard-rejection"
  if (outcome === "insufficient-evidence") return "no-reward-insufficient-evidence"
  if (outcome === "approval-rejected") return "no-reward-approval"
  return outcome
}

function numericReward(input: OutcomeInput) {
  if (input.outcome === "invalid-model-output" || input.outcome === "canary-regression") return -1
  if (input.outcome === "shadow-failure" || input.outcome === "passing-evidence") return input.reward
  return undefined
}
