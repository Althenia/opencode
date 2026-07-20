import { expect, test } from "bun:test"
import { Effect } from "effect"
import { SelfImprovement, SelfImprovementLearning, SelfImprovementLifecycle } from "@opencode-ai/schema"
import { recordOutcome } from "@opencode-ai/core/self-improvement/reward"

const digest = (value: string) => SelfImprovement.Digest.make(value.repeat(64))
const locationID = SelfImprovementLifecycle.LocationID.make("a".repeat(64))
const pull = {
  id: SelfImprovementLifecycle.PullEventID.make("si_pul_reward"),
  locationID,
  actionDomain: "model-route",
  bucketDigest: digest("b"),
  derivationRevision: SelfImprovementLifecycle.Revision.make(1),
  allowlistRevision: SelfImprovementLifecycle.Revision.make(1),
  orderedEligibleArmIDs: [SelfImprovementLifecycle.ModelRouteArmID.make("si_arm_reward")],
  selectedArmID: SelfImprovementLifecycle.ModelRouteArmID.make("si_arm_reward"),
  timestamp: SelfImprovementLifecycle.TimestampMillis.make(1),
} satisfies SelfImprovementLearning.PullEvent

test("maps every post-selection outcome to the approved reward table", async () => {
  const outcomes = [
    ["model-failure", "no-reward-model-failure", undefined],
    ["invalid-model-output", "invalid-model-output", -1],
    ["hard-rejection", "no-reward-hard-rejection", undefined],
    ["insufficient-evidence", "no-reward-insufficient-evidence", undefined],
    ["shadow-failure", "shadow-failure", -0.4],
    ["canary-regression", "canary-regression", -1],
    ["approval-rejected", "no-reward-approval", undefined],
    ["passing-evidence", "passing-evidence", 0.7],
  ] as const

  for (const [outcome, outcomeClass, numericReward] of outcomes) {
    const recorded: SelfImprovementLearning.RewardEvent[] = []
    let deactivated = false
    const reward = await Effect.runPromise(
      recordOutcome({
        pull,
        outcome,
        evidenceDigest: digest("c"),
        timestamp: SelfImprovementLifecycle.TimestampMillis.make(2),
        reward: numericReward,
        append: (event) => Effect.sync(() => void recorded.push(event)),
        recordCanaryRegression: ({ reward }) =>
          Effect.sync(() => {
            recorded.push(reward)
            deactivated = true
          }),
      }),
    )

    expect(reward).toMatchObject({ outcomeClass, numericReward })
    if (reward === undefined) throw new Error("expected a post-selection reward")
    expect(recorded).toEqual([reward])
    expect(deactivated).toBe(outcome === "canary-regression")
  }
})

test("does not create a reward for pre-selection model unavailability", async () => {
  const reward = await Effect.runPromise(
    recordOutcome({
      pull,
      outcome: "model-unavailable",
      evidenceDigest: digest("c"),
      timestamp: SelfImprovementLifecycle.TimestampMillis.make(2),
      append: () => Effect.die("must not append"),
      recordCanaryRegression: () => Effect.die("must not record a canary regression"),
    }),
  )

  expect(reward).toBeUndefined()
})

test("uses the atomic owner callback for canary regression reward and arm deactivation", async () => {
  const calls: string[] = []
  const reward = await Effect.runPromise(
    recordOutcome({
      pull,
      outcome: "canary-regression",
      evidenceDigest: digest("c"),
      timestamp: SelfImprovementLifecycle.TimestampMillis.make(2),
      append: () => Effect.sync(() => void calls.push("append")),
      recordCanaryRegression: (input) =>
        Effect.sync(
          () =>
            void calls.push(
              `${input.locationID}:${input.bucketDigest}:${input.derivationRevision}:${input.allowlistRevision}:${input.armID}:${input.reward.id}`,
            ),
        ),
    }),
  )

  expect(reward).toMatchObject({ outcomeClass: "canary-regression", numericReward: -1 })
  expect(calls).toEqual([
    `${pull.locationID}:${pull.bucketDigest}:${pull.derivationRevision}:${pull.allowlistRevision}:${pull.selectedArmID}:${reward?.id}`,
  ])
})
