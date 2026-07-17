# Smart Self-Improvement S01 Contracts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Define the executable S01 schemas, types, stable identifiers, private API contracts, and minimal live dependency adapters consumed by later smart self-improvement slices.

**Architecture:** S01 adds browser-safe Effect schemas in four focused `@opencode-ai/schema` modules and one Core compile-time dependency contract. The schema package owns serializable vocabulary only; Core pins the existing Slice 1A parser, derives an opaque Location ID from the complete live `Location.Ref`, and records the `Policy -> Catalog -> variant materialization -> SessionRunnerModel` boundary without implementing a router, service, handler, persistence, or lifecycle behavior. The complete MVP lifecycle remains design context for these contracts, not an S01 deliverable.

**Tech Stack:** TypeScript, Bun 1.3.14, Effect 4.0.0-beta.83 `Schema`, Bun test, oxlint, `@opencode-ai/schema`, and `@opencode-ai/core`.

## Global Constraints

The following requirements are copied verbatim from the approved design and apply to every task:

1. Normative precedence is:
   1. explicit requirements in this design;
   2. current live repository source and schemas;
   3. repository defaults and conventions; and
   4. durable memory or prior design notes.
2. Current live source always wins over stale memory. An explicit requirement here wins over a conflicting repository default. A discovered conflict with a higher-precedence source blocks the affected slice; it is not silently adapted.
3. The lifecycle supports `agent`, `skill`, `workflow`, `mode`, `command`, and `routing-policy`.
4. Artifacts own exactly one immutable Location. Versions inherit it and do not duplicate Location scope.
5. Every reference resolves only inside the owning Location.
6. Generated output never bypasses Slice 1A, semantic gates, capability policy, or authorization.
7. Generated routing policies are rejected before version storage.
8. Generated agents without an active baseline are rejected before version storage.
9. Runtime permissions and Location grants remain authoritative over generated text and manifests.
10. Generated executable or behavior-changing versions may enter shadow automatically but require exact bound approval before canary.
11. Required gates cannot be removed; overrides may only add gates or tighten thresholds.
12. Version content, capability manifests, approvals, samples, transitions, rewards, and audit entries are immutable until retention or governance deletion.
13. No caller can set a current stage directly.
14. At most one active, one shadow, and one canary version exist per artifact.
15. Tombstoned names remain reserved and normal CRUD is tombstone-only.
16. Raw prompts, transcripts, secrets, credentials, tool arguments, and remote embedded content are not learning data.
17. All reads, writes, uniqueness, evidence, routing, learning, and audit are Location-scoped. Cross-Location access is denied without fallback.
18. public Protocol, SDK, plugin, or MCP APIs are non-goals.
19. learner-created provider settings, credentials, endpoints, models, or variants are non-goals.
20. physical deletion through normal CRUD is a non-goal.
21. Every route follows `Policy -> Catalog -> variant materialization -> SessionRunnerModel`. The learner supplies only an advisory identity already present in these live dependencies.
22. Resolution precedence is:
   1. explicit session/user model and variant;
   2. explicit role route;
   3. eligible active bandit recommendation;
   4. Catalog default; and
   5. supported Catalog fallback.
23. At each step, Policy must allow `provider.use`, Catalog must report the model available, provider integration must be available, the variant must already exist after plugin materialization, and SessionRunnerModel must support the API. Failure continues only to the next configured fallback allowed by live policy; it never synthesizes settings.
24. The learner cannot create or alter provider settings, credentials, endpoints, integrations, model IDs, variants, defaults, fallbacks, or Policy.
25. Each slice is independently testable and cannot weaken an earlier invariant. Later slices consume contracts rather than redefining them.

S01-specific limits:

- Add executable schemas, TypeScript types, constants, schema tests, compile-time dependency contracts, one pure Location ID adapter, and a recorded manual dependency-resolution review only.
- Do not add or change persistence, Drizzle schemas, migrations, evaluators, coordinators, approval behavior, reconciliation, HTTP handlers, ingestion, generation, bandit selection, reward calculation, routing execution, context application, or E2E behavior.
- Do not modify generated files, lockfiles, package dependencies, public Protocol, Server `HttpApi`, SDKs, or manifests.
- Do not add an arbitrary stage setter, a parallel router, a provider constructor, a physical-delete contract, or fields for raw prompts, transcripts, secrets, credentials, URLs, full tool arguments, or provider settings.
- Reuse `SelfImprovement.ArtifactKind`, `SelfImprovement.CandidateName`, `SelfImprovement.Digest`, `SelfImprovement.CanonicalJson`, `SelfImprovement.JsonPointer`, `SelfImprovement.CandidateProposal`, `Model.Ref`, `SelfImprovementProposal.parse`, and the live Core service interfaces; do not bridge or duplicate their schema identities.
- Public `Schema.Struct` records use same-name interfaces, public contracts stay readonly, optional encoded properties use `optional(...)`, and every reusable schema has one stable unique identifier.
- New modules use flat exports plus a self-reexport. Tests run from package directories. Typecheck uses `bun typecheck`, never direct `tsc`.

---

## Orchestrator Bootstrap And Mandatory Isolated Execution Preflight

The shared checkout was dirty while this plan was written, and this plan was initially untracked. Before dispatching any implementation worker, the orchestrator must create one documentation-only commit containing this plan, record that commit as the approved base, and create the clean worktree from it. The implementation worker never copies an untracked plan or any other uncommitted file from the shared checkout.

- [ ] **Orchestrator prerequisite, before execution:** from the shared checkout, verify the index has no staged work with `git diff --cached --quiet`, then stage only `docs/superpowers/plans/2026-07-17-smart-self-improvement-s01-contracts.md`.
  - Run `git diff --cached --check` and `git diff --cached --name-only`.
  - Expected: the check prints nothing and the name-only output is exactly `docs/superpowers/plans/2026-07-17-smart-self-improvement-s01-contracts.md`. If any other path is staged, stop without committing.
  - Commit with `git commit -m "docs: add smart self-improvement S01 plan"`.
- [ ] **Orchestrator prerequisite, after the documentation commit:** run `SHARED_CHECKOUT=$(pwd)` and `APPROVED_BASE_SHA=$(git rev-parse HEAD)`, record both values in the execution handoff, and verify the approved documents with:

```bash
git cat-file -e "$APPROVED_BASE_SHA:docs/superpowers/specs/2026-07-17-smart-self-improvement-mvp-design.md"
git cat-file -e "$APPROVED_BASE_SHA:docs/superpowers/plans/2026-07-17-smart-self-improvement-s01-contracts.md"
```

Expected: both commands exit 0. This explicit `APPROVED_BASE_SHA` replaces any inferred `git log` SHA.

- [ ] Load `superpowers:using-git-worktrees` and create the dedicated clean worktree from the recorded base with `git worktree add ../opencode-self-improvement-s01 -b self-improvement-s01 "$APPROVED_BASE_SHA"`; then work only in `../opencode-self-improvement-s01`.
- [ ] In the isolated worktree run `git status --short --branch` and `git rev-parse HEAD`.
  - Expected: status shows the dedicated branch and no modified or untracked files; HEAD equals the recorded `APPROVED_BASE_SHA`.
- [ ] Record the shared checkout's dirty path list separately with `git -C "$SHARED_CHECKOUT" status --short`.
  - Expected: this record is evidence only. Do not copy uncommitted files from the shared checkout and do not run S01 edit, stage, commit, reset, restore, or checkout commands there.
- [ ] Before creating or modifying files, inspect all eleven planned paths at isolated-worktree HEAD:

```bash
for path in \
  packages/schema/src/self-improvement-lifecycle.ts \
  packages/schema/test/self-improvement-lifecycle.test.ts \
  packages/schema/src/self-improvement-evaluation.ts \
  packages/schema/test/self-improvement-evaluation.test.ts \
  packages/schema/src/self-improvement-learning.ts \
  packages/schema/test/self-improvement-learning.test.ts \
  packages/schema/src/self-improvement-api.ts \
  packages/schema/test/self-improvement-api.test.ts \
  packages/schema/src/index.ts \
  packages/core/src/self-improvement/contracts.ts \
  packages/core/test/self-improvement-contracts.test.ts
do
  git log -1 --oneline -- "$path"
done
```

Inspect every existing path at `APPROVED_BASE_SHA`; an empty log is expected for a new path.
  - If the path already exists because concurrent work was committed into the execution base, preserve compatible definitions and reconcile this plan into that committed version rather than overwriting it.
  - If a committed live signature conflicts with the approved design, stop that task and report the exact conflict. Never resolve it by restoring the dirty shared-checkout version.
- [ ] Re-read these read-only dependency regions in the isolated worktree before Task 5: `packages/core/src/policy.ts:17-25`, `packages/core/src/catalog.ts:48-63,178-295`, `packages/core/src/plugin.ts:23-29,100-126`, `packages/core/src/plugin/variant.ts:11-38`, `packages/core/src/session/runner/model.ts:76-83,184-233`, `packages/core/src/system-context/index.ts:22-46,135-180`, `packages/core/src/location.ts:9-17`, `packages/core/src/location-service-map.ts:1-12`, and `packages/core/src/self-improvement/proposal.ts:14-115`.
  - Required live names: `Policy.Interface.evaluate`, `Catalog.Interface.provider`, `Catalog.Interface.model`, `PluginV2.Interface.wait`, `PluginV2.ID.make("variant")`, `SessionRunnerModel.Interface.resolve`, `SystemContext.make`, `SystemContext.combine`, `Location.Interface`, and `SelfImprovementProposal.parse`.
  - Required Location fields: `directory`, optional `workspaceID`, `project`, and optional `vcs`; no live Location ID exists.
- [ ] Run the package baseline in the clean worktree before editing: `bun test test/self-improvement.test.ts test/contract-hygiene.test.ts` and `bun typecheck` from `packages/schema`, then `bun test test/catalog.test.ts test/session-runner-model.test.ts` and `bun typecheck` from `packages/core`.
  - Expected: all commands exit 0. If the approved base fails, record the exact failure and obtain permission before implementation.

## Planned File Map

| Path | Action | Responsibility |
| --- | --- | --- |
| `packages/schema/src/self-improvement-lifecycle.ts` | Create | Glossary, Location-owned identity, principals/actions, sources, behavior, stages/events/reasons, capability manifest, generated metadata, artifacts, versions, transitions, approval requests/decisions, rollback, and tombstone contracts |
| `packages/schema/test/self-improvement-lifecycle.test.ts` | Create | Lifecycle/identity schema RED/GREEN coverage, exact literal sets, Location ownership, forbidden fields, identifiers, and constructors |
| `packages/schema/src/self-improvement-evaluation.ts` | Create | Location-owned suites, exact gate order/thresholds, tightening-only overrides, baselines, runs, samples, seven metric components, findings, and decisions |
| `packages/schema/test/self-improvement-evaluation.test.ts` | Create | Metric shape, gate order/result, binding, run/sample, identifier, and privacy contract coverage |
| `packages/schema/src/self-improvement-learning.ts` | Create | Observation, generation lease, typed generation/route arms, pull/reward/projection, routing precedence, context desired/transition intent/outbox, audit, idempotency identity, and retention metadata |
| `packages/schema/test/self-improvement-learning.test.ts` | Create | Fail-closed observation, lease/event/projection, precedence, context/outbox, audit/idempotency, retention, and forbidden-field coverage |
| `packages/schema/src/self-improvement-api.ts` | Create | Private API page, request, disjoint response, error, idempotency, Location-source, conditional authorization, and exact 22-operation metadata contracts without handlers |
| `packages/schema/test/self-improvement-api.test.ts` | Create | Exact methods/paths, request/response decoding, page bounds, error codes, no stage setter, and no public route coverage |
| `packages/schema/src/index.ts:1-28` | Modify | Export the four canonical S01 schema namespaces without changing existing exports |
| `packages/core/src/self-improvement/contracts.ts` | Create | Compile-time projection of the live parser, Policy, Catalog, variant plugin, runner, System Context, and Location interfaces; no runtime router |
| `packages/core/test/self-improvement-contracts.test.ts` | Create | Root export identity, live dependency identity/order review, routing precedence, stable identifier inventory, traceability, and S01 hygiene checks |

Read-only dependencies, never planned edits: `packages/schema/src/self-improvement.ts`, `packages/schema/test/self-improvement.test.ts`, `packages/core/src/policy.ts`, `packages/core/src/catalog.ts`, `packages/core/src/plugin.ts`, `packages/core/src/plugin/variant.ts`, `packages/core/src/session/runner/model.ts`, `packages/core/src/system-context/index.ts`, `packages/core/src/location.ts`, and every committed `packages/core/src/self-improvement/*` file except the planned `contracts.ts` path after per-path reconciliation.

## S01 Traceability Inventory

| Requirement | Contract owner | Verification |
| --- | --- | --- |
| R-01 / AC-01 Location isolation and six kinds | Task 1 `LocationID`, `ArtifactKey`, `Artifact`, `ArtifactVersion`, existing `SelfImprovement.ArtifactKind` | Task 1 strict decode and type tests; Task 5 identity inventory |
| R-02 / AC-02 principal matrix | Task 1 `PrincipalKind`, `Principal`, `Operation`; Task 4 operation metadata | Task 1 literal tests; Task 4 per-operation principal tests |
| R-03 / AC-03 exact approval | Task 1 `ApprovalBinding`, `ApprovalRequest`, `ApprovalDecision`, `Approval` | Exact request/binding/decision schema tests; approval behavior deferred to S06 |
| R-04 / AC-04 generated content boundary | No S01 contract beyond Slice 1A proposal identity | Deferred-only to S04; no S01 behavior or duplicate content schema |
| R-05 / AC-05 capability manifest | Task 1 `CapabilityManifest`, live `Model.Ref` | Strict manifest decoding; capability resolution deferred to S04 |
| R-06 / AC-06 live dependencies | Task 5 `LiveDependencies`, `LiveTypeAssertions`, `ProposalParse`, `VariantPluginID`, `SystemContextFunctions`, `locationID` | Bidirectional compile checks, Location vectors, and manual dependency-resolution review |
| R-07 / AC-07 baseline contract | Task 2 `RequiredGateSequence`, `MetricThresholds`, `Baseline`, `MetricTotals`, `MetricAggregates` | Schema tests; baseline construction deferred to S03 |
| R-08 / AC-08 lifecycle matrix vocabulary | Task 1 stage/event/reason contracts and `Rollback` | Closed-set tests; transitions deferred to S05/S06 |
| R-09 / AC-09 gate applicability | Task 2 `GateID`, `GateResult`, `GateFinding` | Exact catalog/order/result tests; evaluation deferred to S04 |
| R-10 / AC-10 metric dictionary | Task 2 raw components, totals, and aggregates | Boundary/zero-denominator tests; aggregation and gates deferred to S03/S04 |
| R-11 / AC-11 bandit events | Task 3 `GenerationStrategyArm`, `ModelRouteArm`, `BanditArmID`, `PullEvent`, `RewardEvent`, `BanditState` | Arm/domain contract tests; selection/projection behavior deferred to S11 |
| R-12 / AC-12 model routing/cohort | Task 3 precedence, route decision, and `ContextSelectionEvidence` | Exact precedence and evidence tests; routing/cohort behavior deferred to S07/S11 |
| R-13 / AC-13 private API | Task 4 exact 22-operation registry, Location sources, conditional authorization, errors, pages, requests, and responses | Contract tests; handlers/auth/side effects deferred to S08/S09 |
| R-14 / AC-14 idempotency/concurrency | Task 3 `IdempotencyIdentity`; Task 4 `StoredResponse`, `IdempotencyRecord` | Status/body and 30-day expiry schema tests; persistence and ordering deferred to S02/S08 |
| R-15 / AC-15 context reconciliation | Task 3 exact desired-state union, `PendingTransitionIntent`, outbox, and selection evidence | Decode tests; CAS/retry/recovery deferred to S07 |
| R-16 / AC-16 run/sample state | Task 2 `EvaluationRun`, `MetricSample`, `EvaluationDecision` | Binding/state schemas; state-machine behavior deferred to S03 |
| R-17 / AC-17 observation/generation lease | Task 3 `Observation`, `GenerationLease` | Contract tests; HMAC/window/lease behavior deferred to S09/S10 |
| R-18 / AC-18 privacy and retention contracts | Task 3 `Observation`, `AuditEntry`, `RetentionMetadata`; Task 4 exact request unions | Forbidden-field and retention literal tests |
| R-19 / AC-19 E2E boundaries and scenarios | No S01 runtime contract | Deferred-only to S12; S01 adds no harness or fake |
| R-20 / AC-20 traceability | This table and Task 5 `S01Traceability` | Exact deep-equality test |
| R-21 / AC-21 independent slice | All five tasks | Focused test and commit per task; integrated commands in Task 5 |
| R-22 / AC-22 glossary | Task 1 `GlossaryTerm`, `Glossary` | Exact key and text tests |
| R-23 / AC-23 Mermaid consistency | Task 1 lifecycle/approval/rollback vocabulary and Task 3 intent/outbox vocabulary | Task 5 validates both diagrams and records matrix consistency; behavior remains S05-S07/S12 |
| R-24 / AC-24 canary-only rollback | Task 1 `Rollback` reason and bound run/reward IDs | Schema test; rollback behavior deferred to S06/S12 |

### Task 1: Lifecycle, Identity, Principal, And Capability Contracts

**Files:**
- Create: `packages/schema/src/self-improvement-lifecycle.ts:1-end`
- Test: `packages/schema/test/self-improvement-lifecycle.test.ts:1-end`
- Read only: `packages/schema/src/self-improvement.ts:1-282`

**Interfaces:**
- Consumes: `SelfImprovement.ArtifactKind`, `SelfImprovement.CandidateName`, `SelfImprovement.Digest`, `SelfImprovement.CanonicalJson`, `SelfImprovement.CandidateProposal`, `Model.Ref`, `optional(...)`, `statics(...)`, and `ascending(): string`.
- Produces every S01 entity ID: `SelfImprovementLifecycle.LocationID`, `PrincipalID`, `ArtifactID`, `ArtifactVersionID`, `StageTransitionID`, `ApprovalID`, `ApprovalRequestID`, `RollbackID`, `SuiteID`, `BaselineID`, `EvaluationRunID`, `MetricSampleID`, `GateFindingID`, `ObservationID`, `GenerationLeaseID`, `PullEventID`, `RewardEventID`, `GenerationStrategyArmID`, `ModelRouteArmID`, `RoutingDecisionID`, `ContextSelectionEvidenceID`, `ContextOutboxID`, `AuditEntryID`, and `IdempotencyRecordID`.
- Produces lifecycle contracts: `Revision`, `TimestampMillis`, `GlossaryTerm`, `Glossary`, `ArtifactSource`, `BehaviorClass`, `ArtifactStage`, `ArtifactStatus`, `PrincipalKind`, `Operation`, `LifecycleEvent`, `LifecycleReason`, `ArtifactKey`, `TypedArtifactReference`, `CapabilityDeny`, `CapabilityManifest`, `GeneratedContentMetadata`, `Artifact`, `ArtifactVersion`, `StageTransition`, `ApprovalBinding`, `ApprovalRejectionReason`, `ApprovalRequest`, `ApprovalGranted`, `ApprovalRejected`, `ApprovalDecision`, `Approval`, `Rollback`, and `Tombstone`.
- `CapabilityDeny` is a closed capability-manifest deny over capability/resource identifiers; Slice 1A `SelfImprovement.DenyRule` is a proposal policy statement and is neither reused, translated, nor duplicated here.
- `LocationID` is an opaque lowercase 64-hex brand with no generated `create()` method. Only the deterministic Core adapter in Task 5 validates its digest through `LocationID.make(...)`; every other generated entity ID exposes `create()` and validates its exact `si_*_` prefix.

- [ ] **Step 1: Write the failing lifecycle contract test**

```ts
import { expect, test } from "bun:test"
import { Schema } from "effect"
import { SelfImprovementLifecycle } from "../src/self-improvement-lifecycle"

const decode = <S extends Schema.Decoder<unknown>>(schema: S, input: unknown) =>
  Schema.decodeUnknownSync(schema, { errors: "all", onExcessProperty: "error" })(input)

test("defines exact lifecycle vocabulary and Location-owned artifact keys", () => {
  expect(SelfImprovementLifecycle.GlossaryTerms).toEqual([
    "matching-observation",
    "eligible-arm",
    "positive-evidence",
    "improving-sample",
    "complete-audit-chain",
    "active-recommendation",
    "ephemeral",
    "baseline",
    "workload",
    "task",
    "success",
    "repeated-issue-fingerprint",
    "precision",
    "tombstone",
  ])
  expect(SelfImprovementLifecycle.PrincipalKinds).toEqual([
    "first-party-user",
    "location-approver",
    "runtime-evidence-service",
    "evaluator",
    "coordinator",
    "audit-reader",
  ])
  expect(SelfImprovementLifecycle.ArtifactStages).toEqual([
    "draft",
    "experimental",
    "candidate",
    "shadow",
    "canary",
    "active",
    "deprecated",
    "archived",
  ])
  expect(
    decode(SelfImprovementLifecycle.ArtifactKey, {
      locationID: "a".repeat(64),
      kind: "skill",
      name: "repair-types",
    }),
  ).toEqual({ locationID: "a".repeat(64), kind: "skill", name: "repair-types" })
  expect(SelfImprovementLifecycle.ArtifactID.create()).toStartWith("si_art_")
  expect(SelfImprovementLifecycle.ArtifactVersionID.create()).toStartWith("si_ver_")
})

test("capability and generated metadata contracts are fail-closed", () => {
  const manifest = {
    toolIDs: ["read"],
    filesystemScopeIDs: ["workspace"],
    networkOriginIDs: [],
    modelRoutes: [{ providerID: "opencode", id: "gpt-5", variant: "default" }],
    childAgentTargets: ["reviewer"],
    artifactReferences: [{ kind: "skill", name: "reviewer" }],
    denies: [{ capability: "tool", resourceID: "write" }],
  }
  expect(decode(SelfImprovementLifecycle.CapabilityManifest, manifest)).toEqual(manifest)
  expect(() => decode(SelfImprovementLifecycle.CapabilityManifest, { ...manifest, credentials: ["x"] })).toThrow()
  const generated = {
    generationLeaseID: SelfImprovementLifecycle.GenerationLeaseID.create(),
    strategyPullID: SelfImprovementLifecycle.PullEventID.create(),
    originatingTaskIDDigest: "a".repeat(64),
    modelRequestDigest: "b".repeat(64),
    modelOutputDigest: "c".repeat(64),
    retentionDeadline: 1,
  }
  expect(decode(SelfImprovementLifecycle.GeneratedContentMetadata, generated)).toEqual(generated)
  expect(() => decode(SelfImprovementLifecycle.GeneratedContentMetadata, { ...generated, transcript: "raw" })).toThrow()
})
```

- [ ] **Step 2: Run the test to verify RED**

Run from `packages/schema`:

```bash
bun test test/self-improvement-lifecycle.test.ts
```

Expected when the reconciled path is absent: FAIL with `Cannot find module '../src/self-improvement-lifecycle'`. If the path already exists on `APPROVED_BASE_SHA`, preserve it, add the exact `GlossaryTerms` assertion from Step 1 as the first missing behavioral assertion, and verify that assertion fails before editing the module.

- [ ] **Step 3: Implement the minimal lifecycle contract module**

Use these exact closed sets and schema fields:

```ts
export * as SelfImprovementLifecycle from "./self-improvement-lifecycle"

import { Schema } from "effect"
import { ascending } from "./identifier"
import { Model } from "./model"
import { optional, statics } from "./schema"
import { SelfImprovement } from "./self-improvement"

const unique = <S extends Schema.Top>(schema: S) => Schema.Array(schema).check(Schema.isUnique())
const generatedID = <const Prefix extends string, const Brand extends string>(prefix: Prefix, brand: Brand) =>
  Schema.String.check(Schema.isStartsWith(prefix))
    .pipe(Schema.brand(brand))
    .annotate({ identifier: brand })
    .pipe(statics((schema) => ({ create: () => schema.make(prefix + ascending()) })))

export const LocationID = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/))
  .pipe(Schema.brand("SelfImprovementLifecycle.LocationID"))
  .annotate({ identifier: "SelfImprovementLifecycle.LocationID" })
export type LocationID = typeof LocationID.Type
export const PrincipalID = Schema.NonEmptyString.pipe(Schema.brand("SelfImprovementLifecycle.PrincipalID")).annotate({
  identifier: "SelfImprovementLifecycle.PrincipalID",
})
export type PrincipalID = typeof PrincipalID.Type
export const ArtifactID = generatedID("si_art_", "SelfImprovementLifecycle.ArtifactID")
export type ArtifactID = typeof ArtifactID.Type
export const ArtifactVersionID = generatedID("si_ver_", "SelfImprovementLifecycle.ArtifactVersionID")
export type ArtifactVersionID = typeof ArtifactVersionID.Type
export const StageTransitionID = generatedID("si_trn_", "SelfImprovementLifecycle.StageTransitionID")
export type StageTransitionID = typeof StageTransitionID.Type
export const ApprovalID = generatedID("si_app_", "SelfImprovementLifecycle.ApprovalID")
export type ApprovalID = typeof ApprovalID.Type
export const ApprovalRequestID = generatedID("si_apr_", "SelfImprovementLifecycle.ApprovalRequestID")
export type ApprovalRequestID = typeof ApprovalRequestID.Type
export const RollbackID = generatedID("si_rol_", "SelfImprovementLifecycle.RollbackID")
export type RollbackID = typeof RollbackID.Type
export const SuiteID = generatedID("si_sui_", "SelfImprovementLifecycle.SuiteID")
export type SuiteID = typeof SuiteID.Type
export const BaselineID = generatedID("si_bas_", "SelfImprovementLifecycle.BaselineID")
export type BaselineID = typeof BaselineID.Type
export const EvaluationRunID = generatedID("si_run_", "SelfImprovementLifecycle.EvaluationRunID")
export type EvaluationRunID = typeof EvaluationRunID.Type
export const MetricSampleID = generatedID("si_sam_", "SelfImprovementLifecycle.MetricSampleID")
export type MetricSampleID = typeof MetricSampleID.Type
export const GateFindingID = generatedID("si_gat_", "SelfImprovementLifecycle.GateFindingID")
export type GateFindingID = typeof GateFindingID.Type
export const ObservationID = generatedID("si_obs_", "SelfImprovementLifecycle.ObservationID")
export type ObservationID = typeof ObservationID.Type
export const GenerationLeaseID = generatedID("si_les_", "SelfImprovementLifecycle.GenerationLeaseID")
export type GenerationLeaseID = typeof GenerationLeaseID.Type
export const PullEventID = generatedID("si_pul_", "SelfImprovementLifecycle.PullEventID")
export type PullEventID = typeof PullEventID.Type
export const RewardEventID = generatedID("si_rew_", "SelfImprovementLifecycle.RewardEventID")
export type RewardEventID = typeof RewardEventID.Type
export const GenerationStrategyArmID = generatedID("si_gsa_", "SelfImprovementLifecycle.GenerationStrategyArmID")
export type GenerationStrategyArmID = typeof GenerationStrategyArmID.Type
export const ModelRouteArmID = generatedID("si_arm_", "SelfImprovementLifecycle.ModelRouteArmID")
export type ModelRouteArmID = typeof ModelRouteArmID.Type
export const RoutingDecisionID = generatedID("si_rte_", "SelfImprovementLifecycle.RoutingDecisionID")
export type RoutingDecisionID = typeof RoutingDecisionID.Type
export const ContextSelectionEvidenceID = generatedID("si_sel_", "SelfImprovementLifecycle.ContextSelectionEvidenceID")
export type ContextSelectionEvidenceID = typeof ContextSelectionEvidenceID.Type
export const ContextOutboxID = generatedID("si_obx_", "SelfImprovementLifecycle.ContextOutboxID")
export type ContextOutboxID = typeof ContextOutboxID.Type
export const AuditEntryID = generatedID("si_aud_", "SelfImprovementLifecycle.AuditEntryID")
export type AuditEntryID = typeof AuditEntryID.Type
export const IdempotencyRecordID = generatedID("si_idm_", "SelfImprovementLifecycle.IdempotencyRecordID")
export type IdempotencyRecordID = typeof IdempotencyRecordID.Type
export const Revision = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).pipe(
  Schema.brand("SelfImprovementLifecycle.Revision"),
).annotate({ identifier: "SelfImprovementLifecycle.Revision" })
export type Revision = typeof Revision.Type
export const TimestampMillis = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).pipe(
  Schema.brand("SelfImprovementLifecycle.TimestampMillis"),
).annotate({ identifier: "SelfImprovementLifecycle.TimestampMillis" })
export type TimestampMillis = typeof TimestampMillis.Type

export const GlossaryTerms = [
  "matching-observation",
  "eligible-arm",
  "positive-evidence",
  "improving-sample",
  "complete-audit-chain",
  "active-recommendation",
  "ephemeral",
  "baseline",
  "workload",
  "task",
  "success",
  "repeated-issue-fingerprint",
  "precision",
  "tombstone",
] as const
export const GlossaryTerm = Schema.Literals(GlossaryTerms).annotate({
  identifier: "SelfImprovementLifecycle.GlossaryTerm",
})
export type GlossaryTerm = typeof GlossaryTerm.Type
export const Glossary = {
  "matching-observation": "A trusted, redacted observation in the same Location whose HMAC identity has the same workload, error class, ordered tool/symbol digest, and outcome class within the rolling 30-day window",
  "eligible-arm": "An active allowlisted arm that passes all pre-selection policy, availability, capability, stage, and bucket checks",
  "positive-evidence": "Complete trusted evidence with all applicable gates passing and aggregate reward greater than zero",
  "improving-sample": "A valid candidate sample whose paired aggregate contribution improves at least one metric and violates no applicable non-regression or budget gate",
  "complete-audit-chain": "Admission/generation, evaluation, sample cutoff, approval when required, context outbox, transition, routing, reward, and terminal outcome records linked by immutable IDs and digests",
  "active-recommendation": "The highest-scoring eligible model-route arm activated after complete canary evidence; it is advisory and remains below explicit session/user and role routes",
  ephemeral: "An ad hoc version that auto-archives if not promoted by its retention deadline; it is never immediately deleted",
  baseline: "An immutable Location + workload + suite-revision control aggregate built from at least 20 unique trusted samples",
  workload: "A revisioned, allowlisted class that groups comparable tasks for baseline, suite, bucket, and routing decisions",
  task: "One immutable accepted runtime request bound to a Location, workload, suite revision, stage, version, and task ID digest",
  success: "A terminal accepted task outcome that passes the suite's required correctness condition",
  "repeated-issue-fingerprint": "A Location-keyed HMAC over the normalized issue class and affected stable identifiers, never raw content",
  precision: "Accepted relevant, non-extraneous assessed changes or claims divided by all assessed changes or claims",
  tombstone: "The terminal artifact operation that reserves its Location + kind + name, archives every version, removes rollout contributions, and forbids further normal mutation",
} as const satisfies Readonly<Record<GlossaryTerm, string>>

export const ArtifactSources = ["human", "generated"] as const
export const ArtifactSource = Schema.Literals(ArtifactSources).annotate({ identifier: "SelfImprovementLifecycle.ArtifactSource" })
export type ArtifactSource = typeof ArtifactSource.Type
export const BehaviorClasses = ["instruction-only", "executable", "behavior-changing"] as const
export const BehaviorClass = Schema.Literals(BehaviorClasses).annotate({ identifier: "SelfImprovementLifecycle.BehaviorClass" })
export type BehaviorClass = typeof BehaviorClass.Type
export const ArtifactStages = ["draft", "experimental", "candidate", "shadow", "canary", "active", "deprecated", "archived"] as const
export const ArtifactStage = Schema.Literals(ArtifactStages).annotate({ identifier: "SelfImprovementLifecycle.ArtifactStage" })
export type ArtifactStage = typeof ArtifactStage.Type
export const ArtifactStatus = Schema.Literals(["live", "tombstoned"]).annotate({ identifier: "SelfImprovementLifecycle.ArtifactStatus" })
export type ArtifactStatus = typeof ArtifactStatus.Type
export const PrincipalKinds = ["first-party-user", "location-approver", "runtime-evidence-service", "evaluator", "coordinator", "audit-reader"] as const
export const PrincipalKind = Schema.Literals(PrincipalKinds).annotate({ identifier: "SelfImprovementLifecycle.PrincipalKind" })
export type PrincipalKind = typeof PrincipalKind.Type
export const Operations = ["artifact.read", "artifact.create", "artifact.archive", "artifact.tombstone", "approval.decide", "evidence.ingest", "generation.execute", "evaluation.decide", "lifecycle.transition", "learning.update", "context.reconcile", "audit.read"] as const
export const Operation = Schema.Literals(Operations).annotate({ identifier: "SelfImprovementLifecycle.Operation" })
export type Operation = typeof Operation.Type
export const LifecycleEvents = ["version-admitted", "static-passed", "offline-passed", "shadow-started", "shadow-evidence-passed", "approval-consumed", "canary-passed", "canary-regressed", "retention-archive", "ephemeral-expired", "artifact-tombstoned", "version-archived"] as const
export const LifecycleEvent = Schema.Literals(LifecycleEvents).annotate({ identifier: "SelfImprovementLifecycle.LifecycleEvent" })
export type LifecycleEvent = typeof LifecycleEvent.Type
export const LifecycleReasons = ["admission-accepted", "gates-passed", "gates-failed", "approval-rejected", "approval-expired", "superseded", "canary-regression", "retention-expired", "ephemeral-expired", "user-archive", "policy-archive", "artifact-tombstoned"] as const
export const LifecycleReason = Schema.Literals(LifecycleReasons).annotate({ identifier: "SelfImprovementLifecycle.LifecycleReason" })
export type LifecycleReason = typeof LifecycleReason.Type

export class ArtifactKey extends Schema.Class<ArtifactKey>("SelfImprovementLifecycle.ArtifactKey")({
  locationID: LocationID,
  kind: SelfImprovement.ArtifactKind,
  name: SelfImprovement.CandidateName,
}) {}
export class TypedArtifactReference extends Schema.Class<TypedArtifactReference>("SelfImprovementLifecycle.TypedArtifactReference")({
  kind: SelfImprovement.ArtifactKind,
  name: SelfImprovement.CandidateName,
}) {}
export class Principal extends Schema.Class<Principal>("SelfImprovementLifecycle.Principal")({
  id: PrincipalID,
  kind: PrincipalKind,
  locationID: LocationID,
}) {}
export class CapabilityDeny extends Schema.Class<CapabilityDeny>("SelfImprovementLifecycle.CapabilityDeny")({
  capability: Schema.Literals(["tool", "filesystem", "network-origin", "model-route", "child-agent", "artifact-reference"]),
  resourceID: Schema.NonEmptyString,
}) {}
export class CapabilityManifest extends Schema.Class<CapabilityManifest>("SelfImprovementLifecycle.CapabilityManifest")({
  toolIDs: unique(Schema.NonEmptyString),
  filesystemScopeIDs: unique(Schema.NonEmptyString),
  networkOriginIDs: unique(Schema.NonEmptyString),
  modelRoutes: unique(Model.Ref),
  childAgentTargets: unique(SelfImprovement.CandidateName),
  artifactReferences: unique(TypedArtifactReference),
  denies: unique(CapabilityDeny),
}) {}
export class GeneratedContentMetadata extends Schema.Class<GeneratedContentMetadata>("SelfImprovementLifecycle.GeneratedContentMetadata")({
  generationLeaseID: GenerationLeaseID,
  strategyPullID: PullEventID,
  originatingTaskIDDigest: SelfImprovement.Digest,
  modelRequestDigest: SelfImprovement.Digest,
  modelOutputDigest: SelfImprovement.Digest,
  retentionDeadline: TimestampMillis,
}) {}
export class Artifact extends Schema.Class<Artifact>("SelfImprovementLifecycle.Artifact")({
  id: ArtifactID,
  key: ArtifactKey,
  status: ArtifactStatus,
  createdBy: PrincipalID,
  createdAt: TimestampMillis,
  revision: Revision,
  tombstone: Schema.suspend(() => Tombstone).pipe(optional),
}) {}
export class ArtifactVersion extends Schema.Class<ArtifactVersion>("SelfImprovementLifecycle.ArtifactVersion")({
  id: ArtifactVersionID,
  artifactID: ArtifactID,
  versionNumber: Schema.Int.check(Schema.isGreaterThan(0)),
  source: ArtifactSource,
  behaviorClass: BehaviorClass,
  proposal: SelfImprovement.CandidateProposal,
  canonicalJson: SelfImprovement.CanonicalJson,
  proposalDigest: SelfImprovement.Digest,
  inputSnapshotDigest: SelfImprovement.Digest,
  versionDigest: SelfImprovement.Digest,
  capabilityManifest: CapabilityManifest,
  capabilityManifestDigest: SelfImprovement.Digest,
  creatorID: PrincipalID,
  createdAt: TimestampMillis,
  generated: GeneratedContentMetadata.pipe(optional),
}) {}
export class StageTransition extends Schema.Class<StageTransition>("SelfImprovementLifecycle.StageTransition")({
  id: StageTransitionID,
  versionID: ArtifactVersionID,
  previousStage: Schema.Union([Schema.Null, ArtifactStage]),
  nextStage: ArtifactStage,
  event: LifecycleEvent,
  reason: LifecycleReason,
  actorID: PrincipalID,
  timestamp: TimestampMillis,
  evaluationRunID: EvaluationRunID.pipe(optional),
  approvalID: ApprovalID.pipe(optional),
  rollbackID: RollbackID.pipe(optional),
  contextOutboxID: ContextOutboxID.pipe(optional),
  idempotencyRecordID: IdempotencyRecordID,
  idempotencyDigest: SelfImprovement.Digest,
}) {}
export class ApprovalBinding extends Schema.Class<ApprovalBinding>("SelfImprovementLifecycle.ApprovalBinding")({
  versionID: ArtifactVersionID,
  versionDigest: SelfImprovement.Digest,
  suiteID: SuiteID,
  suiteRevision: Revision,
  evaluationRunID: EvaluationRunID,
  shadowEvidenceDigest: SelfImprovement.Digest,
}) {}
export const ApprovalRejectionReason = Schema.Literal("approval-rejected").annotate({
  identifier: "SelfImprovementLifecycle.ApprovalRejectionReason",
})
export type ApprovalRejectionReason = typeof ApprovalRejectionReason.Type
export class ApprovalRequest extends Schema.Class<ApprovalRequest>("SelfImprovementLifecycle.ApprovalRequest")({
  id: ApprovalRequestID,
  locationID: LocationID,
  binding: ApprovalBinding,
  creatorID: PrincipalID,
  requestedAt: TimestampMillis,
}) {}
export class ApprovalGranted extends Schema.TaggedClass<ApprovalGranted>("SelfImprovementLifecycle.ApprovalGranted")(
  "approved",
  {
    approverID: PrincipalID,
    decidedAt: TimestampMillis,
    expiresAt: TimestampMillis,
    consumedAt: TimestampMillis.pipe(optional),
  },
) {}
export class ApprovalRejected extends Schema.TaggedClass<ApprovalRejected>("SelfImprovementLifecycle.ApprovalRejected")(
  "rejected",
  {
    approverID: PrincipalID,
    decidedAt: TimestampMillis,
    reason: ApprovalRejectionReason,
  },
) {}
export const ApprovalDecision = Schema.Union([ApprovalGranted, ApprovalRejected])
  .pipe(Schema.toTaggedUnion("_tag"))
  .annotate({ identifier: "SelfImprovementLifecycle.ApprovalDecision" })
export type ApprovalDecision = typeof ApprovalDecision.Type
export class Approval extends Schema.Class<Approval>("SelfImprovementLifecycle.Approval")({
  id: ApprovalID,
  requestID: ApprovalRequestID,
  locationID: LocationID,
  binding: ApprovalBinding,
  decision: ApprovalDecision,
}) {}
export class Rollback extends Schema.Class<Rollback>("SelfImprovementLifecycle.Rollback")({
  id: RollbackID,
  locationID: LocationID,
  artifactID: ArtifactID,
  candidateVersionID: ArtifactVersionID,
  retainedActiveVersionID: ArtifactVersionID,
  canaryRunID: EvaluationRunID,
  reason: Schema.Literal("canary-regression"),
  rewardEventID: RewardEventID,
  timestamp: TimestampMillis,
}) {}
export class Tombstone extends Schema.Class<Tombstone>("SelfImprovementLifecycle.Tombstone")({
  actorID: PrincipalID,
  reason: Schema.NonEmptyString,
  timestamp: TimestampMillis,
}) {}
```

- [ ] **Step 4: Complete lifecycle contract assertions**

Add table-driven strict-decode tests for every closed set, every generated ID prefix/create method, lowercase 64-hex `LocationID` with no `create`, `GenerationStrategyArmID`, required fields, excess-property rejection, omitted optional fields, all six artifact kinds inside `ArtifactKey`, exact `ApprovalRequest` binding/creator/time fields, disjoint approval/rejection decision fields, `ArtifactVersion.versionDigest`, `ArtifactVersion` lacking `locationID`, `StageTransition.idempotencyRecordID`, `Tombstone` preserving the original key, and stable unique identifiers for every exported schema in the Interfaces block.

Use strict decoding for these checks:

```ts
test("lifecycle contracts reject unmodeled sensitive and stage-setter fields", () => {
  expect(() => decode(SelfImprovementLifecycle.ArtifactKey, {
    locationID: "a".repeat(64),
    kind: "skill",
    name: "repair-types",
    currentStage: "active",
  })).toThrow()
  expect(() => decode(SelfImprovementLifecycle.CapabilityManifest, {
    toolIDs: [],
    filesystemScopeIDs: [],
    networkOriginIDs: [],
    modelRoutes: [],
    childAgentTargets: [],
    artifactReferences: [],
    denies: [],
    providerSettings: {},
  })).toThrow()
  expect("create" in SelfImprovementLifecycle.LocationID).toBe(false)
  const approvalRequest = {
    id: SelfImprovementLifecycle.ApprovalRequestID.create(),
    locationID: "a".repeat(64),
    binding: {
      versionID: SelfImprovementLifecycle.ArtifactVersionID.create(),
      versionDigest: "b".repeat(64),
      suiteID: SelfImprovementLifecycle.SuiteID.create(),
      suiteRevision: 1,
      evaluationRunID: SelfImprovementLifecycle.EvaluationRunID.create(),
      shadowEvidenceDigest: "c".repeat(64),
    },
    creatorID: "creator-1",
    requestedAt: 1,
  }
  expect(decode(SelfImprovementLifecycle.ApprovalRequest, approvalRequest)).toEqual(approvalRequest)
  const rejected = {
    _tag: "rejected",
    approverID: "location-approver",
    decidedAt: 1,
    reason: "approval-rejected",
  }
  expect(decode(SelfImprovementLifecycle.ApprovalDecision, rejected)).toEqual(rejected)
  expect(() => decode(SelfImprovementLifecycle.ApprovalDecision, { ...rejected, expiresAt: 2 })).toThrow()
  const approved = { _tag: "approved", approverID: "location-approver", decidedAt: 1, expiresAt: 2 }
  expect(decode(SelfImprovementLifecycle.ApprovalDecision, approved)).toEqual(approved)
  expect(() => decode(SelfImprovementLifecycle.ApprovalDecision, { ...approved, reason: "approval-rejected" })).toThrow()
})
```

- [ ] **Step 5: Run focused GREEN checks**

Run from `packages/schema`:

```bash
bun test test/self-improvement-lifecycle.test.ts
bun typecheck
```

Expected: both commands exit 0; Bun reports all lifecycle tests passing and `bun typecheck` prints no TypeScript errors.

- [ ] **Step 6: Commit Task 1 only**

```bash
git add packages/schema/src/self-improvement-lifecycle.ts packages/schema/test/self-improvement-lifecycle.test.ts
git diff --cached --check
git commit -m "feat(schema): add self-improvement lifecycle contracts"
```

Expected: one commit containing exactly the two Task 1 files in the isolated worktree.

### Task 2: Evaluation, Suite, Baseline, Run, Sample, Gate, And Metric Contracts

**Files:**
- Create: `packages/schema/src/self-improvement-evaluation.ts:1-end`
- Test: `packages/schema/test/self-improvement-evaluation.test.ts:1-end`
- Read only: `docs/superpowers/specs/2026-07-17-smart-self-improvement-mvp-design.md:231-356`

**Interfaces:**
- Consumes: `SelfImprovement.Digest`, `SelfImprovement.JsonPointer`, and Task 1 `LocationID`, `PrincipalID`, `ArtifactID`, `ArtifactVersionID`, `ArtifactStage`, `ApprovalBinding`, `SuiteID`, `BaselineID`, `EvaluationRunID`, `MetricSampleID`, `GateFindingID`, `Revision`, and `TimestampMillis`.
- Produces: `Workload`, `RunState`, `TaskOutcome`, `GateIDs`, `GateID`, `GateOrder`, `RequiredGateSequence`, `GateResult`, `HigherIsBetterNonRegression`, `LowerIsBetterNonRegression`, `MaximumRatioThreshold`, `PositiveAggregateRewardThreshold`, `MetricThresholds`, `GateThresholdTightening`, `ArtifactGateOverride`, `TaskQualityMetric`, `CorrectnessMetric`, `RepeatFixRateMetric`, `PrecisionMetric`, `LatencyMetric`, `TokensPerSuccessMetric`, `CacheHitRatioMetric`, `MetricComponents`, `MetricTotals`, `MetricAggregates`, `SuiteRevision`, `Baseline`, `EvaluationRun`, `MetricSample`, `GateFinding`, and `EvaluationDecision`.

- [ ] **Step 1: Write the failing evaluation contract test**

```ts
import { expect, test } from "bun:test"
import { Schema } from "effect"
import { SelfImprovementEvaluation } from "../src/self-improvement-evaluation"
import { SelfImprovementLifecycle } from "../src/self-improvement-lifecycle"

const decode = <S extends Schema.Decoder<unknown>>(schema: S, input: unknown) =>
  Schema.decodeUnknownSync(schema, { errors: "all", onExcessProperty: "error" })(input)

test("pins all 23 gate IDs in stable order and three result values", () => {
  expect(SelfImprovementEvaluation.GateIDs).toEqual([
    "candidate-name-available",
    "common-references-resolve",
    "typed-references-resolve",
    "reference-cycle-absent",
    "model-references-resolve",
    "generated-governance-unchanged",
    "generated-content-safe",
    "capabilities-static-known",
    "capabilities-within-location-grant",
    "generated-capabilities-within-baseline",
    "adhoc-capabilities-within-task-envelope",
    "required-suite-passed",
    "baseline-compatible",
    "minimum-samples-present",
    "task-quality-non-regression",
    "correctness-non-regression",
    "repeat-fix-non-regression",
    "precision-non-regression",
    "latency-budget-met",
    "token-budget-met",
    "cache-hit-non-regression",
    "aggregate-reward-positive",
    "required-approval-present",
  ])
  for (const result of ["pass", "fail", "not-applicable"]) {
    expect(decode(SelfImprovementEvaluation.GateResult, result)).toBe(result)
  }
  expect(decode(SelfImprovementEvaluation.RequiredGateSequence, SelfImprovementEvaluation.GateIDs)).toEqual(
    SelfImprovementEvaluation.GateIDs,
  )
  expect(() =>
    decode(SelfImprovementEvaluation.RequiredGateSequence, SelfImprovementEvaluation.GateIDs.slice(1)),
  ).toThrow()
})

test("requires seven explicit sample metric components", () => {
  const metrics = {
    taskQuality: { earnedAllowlistedPoints: 8, possibleAllowlistedPoints: 10 },
    correctness: { passedRequiredChecks: 4, requiredChecks: 4 },
    repeatFixRate: { repeatedTasks: 0, completedTasks: 1 },
    precision: { acceptedRelevantItems: 3, assessedItems: 3 },
    latencyMs: 120,
    tokensPerSuccess: { inputTokens: 300, outputTokens: 200, successfulTasks: 1 },
    cacheHitRatio: { cacheReadTokens: 50, cacheEligibleTokens: 100 },
  }
  expect(decode(SelfImprovementEvaluation.MetricComponents, metrics)).toEqual(metrics)
  const missing = { ...metrics, correctness: undefined }
  expect(() => decode(SelfImprovementEvaluation.MetricComponents, missing)).toThrow()
})
```

- [ ] **Step 2: Run the test to verify RED**

Run from `packages/schema`:

```bash
bun test test/self-improvement-evaluation.test.ts
```

Expected when the reconciled path is absent: FAIL with `Cannot find module '../src/self-improvement-evaluation'`. If the path already exists on `APPROVED_BASE_SHA`, preserve it, add the exact `RequiredGateSequence` assertions from Step 1 as the first missing behavioral assertions, and verify the missing/reordered sequence case fails before editing the module.

- [ ] **Step 3: Implement the minimal evaluation contract module**

```ts
export * as SelfImprovementEvaluation from "./self-improvement-evaluation"

import { Schema } from "effect"
import { optional } from "./schema"
import { SelfImprovement } from "./self-improvement"
import { SelfImprovementLifecycle } from "./self-improvement-lifecycle"

const nonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
const nonNegativeFinite = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))
const unitRatio = Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 }))
const gateTighteningRatio = Schema.Finite.check(Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(1.1))
export const Workload = Schema.NonEmptyString.pipe(Schema.brand("SelfImprovementEvaluation.Workload")).annotate({ identifier: "SelfImprovementEvaluation.Workload" })
export type Workload = typeof Workload.Type
export const RunState = Schema.Literals(["open", "deciding", "decided", "cancelled"]).annotate({ identifier: "SelfImprovementEvaluation.RunState" })
export type RunState = typeof RunState.Type
export const TaskOutcome = Schema.Literals(["success", "failure"]).annotate({ identifier: "SelfImprovementEvaluation.TaskOutcome" })
export type TaskOutcome = typeof TaskOutcome.Type
export const GateIDs = [
  "candidate-name-available", "common-references-resolve", "typed-references-resolve", "reference-cycle-absent", "model-references-resolve", "generated-governance-unchanged", "generated-content-safe", "capabilities-static-known", "capabilities-within-location-grant", "generated-capabilities-within-baseline", "adhoc-capabilities-within-task-envelope", "required-suite-passed", "baseline-compatible", "minimum-samples-present", "task-quality-non-regression", "correctness-non-regression", "repeat-fix-non-regression", "precision-non-regression", "latency-budget-met", "token-budget-met", "cache-hit-non-regression", "aggregate-reward-positive", "required-approval-present",
] as const
export const GateID = Schema.Literals(GateIDs).annotate({ identifier: "SelfImprovementEvaluation.GateID" })
export type GateID = typeof GateID.Type
export const GateOrder = {
  "candidate-name-available": 1,
  "common-references-resolve": 2,
  "typed-references-resolve": 3,
  "reference-cycle-absent": 4,
  "model-references-resolve": 5,
  "generated-governance-unchanged": 6,
  "generated-content-safe": 7,
  "capabilities-static-known": 8,
  "capabilities-within-location-grant": 9,
  "generated-capabilities-within-baseline": 10,
  "adhoc-capabilities-within-task-envelope": 11,
  "required-suite-passed": 12,
  "baseline-compatible": 13,
  "minimum-samples-present": 14,
  "task-quality-non-regression": 15,
  "correctness-non-regression": 16,
  "repeat-fix-non-regression": 17,
  "precision-non-regression": 18,
  "latency-budget-met": 19,
  "token-budget-met": 20,
  "cache-hit-non-regression": 21,
  "aggregate-reward-positive": 22,
  "required-approval-present": 23,
} as const satisfies Readonly<Record<GateID, number>>
export const RequiredGateSequence = Schema.Array(GateID)
  .check(Schema.makeFilter((value) => value.length === GateIDs.length && value.every((gateID, index) => gateID === GateIDs[index])))
  .annotate({ identifier: "SelfImprovementEvaluation.RequiredGateSequence" })
export type RequiredGateSequence = typeof RequiredGateSequence.Type
export const GateResult = Schema.Literals(["pass", "fail", "not-applicable"]).annotate({ identifier: "SelfImprovementEvaluation.GateResult" })
export type GateResult = typeof GateResult.Type

export class HigherIsBetterNonRegression extends Schema.TaggedClass<HigherIsBetterNonRegression>("SelfImprovementEvaluation.HigherIsBetterNonRegression")("higher-is-better", { minimumDelta: Schema.Literal(0) }) {}
export class LowerIsBetterNonRegression extends Schema.TaggedClass<LowerIsBetterNonRegression>("SelfImprovementEvaluation.LowerIsBetterNonRegression")("lower-is-better", { maximumDelta: Schema.Literal(0) }) {}
export class MaximumRatioThreshold extends Schema.TaggedClass<MaximumRatioThreshold>("SelfImprovementEvaluation.MaximumRatioThreshold")("maximum-ratio", { maximumRatio: Schema.Literal(1.1) }) {}
export class PositiveAggregateRewardThreshold extends Schema.TaggedClass<PositiveAggregateRewardThreshold>("SelfImprovementEvaluation.PositiveAggregateRewardThreshold")("positive-aggregate-reward", { minimumExclusive: Schema.Literal(0) }) {}
export class MetricThresholds extends Schema.Class<MetricThresholds>("SelfImprovementEvaluation.MetricThresholds")({ taskQuality: HigherIsBetterNonRegression, correctness: HigherIsBetterNonRegression, repeatFixRate: LowerIsBetterNonRegression, precision: HigherIsBetterNonRegression, latency: MaximumRatioThreshold, tokensPerSuccess: MaximumRatioThreshold, cacheHitRatio: HigherIsBetterNonRegression, aggregateReward: PositiveAggregateRewardThreshold }) {}
const HigherIsBetterTightening = Schema.Struct({ type: Schema.Literal("higher-is-better"), minimumDelta: nonNegativeFinite })
const LowerIsBetterTightening = Schema.Struct({ type: Schema.Literal("lower-is-better"), maximumDelta: Schema.Finite.check(Schema.isLessThanOrEqualTo(0)) })
const MaximumRatioTightening = Schema.Struct({ type: Schema.Literal("maximum-ratio"), maximumRatio: gateTighteningRatio })
const PositiveRewardTightening = Schema.Struct({ type: Schema.Literal("positive-aggregate-reward"), minimumExclusive: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThan(1)) })
export const GateThresholdTightening = Schema.Union([HigherIsBetterTightening, LowerIsBetterTightening, MaximumRatioTightening, PositiveRewardTightening]).pipe(Schema.toTaggedUnion("type")).annotate({ identifier: "SelfImprovementEvaluation.GateThresholdTightening" })
export type GateThresholdTightening = typeof GateThresholdTightening.Type
export class ArtifactGateOverride extends Schema.Class<ArtifactGateOverride>("SelfImprovementEvaluation.ArtifactGateOverride")({ locationID: SelfImprovementLifecycle.LocationID, artifactID: SelfImprovementLifecycle.ArtifactID, suiteID: SelfImprovementLifecycle.SuiteID, suiteRevision: SelfImprovementLifecycle.Revision, gateID: GateID, applicability: Schema.Literal("required"), thresholdTightening: GateThresholdTightening.pipe(optional) }) {}

export interface TaskQualityMetric extends Schema.Schema.Type<typeof TaskQualityMetric> {}
export const TaskQualityMetric = Schema.Struct({ earnedAllowlistedPoints: nonNegativeInt, possibleAllowlistedPoints: nonNegativeInt }).check(Schema.makeFilter((value) => value.earnedAllowlistedPoints <= value.possibleAllowlistedPoints)).annotate({ identifier: "SelfImprovementEvaluation.TaskQualityMetric" })
export interface CorrectnessMetric extends Schema.Schema.Type<typeof CorrectnessMetric> {}
export const CorrectnessMetric = Schema.Struct({ passedRequiredChecks: nonNegativeInt, requiredChecks: nonNegativeInt }).check(Schema.makeFilter((value) => value.passedRequiredChecks <= value.requiredChecks)).annotate({ identifier: "SelfImprovementEvaluation.CorrectnessMetric" })
export interface RepeatFixRateMetric extends Schema.Schema.Type<typeof RepeatFixRateMetric> {}
export const RepeatFixRateMetric = Schema.Struct({ repeatedTasks: nonNegativeInt, completedTasks: nonNegativeInt }).check(Schema.makeFilter((value) => value.repeatedTasks <= value.completedTasks)).annotate({ identifier: "SelfImprovementEvaluation.RepeatFixRateMetric" })
export interface PrecisionMetric extends Schema.Schema.Type<typeof PrecisionMetric> {}
export const PrecisionMetric = Schema.Struct({ acceptedRelevantItems: nonNegativeInt, assessedItems: nonNegativeInt }).check(Schema.makeFilter((value) => value.acceptedRelevantItems <= value.assessedItems)).annotate({ identifier: "SelfImprovementEvaluation.PrecisionMetric" })
export const LatencyMetric = nonNegativeInt.annotate({ identifier: "SelfImprovementEvaluation.LatencyMetric" })
export type LatencyMetric = typeof LatencyMetric.Type
export class TokensPerSuccessMetric extends Schema.Class<TokensPerSuccessMetric>("SelfImprovementEvaluation.TokensPerSuccessMetric")({ inputTokens: nonNegativeInt, outputTokens: nonNegativeInt, successfulTasks: Schema.Literals([0, 1]) }) {}
export interface CacheHitRatioMetric extends Schema.Schema.Type<typeof CacheHitRatioMetric> {}
export const CacheHitRatioMetric = Schema.Struct({ cacheReadTokens: nonNegativeInt, cacheEligibleTokens: nonNegativeInt }).check(Schema.makeFilter((value) => value.cacheReadTokens <= value.cacheEligibleTokens)).annotate({ identifier: "SelfImprovementEvaluation.CacheHitRatioMetric" })
export class MetricComponents extends Schema.Class<MetricComponents>("SelfImprovementEvaluation.MetricComponents")({ taskQuality: TaskQualityMetric, correctness: CorrectnessMetric, repeatFixRate: RepeatFixRateMetric, precision: PrecisionMetric, latencyMs: LatencyMetric, tokensPerSuccess: TokensPerSuccessMetric, cacheHitRatio: CacheHitRatioMetric }) {}
export interface MetricTotals extends Schema.Schema.Type<typeof MetricTotals> {}
export const MetricTotals = Schema.Struct({ taskQualityEarnedAllowlistedPoints: nonNegativeInt, taskQualityPossibleAllowlistedPoints: nonNegativeInt, correctnessPassedRequiredChecks: nonNegativeInt, correctnessRequiredChecks: nonNegativeInt, repeatFixRepeatedTasks: nonNegativeInt, repeatFixCompletedTasks: nonNegativeInt, precisionAcceptedRelevantItems: nonNegativeInt, precisionAssessedItems: nonNegativeInt, acceptedLatencySampleCount: nonNegativeInt, latencySampleSetDigest: SelfImprovement.Digest, inputTokens: nonNegativeInt, outputTokens: nonNegativeInt, successfulTasks: nonNegativeInt, cacheReadTokens: nonNegativeInt, cacheEligibleTokens: nonNegativeInt }).check(Schema.makeFilter((value) => value.taskQualityEarnedAllowlistedPoints <= value.taskQualityPossibleAllowlistedPoints && value.correctnessPassedRequiredChecks <= value.correctnessRequiredChecks && value.repeatFixRepeatedTasks <= value.repeatFixCompletedTasks && value.precisionAcceptedRelevantItems <= value.precisionAssessedItems && value.cacheReadTokens <= value.cacheEligibleTokens)).annotate({ identifier: "SelfImprovementEvaluation.MetricTotals" })
export class MetricAggregates extends Schema.Class<MetricAggregates>("SelfImprovementEvaluation.MetricAggregates")({ taskQuality: unitRatio, correctness: unitRatio, repeatFixRate: unitRatio, precision: unitRatio, latencyP95Ms: nonNegativeFinite, tokensPerSuccess: nonNegativeFinite, cacheHitRatio: unitRatio }) {}
export class SuiteRevision extends Schema.Class<SuiteRevision>("SelfImprovementEvaluation.SuiteRevision")({ locationID: SelfImprovementLifecycle.LocationID, suiteID: SelfImprovementLifecycle.SuiteID, revision: SelfImprovementLifecycle.Revision, workload: Workload, workloadRevision: SelfImprovementLifecycle.Revision, artifactKinds: Schema.Array(SelfImprovement.ArtifactKind).check(Schema.isUnique()), orderedGates: RequiredGateSequence, thresholds: MetricThresholds, shadowMinimumSamples: Schema.Literal(10), canaryMinimumSamples: Schema.Literal(20), creatorID: SelfImprovementLifecycle.PrincipalID, createdAt: SelfImprovementLifecycle.TimestampMillis }) {}
export class Baseline extends Schema.Class<Baseline>("SelfImprovementEvaluation.Baseline")({ id: SelfImprovementLifecycle.BaselineID, locationID: SelfImprovementLifecycle.LocationID, workload: Workload, workloadRevision: SelfImprovementLifecycle.Revision, suiteID: SelfImprovementLifecycle.SuiteID, suiteRevision: SelfImprovementLifecycle.Revision, producerAllowlistRevision: SelfImprovementLifecycle.Revision, controlSource: Schema.NonEmptyString, acceptanceStart: SelfImprovementLifecycle.TimestampMillis, acceptanceEnd: SelfImprovementLifecycle.TimestampMillis, cutoffAt: SelfImprovementLifecycle.TimestampMillis, uniqueSampleCount: Schema.Int.check(Schema.isGreaterThanOrEqualTo(20)), orderedSampleIDDigest: SelfImprovement.Digest, metricTotals: MetricTotals, aggregates: MetricAggregates, createdAt: SelfImprovementLifecycle.TimestampMillis, evaluatorSignatureDigest: SelfImprovement.Digest, bootstrapAuthorityID: SelfImprovementLifecycle.PrincipalID }) {}
export class EvaluationRun extends Schema.Class<EvaluationRun>("SelfImprovementEvaluation.EvaluationRun")({ id: SelfImprovementLifecycle.EvaluationRunID, locationID: SelfImprovementLifecycle.LocationID, versionID: SelfImprovementLifecycle.ArtifactVersionID, stage: SelfImprovementLifecycle.ArtifactStage, workload: Workload, workloadRevision: SelfImprovementLifecycle.Revision, suiteID: SelfImprovementLifecycle.SuiteID, suiteRevision: SelfImprovementLifecycle.Revision, baselineID: SelfImprovementLifecycle.BaselineID, state: RunState, trustedProducerIDs: Schema.Array(SelfImprovementLifecycle.PrincipalID).check(Schema.isUnique()), acceptanceStart: SelfImprovementLifecycle.TimestampMillis, acceptanceEnd: SelfImprovementLifecycle.TimestampMillis, cutoffAt: SelfImprovementLifecycle.TimestampMillis, requestDigest: SelfImprovement.Digest, createdAt: SelfImprovementLifecycle.TimestampMillis, cutoffSampleSetDigest: SelfImprovement.Digest.pipe(optional), decidedAt: SelfImprovementLifecycle.TimestampMillis.pipe(optional) }) {}
export class MetricSample extends Schema.Class<MetricSample>("SelfImprovementEvaluation.MetricSample")({ id: SelfImprovementLifecycle.MetricSampleID, runID: SelfImprovementLifecycle.EvaluationRunID, sampleIDDigest: SelfImprovement.Digest, taskIDDigest: SelfImprovement.Digest, producerID: SelfImprovementLifecycle.PrincipalID, requestDigest: SelfImprovement.Digest, metrics: MetricComponents, outcome: TaskOutcome, startedAt: SelfImprovementLifecycle.TimestampMillis, terminalAt: SelfImprovementLifecycle.TimestampMillis }) {}
export interface GateFinding extends Schema.Schema.Type<typeof GateFinding> {}
export const GateFinding = Schema.Struct({ id: SelfImprovementLifecycle.GateFindingID, evaluationRunID: SelfImprovementLifecycle.EvaluationRunID, order: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 23 })), gateID: GateID, result: GateResult, code: Schema.NonEmptyString, pointer: SelfImprovement.JsonPointer.pipe(optional), expected: Schema.Finite.pipe(optional), actual: Schema.Finite.pipe(optional), evidenceDigest: SelfImprovement.Digest.pipe(optional) }).check(Schema.makeFilter((value) => value.order === GateOrder[value.gateID])).annotate({ identifier: "SelfImprovementEvaluation.GateFinding" })
export class EvaluationDecision extends Schema.Class<EvaluationDecision>("SelfImprovementEvaluation.EvaluationDecision")({ runID: SelfImprovementLifecycle.EvaluationRunID, cutoffSampleSetDigest: SelfImprovement.Digest, findings: Schema.Array(GateFinding), metricTotals: MetricTotals, aggregates: MetricAggregates, aggregateReward: Schema.Finite.check(Schema.isBetween({ minimum: -1, maximum: 1 })), decision: Schema.Literals(["passed", "failed"]), approvalBinding: SelfImprovementLifecycle.ApprovalBinding.pipe(optional), decidedAt: SelfImprovementLifecycle.TimestampMillis }) {}
```

- [ ] **Step 4: Add exact boundary tests**

Cover `SuiteRevision.locationID`, the exact 23-gate sequence with missing/duplicate/reordered rejection, immutable threshold literals `0/0/1.10/0`, tightening-only artifact overrides with `applicability: "required"`, `>=20` baseline samples, exact shadow/canary minima `10/20`, explicit Section 8 raw field names, valid zero-denominator cases such as `0/0`, impossible numerator rejection, all `MetricTotals` fields including `acceptedLatencySampleCount`, aggregate ratio bounds `[0,1]`, finite non-negative latency/tokens, all seven required fields, `EvaluationRun.createdAt`, exact `TaskOutcome` values `success|failure` with `cancelled` rejected, immutable binding fields, GateFinding order-to-ID binding, pass/fail/not-applicable, reward range `[-1,1]`, strict excess-property rejection, optional omission encoding, and stable unique identifiers.

Use a representative strict decode test:

```ts
test("metric components preserve valid zero denominators and reject excess content", () => {
  const zero = {
    taskQuality: { earnedAllowlistedPoints: 0, possibleAllowlistedPoints: 0 },
    correctness: { passedRequiredChecks: 0, requiredChecks: 0 },
    repeatFixRate: { repeatedTasks: 0, completedTasks: 0 },
    precision: { acceptedRelevantItems: 0, assessedItems: 0 },
    latencyMs: 0,
    tokensPerSuccess: { inputTokens: 0, outputTokens: 0, successfulTasks: 0 },
    cacheHitRatio: { cacheReadTokens: 0, cacheEligibleTokens: 0 },
  }
  expect(decode(SelfImprovementEvaluation.MetricComponents, zero)).toEqual(zero)
  expect(() => decode(SelfImprovementEvaluation.MetricComponents, { ...zero, transcript: "raw" })).toThrow()
  expect(() => decode(SelfImprovementEvaluation.TaskOutcome, "cancelled")).toThrow()
  expect(() => decode(SelfImprovementEvaluation.GateFinding, {
    id: SelfImprovementLifecycle.GateFindingID.create(),
    evaluationRunID: SelfImprovementLifecycle.EvaluationRunID.create(),
    order: 2,
    gateID: "candidate-name-available",
    result: "pass",
    code: "ok",
  })).toThrow()
})

test("suite revision is Location-owned and cannot drop required gates", () => {
  const higher = { _tag: "higher-is-better", minimumDelta: 0 }
  const suite = {
    locationID: "a".repeat(64),
    suiteID: SelfImprovementLifecycle.SuiteID.create(),
    revision: 1,
    workload: "typescript",
    workloadRevision: 1,
    artifactKinds: ["skill"],
    orderedGates: SelfImprovementEvaluation.GateIDs,
    thresholds: {
      taskQuality: higher,
      correctness: higher,
      repeatFixRate: { _tag: "lower-is-better", maximumDelta: 0 },
      precision: higher,
      latency: { _tag: "maximum-ratio", maximumRatio: 1.1 },
      tokensPerSuccess: { _tag: "maximum-ratio", maximumRatio: 1.1 },
      cacheHitRatio: higher,
      aggregateReward: { _tag: "positive-aggregate-reward", minimumExclusive: 0 },
    },
    shadowMinimumSamples: 10,
    canaryMinimumSamples: 20,
    creatorID: "evaluator",
    createdAt: 1,
  }
  expect(decode(SelfImprovementEvaluation.SuiteRevision, suite)).toEqual(suite)
  expect(() => decode(SelfImprovementEvaluation.SuiteRevision, { ...suite, locationID: undefined })).toThrow()
  expect(() => decode(SelfImprovementEvaluation.SuiteRevision, { ...suite, orderedGates: suite.orderedGates.slice(1) })).toThrow()
})
```

- [ ] **Step 5: Run focused GREEN checks**

Run from `packages/schema`:

```bash
bun test test/self-improvement-evaluation.test.ts
bun typecheck
```

Expected: both commands exit 0; Bun reports all evaluation tests passing and typecheck prints no errors.

- [ ] **Step 6: Commit Task 2 only**

```bash
git add packages/schema/src/self-improvement-evaluation.ts packages/schema/test/self-improvement-evaluation.test.ts
git diff --cached --check
git commit -m "feat(schema): add self-improvement evaluation contracts"
```

Expected: one commit containing exactly the two Task 2 files.

### Task 3: Learning, Observation, Reward, Routing, Context, Audit, And Retention Contracts

**Files:**
- Create: `packages/schema/src/self-improvement-learning.ts:1-end`
- Test: `packages/schema/test/self-improvement-learning.test.ts:1-end`
- Read only: `docs/superpowers/specs/2026-07-17-smart-self-improvement-mvp-design.md:405-504,541-565`

**Interfaces:**
- Consumes: `SelfImprovement.Digest`, live `Model.Ref`, Task 1 identity/stage/revision/time/entity IDs, and Task 2 `Workload`, `GateFinding`, and decision contracts.
- Produces: `IdempotencyKey`, `ActionDomain`, `ObservationOutcomeClass`, `GenerationOutcome`, `RewardOutcomeClass`, `RoutingPrecedence`, `RoutingPrecedenceSource`, `ContextOutboxStatus`, `ContextCohortResult`, `Observation`, `GenerationLease`, `GenerationStrategyArm`, `ModelRouteArm`, `BanditArmID`, `PullEvent`, `RewardEvent`, `BanditState`, `RoutingDecision`, `ContextDesiredTarget`, `ContextDesiredState`, `PendingTransitionIntent`, `ContextOutbox`, `ContextSelectionEvidence`, `AuditPayload`, `AuditEntry`, `IdempotencyIdentity`, `ObservationRetention`, `EvidenceRetention`, `GovernedMetadataRetention`, and `RetentionMetadata`.

- [ ] **Step 1: Write the failing learning contract test**

```ts
import { expect, test } from "bun:test"
import { Schema } from "effect"
import { SelfImprovementLearning } from "../src/self-improvement-learning"
import { SelfImprovementLifecycle } from "../src/self-improvement-lifecycle"

const decode = <S extends Schema.Decoder<unknown>>(schema: S, input: unknown) =>
  Schema.decodeUnknownSync(schema, { errors: "all", onExcessProperty: "error" })(input)

const observationInput = {
  id: "si_obs_00000000000000000000000000",
  locationID: "e".repeat(64),
  patternDigest: "a".repeat(64),
  identityDigest: "b".repeat(64),
  workload: "typescript",
  workloadRevision: 1,
  errorClass: "type-error",
  orderedToolSymbolDigest: "c".repeat(64),
  outcomeClass: "failure",
  taskIDDigest: "d".repeat(64),
  producerID: "runtime-evidence",
  occurredAt: 1,
  expiresAt: 2,
}

test("pins routing precedence below explicit session and role routes", () => {
  expect(SelfImprovementLearning.RoutingPrecedence).toEqual([
    "session-user",
    "role",
    "active-recommendation",
    "catalog-default",
    "catalog-fallback",
  ])
})

test("observation accepts only redacted stable identifiers and digests", () => {
  expect(decode(SelfImprovementLearning.Observation, observationInput)).toEqual(observationInput)
  expect(() => decode(SelfImprovementLearning.Observation, { ...observationInput, transcript: "raw" })).toThrow()
})
```

- [ ] **Step 2: Run the test to verify RED**

Run from `packages/schema`:

```bash
bun test test/self-improvement-learning.test.ts
```

Expected when the reconciled path is absent: FAIL with `Cannot find module '../src/self-improvement-learning'`. If the path already exists on `APPROVED_BASE_SHA`, preserve it, add the exact `RoutingPrecedence` assertion from Step 1 as the first missing behavioral assertion, and verify it fails before editing the module.

- [ ] **Step 3: Implement the minimal learning contract module**

```ts
export * as SelfImprovementLearning from "./self-improvement-learning"

import { Schema } from "effect"
import { Model } from "./model"
import { optional } from "./schema"
import { SelfImprovement } from "./self-improvement"
import { SelfImprovementEvaluation } from "./self-improvement-evaluation"
import { SelfImprovementLifecycle } from "./self-improvement-lifecycle"

export const IdempotencyKey = Schema.NonEmptyString.pipe(Schema.brand("SelfImprovementLearning.IdempotencyKey")).annotate({ identifier: "SelfImprovementLearning.IdempotencyKey" })
export type IdempotencyKey = typeof IdempotencyKey.Type
export const ActionDomain = Schema.Literals(["generation-strategy", "model-route"]).annotate({ identifier: "SelfImprovementLearning.ActionDomain" })
export type ActionDomain = typeof ActionDomain.Type
export const ObservationOutcomeClass = Schema.Literals(["success", "failure", "cancelled"]).annotate({ identifier: "SelfImprovementLearning.ObservationOutcomeClass" })
export type ObservationOutcomeClass = typeof ObservationOutcomeClass.Type
export const GenerationOutcome = Schema.Literals(["pending", "model-failed", "output-rejected", "hard-rejected", "admitted"]).annotate({ identifier: "SelfImprovementLearning.GenerationOutcome" })
export type GenerationOutcome = typeof GenerationOutcome.Type
export const RewardOutcomeClass = Schema.Literals(["no-reward-model-failure", "invalid-model-output", "no-reward-hard-rejection", "no-reward-insufficient-evidence", "shadow-failure", "canary-regression", "no-reward-approval", "passing-evidence"]).annotate({ identifier: "SelfImprovementLearning.RewardOutcomeClass" })
export type RewardOutcomeClass = typeof RewardOutcomeClass.Type
export const RoutingPrecedence = ["session-user", "role", "active-recommendation", "catalog-default", "catalog-fallback"] as const
export const RoutingPrecedenceSource = Schema.Literals(RoutingPrecedence).annotate({ identifier: "SelfImprovementLearning.RoutingPrecedenceSource" })
export type RoutingPrecedenceSource = typeof RoutingPrecedenceSource.Type
export const ContextOutboxStatus = Schema.Literals(["pending", "applying", "applied", "superseded", "blocked"]).annotate({ identifier: "SelfImprovementLearning.ContextOutboxStatus" })
export type ContextOutboxStatus = typeof ContextOutboxStatus.Type
export const ContextCohortResult = Schema.Literals(["shadow-isolated", "canary-in", "canary-out", "active"]).annotate({ identifier: "SelfImprovementLearning.ContextCohortResult" })
export type ContextCohortResult = typeof ContextCohortResult.Type

export class Observation extends Schema.Class<Observation>("SelfImprovementLearning.Observation")({ id: SelfImprovementLifecycle.ObservationID, locationID: SelfImprovementLifecycle.LocationID, patternDigest: SelfImprovement.Digest, identityDigest: SelfImprovement.Digest, workload: SelfImprovementEvaluation.Workload, workloadRevision: SelfImprovementLifecycle.Revision, errorClass: Schema.NonEmptyString, orderedToolSymbolDigest: SelfImprovement.Digest, outcomeClass: ObservationOutcomeClass, taskIDDigest: SelfImprovement.Digest, producerID: SelfImprovementLifecycle.PrincipalID, occurredAt: SelfImprovementLifecycle.TimestampMillis, expiresAt: SelfImprovementLifecycle.TimestampMillis }) {}
export class GenerationLease extends Schema.Class<GenerationLease>("SelfImprovementLearning.GenerationLease")({ id: SelfImprovementLifecycle.GenerationLeaseID, locationID: SelfImprovementLifecycle.LocationID, patternDigest: SelfImprovement.Digest, ownerID: SelfImprovementLifecycle.PrincipalID, leaseTokenDigest: SelfImprovement.Digest, attemptNumber: Schema.Int.check(Schema.isGreaterThan(0)), acquiredAt: SelfImprovementLifecycle.TimestampMillis, expiresAt: SelfImprovementLifecycle.TimestampMillis, completedAt: SelfImprovementLifecycle.TimestampMillis.pipe(optional), modelRequestDigest: SelfImprovement.Digest, modelOutputDigest: SelfImprovement.Digest.pipe(optional), outcome: GenerationOutcome }) {}
export class GenerationStrategyArm extends Schema.Class<GenerationStrategyArm>("SelfImprovementLearning.GenerationStrategyArm")({ id: SelfImprovementLifecycle.GenerationStrategyArmID, locationID: SelfImprovementLifecycle.LocationID, strategyID: Schema.NonEmptyString, allowlistRevision: SelfImprovementLifecycle.Revision, active: Schema.Boolean }) {}
export class ModelRouteArm extends Schema.Class<ModelRouteArm>("SelfImprovementLearning.ModelRouteArm")({ id: SelfImprovementLifecycle.ModelRouteArmID, locationID: SelfImprovementLifecycle.LocationID, route: Model.Ref, allowlistRevision: SelfImprovementLifecycle.Revision, active: Schema.Boolean }) {}
export const BanditArmID = Schema.Union([SelfImprovementLifecycle.GenerationStrategyArmID, SelfImprovementLifecycle.ModelRouteArmID]).annotate({ identifier: "SelfImprovementLearning.BanditArmID" })
export type BanditArmID = typeof BanditArmID.Type
const armMatchesDomain = (actionDomain: ActionDomain, armID: BanditArmID) =>
  actionDomain === "generation-strategy" ? armID.startsWith("si_gsa_") : armID.startsWith("si_arm_")
export interface PullEvent extends Schema.Schema.Type<typeof PullEvent> {}
export const PullEvent = Schema.Struct({ id: SelfImprovementLifecycle.PullEventID, locationID: SelfImprovementLifecycle.LocationID, actionDomain: ActionDomain, bucketDigest: SelfImprovement.Digest, derivationRevision: SelfImprovementLifecycle.Revision, allowlistRevision: SelfImprovementLifecycle.Revision, orderedEligibleArmIDs: Schema.Array(BanditArmID).check(Schema.isUnique()), selectedArmID: BanditArmID, proposalDigest: SelfImprovement.Digest.pipe(optional), sessionDigest: SelfImprovement.Digest.pipe(optional), versionID: SelfImprovementLifecycle.ArtifactVersionID.pipe(optional), timestamp: SelfImprovementLifecycle.TimestampMillis }).check(Schema.makeFilter((value) => value.orderedEligibleArmIDs.includes(value.selectedArmID) && value.orderedEligibleArmIDs.every((armID) => armMatchesDomain(value.actionDomain, armID)))).annotate({ identifier: "SelfImprovementLearning.PullEvent" })
export class RewardEvent extends Schema.Class<RewardEvent>("SelfImprovementLearning.RewardEvent")({ id: SelfImprovementLifecycle.RewardEventID, locationID: SelfImprovementLifecycle.LocationID, pullEventID: SelfImprovementLifecycle.PullEventID, outcomeClass: RewardOutcomeClass, numericReward: Schema.Finite.check(Schema.isBetween({ minimum: -1, maximum: 1 })).pipe(optional), evidenceDigest: SelfImprovement.Digest, timestamp: SelfImprovementLifecycle.TimestampMillis }) {}
export interface BanditState extends Schema.Schema.Type<typeof BanditState> {}
export const BanditState = Schema.Struct({ locationID: SelfImprovementLifecycle.LocationID, actionDomain: ActionDomain, bucketDigest: SelfImprovement.Digest, derivationRevision: SelfImprovementLifecycle.Revision, allowlistRevision: SelfImprovementLifecycle.Revision, armID: BanditArmID, pullTotal: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)), rewardedPullTotal: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)), cumulativeReward: Schema.Finite, meanReward: Schema.Finite, active: Schema.Boolean, latestPullEventID: SelfImprovementLifecycle.PullEventID.pipe(optional), latestRewardEventID: SelfImprovementLifecycle.RewardEventID.pipe(optional) }).check(Schema.makeFilter((value) => armMatchesDomain(value.actionDomain, value.armID))).annotate({ identifier: "SelfImprovementLearning.BanditState" })
export class RoutingDecision extends Schema.Class<RoutingDecision>("SelfImprovementLearning.RoutingDecision")({ id: SelfImprovementLifecycle.RoutingDecisionID, locationID: SelfImprovementLifecycle.LocationID, sessionDigest: SelfImprovement.Digest, workload: SelfImprovementEvaluation.Workload, workloadRevision: SelfImprovementLifecycle.Revision, roleDigest: SelfImprovement.Digest, precedenceSource: RoutingPrecedenceSource, policySnapshotDigest: SelfImprovement.Digest, catalogSnapshotDigest: SelfImprovement.Digest, variantSnapshotDigest: SelfImprovement.Digest, orderedEligibleArms: Schema.Array(ModelRouteArm), selectedRoute: Model.Ref, reasonCode: Schema.NonEmptyString, pullEventID: SelfImprovementLifecycle.PullEventID.pipe(optional), timestamp: SelfImprovementLifecycle.TimestampMillis }) {}
const DesiredPresent = Schema.Struct({ state: Schema.Literal("present"), versionID: SelfImprovementLifecycle.ArtifactVersionID, versionDigest: SelfImprovement.Digest, stage: SelfImprovementLifecycle.ArtifactStage })
const DesiredAbsent = Schema.Struct({ state: Schema.Literal("absent") })
export const ContextDesiredTarget = Schema.Union([DesiredPresent, DesiredAbsent]).pipe(Schema.toTaggedUnion("state")).annotate({ identifier: "SelfImprovementLearning.ContextDesiredTarget" })
export type ContextDesiredTarget = typeof ContextDesiredTarget.Type
export class ContextDesiredState extends Schema.Class<ContextDesiredState>("SelfImprovementLearning.ContextDesiredState")({ locationID: SelfImprovementLifecycle.LocationID, artifactID: SelfImprovementLifecycle.ArtifactID, rolloutSlot: Schema.Literals(["shadow", "canary", "active"]), desired: ContextDesiredTarget, desiredRevision: SelfImprovementLifecycle.Revision }) {}
export class PendingTransitionIntent extends Schema.Class<PendingTransitionIntent>("SelfImprovementLearning.PendingTransitionIntent")({ versionID: SelfImprovementLifecycle.ArtifactVersionID, previousStage: SelfImprovementLifecycle.ArtifactStage, nextStage: SelfImprovementLifecycle.ArtifactStage, event: SelfImprovementLifecycle.LifecycleEvent, reason: SelfImprovementLifecycle.LifecycleReason, actorID: SelfImprovementLifecycle.PrincipalID, evaluationRunID: SelfImprovementLifecycle.EvaluationRunID.pipe(optional), approvalID: SelfImprovementLifecycle.ApprovalID.pipe(optional), rollbackID: SelfImprovementLifecycle.RollbackID.pipe(optional), idempotencyRecordID: SelfImprovementLifecycle.IdempotencyRecordID, idempotencyDigest: SelfImprovement.Digest }) {}
export class ContextOutbox extends Schema.Class<ContextOutbox>("SelfImprovementLearning.ContextOutbox")({ id: SelfImprovementLifecycle.ContextOutboxID, locationID: SelfImprovementLifecycle.LocationID, artifactID: SelfImprovementLifecycle.ArtifactID, expectedArtifactRevision: SelfImprovementLifecycle.Revision, expectedStage: SelfImprovementLifecycle.ArtifactStage, desiredStateRevision: SelfImprovementLifecycle.Revision, intent: PendingTransitionIntent, status: ContextOutboxStatus, attempts: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)), nextRetryAt: SelfImprovementLifecycle.TimestampMillis, casResultDigest: SelfImprovement.Digest.pipe(optional), createdAt: SelfImprovementLifecycle.TimestampMillis }) {}
export class ContextSelectionEvidence extends Schema.Class<ContextSelectionEvidence>("SelfImprovementLearning.ContextSelectionEvidence")({ id: SelfImprovementLifecycle.ContextSelectionEvidenceID, artifactID: SelfImprovementLifecycle.ArtifactID, versionID: SelfImprovementLifecycle.ArtifactVersionID, versionDigest: SelfImprovement.Digest, locationID: SelfImprovementLifecycle.LocationID, stage: SelfImprovementLifecycle.ArtifactStage, contextEpoch: SelfImprovementLifecycle.Revision, sessionDigest: SelfImprovement.Digest, cohortResult: ContextCohortResult, outboxID: SelfImprovementLifecycle.ContextOutboxID }) {}
export class AuditPayload extends Schema.Class<AuditPayload>("SelfImprovementLearning.AuditPayload")({ artifactID: SelfImprovementLifecycle.ArtifactID.pipe(optional), versionID: SelfImprovementLifecycle.ArtifactVersionID.pipe(optional), evaluationRunID: SelfImprovementLifecycle.EvaluationRunID.pipe(optional), pullEventID: SelfImprovementLifecycle.PullEventID.pipe(optional), rewardEventID: SelfImprovementLifecycle.RewardEventID.pipe(optional), contextOutboxID: SelfImprovementLifecycle.ContextOutboxID.pipe(optional), linkedDigests: Schema.Array(SelfImprovement.Digest).check(Schema.isUnique()), rejectedFieldNames: Schema.Array(Schema.NonEmptyString).check(Schema.isUnique()) }) {}
export class ObservationRetention extends Schema.TaggedClass<ObservationRetention>("SelfImprovementLearning.ObservationRetention")("observation-30d", { createdAt: SelfImprovementLifecycle.TimestampMillis, expiresAt: SelfImprovementLifecycle.TimestampMillis }) {}
export class EvidenceRetention extends Schema.TaggedClass<EvidenceRetention>("SelfImprovementLearning.EvidenceRetention")("evidence-180d", { createdAt: SelfImprovementLifecycle.TimestampMillis, expiresAt: SelfImprovementLifecycle.TimestampMillis }) {}
export class GovernedMetadataRetention extends Schema.TaggedClass<GovernedMetadataRetention>("SelfImprovementLearning.GovernedMetadataRetention")("governed-metadata", { createdAt: SelfImprovementLifecycle.TimestampMillis }) {}
export const RetentionMetadata = Schema.Union([ObservationRetention, EvidenceRetention, GovernedMetadataRetention])
  .pipe(Schema.toTaggedUnion("_tag"))
  .check(Schema.makeFilter((value) => value._tag === "governed-metadata" || value.expiresAt === value.createdAt + (value._tag === "observation-30d" ? 30 : 180) * 86_400_000))
  .annotate({ identifier: "SelfImprovementLearning.RetentionMetadata" })
export type RetentionMetadata = typeof RetentionMetadata.Type
export class AuditEntry extends Schema.Class<AuditEntry>("SelfImprovementLearning.AuditEntry")({ id: SelfImprovementLifecycle.AuditEntryID, locationID: SelfImprovementLifecycle.LocationID, eventType: Schema.NonEmptyString, actorID: SelfImprovementLifecycle.PrincipalID, payload: AuditPayload, timestamp: SelfImprovementLifecycle.TimestampMillis, retention: RetentionMetadata }) {}
export class IdempotencyIdentity extends Schema.Class<IdempotencyIdentity>("SelfImprovementLearning.IdempotencyIdentity")({ principalID: SelfImprovementLifecycle.PrincipalID, locationID: SelfImprovementLifecycle.LocationID, operation: SelfImprovementLifecycle.Operation, key: IdempotencyKey }) {}
```

- [ ] **Step 4: Add exact contract assertions**

Cover one active lease identity per Location/pattern shape, attempt number `>0`, immutable request/output digests, all reward outcome values, numeric reward `[-1,1]`, Location-owned generation-strategy and model-route arms, `BanditArmID`, domain/arm-prefix matching, selected-arm membership in the unique ordered eligible list, preserved `BanditState.derivationRevision`, route identities using live `Model.Ref`, exact precedence order, Location on every event/decision/context/audit identity, every Section 6.4 selection field, exact outbox statuses, present/absent desired-state decoding, every `PendingTransitionIntent` field required to append the exact transition after CAS, idempotency identity tuple, tagged retention expiry rules, strict excess-property rejection, optional omission, and stable unique identifiers.

Use representative strict decode checks:

```ts
test("desired context and retention unions reject partial states", () => {
  expect(() => decode(SelfImprovementLearning.ContextDesiredTarget, {
    state: "present",
    versionID: SelfImprovementLifecycle.ArtifactVersionID.create(),
  })).toThrow()
  expect(() => decode(SelfImprovementLearning.RetentionMetadata, {
    _tag: "observation-30d",
    createdAt: 1,
  })).toThrow()
  expect(() => decode(SelfImprovementLearning.RetentionMetadata, {
    _tag: "evidence-180d",
    createdAt: 1,
    expiresAt: 1 + 179 * 86_400_000,
  })).toThrow()
  expect(() => decode(SelfImprovementLearning.Observation, {
    ...observationInput,
    providerSettings: {},
  })).toThrow()
  const routeArmID = SelfImprovementLifecycle.ModelRouteArmID.create()
  expect(() => decode(SelfImprovementLearning.PullEvent, {
    id: SelfImprovementLifecycle.PullEventID.create(),
    locationID: "e".repeat(64),
    actionDomain: "generation-strategy",
    bucketDigest: "a".repeat(64),
    derivationRevision: 1,
    allowlistRevision: 1,
    orderedEligibleArmIDs: [routeArmID],
    selectedArmID: routeArmID,
    timestamp: 1,
  })).toThrow()
  const routeArm = {
    id: SelfImprovementLifecycle.ModelRouteArmID.create(),
    locationID: "e".repeat(64),
    route: { providerID: "opencode", id: "gpt-5", variant: "default" },
    allowlistRevision: 1,
    active: true,
  }
  expect(decode(SelfImprovementLearning.ModelRouteArm, routeArm)).toEqual(routeArm)
  expect(() => decode(SelfImprovementLearning.ModelRouteArm, { ...routeArm, locationID: undefined })).toThrow()
  const intent = {
    versionID: SelfImprovementLifecycle.ArtifactVersionID.create(),
    previousStage: "shadow",
    nextStage: "canary",
    event: "approval-consumed",
    reason: "gates-passed",
    actorID: "coordinator",
    evaluationRunID: SelfImprovementLifecycle.EvaluationRunID.create(),
    approvalID: SelfImprovementLifecycle.ApprovalID.create(),
    idempotencyRecordID: SelfImprovementLifecycle.IdempotencyRecordID.create(),
    idempotencyDigest: "f".repeat(64),
  }
  expect(decode(SelfImprovementLearning.PendingTransitionIntent, intent)).toEqual(intent)
  expect(() => decode(SelfImprovementLearning.PendingTransitionIntent, { ...intent, actorID: undefined })).toThrow()
})
```

- [ ] **Step 5: Run focused GREEN checks**

Run from `packages/schema`:

```bash
bun test test/self-improvement-learning.test.ts
bun typecheck
```

Expected: both commands exit 0; Bun reports all learning tests passing and typecheck prints no errors.

- [ ] **Step 6: Commit Task 3 only**

```bash
git add packages/schema/src/self-improvement-learning.ts packages/schema/test/self-improvement-learning.test.ts
git diff --cached --check
git commit -m "feat(schema): add self-improvement learning contracts"
```

Expected: one commit containing exactly the two Task 3 files.

### Task 4: Exact Private API Request, Response, Error, Page, And Operation Contracts

**Files:**
- Create: `packages/schema/src/self-improvement-api.ts:1-end`
- Test: `packages/schema/test/self-improvement-api.test.ts:1-end`
- Read only: `docs/superpowers/specs/2026-07-17-smart-self-improvement-mvp-design.md:506-539`

**Interfaces:**
- Consumes: existing Slice 1A `ProposalAccepted`/`ProposalRejected`, all Task 1 lifecycle schemas, Task 2 suite/baseline/run/sample/finding/decision schemas, and Task 3 observation/routing/context/audit/idempotency identity schemas.
- Produces common contracts: `PageLimit`, `Cursor`, `PageRequest`, `IfMatchRevision`, `LocationHeaders`, `MutationHeaders`, `ArtifactMutationHeaders`, `ApiErrorCode`, `ApiErrorDetails`, `ApiError`, `ApiErrorContract`, `ApiErrors`, `ApiSideEffect`, `ResponseOrder`, `CompletedCommandResult`, `ReconciliationPendingCommandResult`, `CommandResult`, `ArtifactRolloutProjection`, `MetricRunView`, `EvaluationView`, `ContextEvidenceView`, `StoredResponse`, `IdempotencyRecord`, `LocationSource`, `ConditionalAuthorizationRule`, `PrivateApiOperation`, and `PrivateApiOperations`.
- Produces operation schemas: `ListArtifactsRequest/Response`, `CreateArtifactRequest/Response`, `GetArtifactRequest/Response`, `ListVersionsRequest/Response`, `CreateVersionRequest/Response`, `GetVersionRequest/Response`, `ArchiveVersionRequest/Response`, `TombstoneArtifactRequest/Response`, `ApproveRequest/Response`, `RejectRequest/Response`, `CreateObservationRequest/Response`, `CreateMetricRunRequest/Response`, `AddMetricSampleRequest/Response`, `DecideMetricRunRequest/Response`, `ListBaselinesRequest/Response`, `ListMetricRunsRequest/Response`, `ListEvaluationsRequest/Response`, `ListTransitionsRequest/Response`, `ListApprovalsRequest/Response`, `ListContextEvidenceRequest/Response`, `ListRoutingDecisionsRequest/Response`, and `ListAuditRequest/Response`.
- `PrivateApiOperations` has exactly 22 entries and only `/private/self-improvement` paths from Section 15.

- [ ] **Step 1: Write the failing API contract test**

```ts
import { expect, test } from "bun:test"
import { Schema } from "effect"
import { SelfImprovementApi } from "../src/self-improvement-api"
import { SelfImprovementLifecycle } from "../src/self-improvement-lifecycle"

const decode = <S extends Schema.Decoder<unknown>>(schema: S, input: unknown) =>
  Schema.decodeUnknownSync(schema, { errors: "all", onExcessProperty: "error" })(input)

test("defines exactly the 22 app-private operations", () => {
  expect(Object.values(SelfImprovementApi.PrivateApiOperations).map(({ method, path }) => `${method} ${path}`)).toEqual([
    "GET /private/self-improvement/artifacts",
    "POST /private/self-improvement/artifacts",
    "GET /private/self-improvement/artifacts/{artifactID}",
    "GET /private/self-improvement/artifacts/{artifactID}/versions",
    "POST /private/self-improvement/artifacts/{artifactID}/versions",
    "GET /private/self-improvement/artifacts/{artifactID}/versions/{versionID}",
    "POST /private/self-improvement/artifacts/{artifactID}/versions/{versionID}/archive",
    "POST /private/self-improvement/artifacts/{artifactID}/tombstone",
    "POST /private/self-improvement/approvals/{approvalRequestID}/approve",
    "POST /private/self-improvement/approvals/{approvalRequestID}/reject",
    "POST /private/self-improvement/observations",
    "POST /private/self-improvement/metric-runs",
    "POST /private/self-improvement/metric-runs/{runID}/samples",
    "POST /private/self-improvement/metric-runs/{runID}/decisions",
    "GET /private/self-improvement/baselines",
    "GET /private/self-improvement/metric-runs",
    "GET /private/self-improvement/evaluations",
    "GET /private/self-improvement/transitions",
    "GET /private/self-improvement/approvals",
    "GET /private/self-improvement/context-evidence",
    "GET /private/self-improvement/routing-decisions",
    "GET /private/self-improvement/audit",
  ])
  expect(Object.keys(SelfImprovementApi.PrivateApiOperations).some((key) => key.toLowerCase().includes("stage"))).toBe(false)
})

test("page limits are 1 through 100 with default 50", () => {
  expect(decode(SelfImprovementApi.PageRequest, {})).toEqual({ limit: 50 })
  expect(() => decode(SelfImprovementApi.PageRequest, { limit: 0 })).toThrow()
  expect(() => decode(SelfImprovementApi.PageRequest, { limit: 101 })).toThrow()
})
```

- [ ] **Step 2: Run the test to verify RED**

Run from `packages/schema`:

```bash
bun test test/self-improvement-api.test.ts
```

Expected when the reconciled path is absent: FAIL with `Cannot find module '../src/self-improvement-api'`. If the path already exists on `APPROVED_BASE_SHA`, preserve it, add the exact ordered 22-method/path assertion from Step 1 as the first missing behavioral assertion, and verify it fails before editing the module.

- [ ] **Step 3: Implement the common API and exact operation schemas**

Use `Schema.Uint8ArrayFromBase64` for encoded raw Slice 1A bytes. Do not accept caller-supplied `source`, stage, provider settings, or side effects.

```ts
export * as SelfImprovementApi from "./self-improvement-api"

import { Effect, Schema } from "effect"
import { optional } from "./schema"
import { SelfImprovement } from "./self-improvement"
import { SelfImprovementEvaluation } from "./self-improvement-evaluation"
import { SelfImprovementLearning } from "./self-improvement-learning"
import { SelfImprovementLifecycle } from "./self-improvement-lifecycle"

export const PageLimit = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 })).pipe(Schema.withDecodingDefault(Effect.succeed(50))).annotate({ identifier: "SelfImprovementApi.PageLimit" })
export type PageLimit = typeof PageLimit.Type
export const Cursor = Schema.NonEmptyString.pipe(Schema.brand("SelfImprovementApi.Cursor")).annotate({ identifier: "SelfImprovementApi.Cursor" })
export type Cursor = typeof Cursor.Type
export class PageRequest extends Schema.Class<PageRequest>("SelfImprovementApi.PageRequest")({ limit: PageLimit, cursor: Cursor.pipe(optional) }) {}
export const IfMatchRevision = Schema.NumberFromString.pipe(Schema.decodeTo(SelfImprovementLifecycle.Revision)).annotate({ identifier: "SelfImprovementApi.IfMatchRevision" })
export type IfMatchRevision = typeof IfMatchRevision.Type
export interface LocationHeaders extends Schema.Schema.Type<typeof LocationHeaders> {}
export const LocationHeaders = Schema.Struct({
  "X-OpenCode-Location-ID": SelfImprovementLifecycle.LocationID,
}).annotate({ identifier: "SelfImprovementApi.LocationHeaders" })
export interface MutationHeaders extends Schema.Schema.Type<typeof MutationHeaders> {}
export const MutationHeaders = Schema.Struct({
  "X-OpenCode-Location-ID": SelfImprovementLifecycle.LocationID,
  "Idempotency-Key": SelfImprovementLearning.IdempotencyKey,
}).annotate({ identifier: "SelfImprovementApi.MutationHeaders" })
export interface ArtifactMutationHeaders extends Schema.Schema.Type<typeof ArtifactMutationHeaders> {}
export const ArtifactMutationHeaders = Schema.Struct({
  "X-OpenCode-Location-ID": SelfImprovementLifecycle.LocationID,
  "Idempotency-Key": SelfImprovementLearning.IdempotencyKey,
  "If-Match": IfMatchRevision,
}).annotate({ identifier: "SelfImprovementApi.ArtifactMutationHeaders" })
const page = <S extends Schema.Top>(item: S) => Schema.Struct({ items: Schema.Array(item), nextCursor: Cursor.pipe(optional) })
export const ApiErrorCode = Schema.Literals(["invalid-page", "admission-rejected", "redaction-rejected", "binding-invalid", "sample-invalid", "forbidden", "creator-self-approval", "artifact-not-found", "artifact-or-version-not-found", "approval-request-not-found", "version-or-baseline-not-found", "run-not-found", "name-reserved", "revision-conflict", "idempotency-mismatch", "tombstoned", "stage-illegal", "binding-mismatch", "expired", "already-decided", "run-conflict", "duplicate-different", "late", "out-of-stage", "cutoff-mismatch", "context-unavailable"]).annotate({ identifier: "SelfImprovementApi.ApiErrorCode" })
export type ApiErrorCode = typeof ApiErrorCode.Type
export class ApiErrorDetails extends Schema.Class<ApiErrorDetails>("SelfImprovementApi.ApiErrorDetails")({ artifactID: SelfImprovementLifecycle.ArtifactID.pipe(optional), versionID: SelfImprovementLifecycle.ArtifactVersionID.pipe(optional), runID: SelfImprovementLifecycle.EvaluationRunID.pipe(optional), digest: SelfImprovement.Digest.pipe(optional), conflictingFieldNames: Schema.Array(Schema.NonEmptyString).check(Schema.isUnique()).pipe(optional) }) {}
export class ApiError extends Schema.Class<ApiError>("SelfImprovementApi.ApiError")({ code: ApiErrorCode, message: Schema.NonEmptyString, requestID: Schema.NonEmptyString, details: ApiErrorDetails }) {}
export interface ApiErrorContract { readonly code: ApiErrorCode; readonly status: 400 | 403 | 404 | 409 | 503 }
export const ApiErrors = {
  invalidPage: { code: "invalid-page", status: 400 }, admissionRejected: { code: "admission-rejected", status: 400 }, redactionRejected: { code: "redaction-rejected", status: 400 }, bindingInvalid: { code: "binding-invalid", status: 400 }, sampleInvalid: { code: "sample-invalid", status: 400 },
  forbidden: { code: "forbidden", status: 403 }, creatorSelfApproval: { code: "creator-self-approval", status: 403 },
  artifactNotFound: { code: "artifact-not-found", status: 404 }, artifactOrVersionNotFound: { code: "artifact-or-version-not-found", status: 404 }, approvalRequestNotFound: { code: "approval-request-not-found", status: 404 }, versionOrBaselineNotFound: { code: "version-or-baseline-not-found", status: 404 }, runNotFound: { code: "run-not-found", status: 404 },
  nameReserved: { code: "name-reserved", status: 409 }, revisionConflict: { code: "revision-conflict", status: 409 }, idempotencyMismatch: { code: "idempotency-mismatch", status: 409 }, tombstoned: { code: "tombstoned", status: 409 }, stageIllegal: { code: "stage-illegal", status: 409 }, bindingMismatch: { code: "binding-mismatch", status: 409 }, expired: { code: "expired", status: 409 }, alreadyDecided: { code: "already-decided", status: 409 }, runConflict: { code: "run-conflict", status: 409 }, duplicateDifferent: { code: "duplicate-different", status: 409 }, late: { code: "late", status: 409 }, outOfStage: { code: "out-of-stage", status: 409 }, cutoffMismatch: { code: "cutoff-mismatch", status: 409 },
  contextUnavailable: { code: "context-unavailable", status: 503 },
} as const satisfies Record<string, ApiErrorContract>
export const ApiSideEffect = Schema.Literals(["none", "artifact-created", "draft-version-created", "transition-appended", "audit-appended", "context-removal-requested", "approval-recorded", "rejection-recorded", "terminal-intent-recorded", "observation-recorded", "generation-eligibility-updated", "run-opened", "sample-appended", "decision-recorded", "coordinator-event-emitted", "pending-work-cancelled", "versions-archived", "recommendations-removed", "access-audited"]).annotate({ identifier: "SelfImprovementApi.ApiSideEffect" })
export type ApiSideEffect = typeof ApiSideEffect.Type
export const ResponseOrder = Schema.Literals(["kind-name-id-asc", "version-number-id-desc", "created-id-desc", "decided-id-desc", "timestamp-id-desc"]).annotate({ identifier: "SelfImprovementApi.ResponseOrder" })
export type ResponseOrder = typeof ResponseOrder.Type
export interface CompletedCommandResult extends Schema.Schema.Type<typeof CompletedCommandResult> {}
export const CompletedCommandResult = Schema.Struct({ status: Schema.Literal("completed"), artifactRevision: SelfImprovementLifecycle.Revision, transition: SelfImprovementLifecycle.StageTransition }).annotate({ identifier: "SelfImprovementApi.CompletedCommandResult" })
export interface ReconciliationPendingCommandResult extends Schema.Schema.Type<typeof ReconciliationPendingCommandResult> {}
export const ReconciliationPendingCommandResult = Schema.Struct({ status: Schema.Literal("reconciliation-pending"), artifactRevision: SelfImprovementLifecycle.Revision, outbox: SelfImprovementLearning.ContextOutbox }).annotate({ identifier: "SelfImprovementApi.ReconciliationPendingCommandResult" })
export const CommandResult = Schema.Union([CompletedCommandResult, ReconciliationPendingCommandResult]).pipe(Schema.toTaggedUnion("status")).annotate({ identifier: "SelfImprovementApi.CommandResult" })
export type CommandResult = typeof CommandResult.Type
export class ArtifactRolloutProjection extends Schema.Class<ArtifactRolloutProjection>("SelfImprovementApi.ArtifactRolloutProjection")({ versionID: SelfImprovementLifecycle.ArtifactVersionID, versionDigest: SelfImprovement.Digest, transitionID: SelfImprovementLifecycle.StageTransitionID }) {}

export class ListArtifactsRequest extends Schema.Class<ListArtifactsRequest>("SelfImprovementApi.ListArtifactsRequest")({ kind: SelfImprovement.ArtifactKind.pipe(optional), status: SelfImprovementLifecycle.ArtifactStatus.pipe(optional), namePrefix: Schema.NonEmptyString.pipe(optional), limit: PageLimit, cursor: Cursor.pipe(optional) }) {}
export interface ListArtifactsResponse extends Schema.Schema.Type<typeof ListArtifactsResponse> {}
export const ListArtifactsResponse = page(SelfImprovementLifecycle.Artifact).annotate({ identifier: "SelfImprovementApi.ListArtifactsResponse" })
export class CreateArtifactRequest extends Schema.Class<CreateArtifactRequest>("SelfImprovementApi.CreateArtifactRequest")({ proposalBytes: Schema.Uint8ArrayFromBase64, behaviorClass: SelfImprovementLifecycle.BehaviorClass, capabilityManifest: SelfImprovementLifecycle.CapabilityManifest }) {}
export class CreateArtifactResponse extends Schema.Class<CreateArtifactResponse>("SelfImprovementApi.CreateArtifactResponse")({ artifact: SelfImprovementLifecycle.Artifact, version: SelfImprovementLifecycle.ArtifactVersion, revision: SelfImprovementLifecycle.Revision }) {}
export class GetArtifactRequest extends Schema.Class<GetArtifactRequest>("SelfImprovementApi.GetArtifactRequest")({ artifactID: SelfImprovementLifecycle.ArtifactID }) {}
export class GetArtifactResponse extends Schema.Class<GetArtifactResponse>("SelfImprovementApi.GetArtifactResponse")({ artifact: SelfImprovementLifecycle.Artifact, activeProjection: ArtifactRolloutProjection.pipe(optional), shadowProjection: ArtifactRolloutProjection.pipe(optional), canaryProjection: ArtifactRolloutProjection.pipe(optional) }) {}
export class ListVersionsRequest extends Schema.Class<ListVersionsRequest>("SelfImprovementApi.ListVersionsRequest")({ artifactID: SelfImprovementLifecycle.ArtifactID, limit: PageLimit, cursor: Cursor.pipe(optional) }) {}
export interface ListVersionsResponse extends Schema.Schema.Type<typeof ListVersionsResponse> {}
export const ListVersionsResponse = page(SelfImprovementLifecycle.ArtifactVersion).annotate({ identifier: "SelfImprovementApi.ListVersionsResponse" })
export class CreateVersionRequest extends Schema.Class<CreateVersionRequest>("SelfImprovementApi.CreateVersionRequest")({ artifactID: SelfImprovementLifecycle.ArtifactID, proposalBytes: Schema.Uint8ArrayFromBase64, behaviorClass: SelfImprovementLifecycle.BehaviorClass, capabilityManifest: SelfImprovementLifecycle.CapabilityManifest, expectedRevision: SelfImprovementLifecycle.Revision }) {}
export class CreateVersionResponse extends Schema.Class<CreateVersionResponse>("SelfImprovementApi.CreateVersionResponse")({ version: SelfImprovementLifecycle.ArtifactVersion, revision: SelfImprovementLifecycle.Revision }) {}
export class GetVersionRequest extends Schema.Class<GetVersionRequest>("SelfImprovementApi.GetVersionRequest")({ artifactID: SelfImprovementLifecycle.ArtifactID, versionID: SelfImprovementLifecycle.ArtifactVersionID }) {}
export class GetVersionResponse extends Schema.Class<GetVersionResponse>("SelfImprovementApi.GetVersionResponse")({ version: SelfImprovementLifecycle.ArtifactVersion, stage: SelfImprovementLifecycle.ArtifactStage, capabilityManifest: SelfImprovementLifecycle.CapabilityManifest }) {}
export class ArchiveVersionRequest extends Schema.Class<ArchiveVersionRequest>("SelfImprovementApi.ArchiveVersionRequest")({ artifactID: SelfImprovementLifecycle.ArtifactID, versionID: SelfImprovementLifecycle.ArtifactVersionID, reason: SelfImprovementLifecycle.LifecycleReason, expectedRevision: SelfImprovementLifecycle.Revision }) {}
export const ArchiveVersionResponse = CommandResult.annotate({ identifier: "SelfImprovementApi.ArchiveVersionResponse" })
export type ArchiveVersionResponse = typeof ArchiveVersionResponse.Type
export class TombstoneArtifactRequest extends Schema.Class<TombstoneArtifactRequest>("SelfImprovementApi.TombstoneArtifactRequest")({ artifactID: SelfImprovementLifecycle.ArtifactID, reason: Schema.NonEmptyString, expectedRevision: SelfImprovementLifecycle.Revision }) {}
export const TombstoneArtifactResponse = CommandResult.annotate({ identifier: "SelfImprovementApi.TombstoneArtifactResponse" })
export type TombstoneArtifactResponse = typeof TombstoneArtifactResponse.Type
export class ApproveRequest extends Schema.Class<ApproveRequest>("SelfImprovementApi.ApproveRequest")({ approvalRequestID: SelfImprovementLifecycle.ApprovalRequestID, binding: SelfImprovementLifecycle.ApprovalBinding }) {}
export class ApproveResponse extends Schema.Class<ApproveResponse>("SelfImprovementApi.ApproveResponse")({ approval: SelfImprovementLifecycle.Approval }) {}
export class RejectRequest extends Schema.Class<RejectRequest>("SelfImprovementApi.RejectRequest")({ approvalRequestID: SelfImprovementLifecycle.ApprovalRequestID, binding: SelfImprovementLifecycle.ApprovalBinding, reason: SelfImprovementLifecycle.ApprovalRejectionReason }) {}
export class RejectResponse extends Schema.Class<RejectResponse>("SelfImprovementApi.RejectResponse")({ approval: SelfImprovementLifecycle.Approval }) {}
export class CreateObservationRequest extends Schema.Class<CreateObservationRequest>("SelfImprovementApi.CreateObservationRequest")({ workload: SelfImprovementEvaluation.Workload, workloadRevision: SelfImprovementLifecycle.Revision, errorClass: Schema.NonEmptyString, orderedToolSymbolDigest: SelfImprovement.Digest, outcomeClass: SelfImprovementLearning.ObservationOutcomeClass, taskIDDigest: SelfImprovement.Digest }) {}
export class CreateObservationResponse extends Schema.Class<CreateObservationResponse>("SelfImprovementApi.CreateObservationResponse")({ observation: SelfImprovementLearning.Observation, matchingCount: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)), generationEligible: Schema.Boolean }) {}
export class CreateMetricRunRequest extends Schema.Class<CreateMetricRunRequest>("SelfImprovementApi.CreateMetricRunRequest")({ versionID: SelfImprovementLifecycle.ArtifactVersionID, stage: SelfImprovementLifecycle.ArtifactStage, suiteID: SelfImprovementLifecycle.SuiteID, suiteRevision: SelfImprovementLifecycle.Revision, workload: SelfImprovementEvaluation.Workload, workloadRevision: SelfImprovementLifecycle.Revision, baselineID: SelfImprovementLifecycle.BaselineID, acceptanceStart: SelfImprovementLifecycle.TimestampMillis, acceptanceEnd: SelfImprovementLifecycle.TimestampMillis, cutoffAt: SelfImprovementLifecycle.TimestampMillis, requestDigest: SelfImprovement.Digest }) {}
export class CreateMetricRunResponse extends Schema.Class<CreateMetricRunResponse>("SelfImprovementApi.CreateMetricRunResponse")({ run: SelfImprovementEvaluation.EvaluationRun }) {}
export class AddMetricSampleRequest extends Schema.Class<AddMetricSampleRequest>("SelfImprovementApi.AddMetricSampleRequest")({ runID: SelfImprovementLifecycle.EvaluationRunID, sampleIDDigest: SelfImprovement.Digest, taskIDDigest: SelfImprovement.Digest, metrics: SelfImprovementEvaluation.MetricComponents, outcome: SelfImprovementEvaluation.TaskOutcome, startedAt: SelfImprovementLifecycle.TimestampMillis, terminalAt: SelfImprovementLifecycle.TimestampMillis, requestDigest: SelfImprovement.Digest }) {}
export class AddMetricSampleResponse extends Schema.Class<AddMetricSampleResponse>("SelfImprovementApi.AddMetricSampleResponse")({ sample: SelfImprovementEvaluation.MetricSample, replayed: Schema.Boolean }) {}
export class DecideMetricRunRequest extends Schema.Class<DecideMetricRunRequest>("SelfImprovementApi.DecideMetricRunRequest")({ runID: SelfImprovementLifecycle.EvaluationRunID, cutoffSampleSetDigest: SelfImprovement.Digest }) {}
export class DecideMetricRunResponse extends Schema.Class<DecideMetricRunResponse>("SelfImprovementApi.DecideMetricRunResponse")({ decision: SelfImprovementEvaluation.EvaluationDecision, findings: Schema.Array(SelfImprovementEvaluation.GateFinding), replayed: Schema.Boolean }) {}

export class ListBaselinesRequest extends Schema.Class<ListBaselinesRequest>("SelfImprovementApi.ListBaselinesRequest")({ workload: SelfImprovementEvaluation.Workload.pipe(optional), suiteRevision: SelfImprovementLifecycle.Revision.pipe(optional), limit: PageLimit, cursor: Cursor.pipe(optional) }) {}
export interface ListBaselinesResponse extends Schema.Schema.Type<typeof ListBaselinesResponse> {}
export const ListBaselinesResponse = page(SelfImprovementEvaluation.Baseline).annotate({ identifier: "SelfImprovementApi.ListBaselinesResponse" })
export class ListMetricRunsRequest extends Schema.Class<ListMetricRunsRequest>("SelfImprovementApi.ListMetricRunsRequest")({ versionID: SelfImprovementLifecycle.ArtifactVersionID.pipe(optional), stage: SelfImprovementLifecycle.ArtifactStage.pipe(optional), state: SelfImprovementEvaluation.RunState.pipe(optional), includeSamples: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))), limit: PageLimit, cursor: Cursor.pipe(optional) }) {}
export class MetricRunView extends Schema.Class<MetricRunView>("SelfImprovementApi.MetricRunView")({ run: SelfImprovementEvaluation.EvaluationRun, aggregates: SelfImprovementEvaluation.MetricAggregates.pipe(optional), sampleCount: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)), samples: Schema.Array(SelfImprovementEvaluation.MetricSample).pipe(optional) }) {}
export interface ListMetricRunsResponse extends Schema.Schema.Type<typeof ListMetricRunsResponse> {}
export const ListMetricRunsResponse = page(MetricRunView).annotate({ identifier: "SelfImprovementApi.ListMetricRunsResponse" })
export class ListEvaluationsRequest extends Schema.Class<ListEvaluationsRequest>("SelfImprovementApi.ListEvaluationsRequest")({ artifactID: SelfImprovementLifecycle.ArtifactID.pipe(optional), versionID: SelfImprovementLifecycle.ArtifactVersionID.pipe(optional), stage: SelfImprovementLifecycle.ArtifactStage.pipe(optional), limit: PageLimit, cursor: Cursor.pipe(optional) }) {}
export class EvaluationView extends Schema.Class<EvaluationView>("SelfImprovementApi.EvaluationView")({ run: SelfImprovementEvaluation.EvaluationRun, decision: SelfImprovementEvaluation.EvaluationDecision, orderedFindings: Schema.Array(SelfImprovementEvaluation.GateFinding) }) {}
export interface ListEvaluationsResponse extends Schema.Schema.Type<typeof ListEvaluationsResponse> {}
export const ListEvaluationsResponse = page(EvaluationView).annotate({ identifier: "SelfImprovementApi.ListEvaluationsResponse" })
export class ListTransitionsRequest extends Schema.Class<ListTransitionsRequest>("SelfImprovementApi.ListTransitionsRequest")({ artifactID: SelfImprovementLifecycle.ArtifactID.pipe(optional), versionID: SelfImprovementLifecycle.ArtifactVersionID.pipe(optional), event: SelfImprovementLifecycle.LifecycleEvent.pipe(optional), limit: PageLimit, cursor: Cursor.pipe(optional) }) {}
export interface ListTransitionsResponse extends Schema.Schema.Type<typeof ListTransitionsResponse> {}
export const ListTransitionsResponse = page(SelfImprovementLifecycle.StageTransition).annotate({ identifier: "SelfImprovementApi.ListTransitionsResponse" })
export class ListApprovalsRequest extends Schema.Class<ListApprovalsRequest>("SelfImprovementApi.ListApprovalsRequest")({ artifactID: SelfImprovementLifecycle.ArtifactID.pipe(optional), versionID: SelfImprovementLifecycle.ArtifactVersionID.pipe(optional), approverID: SelfImprovementLifecycle.PrincipalID.pipe(optional), limit: PageLimit, cursor: Cursor.pipe(optional) }) {}
export interface ListApprovalsResponse extends Schema.Schema.Type<typeof ListApprovalsResponse> {}
export const ListApprovalsResponse = page(SelfImprovementLifecycle.Approval).annotate({ identifier: "SelfImprovementApi.ListApprovalsResponse" })
export class ListContextEvidenceRequest extends Schema.Class<ListContextEvidenceRequest>("SelfImprovementApi.ListContextEvidenceRequest")({ artifactID: SelfImprovementLifecycle.ArtifactID.pipe(optional), versionID: SelfImprovementLifecycle.ArtifactVersionID.pipe(optional), status: SelfImprovementLearning.ContextOutboxStatus.pipe(optional), limit: PageLimit, cursor: Cursor.pipe(optional) }) {}
const ContextEvidence = Schema.Union([
  Schema.Struct({ type: Schema.Literal("desired-state"), value: SelfImprovementLearning.ContextDesiredState }),
  Schema.Struct({ type: Schema.Literal("outbox"), value: SelfImprovementLearning.ContextOutbox }),
  Schema.Struct({ type: Schema.Literal("selection"), value: SelfImprovementLearning.ContextSelectionEvidence }),
]).pipe(Schema.toTaggedUnion("type"))
export class ContextEvidenceView extends Schema.Class<ContextEvidenceView>("SelfImprovementApi.ContextEvidenceView")({ cursorID: Schema.NonEmptyString, createdAt: SelfImprovementLifecycle.TimestampMillis, evidence: ContextEvidence }) {}
export interface ListContextEvidenceResponse extends Schema.Schema.Type<typeof ListContextEvidenceResponse> {}
export const ListContextEvidenceResponse = page(ContextEvidenceView).annotate({ identifier: "SelfImprovementApi.ListContextEvidenceResponse" })
export class ListRoutingDecisionsRequest extends Schema.Class<ListRoutingDecisionsRequest>("SelfImprovementApi.ListRoutingDecisionsRequest")({ sessionDigest: SelfImprovement.Digest.pipe(optional), workload: SelfImprovementEvaluation.Workload.pipe(optional), limit: PageLimit, cursor: Cursor.pipe(optional) }) {}
export interface ListRoutingDecisionsResponse extends Schema.Schema.Type<typeof ListRoutingDecisionsResponse> {}
export const ListRoutingDecisionsResponse = page(SelfImprovementLearning.RoutingDecision).annotate({ identifier: "SelfImprovementApi.ListRoutingDecisionsResponse" })
export class ListAuditRequest extends Schema.Class<ListAuditRequest>("SelfImprovementApi.ListAuditRequest")({ eventType: Schema.NonEmptyString.pipe(optional), artifactID: SelfImprovementLifecycle.ArtifactID.pipe(optional), from: SelfImprovementLifecycle.TimestampMillis.pipe(optional), to: SelfImprovementLifecycle.TimestampMillis.pipe(optional), limit: PageLimit, cursor: Cursor.pipe(optional) }) {}
export interface ListAuditResponse extends Schema.Schema.Type<typeof ListAuditResponse> {}
export const ListAuditResponse = page(SelfImprovementLearning.AuditEntry).annotate({ identifier: "SelfImprovementApi.ListAuditResponse" })

const errorFor = (codes: ReadonlyArray<ApiErrorCode>) => ApiError.check(Schema.makeFilter((value) => codes.includes(value.code)))
const Stored200 = Schema.Struct({ status: Schema.Literal(200), body: Schema.Union([CompletedCommandResult, ApproveResponse, RejectResponse, CreateObservationResponse]) })
const Stored201 = Schema.Struct({ status: Schema.Literal(201), body: Schema.Union([CreateArtifactResponse, CreateVersionResponse, CreateObservationResponse, CreateMetricRunResponse, AddMetricSampleResponse, DecideMetricRunResponse]) })
const Stored202 = Schema.Struct({ status: Schema.Literal(202), body: ReconciliationPendingCommandResult })
const Stored400 = Schema.Struct({ status: Schema.Literal(400), body: errorFor(["invalid-page", "admission-rejected", "redaction-rejected", "binding-invalid", "sample-invalid"]) })
const Stored403 = Schema.Struct({ status: Schema.Literal(403), body: errorFor(["forbidden", "creator-self-approval"]) })
const Stored404 = Schema.Struct({ status: Schema.Literal(404), body: errorFor(["artifact-not-found", "artifact-or-version-not-found", "approval-request-not-found", "version-or-baseline-not-found", "run-not-found"]) })
const Stored409 = Schema.Struct({ status: Schema.Literal(409), body: errorFor(["name-reserved", "revision-conflict", "idempotency-mismatch", "tombstoned", "stage-illegal", "binding-mismatch", "expired", "already-decided", "run-conflict", "duplicate-different", "late", "out-of-stage", "cutoff-mismatch"]) })
const Stored503 = Schema.Struct({ status: Schema.Literal(503), body: errorFor(["context-unavailable"]) })
export const StoredResponse = Schema.Union([Stored200, Stored201, Stored202, Stored400, Stored403, Stored404, Stored409, Stored503]).pipe(Schema.toTaggedUnion("status")).annotate({ identifier: "SelfImprovementApi.StoredResponse" })
export type StoredResponse = typeof StoredResponse.Type
export interface IdempotencyRecord extends Schema.Schema.Type<typeof IdempotencyRecord> {}
export const IdempotencyRecord = Schema.Struct({ id: SelfImprovementLifecycle.IdempotencyRecordID, identity: SelfImprovementLearning.IdempotencyIdentity, requestDigest: SelfImprovement.Digest, storedBodyDigest: SelfImprovement.Digest, storedResponse: StoredResponse, createdAt: SelfImprovementLifecycle.TimestampMillis, expiresAt: SelfImprovementLifecycle.TimestampMillis }).check(Schema.makeFilter((value) => value.expiresAt === value.createdAt + 30 * 86_400_000)).annotate({ identifier: "SelfImprovementApi.IdempotencyRecord" })
```

`IdempotencyRecord` stores only a status/body-valid original success or `ApiError`, expires exactly 30 days after creation, and is linked from transition/outbox intent evidence. Authorization and Location checks before replay are S08/S09 behavior and are not implemented in S01.

- [ ] **Step 4: Add the exact operation metadata registry**

Use schema values, not handlers or callbacks:

```ts
export const LocationSource = Schema.Literals(["header-grant", "artifact-header-grant", "run-header-grant", "approval-binding-header-grant"]).annotate({ identifier: "SelfImprovementApi.LocationSource" })
export type LocationSource = typeof LocationSource.Type
const CoordinatorGeneratedOnly = Schema.Struct({ type: Schema.Literal("coordinator-generated-only"), principal: Schema.Literal("coordinator"), condition: Schema.Literal("generated-output") })
const CoordinatorPolicyTerminalOnly = Schema.Struct({ type: Schema.Literal("coordinator-policy-terminal-only"), principal: Schema.Literal("coordinator"), condition: Schema.Literal("policy-terminal-action") })
const DedicatedApproverNotCreator = Schema.Struct({ type: Schema.Literal("dedicated-approver-not-creator"), principal: Schema.Literal("location-approver") })
const IncludeSamplesAuditReaderOnly = Schema.Struct({ type: Schema.Literal("include-samples-audit-reader-only"), principal: Schema.Literal("audit-reader"), queryField: Schema.Literal("includeSamples") })
const ApproverOwnDecisionsOnly = Schema.Struct({ type: Schema.Literal("approver-own-decisions-only"), principal: Schema.Literal("location-approver") })
const AuditReaderOnlyAudit = Schema.Struct({ type: Schema.Literal("audit-reader-only-audit"), principal: Schema.Literal("audit-reader") })
export const ConditionalAuthorizationRule = Schema.Union([CoordinatorGeneratedOnly, CoordinatorPolicyTerminalOnly, DedicatedApproverNotCreator, IncludeSamplesAuditReaderOnly, ApproverOwnDecisionsOnly, AuditReaderOnlyAudit]).pipe(Schema.toTaggedUnion("type")).annotate({ identifier: "SelfImprovementApi.ConditionalAuthorizationRule" })
export type ConditionalAuthorizationRule = typeof ConditionalAuthorizationRule.Type
export interface PrivateApiOperation {
  readonly method: "GET" | "POST"
  readonly path: `/private/self-improvement${string}`
  readonly operation: SelfImprovementLifecycle.Operation
  readonly locationSource: LocationSource
  readonly principals: ReadonlyArray<SelfImprovementLifecycle.PrincipalKind>
  readonly authorizationRules: ReadonlyArray<ConditionalAuthorizationRule>
  readonly headers: Schema.Top
  readonly request: Schema.Top
  readonly response: Schema.Top
  readonly errors: ReadonlyArray<ApiErrorContract>
  readonly successStatuses: ReadonlyArray<200 | 201 | 202>
  readonly ordering?: ResponseOrder
  readonly sideEffects: ReadonlyArray<ApiSideEffect>
  readonly mutation: boolean
}

export const PrivateApiOperations = {
  listArtifacts: { method: "GET", path: "/private/self-improvement/artifacts", operation: "artifact.read", locationSource: "header-grant", principals: ["first-party-user", "coordinator", "audit-reader"], authorizationRules: [], headers: LocationHeaders, request: ListArtifactsRequest, response: ListArtifactsResponse, errors: [ApiErrors.invalidPage, ApiErrors.forbidden], successStatuses: [200], ordering: "kind-name-id-asc", sideEffects: ["none"], mutation: false },
  createArtifact: { method: "POST", path: "/private/self-improvement/artifacts", operation: "artifact.create", locationSource: "header-grant", principals: ["first-party-user", "coordinator"], authorizationRules: [{ type: "coordinator-generated-only", principal: "coordinator", condition: "generated-output" }], headers: MutationHeaders, request: CreateArtifactRequest, response: CreateArtifactResponse, errors: [ApiErrors.admissionRejected, ApiErrors.forbidden, ApiErrors.nameReserved, ApiErrors.idempotencyMismatch], successStatuses: [201], sideEffects: ["artifact-created", "draft-version-created", "transition-appended", "audit-appended"], mutation: true },
  getArtifact: { method: "GET", path: "/private/self-improvement/artifacts/{artifactID}", operation: "artifact.read", locationSource: "artifact-header-grant", principals: ["first-party-user", "coordinator", "audit-reader"], authorizationRules: [], headers: LocationHeaders, request: GetArtifactRequest, response: GetArtifactResponse, errors: [ApiErrors.forbidden, ApiErrors.artifactNotFound], successStatuses: [200], sideEffects: ["none"], mutation: false },
  listVersions: { method: "GET", path: "/private/self-improvement/artifacts/{artifactID}/versions", operation: "artifact.read", locationSource: "artifact-header-grant", principals: ["first-party-user", "coordinator", "audit-reader"], authorizationRules: [], headers: LocationHeaders, request: ListVersionsRequest, response: ListVersionsResponse, errors: [ApiErrors.invalidPage, ApiErrors.forbidden, ApiErrors.artifactNotFound], successStatuses: [200], ordering: "version-number-id-desc", sideEffects: ["none"], mutation: false },
  createVersion: { method: "POST", path: "/private/self-improvement/artifacts/{artifactID}/versions", operation: "artifact.create", locationSource: "artifact-header-grant", principals: ["first-party-user", "coordinator"], authorizationRules: [{ type: "coordinator-generated-only", principal: "coordinator", condition: "generated-output" }], headers: ArtifactMutationHeaders, request: CreateVersionRequest, response: CreateVersionResponse, errors: [ApiErrors.admissionRejected, ApiErrors.forbidden, ApiErrors.artifactNotFound, ApiErrors.revisionConflict, ApiErrors.idempotencyMismatch, ApiErrors.tombstoned], successStatuses: [201], sideEffects: ["draft-version-created", "audit-appended"], mutation: true },
  getVersion: { method: "GET", path: "/private/self-improvement/artifacts/{artifactID}/versions/{versionID}", operation: "artifact.read", locationSource: "artifact-header-grant", principals: ["first-party-user", "coordinator", "audit-reader"], authorizationRules: [], headers: LocationHeaders, request: GetVersionRequest, response: GetVersionResponse, errors: [ApiErrors.forbidden, ApiErrors.artifactOrVersionNotFound], successStatuses: [200], sideEffects: ["none"], mutation: false },
  archiveVersion: { method: "POST", path: "/private/self-improvement/artifacts/{artifactID}/versions/{versionID}/archive", operation: "artifact.archive", locationSource: "artifact-header-grant", principals: ["first-party-user", "coordinator"], authorizationRules: [{ type: "coordinator-policy-terminal-only", principal: "coordinator", condition: "policy-terminal-action" }], headers: ArtifactMutationHeaders, request: ArchiveVersionRequest, response: ArchiveVersionResponse, errors: [ApiErrors.forbidden, ApiErrors.artifactOrVersionNotFound, ApiErrors.revisionConflict, ApiErrors.stageIllegal, ApiErrors.idempotencyMismatch, ApiErrors.contextUnavailable], successStatuses: [200, 202], sideEffects: ["terminal-intent-recorded", "context-removal-requested", "transition-appended", "audit-appended"], mutation: true },
  tombstoneArtifact: { method: "POST", path: "/private/self-improvement/artifacts/{artifactID}/tombstone", operation: "artifact.tombstone", locationSource: "artifact-header-grant", principals: ["first-party-user", "coordinator"], authorizationRules: [{ type: "coordinator-policy-terminal-only", principal: "coordinator", condition: "policy-terminal-action" }], headers: ArtifactMutationHeaders, request: TombstoneArtifactRequest, response: TombstoneArtifactResponse, errors: [ApiErrors.forbidden, ApiErrors.artifactNotFound, ApiErrors.revisionConflict, ApiErrors.idempotencyMismatch, ApiErrors.contextUnavailable], successStatuses: [200, 202], sideEffects: ["pending-work-cancelled", "terminal-intent-recorded", "context-removal-requested", "versions-archived", "recommendations-removed", "transition-appended", "audit-appended"], mutation: true },
  approve: { method: "POST", path: "/private/self-improvement/approvals/{approvalRequestID}/approve", operation: "approval.decide", locationSource: "approval-binding-header-grant", principals: ["location-approver"], authorizationRules: [{ type: "dedicated-approver-not-creator", principal: "location-approver" }], headers: MutationHeaders, request: ApproveRequest, response: ApproveResponse, errors: [ApiErrors.forbidden, ApiErrors.creatorSelfApproval, ApiErrors.approvalRequestNotFound, ApiErrors.bindingMismatch, ApiErrors.expired, ApiErrors.alreadyDecided, ApiErrors.idempotencyMismatch], successStatuses: [200], sideEffects: ["approval-recorded"], mutation: true },
  reject: { method: "POST", path: "/private/self-improvement/approvals/{approvalRequestID}/reject", operation: "approval.decide", locationSource: "approval-binding-header-grant", principals: ["location-approver"], authorizationRules: [{ type: "dedicated-approver-not-creator", principal: "location-approver" }], headers: MutationHeaders, request: RejectRequest, response: RejectResponse, errors: [ApiErrors.forbidden, ApiErrors.creatorSelfApproval, ApiErrors.approvalRequestNotFound, ApiErrors.bindingMismatch, ApiErrors.expired, ApiErrors.alreadyDecided, ApiErrors.idempotencyMismatch], successStatuses: [200], sideEffects: ["rejection-recorded", "terminal-intent-recorded"], mutation: true },
  createObservation: { method: "POST", path: "/private/self-improvement/observations", operation: "evidence.ingest", locationSource: "header-grant", principals: ["runtime-evidence-service"], authorizationRules: [], headers: MutationHeaders, request: CreateObservationRequest, response: CreateObservationResponse, errors: [ApiErrors.redactionRejected, ApiErrors.forbidden, ApiErrors.idempotencyMismatch], successStatuses: [200, 201], sideEffects: ["observation-recorded", "generation-eligibility-updated", "audit-appended"], mutation: true },
  createMetricRun: { method: "POST", path: "/private/self-improvement/metric-runs", operation: "evidence.ingest", locationSource: "header-grant", principals: ["runtime-evidence-service"], authorizationRules: [], headers: MutationHeaders, request: CreateMetricRunRequest, response: CreateMetricRunResponse, errors: [ApiErrors.bindingInvalid, ApiErrors.forbidden, ApiErrors.versionOrBaselineNotFound, ApiErrors.idempotencyMismatch, ApiErrors.runConflict], successStatuses: [201], sideEffects: ["run-opened"], mutation: true },
  addMetricSample: { method: "POST", path: "/private/self-improvement/metric-runs/{runID}/samples", operation: "evidence.ingest", locationSource: "run-header-grant", principals: ["runtime-evidence-service"], authorizationRules: [], headers: MutationHeaders, request: AddMetricSampleRequest, response: AddMetricSampleResponse, errors: [ApiErrors.sampleInvalid, ApiErrors.forbidden, ApiErrors.runNotFound, ApiErrors.duplicateDifferent, ApiErrors.late, ApiErrors.outOfStage, ApiErrors.idempotencyMismatch], successStatuses: [201], sideEffects: ["sample-appended"], mutation: true },
  decideMetricRun: { method: "POST", path: "/private/self-improvement/metric-runs/{runID}/decisions", operation: "evaluation.decide", locationSource: "run-header-grant", principals: ["evaluator"], authorizationRules: [], headers: MutationHeaders, request: DecideMetricRunRequest, response: DecideMetricRunResponse, errors: [ApiErrors.forbidden, ApiErrors.runNotFound, ApiErrors.alreadyDecided, ApiErrors.cutoffMismatch, ApiErrors.idempotencyMismatch], successStatuses: [201], sideEffects: ["decision-recorded", "coordinator-event-emitted"], mutation: true },
  listBaselines: { method: "GET", path: "/private/self-improvement/baselines", operation: "audit.read", locationSource: "header-grant", principals: ["audit-reader", "evaluator", "coordinator"], authorizationRules: [], headers: LocationHeaders, request: ListBaselinesRequest, response: ListBaselinesResponse, errors: [ApiErrors.invalidPage, ApiErrors.forbidden], successStatuses: [200], ordering: "created-id-desc", sideEffects: ["none"], mutation: false },
  listMetricRuns: { method: "GET", path: "/private/self-improvement/metric-runs", operation: "audit.read", locationSource: "header-grant", principals: ["audit-reader", "evaluator", "coordinator"], authorizationRules: [{ type: "include-samples-audit-reader-only", principal: "audit-reader", queryField: "includeSamples" }], headers: LocationHeaders, request: ListMetricRunsRequest, response: ListMetricRunsResponse, errors: [ApiErrors.invalidPage, ApiErrors.forbidden], successStatuses: [200], ordering: "created-id-desc", sideEffects: ["none"], mutation: false },
  listEvaluations: { method: "GET", path: "/private/self-improvement/evaluations", operation: "audit.read", locationSource: "header-grant", principals: ["audit-reader", "evaluator", "coordinator"], authorizationRules: [], headers: LocationHeaders, request: ListEvaluationsRequest, response: ListEvaluationsResponse, errors: [ApiErrors.invalidPage, ApiErrors.forbidden], successStatuses: [200], ordering: "decided-id-desc", sideEffects: ["none"], mutation: false },
  listTransitions: { method: "GET", path: "/private/self-improvement/transitions", operation: "audit.read", locationSource: "header-grant", principals: ["audit-reader", "coordinator"], authorizationRules: [], headers: LocationHeaders, request: ListTransitionsRequest, response: ListTransitionsResponse, errors: [ApiErrors.invalidPage, ApiErrors.forbidden], successStatuses: [200], ordering: "timestamp-id-desc", sideEffects: ["none"], mutation: false },
  listApprovals: { method: "GET", path: "/private/self-improvement/approvals", operation: "audit.read", locationSource: "header-grant", principals: ["audit-reader", "location-approver"], authorizationRules: [{ type: "approver-own-decisions-only", principal: "location-approver" }], headers: LocationHeaders, request: ListApprovalsRequest, response: ListApprovalsResponse, errors: [ApiErrors.invalidPage, ApiErrors.forbidden], successStatuses: [200], ordering: "decided-id-desc", sideEffects: ["none"], mutation: false },
  listContextEvidence: { method: "GET", path: "/private/self-improvement/context-evidence", operation: "audit.read", locationSource: "header-grant", principals: ["audit-reader", "coordinator"], authorizationRules: [], headers: LocationHeaders, request: ListContextEvidenceRequest, response: ListContextEvidenceResponse, errors: [ApiErrors.invalidPage, ApiErrors.forbidden], successStatuses: [200], ordering: "created-id-desc", sideEffects: ["none"], mutation: false },
  listRoutingDecisions: { method: "GET", path: "/private/self-improvement/routing-decisions", operation: "audit.read", locationSource: "header-grant", principals: ["audit-reader", "coordinator"], authorizationRules: [], headers: LocationHeaders, request: ListRoutingDecisionsRequest, response: ListRoutingDecisionsResponse, errors: [ApiErrors.invalidPage, ApiErrors.forbidden], successStatuses: [200], ordering: "timestamp-id-desc", sideEffects: ["none"], mutation: false },
  listAudit: { method: "GET", path: "/private/self-improvement/audit", operation: "audit.read", locationSource: "header-grant", principals: ["audit-reader"], authorizationRules: [{ type: "audit-reader-only-audit", principal: "audit-reader" }], headers: LocationHeaders, request: ListAuditRequest, response: ListAuditResponse, errors: [ApiErrors.invalidPage, ApiErrors.forbidden], successStatuses: [200], ordering: "timestamp-id-desc", sideEffects: ["access-audited"], mutation: false },
} as const satisfies Record<string, PrivateApiOperation>
```

- [ ] **Step 5: Complete API contract coverage**

Add strict decode/encode tests for all 22 request and response schemas, all three header schemas, string-to-revision `If-Match`, exact four-field `ApiError`, closed `ApiErrorDetails`, every error/status pair, Base64 proposal byte round-trip, disjoint completed/pending command results and their `200/202` mappings, status/body-paired stored responses, exact 30-day idempotency expiry, default page limit 50, limits 1 and 100, rejected limits 0 and 101, cursor omission, operation/principal/Location-source metadata, all six typed conditional authorization rules on their exact operations, closed side-effect tags, exact result ordering, mutation flags, exact path order, only `GET|POST`, no public path, no arbitrary stage operation, no caller-supplied `source`, explicit active/shadow/canary projections, `EvaluationRun.createdAt`, sortable mixed `ContextEvidenceView` envelopes, narrow rejection reasons, and stable unique identifiers.

Use behavior and registry assertions:

```ts
test("private API wire contracts are closed and preserve HTTP encodings", () => {
  const headers = {
    "X-OpenCode-Location-ID": "a".repeat(64),
    "Idempotency-Key": "retry-1",
    "If-Match": "7",
  }
  expect(decode(SelfImprovementApi.ArtifactMutationHeaders, headers)["If-Match"]).toBe(7)
  expect(() => decode(SelfImprovementApi.ArtifactMutationHeaders, { ...headers, "If-Match": "-1" })).toThrow()
  const error = { code: "artifact-not-found", message: "not found", requestID: "req-1", details: {} }
  expect(decode(SelfImprovementApi.ApiError, error)).toEqual(error)
  expect(() => decode(SelfImprovementApi.ApiError, { ...error, transcript: "raw" })).toThrow()
  expect(decode(SelfImprovementApi.StoredResponse, { status: 404, body: error })).toEqual({ status: 404, body: error })
  expect(() => decode(SelfImprovementApi.StoredResponse, { status: 400, body: error })).toThrow()
  expect(() => decode(SelfImprovementApi.CommandResult, { status: "completed", artifactRevision: 1 })).toThrow()
  expect(SelfImprovementApi.PrivateApiOperations.listAudit.sideEffects).toEqual(["access-audited"])
  expect(SelfImprovementApi.PrivateApiOperations.createArtifact.errors).toContainEqual({ code: "admission-rejected", status: 400 })
  expect(SelfImprovementApi.PrivateApiOperations.createArtifact.authorizationRules).toEqual([
    { type: "coordinator-generated-only", principal: "coordinator", condition: "generated-output" },
  ])
  expect(SelfImprovementApi.PrivateApiOperations.listMetricRuns.authorizationRules).toEqual([
    { type: "include-samples-audit-reader-only", principal: "audit-reader", queryField: "includeSamples" },
  ])
  expect(SelfImprovementApi.PrivateApiOperations.listAudit.operation).toBe("audit.read")
  expect(SelfImprovementApi.PrivateApiOperations.getArtifact.locationSource).toBe("artifact-header-grant")
  expect(Object.values(SelfImprovementApi.PrivateApiOperations).every((operation) => operation.path.startsWith("/private/self-improvement"))).toBe(true)
})

test("idempotency records pair status/body and expire after exactly 30 days", () => {
  const record = {
    id: SelfImprovementLifecycle.IdempotencyRecordID.create(),
    identity: {
      principalID: "user-1",
      locationID: "a".repeat(64),
      operation: "artifact.read",
      key: "retry-1",
    },
    requestDigest: "b".repeat(64),
    storedBodyDigest: "c".repeat(64),
    storedResponse: {
      status: 404,
      body: { code: "artifact-not-found", message: "not found", requestID: "req-1", details: {} },
    },
    createdAt: 1,
    expiresAt: 1 + 30 * 86_400_000,
  }
  expect(decode(SelfImprovementApi.IdempotencyRecord, record)).toEqual(record)
  expect(() => decode(SelfImprovementApi.IdempotencyRecord, { ...record, expiresAt: record.expiresAt - 1 })).toThrow()
})
```

- [ ] **Step 6: Run focused GREEN checks**

Run from `packages/schema`:

```bash
bun test test/self-improvement-api.test.ts
bun typecheck
```

Expected: both commands exit 0; Bun reports all API contract tests passing and typecheck prints no errors.

- [ ] **Step 7: Commit Task 4 only**

```bash
git add packages/schema/src/self-improvement-api.ts packages/schema/test/self-improvement-api.test.ts
git diff --cached --check
git commit -m "feat(schema): add self-improvement private API contracts"
```

Expected: one commit containing exactly the two Task 4 files.

### Task 5: Root Exports, Live Dependency Compile Contract, Traceability, And Integrated S01 Validation

**Files:**
- Modify: `packages/schema/src/index.ts:1-28`
- Create: `packages/core/src/self-improvement/contracts.ts:1-end`
- Test: `packages/core/test/self-improvement-contracts.test.ts:1-end`
- Read only: live dependency regions listed in Orchestrator Bootstrap And Mandatory Isolated Execution Preflight

**Interfaces:**
- Consumes Schema namespaces: `SelfImprovement`, `SelfImprovementLifecycle`, `SelfImprovementEvaluation`, `SelfImprovementLearning`, and `SelfImprovementApi`.
- Consumes live Core signatures: `SelfImprovementProposal.parse(input: Uint8Array): SelfImprovement.ProposalParseResult`; `Policy.Interface.evaluate(action: string, resource: string, fallback: Policy.Effect): Effect.Effect<Policy.Effect>`; `Catalog.Interface.provider.get/all/available`; `Catalog.Interface.model.get/all/available/default/small`; `PluginV2.Interface.wait(id: PluginV2.ID): Effect.Effect<void>`; `SessionRunnerModel.Interface.resolve(session: SessionSchema.Info): Effect.Effect<Model, SessionRunnerModel.Error>`; `SystemContext.make<A>(source: SystemContext.Source<A>): SystemContext.SystemContext`; `SystemContext.combine(values: ReadonlyArray<SystemContext.SystemContext>): SystemContext.SystemContext`; `Location.Ref`; and `Location.Interface`.
- Produces root exports: `SelfImprovementLifecycle`, `SelfImprovementEvaluation`, `SelfImprovementLearning`, and `SelfImprovementApi`.
- Produces Core contracts: `SelfImprovementContracts.LiveDependencies`, `LiveTypeAssertions`, `ProposalParse`, `VariantPluginID`, `SystemContextFunctions`, `locationID(location: Location.Ref): SelfImprovementLifecycle.LocationID`, and `S01Traceability`.
- `LiveDependencies` writes every expected function signature explicitly; `LiveTypeAssertions` proves bidirectional equality with the live interfaces. Neither contains service tags, resolver implementation, layer, mutable state, fallback loop, route selection, Policy load, Catalog transform, plugin registration, or runner call.

- [ ] **Step 1: Write the failing root/dependency contract test**

```ts
import { expect, test } from "bun:test"
import {
  SelfImprovementApi,
  SelfImprovementEvaluation,
  SelfImprovementLearning,
  SelfImprovementLifecycle,
} from "@opencode-ai/schema"
import { Schema } from "effect"
import { Location } from "../src/location"
import { PluginV2 } from "../src/plugin"
import { SystemContext } from "../src/system-context"
import { SelfImprovementContracts } from "../src/self-improvement/contracts"
import { SelfImprovementProposal } from "../src/self-improvement/proposal"

test("exports canonical S01 namespaces and live dependency identities", () => {
  expect(SelfImprovementLifecycle.ArtifactID).toBeDefined()
  expect(SelfImprovementEvaluation.GateID).toBeDefined()
  expect(SelfImprovementLearning.RoutingDecision).toBeDefined()
  expect(SelfImprovementApi.PrivateApiOperations).toBeDefined()
  expect(SelfImprovementContracts.VariantPluginID).toBe(PluginV2.ID.make("variant"))
  expect(SelfImprovementContracts.ProposalParse).toBe(SelfImprovementProposal.parse)
  expect(SelfImprovementContracts.SystemContextFunctions.make).toBe(SystemContext.make)
  expect(SelfImprovementContracts.SystemContextFunctions.combine).toBe(SystemContext.combine)
})

test("derives opaque Location IDs from the complete versioned Location.Ref", () => {
  const ref = (directory: string, workspaceID?: string) =>
    Schema.decodeUnknownSync(Location.Ref)({ directory, ...(workspaceID === undefined ? {} : { workspaceID }) })
  expect(SelfImprovementContracts.locationID(ref("/tmp/one", "wrk_test"))).toBe(
    "d24cc3fcbde62bde5441826f944f97b336fafb8ef8f0d427b08ae4f60de0b596",
  )
  expect(SelfImprovementContracts.locationID(ref("/tmp/project"))).toBe(
    "fe51b43122d0ae9e9e072da9b714dffd623fa97489917d443695f0e3b7c8ba89",
  )
  expect(SelfImprovementContracts.locationID(ref("/tmp/two", "wrk_test"))).toBe(
    "7a53078550e5ae78d0fe6119338af04a8ded3b5d1210f83239eb7ae8468737e6",
  )
  expect(SelfImprovementContracts.locationID(ref("/tmp/two", "wrk_test"))).not.toBe(
    SelfImprovementContracts.locationID(ref("/tmp/one", "wrk_test")),
  )
  expect(SelfImprovementContracts.locationID(ref("/tmp/one", "wrk_test"))).toBe(
    SelfImprovementContracts.locationID(ref("/tmp/one", "wrk_test")),
  )
  expect(SelfImprovementContracts.locationID(ref("/tmp/one"))).not.toBe(
    SelfImprovementContracts.locationID(ref("/tmp/two")),
  )
  expect(SelfImprovementContracts.locationID(ref("/tmp/project"))).toMatch(/^[0-9a-f]{64}$/)
})

test("pins S01 traceability and routing precedence", () => {
  expect(Object.keys(SelfImprovementContracts.S01Traceability)).toEqual([
    "R-01", "R-02", "R-03", "R-04", "R-05", "R-06", "R-07", "R-08", "R-09", "R-10", "R-11", "R-12",
    "R-13", "R-14", "R-15", "R-16", "R-17", "R-18", "R-19", "R-20", "R-21", "R-22", "R-23", "R-24",
  ])
  expect(SelfImprovementContracts.S01Traceability["R-13"]).toEqual({
    contracts: ["SelfImprovementApi.PrivateApiOperations", "SelfImprovementApi.LocationSource", "SelfImprovementApi.ConditionalAuthorizationRule", "SelfImprovementApi.ApiError", "SelfImprovementApi.ApiErrorDetails"],
    behaviorDeferredTo: ["S08", "S09"],
  })
  expect(SelfImprovementContracts.S01Traceability["R-15"].contracts).toContain(
    "SelfImprovementLearning.ContextSelectionEvidence",
  )
  expect(SelfImprovementLearning.RoutingPrecedence).toEqual([
    "session-user",
    "role",
    "active-recommendation",
    "catalog-default",
    "catalog-fallback",
  ])
})
```

Complete this test with one deep-equality assertion for the full `S01Traceability` object shown in Step 4; checking only keys or representative rows is insufficient.

- [ ] **Step 2: Run the test to verify RED**

Run from `packages/core`:

```bash
bun test test/self-improvement-contracts.test.ts
```

Expected when the reconciled paths are absent: FAIL because `@opencode-ai/schema` does not export the four S01 namespaces and `../src/self-improvement/contracts` does not exist. If either path exists on `APPROVED_BASE_SHA`, preserve it, add the exact full-`Location.Ref` vector assertions from Step 1 and the `LiveTypeAssertions` object from Step 5, then verify the first unsatisfied vector or type equality fails before editing production code.

- [ ] **Step 3: Add canonical Schema root exports**

Add these exact lines beside the existing `SelfImprovement` export in `packages/schema/src/index.ts`:

```ts
export { SelfImprovementApi } from "./self-improvement-api"
export { SelfImprovementEvaluation } from "./self-improvement-evaluation"
export { SelfImprovementLearning } from "./self-improvement-learning"
export { SelfImprovementLifecycle } from "./self-improvement-lifecycle"
```

- [ ] **Step 4: Add the Core compile-time live dependency contract**

```ts
export * as SelfImprovementContracts from "./contracts"

import { type Model } from "@opencode-ai/llm"
import { AbsolutePath, SelfImprovement, SelfImprovementLifecycle } from "@opencode-ai/schema"
import { type WorkspaceID } from "@opencode-ai/schema/workspace-id"
import { Effect } from "effect"
import { Catalog } from "../catalog"
import { Location } from "../location"
import { ModelV2 } from "../model"
import { PluginV2 } from "../plugin"
import { Policy } from "../policy"
import { Project } from "../project"
import { ProviderV2 } from "../provider"
import { SessionRunnerModel } from "../session/runner/model"
import { SessionSchema } from "../session/schema"
import { SystemContext } from "../system-context"
import { Hash } from "../util/hash"
import { SelfImprovementProposal } from "./proposal"

export interface LiveDependencies {
  readonly proposalParse: (input: Uint8Array) => SelfImprovement.ProposalParseResult
  readonly policyEvaluate: (action: string, resource: string, fallback: Policy.Effect) => Effect.Effect<Policy.Effect>
  readonly catalogProviderGet: (providerID: ProviderV2.ID) => Effect.Effect<ProviderV2.Info | undefined>
  readonly catalogProviderAll: () => Effect.Effect<ProviderV2.Info[]>
  readonly catalogProviderAvailable: () => Effect.Effect<ProviderV2.Info[]>
  readonly catalogModelGet: (providerID: ProviderV2.ID, modelID: ModelV2.ID) => Effect.Effect<ModelV2.Info | undefined>
  readonly catalogModelAll: () => Effect.Effect<ModelV2.Info[]>
  readonly catalogModelAvailable: () => Effect.Effect<ModelV2.Info[]>
  readonly catalogModelDefault: () => Effect.Effect<ModelV2.Info | undefined>
  readonly catalogModelSmall: (providerID: ProviderV2.ID) => Effect.Effect<ModelV2.Info | undefined>
  readonly variantWait: (id: PluginV2.ID) => Effect.Effect<void>
  readonly runnerResolve: (session: SessionSchema.Info) => Effect.Effect<Model, SessionRunnerModel.Error>
  readonly systemContextMake: <A>(source: SystemContext.Source<A>) => SystemContext.SystemContext
  readonly systemContextCombine: (values: ReadonlyArray<SystemContext.SystemContext>) => SystemContext.SystemContext
  readonly locationRef: { readonly directory: AbsolutePath; readonly workspaceID?: WorkspaceID }
  readonly location: {
    readonly directory: AbsolutePath
    readonly workspaceID?: WorkspaceID
    readonly project: { readonly id: Project.ID; readonly directory: AbsolutePath }
    readonly vcs?: Project.Vcs
  }
}

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends (<Value>() => Value extends Right ? 1 : 2)
    ? (<Value>() => Value extends Right ? 1 : 2) extends (<Value>() => Value extends Left ? 1 : 2)
      ? true
      : false
    : false
type Assert<Condition extends true> = Condition
export type LiveTypeAssertions = {
  readonly proposalParse: Assert<Equal<LiveDependencies["proposalParse"], typeof SelfImprovementProposal.parse>>
  readonly policyEvaluate: Assert<Equal<LiveDependencies["policyEvaluate"], Policy.Interface["evaluate"]>>
  readonly catalogProviderGet: Assert<Equal<LiveDependencies["catalogProviderGet"], Catalog.Interface["provider"]["get"]>>
  readonly catalogProviderAll: Assert<Equal<LiveDependencies["catalogProviderAll"], Catalog.Interface["provider"]["all"]>>
  readonly catalogProviderAvailable: Assert<Equal<LiveDependencies["catalogProviderAvailable"], Catalog.Interface["provider"]["available"]>>
  readonly catalogModelGet: Assert<Equal<LiveDependencies["catalogModelGet"], Catalog.Interface["model"]["get"]>>
  readonly catalogModelAll: Assert<Equal<LiveDependencies["catalogModelAll"], Catalog.Interface["model"]["all"]>>
  readonly catalogModelAvailable: Assert<Equal<LiveDependencies["catalogModelAvailable"], Catalog.Interface["model"]["available"]>>
  readonly catalogModelDefault: Assert<Equal<LiveDependencies["catalogModelDefault"], Catalog.Interface["model"]["default"]>>
  readonly catalogModelSmall: Assert<Equal<LiveDependencies["catalogModelSmall"], Catalog.Interface["model"]["small"]>>
  readonly variantWait: Assert<Equal<LiveDependencies["variantWait"], PluginV2.Interface["wait"]>>
  readonly runnerResolve: Assert<Equal<LiveDependencies["runnerResolve"], SessionRunnerModel.Interface["resolve"]>>
  readonly systemContextMake: Assert<Equal<LiveDependencies["systemContextMake"], typeof SystemContext.make>>
  readonly systemContextCombine: Assert<Equal<LiveDependencies["systemContextCombine"], typeof SystemContext.combine>>
  readonly locationRef: Assert<Equal<LiveDependencies["locationRef"], Location.Ref>>
  readonly location: Assert<Equal<LiveDependencies["location"], Location.Interface>>
}

export const ProposalParse: LiveDependencies["proposalParse"] = SelfImprovementProposal.parse
export const VariantPluginID = PluginV2.ID.make("variant")
export const SystemContextFunctions: {
  readonly make: LiveDependencies["systemContextMake"]
  readonly combine: LiveDependencies["systemContextCombine"]
} = {
  make: SystemContext.make,
  combine: SystemContext.combine,
}
export const locationID = (
  location: Location.Ref,
): SelfImprovementLifecycle.LocationID =>
  SelfImprovementLifecycle.LocationID.make(
    Hash.sha256(
      `self-improvement/location/v1\0directory\0${location.directory}\0workspace\0${location.workspaceID ?? ""}`,
    ),
  )

export const S01Traceability = {
  "R-01": { contracts: ["SelfImprovementLifecycle.LocationID", "SelfImprovementLifecycle.ArtifactKey", "SelfImprovementLifecycle.ArtifactVersion"], behaviorDeferredTo: ["S02"] },
  "R-02": { contracts: ["SelfImprovementLifecycle.PrincipalKind", "SelfImprovementLifecycle.Operation", "SelfImprovementApi.PrivateApiOperations"], behaviorDeferredTo: ["S08", "S09"] },
  "R-03": { contracts: ["SelfImprovementLifecycle.ApprovalBinding", "SelfImprovementLifecycle.ApprovalRequest", "SelfImprovementLifecycle.ApprovalDecision", "SelfImprovementLifecycle.Approval"], behaviorDeferredTo: ["S06"] },
  "R-04": { contracts: [], behaviorDeferredTo: ["S04"] },
  "R-05": { contracts: ["SelfImprovementLifecycle.CapabilityManifest"], behaviorDeferredTo: ["S04"] },
  "R-06": { contracts: ["SelfImprovementContracts.LiveDependencies", "SelfImprovementContracts.LiveTypeAssertions", "SelfImprovementContracts.locationID"], behaviorDeferredTo: ["S08", "S10", "S11"] },
  "R-07": { contracts: ["SelfImprovementEvaluation.Baseline", "SelfImprovementEvaluation.RequiredGateSequence", "SelfImprovementEvaluation.MetricThresholds", "SelfImprovementEvaluation.MetricTotals"], behaviorDeferredTo: ["S03"] },
  "R-08": { contracts: ["SelfImprovementLifecycle.ArtifactStage", "SelfImprovementLifecycle.LifecycleEvent", "SelfImprovementLifecycle.Rollback"], behaviorDeferredTo: ["S05", "S06"] },
  "R-09": { contracts: ["SelfImprovementEvaluation.GateID", "SelfImprovementEvaluation.GateFinding"], behaviorDeferredTo: ["S04"] },
  "R-10": { contracts: ["SelfImprovementEvaluation.MetricComponents", "SelfImprovementEvaluation.MetricTotals", "SelfImprovementEvaluation.MetricAggregates"], behaviorDeferredTo: ["S03", "S04"] },
  "R-11": { contracts: ["SelfImprovementLearning.GenerationStrategyArm", "SelfImprovementLearning.ModelRouteArm", "SelfImprovementLearning.BanditArmID", "SelfImprovementLearning.PullEvent", "SelfImprovementLearning.RewardEvent", "SelfImprovementLearning.BanditState"], behaviorDeferredTo: ["S11"] },
  "R-12": { contracts: ["SelfImprovementLearning.RoutingPrecedenceSource", "SelfImprovementLearning.RoutingDecision", "SelfImprovementLearning.ContextSelectionEvidence"], behaviorDeferredTo: ["S07", "S11"] },
  "R-13": { contracts: ["SelfImprovementApi.PrivateApiOperations", "SelfImprovementApi.LocationSource", "SelfImprovementApi.ConditionalAuthorizationRule", "SelfImprovementApi.ApiError", "SelfImprovementApi.ApiErrorDetails"], behaviorDeferredTo: ["S08", "S09"] },
  "R-14": { contracts: ["SelfImprovementLearning.IdempotencyIdentity", "SelfImprovementApi.StoredResponse", "SelfImprovementApi.IdempotencyRecord"], behaviorDeferredTo: ["S02", "S08"] },
  "R-15": { contracts: ["SelfImprovementLearning.ContextDesiredState", "SelfImprovementLearning.PendingTransitionIntent", "SelfImprovementLearning.ContextOutbox", "SelfImprovementLearning.ContextSelectionEvidence"], behaviorDeferredTo: ["S07"] },
  "R-16": { contracts: ["SelfImprovementEvaluation.EvaluationRun", "SelfImprovementEvaluation.MetricSample"], behaviorDeferredTo: ["S03"] },
  "R-17": { contracts: ["SelfImprovementLearning.Observation", "SelfImprovementLearning.GenerationLease"], behaviorDeferredTo: ["S09", "S10"] },
  "R-18": { contracts: ["SelfImprovementLearning.Observation", "SelfImprovementLearning.RetentionMetadata", "SelfImprovementLearning.AuditEntry"], behaviorDeferredTo: ["S09"] },
  "R-19": { contracts: [], behaviorDeferredTo: ["S12"] },
  "R-20": { contracts: ["SelfImprovementContracts.S01Traceability"], behaviorDeferredTo: ["S12"] },
  "R-21": { contracts: ["SelfImprovementApi.PrivateApiOperations"], behaviorDeferredTo: ["S02", "S03", "S04", "S05", "S06", "S07", "S08", "S09", "S10", "S11", "S12"] },
  "R-22": { contracts: ["SelfImprovementLifecycle.GlossaryTerm"], behaviorDeferredTo: [] },
  "R-23": { contracts: ["SelfImprovementLifecycle.LifecycleEvent", "SelfImprovementLifecycle.ApprovalDecision", "SelfImprovementLifecycle.Rollback", "SelfImprovementLearning.PendingTransitionIntent", "SelfImprovementLearning.ContextOutboxStatus"], behaviorDeferredTo: ["S12"] },
  "R-24": { contracts: ["SelfImprovementLifecycle.Rollback"], behaviorDeferredTo: ["S06", "S12"] },
} as const
```

- [ ] **Step 5: Add compile checks for exact live member signatures**

Append this compile-only equality witness and test to `packages/core/test/self-improvement-contracts.test.ts`:

```ts
const liveTypeAssertions = {
  proposalParse: true,
  policyEvaluate: true,
  catalogProviderGet: true,
  catalogProviderAll: true,
  catalogProviderAvailable: true,
  catalogModelGet: true,
  catalogModelAll: true,
  catalogModelAvailable: true,
  catalogModelDefault: true,
  catalogModelSmall: true,
  variantWait: true,
  runnerResolve: true,
  systemContextMake: true,
  systemContextCombine: true,
  locationRef: true,
  location: true,
} satisfies SelfImprovementContracts.LiveTypeAssertions

test("pins explicit live dependency signatures without casts or service tags", () => {
  expect(Object.values(liveTypeAssertions).every(Boolean)).toBe(true)
  expect(SelfImprovementLearning.RoutingPrecedence).toEqual([
    "session-user",
    "role",
    "active-recommendation",
    "catalog-default",
    "catalog-fallback",
  ])
})
```

- [ ] **Step 6: Record the mandatory dependency-resolution review**

Review the isolated-worktree source and record the commit SHA plus exact live file/line evidence in the implementation report. The required result is:

| Boundary | Live evidence to record | S01 conclusion |
| --- | --- | --- |
| Policy filters Catalog | `packages/core/src/catalog.ts` calls `Policy.Interface.evaluate("provider.use", ...)` while finalizing Catalog visibility | Reuse live Policy filtering; no S01 policy loader or bypass |
| Variant materialization precedes runner Catalog resolution | `packages/core/src/session/runner/model.ts` awaits `PluginV2.Interface.wait(PluginV2.ID.make("variant"))` before Catalog model lookup | Reuse live variant plugin; no S01 variant creation |
| Explicit session route precedes Catalog default/fallback | `SessionRunnerModel.Interface.resolve` checks `session.model` before `catalog.model.default()` and `catalog.model.available()` | Preserve live explicit/default/fallback order |
| Location runtime identity uses complete Ref | `packages/core/src/location-service-map.ts` declares `LayerMap.LayerMap<Location.Ref, ...>` | Hash versioned directory plus optional workspace together; never key by workspace alone |
| Role and learned recommendation insertion | No verified live role/recommendation insertion exists at S01 plan time | Keep `role` and `active-recommendation` in the precedence contract; implementation is explicitly S11 |
| Final route execution | `SessionRunnerModel.Interface.resolve` returns the supported materialized model route | Every later learned route must still pass through the live runner |

If any row is false on the execution base, block Task 5 and report the exact committed source conflict. Do not add role/recommendation routing or edit Catalog, Policy, plugin, or runner source in S01.

- [ ] **Step 7: Validate both normative Mermaid diagrams and record matrix consistency**

Load the existing `mermaid-diagram` and `drawio` skills. Extract the two diagram bodies from the approved spec without creating files:

```bash
sed -n '570,621p' docs/superpowers/specs/2026-07-17-smart-self-improvement-mvp-design.md
sed -n '625,650p' docs/superpowers/specs/2026-07-17-smart-self-improvement-mvp-design.md
```

Pass each exact output to `drawio_open_drawio_mermaid` with `lightbox: true`. Do not install a Mermaid dependency and do not create `.mmd`, `.drawio`, image, or generated source files. Both tool calls must render without a syntax error. Record this exact review matrix in the implementation report:

| Diagram vocabulary | S01 contracts that must match | S01 evidence | Full behavior owner |
| --- | --- | --- | --- |
| Lifecycle admission, shadow, canary, activation, deprecation, archive | `ArtifactStage`, `LifecycleEvent`, `LifecycleReason`, `GateID` | Closed-set and exact-order schema tests | S05, S12 |
| Approval request, rejection/expiry, exact approval, consumption | `ApprovalRequest`, `ApprovalBinding`, `ApprovalDecision`, `PendingTransitionIntent` | Discriminated-decision and intent schema tests | S06, S12 |
| Canary-only rollback retaining previous active | `Rollback`, `RewardEvent`, `PendingTransitionIntent` | Canary reason/run/reward reference tests | S06, S12 |
| Desired context, CAS apply, terminal removal, final transition | `ContextDesiredState`, `ContextOutbox`, `ContextOutboxStatus`, `PendingTransitionIntent` | Desired/outbox/intent vocabulary tests | S07, S12 |

If either diagram fails to render or any diagram term has no matching S01 vocabulary, block Task 5 and report the exact mismatch. S01 tests contract vocabulary only; transition, approval, rollback, and reconciliation behavior remains S12 verification.

- [ ] **Step 8: Add stable identifier and S01 hygiene inventory**

In the Core test, enumerate every schema named in Tasks 1-4, collect `schema.ast.annotations?.identifier`, and assert all entries are strings, start with their owning namespace, and are unique. Add exact assertions that:

```ts
expect(Object.keys(SelfImprovementApi.PrivateApiOperations)).toHaveLength(22)
expect(Object.values(SelfImprovementApi.PrivateApiOperations).every((operation) => operation.path.startsWith("/private/self-improvement"))).toBe(true)
expect(Object.values(SelfImprovementApi.PrivateApiOperations).some((operation) => operation.path.includes("stage"))).toBe(false)
expect(SelfImprovementLearning.RoutingPrecedence).toEqual(["session-user", "role", "active-recommendation", "catalog-default", "catalog-fallback"])
```

The inventory must include every produced schema from each task's Interfaces block and must not include private helper schemas.

- [ ] **Step 9: Run focused GREEN checks**

Run from `packages/core`:

```bash
bun test test/self-improvement-contracts.test.ts
bun typecheck
```

Expected: both commands exit 0; Bun reports the dependency/traceability tests passing and typecheck prints no errors.

- [ ] **Step 10: Run integrated S01 schema tests**

Run from `packages/schema`:

```bash
bun test test/self-improvement.test.ts test/self-improvement-lifecycle.test.ts test/self-improvement-evaluation.test.ts test/self-improvement-learning.test.ts test/self-improvement-api.test.ts test/contract-hygiene.test.ts
bun typecheck
```

Expected: both commands exit 0; existing Slice 1A and contract-hygiene tests remain green together with all S01 tests.

- [ ] **Step 11: Run lint and isolated-worktree hygiene review**

Run from the repository root:

```bash
bun lint packages/schema/src/self-improvement-lifecycle.ts packages/schema/src/self-improvement-evaluation.ts packages/schema/src/self-improvement-learning.ts packages/schema/src/self-improvement-api.ts packages/schema/test/self-improvement-lifecycle.test.ts packages/schema/test/self-improvement-evaluation.test.ts packages/schema/test/self-improvement-learning.test.ts packages/schema/test/self-improvement-api.test.ts packages/schema/src/index.ts packages/core/src/self-improvement/contracts.ts packages/core/test/self-improvement-contracts.test.ts
git diff --check -- packages/schema/src/self-improvement-lifecycle.ts packages/schema/src/self-improvement-evaluation.ts packages/schema/src/self-improvement-learning.ts packages/schema/src/self-improvement-api.ts packages/schema/test/self-improvement-lifecycle.test.ts packages/schema/test/self-improvement-evaluation.test.ts packages/schema/test/self-improvement-learning.test.ts packages/schema/test/self-improvement-api.test.ts packages/schema/src/index.ts packages/core/src/self-improvement/contracts.ts packages/core/test/self-improvement-contracts.test.ts
git status --short
```

Expected: lint exits 0; `git diff --check` prints nothing; status at this pre-commit step shows only the three planned Task 5 paths. Confirm no migration, Drizzle schema, evaluator, lifecycle service, approval service, context reconciler, HTTP handler, ingestion service, generation service, bandit algorithm, runtime router, generated file, lockfile, Protocol, Server, SDK, or E2E path was added to an S01 commit. Step 13 verifies the clean post-commit state.

- [ ] **Step 12: Commit Task 5 only**

```bash
git add packages/schema/src/index.ts packages/core/src/self-improvement/contracts.ts packages/core/test/self-improvement-contracts.test.ts
git diff --cached --check
git commit -m "feat(core): pin self-improvement dependency contracts"
```

Expected: one commit containing exactly the three Task 5 files in the isolated worktree; the shared dirty checkout remains unmodified.

- [ ] **Step 13: Validate the complete committed S01 range**

Run from the isolated-worktree root after the Task 5 commit:

```bash
git diff --check "$APPROVED_BASE_SHA"..HEAD -- packages/schema/src/self-improvement-lifecycle.ts packages/schema/test/self-improvement-lifecycle.test.ts packages/schema/src/self-improvement-evaluation.ts packages/schema/test/self-improvement-evaluation.test.ts packages/schema/src/self-improvement-learning.ts packages/schema/test/self-improvement-learning.test.ts packages/schema/src/self-improvement-api.ts packages/schema/test/self-improvement-api.test.ts packages/schema/src/index.ts packages/core/src/self-improvement/contracts.ts packages/core/test/self-improvement-contracts.test.ts
git status --short
```

Expected: both commands print nothing and exit 0. Any other changed path or whitespace error blocks completion.

## Final S01 Review Gate

- [ ] Confirm all required S01 domains have executable schemas or compile contracts: glossary, IDs, Location keys, six kinds, tombstones, sources, behavior classes, stages, principals, operations, lifecycle vocabulary, capability/generated metadata, approval requests/bindings/decisions, Location-owned suites and route arms, exact gate sequence/thresholds/tightening overrides, baselines/runs/samples/findings, seven metric components, pass/fail/not-applicable, 23 gate IDs, observations/leases, typed generation/route arms, pulls/rewards/projection, routing precedence, desired context/transition intents/outbox, mixed sortable context evidence, audit/status-paired idempotency/retention, and all 22 private operations.
- [ ] Confirm all S01 public schemas have stable unique identifiers, every generated entity ID validates the same prefix its `create()` method emits, and `LocationID` has no `create()` method and is constructed only by the deterministic adapter through `LocationID.make(...)`.
- [ ] Confirm every contract is Location-owned directly or through its artifact/run parent and `ArtifactVersion` does not duplicate Location scope.
- [ ] Confirm private API contracts expose no handler, public route, arbitrary stage setter, generic mutable update, provider constructor, or physical delete.
- [ ] Confirm every private operation pins its domain operation, Location source, principals, and exact conditional authorization rule; completed/pending results and every stored error remain status/body-valid.
- [ ] Confirm no schema can carry raw prompts, transcripts, secrets, credentials, URLs, full tool arguments, or provider settings.
- [ ] Confirm the Core boundary references the live Slice 1A parser and live service identities and does not implement a parallel route resolver.
- [ ] Confirm `S01Traceability` contains every key from `R-01` through `R-24`, including deferred-only `R-04` and `R-19`, and both approved Mermaid diagrams rendered successfully with the recorded lifecycle/approval/rollback/outbox matrix.
- [ ] Confirm routing precedence remains `session/user -> role -> active recommendation -> Catalog default -> Catalog fallback`, with Policy/Catalog/variant/SessionRunnerModel checks required at execution time.
- [ ] Confirm no persistence, migration, evaluator, coordinator, approval behavior, reconciliation behavior, HTTP handler, ingestion, generation, bandit algorithm, routing execution, context application, or E2E implementation entered the diff.
- [ ] Confirm all focused tests, both package typechecks, lint, and `git diff --check` passed with the exact commands above.
- [ ] Confirm each commit stages only its task files and the shared dirty checkout remains unmodified.
