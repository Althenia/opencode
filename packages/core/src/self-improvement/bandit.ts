export * as SelfImprovementBandit from "./bandit"

import { SelfImprovement, SelfImprovementLearning, SelfImprovementLifecycle } from "@opencode-ai/schema"

export interface SelectionInput {
  readonly locationID: SelfImprovementLifecycle.LocationID
  readonly actionDomain: SelfImprovementLearning.ActionDomain
  readonly derivationRevision: SelfImprovementLifecycle.Revision
  readonly allowlistRevision: SelfImprovementLifecycle.Revision
  readonly eligibleArmIDs: ReadonlyArray<SelfImprovementLearning.BanditArmID>
  readonly states: ReadonlyArray<SelfImprovementLearning.BanditState>
  readonly buckets: ReadonlyArray<SelfImprovement.Digest>
}

export const select = (
  input: SelectionInput,
):
  | { readonly bucketDigest: SelfImprovement.Digest; readonly selectedArmID: SelfImprovementLearning.BanditArmID }
  | undefined => {
  const states = input.states.filter(
    (state) =>
      state.active &&
      state.locationID === input.locationID &&
      state.actionDomain === input.actionDomain &&
      state.derivationRevision === input.derivationRevision &&
      state.allowlistRevision === input.allowlistRevision,
  )
  const bucket =
    input.buckets.find((candidate) => {
      const eligible = states.filter(
        (state) => state.bucketDigest === candidate && input.eligibleArmIDs.includes(state.armID),
      )
      return eligible.reduce((total, state) => total + state.rewardedPullTotal, 0) >= 5
    }) ?? input.buckets.at(-1)
  if (bucket === undefined || input.eligibleArmIDs.length === 0) return undefined

  const eligible = input.eligibleArmIDs.map((armID) => {
    const state = states.find((state) => state.bucketDigest === bucket && state.armID === armID)
    return { armID, pullTotal: state?.pullTotal ?? 0, meanReward: state?.meanReward ?? 0 }
  })
  const untried = eligible.filter((state) => state.pullTotal === 0)
  if (untried.length > 0)
    return { bucketDigest: bucket, selectedArmID: untried.map((state) => state.armID).toSorted(compare)[0] }

  const totalPulls = eligible.reduce((total, state) => total + state.pullTotal, 0)
  return {
    bucketDigest: bucket,
    selectedArmID: eligible.toSorted((left, right) => {
      const leftScore = left.meanReward + Math.sqrt(Math.log(Math.max(totalPulls, 1)) / left.pullTotal)
      const rightScore = right.meanReward + Math.sqrt(Math.log(Math.max(totalPulls, 1)) / right.pullTotal)
      return rightScore - leftScore || compare(left.armID, right.armID)
    })[0].armID,
  }
}

function compare(left: string, right: string) {
  const leftScalars = Array.from(left, (value) => value.codePointAt(0) ?? 0)
  const rightScalars = Array.from(right, (value) => value.codePointAt(0) ?? 0)
  for (let index = 0; index < Math.min(leftScalars.length, rightScalars.length); index++) {
    if (leftScalars[index] !== rightScalars[index]) return leftScalars[index] - rightScalars[index]
  }
  return leftScalars.length - rightScalars.length
}
