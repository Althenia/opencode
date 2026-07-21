import { expect, test } from "bun:test"
import { Effect } from "effect"
import { SelfImprovementLifecycle } from "@opencode-ai/schema"
import { validateCapabilities } from "@opencode-ai/core/self-improvement/capability"

const manifest = (overrides = {}) =>
  new SelfImprovementLifecycle.CapabilityManifest({
    toolIDs: ["read"],
    filesystemScopeIDs: [],
    networkOriginIDs: [],
    modelRoutes: [],
    childAgentTargets: [],
    artifactReferences: [],
    denies: [],
    ...overrides,
  })

test("fails unknown, dynamic, grant, baseline, and task-envelope capability excess", async () => {
  const findings = await Effect.runPromise(
    validateCapabilities({
      runID: SelfImprovementLifecycle.EvaluationRunID.make("si_run_capability_1"),
      manifest: manifest({ toolIDs: ["read", "${write}"] }),
      locationID: SelfImprovementLifecycle.LocationID.make("a".repeat(64)),
      known: { tools: ["read"], filesystemScopes: [], networkOrigins: [], childAgents: [], modelRoutes: [] },
      grant: manifest(),
      baseline: manifest(),
      taskEnvelope: manifest(),
      generated: true,
      adhoc: true,
      resolve: () => [],
    }),
  )

  expect(findings.map((finding) => finding.gateID)).toEqual([
    "capabilities-static-known",
    "capabilities-within-location-grant",
    "generated-capabilities-within-baseline",
    "adhoc-capabilities-within-task-envelope",
  ])
  expect(findings.some((finding) => finding.result === "fail")).toBe(true)
})

test("detects transitive reference cycles and Location resolution failures", async () => {
  const findings = await Effect.runPromise(
    validateCapabilities({
      runID: SelfImprovementLifecycle.EvaluationRunID.make("si_run_capability_2"),
      manifest: manifest({ artifactReferences: [{ kind: "workflow", name: "loop" }] }),
      locationID: SelfImprovementLifecycle.LocationID.make("a".repeat(64)),
      known: { tools: ["read"], filesystemScopes: [], networkOrigins: [], childAgents: [], modelRoutes: [] },
      grant: manifest(),
      generated: false,
      adhoc: false,
      resolve: (reference) =>
        reference.name === "loop"
          ? [
              {
                locationID: SelfImprovementLifecycle.LocationID.make("b".repeat(64)),
                manifest: manifest({ artifactReferences: [reference] }),
              },
            ]
          : [],
    }),
  )

  expect(findings.find((finding) => finding.gateID === "capabilities-static-known")?.result).toBe("fail")
})

test("binds findings to the evaluation run and preserves baseline denies", async () => {
  const runID = SelfImprovementLifecycle.EvaluationRunID.make("si_run_capability_3")
  const baseline = manifest({
    denies: [new SelfImprovementLifecycle.CapabilityDeny({ capability: "tool", resourceID: "write" })],
  })
  const input = {
    runID,
    manifest: manifest({
      denies: [
        new SelfImprovementLifecycle.CapabilityDeny({ capability: "tool", resourceID: "write" }),
        new SelfImprovementLifecycle.CapabilityDeny({ capability: "tool", resourceID: "delete" }),
      ],
    }),
    locationID: SelfImprovementLifecycle.LocationID.make("a".repeat(64)),
    known: { tools: ["read"], filesystemScopes: [], networkOrigins: [], childAgents: [], modelRoutes: [] },
    grant: manifest(),
    baseline,
    generated: true,
    adhoc: false,
    resolve: () => [],
  }

  const first = await Effect.runPromise(validateCapabilities(input))
  const second = await Effect.runPromise(validateCapabilities(input))

  expect(first.every((finding) => finding.evaluationRunID === runID)).toBe(true)
  expect(first.find((finding) => finding.gateID === "generated-capabilities-within-baseline")?.result).toBe("pass")
  expect(first.every((finding) => !second.some((other) => other.id === finding.id))).toBe(true)
})
