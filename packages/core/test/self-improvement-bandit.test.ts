import { expect, test } from "bun:test"
import { SelfImprovement, SelfImprovementLearning, SelfImprovementLifecycle } from "@opencode-ai/schema"
import { SelfImprovementBandit } from "@opencode-ai/core/self-improvement/bandit"

const locationID = SelfImprovementLifecycle.LocationID.make("a".repeat(64))
const revision = SelfImprovementLifecycle.Revision.make(1)
const digest = (value: string) => SelfImprovement.Digest.make(value[0].repeat(64))
const arm = (id: string, pullTotal = 0, rewardedPullTotal = 0, cumulativeReward = 0) =>
  ({
    locationID,
    actionDomain: "generation-strategy" as const,
    bucketDigest: digest("b"),
    derivationRevision: revision,
    allowlistRevision: revision,
    armID: SelfImprovementLifecycle.GenerationStrategyArmID.make(id),
    pullTotal,
    rewardedPullTotal,
    cumulativeReward,
    meanReward: rewardedPullTotal === 0 ? 0 : cumulativeReward / rewardedPullTotal,
    active: true,
  }) satisfies SelfImprovementLearning.BanditState

test("does not select an ineligible arm", () => {
  expect(
    SelfImprovementBandit.select({
      locationID,
      actionDomain: "generation-strategy",
      derivationRevision: revision,
      allowlistRevision: revision,
      eligibleArmIDs: [],
      states: [],
      buckets: [digest("exact"), digest("broad")],
    }),
  ).toBeUndefined()
})

test("uses the first bucket with five rewarded pulls, otherwise the broadest cold-start bucket", () => {
  const exact = digest("c")
  const broad = digest("d")
  const exactArm = { ...arm("si_gsa_exact", 5, 5, 5), bucketDigest: exact }
  const broadArm = { ...arm("si_gsa_broad", 5, 5, 5), bucketDigest: broad }
  const input = {
    locationID,
    actionDomain: "generation-strategy" as const,
    derivationRevision: revision,
    allowlistRevision: revision,
    eligibleArmIDs: [exactArm.armID, broadArm.armID],
    states: [exactArm, broadArm],
    buckets: [exact, broad],
  }

  expect(SelfImprovementBandit.select(input)).toEqual({ bucketDigest: exact, selectedArmID: broadArm.armID })
  expect(SelfImprovementBandit.select({ ...input, states: [{ ...exactArm, rewardedPullTotal: 4 }, broadArm] })).toEqual(
    { bucketDigest: broad, selectedArmID: exactArm.armID },
  )
})

test("selects untried arms before UCB scores and treats zero-reward pulls as mean zero", () => {
  const bucket = digest("b")
  const tried = arm("si_gsa_tried", 3, 0)
  const untried = arm("si_gsa_untried")
  expect(
    SelfImprovementBandit.select({
      locationID,
      actionDomain: "generation-strategy",
      derivationRevision: revision,
      allowlistRevision: revision,
      eligibleArmIDs: [tried.armID, untried.armID],
      states: [tried, untried],
      buckets: [bucket],
    }),
  ).toEqual({ bucketDigest: bucket, selectedArmID: untried.armID })

  const zero = arm("si_gsa_zero", 4, 0)
  const rewarded = arm("si_gsa_rewarded", 4, 4, 1)
  expect(
    SelfImprovementBandit.select({
      locationID,
      actionDomain: "generation-strategy",
      derivationRevision: revision,
      allowlistRevision: revision,
      eligibleArmIDs: [zero.armID, rewarded.armID],
      states: [zero, rewarded],
      buckets: [bucket],
    }),
  ).toEqual({ bucketDigest: bucket, selectedArmID: rewarded.armID })
})

test("uses UCB coefficient one and Unicode-scalar order for ties", () => {
  const bucket = digest("b")
  const highExploration = arm("si_gsa_high", 1, 1, 0)
  const highMean = arm("si_gsa_mean", 100, 100, 50)
  expect(
    SelfImprovementBandit.select({
      locationID,
      actionDomain: "generation-strategy",
      derivationRevision: revision,
      allowlistRevision: revision,
      eligibleArmIDs: [highExploration.armID, highMean.armID],
      states: [highExploration, highMean],
      buckets: [bucket],
    }),
  ).toEqual({ bucketDigest: bucket, selectedArmID: highExploration.armID })

  const supplementary = arm("si_gsa_\u{10000}", 1, 1, 0)
  const bmp = arm("si_gsa_\uffff", 1, 1, 0)
  expect(
    SelfImprovementBandit.select({
      locationID,
      actionDomain: "generation-strategy",
      derivationRevision: revision,
      allowlistRevision: revision,
      eligibleArmIDs: [supplementary.armID, bmp.armID],
      states: [supplementary, bmp],
      buckets: [bucket],
    }),
  ).toEqual({ bucketDigest: bucket, selectedArmID: bmp.armID })
})

test("does not score states from another Location or revision", () => {
  const exact = digest("c")
  const broad = digest("d")
  const exactArm = { ...arm("si_gsa_exact", 4, 4, 4), bucketDigest: exact }
  const broadArm = { ...arm("si_gsa_broad", 5, 5, 5), bucketDigest: broad }
  const historical = {
    ...exactArm,
    locationID: SelfImprovementLifecycle.LocationID.make("b".repeat(64)),
    derivationRevision: SelfImprovementLifecycle.Revision.make(2),
    allowlistRevision: SelfImprovementLifecycle.Revision.make(2),
    rewardedPullTotal: 5,
  }

  expect(
    SelfImprovementBandit.select({
      locationID,
      actionDomain: "generation-strategy",
      derivationRevision: revision,
      allowlistRevision: revision,
      eligibleArmIDs: [exactArm.armID, broadArm.armID],
      states: [exactArm, broadArm, historical],
      buckets: [exact, broad],
    }),
  ).toEqual({ bucketDigest: broad, selectedArmID: exactArm.armID })
})
