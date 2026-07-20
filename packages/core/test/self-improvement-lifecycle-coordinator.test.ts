import { expect, test } from "bun:test"
import { SelfImprovement, SelfImprovementLifecycle } from "@opencode-ai/schema"
import { LifecyclePolicy } from "@opencode-ai/core/self-improvement/lifecycle-coordinator"

const stage = (value: SelfImprovementLifecycle.ArtifactStage | null) => value

test("accepts only approved event-driven lifecycle transitions", () => {
  const cases: ReadonlyArray<{
    readonly current: SelfImprovementLifecycle.ArtifactStage | null
    readonly event: SelfImprovementLifecycle.LifecycleEvent
    readonly result: SelfImprovementLifecycle.ArtifactStage | undefined
  }> = [
    { current: null, event: "version-admitted", result: "draft" },
    { current: "draft", event: "static-passed", result: "experimental" },
    { current: "experimental", event: "offline-passed", result: "candidate" },
    { current: "candidate", event: "shadow-started", result: "shadow" },
    { current: "shadow", event: "shadow-evidence-passed", result: "canary" },
    { current: "shadow", event: "approval-consumed", result: "canary" },
    { current: "canary", event: "canary-passed", result: "active" },
    { current: "canary", event: "canary-regressed", result: "deprecated" },
    { current: "active", event: "version-superseded", result: "deprecated" },
    { current: "deprecated", event: "retention-archive", result: "archived" },
    { current: "draft", event: "ephemeral-expired", result: "archived" },
  ]

  for (const entry of cases) expect(LifecyclePolicy.nextStage(stage(entry.current), entry.event)).toBe(entry.result)

  expect(LifecyclePolicy.nextStage("candidate", "offline-passed")).toBeUndefined()
  expect(LifecyclePolicy.nextStage("archived", "retention-archive")).toBeUndefined()
  expect(LifecyclePolicy.nextStage("active", "version-archived")).toBeUndefined()
  expect("setStage" in LifecyclePolicy).toBe(false)
})

test("keeps insufficient evidence in place and gives tombstones terminal precedence", () => {
  expect(LifecyclePolicy.nextStage("shadow", "shadow-evidence-passed", { decision: "failed", atCutoff: false })).toBe(
    "shadow",
  )
  expect(LifecyclePolicy.nextStage("shadow", "shadow-evidence-passed", { decision: "failed", atCutoff: true })).toBe(
    "deprecated",
  )
  expect(LifecyclePolicy.nextStage("shadow", "retention-archive")).toBeUndefined()
  expect(LifecyclePolicy.nextStage("archived", "retention-archive")).toBeUndefined()
})

test("reserves terminal events for tombstone and archive transactions", () => {
  expect(LifecyclePolicy.nextStage("draft", "artifact-tombstoned")).toBeUndefined()
  expect(LifecyclePolicy.nextStage("active", "version-archived")).toBeUndefined()
})

test("keeps a context-backed transition at its current stage until reconciliation", () => {
  expect(LifecyclePolicy.visibleStage("shadow", "canary", true)).toBe("shadow")
  expect(LifecyclePolicy.visibleStage("shadow", "canary", false)).toBe("canary")
})

test("requires an exact approval intent for deferred approval consumption", () => {
  expect(LifecyclePolicy.matchesApprovalIntent("si_app_1", "si_app_1")).toBe(true)
  expect(LifecyclePolicy.matchesApprovalIntent("si_app_1", "si_app_2")).toBe(false)
  expect(LifecyclePolicy.matchesApprovalIntent("si_app_1", undefined)).toBe(false)
})

test("allows canary regression to remove only the candidate contribution", () => {
  expect(LifecyclePolicy.isCanaryRemoval("canary-regressed", "canary", "absent")).toBe(true)
  expect(LifecyclePolicy.isCanaryRemoval("canary-regressed", "active", "absent")).toBe(false)
  expect(LifecyclePolicy.isCanaryRemoval("canary-passed", "canary", "absent")).toBe(false)
})

test("accepts only terminal tombstone removal intents", () => {
  expect(LifecyclePolicy.isTerminalRemovalIntent("artifact-tombstoned", "archived", "absent")).toBe(true)
  expect(LifecyclePolicy.isTerminalRemovalIntent("artifact-tombstoned", "deprecated", "absent")).toBe(false)
  expect(LifecyclePolicy.isTerminalRemovalIntent("artifact-tombstoned", "archived", "present")).toBe(false)
})

test("requires context desired state and approval binding to match the transition", () => {
  const binding = new SelfImprovementLifecycle.ApprovalBinding({
    versionID: SelfImprovementLifecycle.ArtifactVersionID.make("si_ver_1"),
    versionDigest: SelfImprovement.Digest.make("a".repeat(64)),
    suiteID: SelfImprovementLifecycle.SuiteID.make("si_sui_1"),
    suiteRevision: SelfImprovementLifecycle.Revision.make(1),
    evaluationRunID: SelfImprovementLifecycle.EvaluationRunID.make("si_run_1"),
    shadowEvidenceDigest: SelfImprovement.Digest.make("b".repeat(64)),
  })

  expect(LifecyclePolicy.matchesDesiredVersion("si_ver_1", "a".repeat(64), "si_ver_1", "a".repeat(64))).toBe(true)
  expect(LifecyclePolicy.matchesDesiredVersion("si_ver_1", "a".repeat(64), "si_ver_2", "a".repeat(64))).toBe(false)
  expect(LifecyclePolicy.matchesApprovalBinding(binding, binding)).toBe(true)
  expect(
    LifecyclePolicy.matchesApprovalBinding(
      binding,
      new SelfImprovementLifecycle.ApprovalBinding({
        versionID: binding.versionID,
        versionDigest: binding.versionDigest,
        suiteID: binding.suiteID,
        suiteRevision: SelfImprovementLifecycle.Revision.make(2),
        evaluationRunID: binding.evaluationRunID,
        shadowEvidenceDigest: binding.shadowEvidenceDigest,
      }),
    ),
  ).toBe(false)
})

test("rejects mutation while finalization is blocked", () => {
  expect(LifecyclePolicy.allowsMutation(false)).toBe(true)
  expect(LifecyclePolicy.allowsMutation(true)).toBe(false)
})

test("lets tombstones supersede blocked finalization work", () => {
  expect(LifecyclePolicy.allowsTombstone(true)).toBe(true)
})

test("requires one valid archive transition for every artifact version", () => {
  const transitions = [
    { versionID: "si_ver_1", event: "artifact-tombstoned", nextStage: "archived" },
    { versionID: "si_ver_2", event: "artifact-tombstoned", nextStage: "archived" },
  ] as const

  expect(LifecyclePolicy.matchesArchiveTransitions(["si_ver_1", "si_ver_2"], transitions)).toBe(true)
  expect(LifecyclePolicy.matchesArchiveTransitions(["si_ver_1", "si_ver_2"], [transitions[0]])).toBe(false)
  expect(
    LifecyclePolicy.matchesArchiveTransitions(
      ["si_ver_1", "si_ver_2"],
      [transitions[0], { ...transitions[1], nextStage: "deprecated" }],
    ),
  ).toBe(false)
})

test("requires reconciliation context for approval and canary finalization", () => {
  expect(LifecyclePolicy.requiresContext("approval-consumed")).toBe(true)
  expect(LifecyclePolicy.requiresContext("canary-regressed")).toBe(true)
  expect(LifecyclePolicy.requiresContext("canary-passed")).toBe(false)
})
