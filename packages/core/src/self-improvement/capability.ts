export * as SelfImprovementCapability from "./capability"

import { Effect } from "effect"
import { SelfImprovementEvaluation, SelfImprovementLifecycle } from "@opencode-ai/schema"

export interface CapabilityInput {
  readonly runID: SelfImprovementLifecycle.EvaluationRunID
  readonly manifest: SelfImprovementLifecycle.CapabilityManifest
  readonly locationID: SelfImprovementLifecycle.LocationID
  readonly known: {
    readonly tools: ReadonlyArray<string>
    readonly filesystemScopes: ReadonlyArray<string>
    readonly networkOrigins: ReadonlyArray<string>
    readonly childAgents: ReadonlyArray<string>
    readonly modelRoutes: ReadonlyArray<unknown>
  }
  readonly grant: SelfImprovementLifecycle.CapabilityManifest
  readonly baseline?: SelfImprovementLifecycle.CapabilityManifest
  readonly taskEnvelope?: SelfImprovementLifecycle.CapabilityManifest
  readonly generated: boolean
  readonly adhoc: boolean
  readonly resolve: (reference: SelfImprovementLifecycle.TypedArtifactReference) => ReadonlyArray<{
    readonly locationID: SelfImprovementLifecycle.LocationID
    readonly manifest: SelfImprovementLifecycle.CapabilityManifest
  }>
}

export const validateCapabilities = (
  input: CapabilityInput,
): Effect.Effect<ReadonlyArray<SelfImprovementEvaluation.GateFinding>> =>
  Effect.sync(() => {
    const resolved = collect(input.manifest, input, new Set())
    const finding = (
      gateID: SelfImprovementEvaluation.GateID,
      result: SelfImprovementEvaluation.GateResult,
      code: string,
    ) =>
      SelfImprovementEvaluation.GateFinding.make({
        id: SelfImprovementLifecycle.GateFindingID.create(),
        evaluationRunID: input.runID,
        order: SelfImprovementEvaluation.GateOrder[gateID],
        gateID,
        result,
        code,
      })
    const staticKnown =
      !resolved.invalidReference &&
      !resolved.cycle &&
      !hasDynamic(resolved.manifest) &&
      subset(resolved.manifest.toolIDs, input.known.tools) &&
      subset(resolved.manifest.filesystemScopeIDs, input.known.filesystemScopes) &&
      subset(resolved.manifest.networkOriginIDs, input.known.networkOrigins) &&
      subset(resolved.manifest.childAgentTargets, input.known.childAgents) &&
      subset(resolved.manifest.modelRoutes.map(key), input.known.modelRoutes.map(key))
    return [
      finding(
        "capabilities-static-known",
        staticKnown ? "pass" : "fail",
        staticKnown ? "passed" : "capability-dynamic-or-unknown",
      ),
      finding(
        "capabilities-within-location-grant",
        subsetManifest(resolved.manifest, input.grant) ? "pass" : "fail",
        "capabilities-within-location-grant",
      ),
      finding(
        "generated-capabilities-within-baseline",
        input.generated
          ? input.baseline && subsetManifest(resolved.manifest, input.baseline, true)
            ? "pass"
            : "fail"
          : "not-applicable",
        "generated-capabilities-within-baseline",
      ),
      finding(
        "adhoc-capabilities-within-task-envelope",
        input.adhoc
          ? input.taskEnvelope && subsetManifest(resolved.manifest, input.taskEnvelope)
            ? "pass"
            : "fail"
          : "not-applicable",
        "adhoc-capabilities-within-task-envelope",
      ),
    ]
  })

function collect(
  manifest: SelfImprovementLifecycle.CapabilityManifest,
  input: CapabilityInput,
  seen: Set<string>,
): {
  readonly manifest: SelfImprovementLifecycle.CapabilityManifest
  readonly invalidReference: boolean
  readonly cycle: boolean
} {
  const initial = { manifest, invalidReference: false, cycle: false }
  return manifest.artifactReferences.reduce((current, reference) => {
    const referenceKey = `${reference.kind}:${reference.name}`
    if (seen.has(referenceKey)) return { ...current, cycle: true }
    const matches = input.resolve(reference).filter((candidate) => candidate.locationID === input.locationID)
    if (matches.length !== 1) return { ...current, invalidReference: true }
    const next = collect(matches[0].manifest, input, new Set([...seen, referenceKey]))
    return {
      manifest: merge(current.manifest, next.manifest),
      invalidReference: current.invalidReference || next.invalidReference,
      cycle: current.cycle || next.cycle,
    }
  }, initial)
}

function merge(
  left: SelfImprovementLifecycle.CapabilityManifest,
  right: SelfImprovementLifecycle.CapabilityManifest,
): SelfImprovementLifecycle.CapabilityManifest {
  return new SelfImprovementLifecycle.CapabilityManifest({
    toolIDs: unique([...left.toolIDs, ...right.toolIDs]),
    filesystemScopeIDs: unique([...left.filesystemScopeIDs, ...right.filesystemScopeIDs]),
    networkOriginIDs: unique([...left.networkOriginIDs, ...right.networkOriginIDs]),
    modelRoutes: unique([...left.modelRoutes, ...right.modelRoutes], key),
    childAgentTargets: unique([...left.childAgentTargets, ...right.childAgentTargets]),
    artifactReferences: unique([...left.artifactReferences, ...right.artifactReferences], key),
    denies: unique([...left.denies, ...right.denies], key),
  })
}

function subsetManifest(
  left: SelfImprovementLifecycle.CapabilityManifest,
  right: SelfImprovementLifecycle.CapabilityManifest,
  preserveDenies = false,
) {
  return (
    subset(left.toolIDs, right.toolIDs) &&
    subset(left.filesystemScopeIDs, right.filesystemScopeIDs) &&
    subset(left.networkOriginIDs, right.networkOriginIDs) &&
    subset(left.modelRoutes.map(key), right.modelRoutes.map(key)) &&
    subset(left.childAgentTargets, right.childAgentTargets) &&
    subset(left.artifactReferences.map(key), right.artifactReferences.map(key)) &&
    (preserveDenies
      ? subset(right.denies.map(key), left.denies.map(key))
      : subset(left.denies.map(key), right.denies.map(key)))
  )
}

function subset(values: ReadonlyArray<string>, allowed: ReadonlyArray<string>) {
  return values.every((value) => allowed.includes(value))
}

function unique<Value>(values: ReadonlyArray<Value>, identity: (value: Value) => string = String) {
  return [...new Map(values.map((value) => [identity(value), value])).values()]
}

function key(value: unknown) {
  return JSON.stringify(value)
}

function hasDynamic(manifest: SelfImprovementLifecycle.CapabilityManifest) {
  return [
    ...manifest.toolIDs,
    ...manifest.filesystemScopeIDs,
    ...manifest.networkOriginIDs,
    ...manifest.childAgentTargets,
    ...manifest.modelRoutes.map(key),
  ].some((value) => value.includes("*") || value.includes("${") || value.includes("{{"))
}
