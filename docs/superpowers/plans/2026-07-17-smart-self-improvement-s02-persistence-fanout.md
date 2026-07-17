# S02 Self-Improvement Persistence Fanout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Location-scoped durable storage for every S01 self-improvement persistence contract without adding runtime behavior.

**Architecture:** Five exclusive stores own disjoint Drizzle table sets: artifact admission, lifecycle evidence, evaluation evidence, learning evidence, and durable context state. Each store is an Effect service backed by `Database.Service`; only S02 persistence reads and writes rows. The integrator wires only generated database artifacts after all owner commits are available.

**Tech Stack:** Bun, TypeScript, Effect v4, Drizzle SQLite, `@opencode-ai/schema`, Bun test.

## Global Constraints

- Work in `/Users/kritthapas.phe/Workspace/Personal/opencode/.worktrees/self-improvement-s02` on `self-improvement-s02`.
- Use S01 contracts from `@opencode-ai/schema/self-improvement`, `self-improvement-lifecycle`, `self-improvement-evaluation`, `self-improvement-learning`, and `self-improvement-api`; do not change those schemas.
- Use snake_case columns; persist branded IDs and digests as `text`, revisions/timestamps/counts as `integer`, finite metric values as `real`, booleans as integer-backed Drizzle booleans.
- JSON columns contain only canonical JSON emitted/decoded by existing S01 schemas. Store canonical JSON strings as `text`; use `text({ mode: "json" })` only for value shapes whose S01 class is encoded/decoded by the store. No `any`, casts, raw `JSON.parse`, or new dependency.
- Every read and mutation accepts `locationID` and includes it in its predicate, even when a parent foreign key implies it. There is no cross-Location fallback.
- Evidence/event rows are append-only. Only `artifact.revision`, `evaluation_run.state/cutoff_sample_set_digest/decided_at`, `generation_lease` while held, `bandit_state`, `context_desired_state`, and `context_outbox` retry/status fields are projections/CAS state.
- Store services export `Transaction = Parameters<Parameters<DatabaseClient["transaction"]>[0]>[0]`; mutation methods take `(input, tx?: Transaction)`. Callers start transactions; stores do not invent coordinators.
- S02 does not add handlers, APIs, authorization, admission, evaluators, lifecycle coordinators, generation, reconciliation, routing, background workers, or user-visible behavior.
- Owner-ready means the owner commit changes only its packet paths and passes its focused test, Core typecheck, formatting, scoped lint, and diff/scope check. Integrated means all five commits and integrator-generated artifacts are assembled and the listed integrated checks pass. Neither term claims production readiness.

---

## Completion Definition

- Owner-ready: each owner has one schema file, one store module, one focused test, exact exports below, and no shared/generated file edits.
- Integrated: all owner commits fan in in dependency order; the integrator generates one migration named `self_improvement_persistence`, refreshes `schema.json`, `schema.gen.ts`, and `migration.gen.ts`, and resolves only generated/shared wiring.
- Explicitly deferred: concurrent mutation/race stress, System Context registry CAS against a live registry, authorization/tenant isolation at HTTP boundaries, retention jobs, production migration rehearsal, security review of redacted payload producers, and environment/E2E validation.
- Production-ready is explicitly not claimed.

## Change Inventory

| Path                                                           | Change   | Responsibility                                                         | Owner      | Validation              |
| -------------------------------------------------------------- | -------- | ---------------------------------------------------------------------- | ---------- | ----------------------- |
| `packages/core/src/self-improvement/artifact.sql.ts`           | create   | artifact/version/idempotency tables                                    | Owner 1    | artifact store test     |
| `packages/core/src/self-improvement/artifact-store.ts`         | create   | immutable admission persistence                                        | Owner 1    | artifact store test     |
| `packages/core/test/self-improvement-artifact-store.test.ts`   | create   | Location/name/version/idempotency checks                               | Owner 1    | Bun test                |
| `packages/core/src/self-improvement/lifecycle.sql.ts`          | create   | transition/approval/rollback/stage projection tables                   | Owner 2    | lifecycle store test    |
| `packages/core/src/self-improvement/lifecycle-store.ts`        | create   | append-only lifecycle evidence and CAS stage slots                     | Owner 2    | lifecycle store test    |
| `packages/core/test/self-improvement-lifecycle-store.test.ts`  | create   | transition, approval, slot checks                                      | Owner 2    | Bun test                |
| `packages/core/src/self-improvement/evaluation.sql.ts`         | create   | suite, baseline, run, sample, decision/finding tables                  | Owner 3    | evaluation store test   |
| `packages/core/src/self-improvement/evaluation-store.ts`       | create   | immutable evaluation evidence and run CAS                              | Owner 3    | Bun test                |
| `packages/core/test/self-improvement-evaluation-store.test.ts` | create   | baseline/run/sample/decision checks                                    | Owner 3    | Bun test                |
| `packages/core/src/self-improvement/learning.sql.ts`           | create   | observations, leases, arms, pulls, rewards, projection, routing, audit | Owner 4    | learning store test     |
| `packages/core/src/self-improvement/learning-store.ts`         | create   | learning append log and projection persistence                         | Owner 4    | Bun test                |
| `packages/core/test/self-improvement-learning-store.test.ts`   | create   | lease/event/projection/audit checks                                    | Owner 4    | Bun test                |
| `packages/core/src/self-improvement/context.sql.ts`            | create   | desired state, outbox, selection evidence                              | Owner 5    | context store test      |
| `packages/core/src/self-improvement/context-store.ts`          | create   | desired-state and outbox CAS persistence                               | Owner 5    | Bun test                |
| `packages/core/test/self-improvement-context-store.test.ts`    | create   | slot/outbox/selection checks                                           | Owner 5    | Bun test                |
| `packages/core/schema.json`                                    | generate | Drizzle snapshot                                                       | Integrator | `bun migration --check` |
| `packages/core/src/database/migration/*.ts`                    | generate | migration                                                              | Integrator | migration test          |
| `packages/core/src/database/schema.gen.ts`                     | generate | full generated schema                                                  | Integrator | `bun migration --check` |
| `packages/core/src/database/migration.gen.ts`                  | generate | migration registry                                                     | Integrator | `bun migration --check` |

## Data Contract

### Owner 1: artifacts

`self_improvement_artifact`: `id` PK, `location_id`, `kind`, `name`, `status`, `created_by`, `created_at`, `revision`, `tombstone_actor_id`, `tombstone_reason`, `tombstone_at`; unique `(location_id, kind, name)` including tombstones; index `(location_id, status, kind, name, id)`.

`self_improvement_artifact_version`: `id` PK, `artifact_id` FK artifact `RESTRICT`, `version_number`, `source`, `behavior_class`, `proposal_json`, `canonical_json`, `proposal_digest`, `input_snapshot_digest`, `version_digest`, `capability_manifest_json`, `capability_manifest_digest`, `creator_id`, `created_at`, nullable generated metadata `generation_lease_id`, `strategy_pull_id`, `originating_task_id_digest`, `model_request_digest`, `model_output_digest`, `retention_deadline`; unique `(artifact_id, version_number)`, unique `version_digest`, and check that all generated metadata columns are null together or non-null together. Version Location inherits from artifact and all store queries join/filter `artifact.location_id`.

`self_improvement_idempotency`: `id` PK, `principal_id`, `location_id`, `operation`, `key`, `request_digest`, `status`, `body_digest`, `body_json`, `created_at`, `expires_at`; unique `(principal_id, location_id, operation, key)`; index `(location_id, expires_at)`.

### Owner 2: lifecycle

`self_improvement_stage_transition`: `id` PK, `version_id` FK version `RESTRICT`, `previous_stage`, `next_stage`, `event`, `reason`, `actor_id`, `timestamp`, nullable `evaluation_run_id`, `approval_id`, `rollback_id`, `context_outbox_id`, `idempotency_record_id`, `idempotency_digest`; unique `(idempotency_record_id, idempotency_digest)`; index `(version_id, timestamp, id)`.

`self_improvement_version_stage`: `version_id` PK/FK version `RESTRICT`, `location_id`, `artifact_id`, `stage`, `transition_id` unique, `revision`; unique partial indexes `(artifact_id) WHERE stage = 'active'`, `(artifact_id) WHERE stage = 'shadow'`, `(artifact_id) WHERE stage = 'canary'`; index `(location_id, artifact_id, stage)`. This is a rebuildable projection; CAS updates require expected `revision` and expected stage.

`self_improvement_approval_request`: `id` PK, `location_id`, `version_id` FK version, `version_digest`, `suite_id`, `suite_revision`, `evaluation_run_id`, `shadow_evidence_digest`, `creator_id`, `requested_at`; unique `(location_id, version_id, version_digest, suite_id, suite_revision, evaluation_run_id, shadow_evidence_digest)`.

`self_improvement_approval`: `id` PK, `request_id` unique FK approval request, `location_id`, binding columns above, `decision`, `approver_id`, `decided_at`, nullable `expires_at`, `consumed_at`, `rejection_reason`; check approved rows have expiry and rejected rows have rejection reason; unique partial `(request_id) WHERE consumed_at IS NOT NULL`.

`self_improvement_rollback`: `id` PK, `location_id`, `artifact_id`, `candidate_version_id`, `retained_active_version_id`, `canary_run_id`, `reason`, `reward_event_id`, `timestamp`; unique `canary_run_id`; index `(location_id, artifact_id, timestamp, id)`.

### Owner 3: evaluation

`self_improvement_suite_revision`: composite PK `(location_id, suite_id, revision)`, `workload`, `workload_revision`, `artifact_kinds_json`, `ordered_gates_json`, `thresholds_json`, `shadow_minimum_samples`, `canary_minimum_samples`, `creator_id`, `created_at`; unique `(location_id, workload, workload_revision, suite_id, revision)`.

`self_improvement_baseline`: `id` PK, `location_id`, workload/suite/revision tuple, `producer_allowlist_revision`, `control_source`, acceptance/cutoff timestamps, `unique_sample_count`, `ordered_sample_id_digest`, all `MetricTotals` columns, all `MetricAggregates` columns, `created_at`, `evaluator_signature_digest`, `bootstrap_authority_id`; unique `(location_id, workload, workload_revision, suite_id, suite_revision)`; check `unique_sample_count >= 20`; index `(location_id, workload, workload_revision, suite_id, suite_revision)`.

`self_improvement_evaluation_run`: `id` PK, `location_id`, `version_id` FK version, `stage`, workload/suite/baseline tuple, `state`, `trusted_producer_ids_json`, acceptance/cutoff timestamps, `request_digest`, `created_at`, nullable `cutoff_sample_set_digest`, `decided_at`; unique `(location_id, id)`, unique `(location_id, version_id, stage, request_digest)`; index `(location_id, state, cutoff_at, id)`. CAS state changes require current state and optional expected cutoff digest.

`self_improvement_metric_sample`: `id` PK, `run_id` FK run, `location_id`, `sample_id_digest`, `task_id_digest`, `producer_id`, `request_digest`, seven raw metric component columns, `outcome`, `started_at`, `terminal_at`; unique `(run_id, sample_id_digest)`, unique `(run_id, task_id_digest)`, index `(location_id, run_id, sample_id_digest)`.

`self_improvement_evaluation_decision`: `run_id` PK/FK run, `location_id`, `cutoff_sample_set_digest`, all totals/aggregate/reward columns, `decision`, nullable approval binding columns, `decided_at`; unique `(location_id, run_id)`. `self_improvement_gate_finding`: `id` PK, `evaluation_run_id` FK run, `location_id`, `gate_order`, `gate_id`, `result`, `code`, nullable `pointer`, `expected`, `actual`, `evidence_digest`; unique `(evaluation_run_id, gate_order)`, unique `(evaluation_run_id, gate_id)`.

### Owner 4: learning

`self_improvement_observation`: `id` PK, `location_id`, `pattern_digest`, `identity_digest`, workload/revision, `error_class`, `ordered_tool_symbol_digest`, `outcome_class`, `task_id_digest`, `producer_id`, `occurred_at`, `expires_at`; unique `(location_id, identity_digest)`; index `(location_id, pattern_digest, occurred_at, id)`.

`self_improvement_generation_lease`: `id` PK, `location_id`, `pattern_digest`, `owner_id`, `lease_token_digest`, `attempt_number`, `acquired_at`, `expires_at`, nullable `completed_at`, `model_request_digest`, nullable `model_output_digest`, `outcome`; unique `(location_id, pattern_digest, attempt_number)`, unique partial `(location_id, pattern_digest) WHERE completed_at IS NULL`, unique `lease_token_digest`; index `(location_id, pattern_digest, expires_at)`. Completion CAS matches `lease_token_digest` and requires `completed_at IS NULL`.

`self_improvement_generation_strategy_arm`: `id` PK, `location_id`, `strategy_id`, `allowlist_revision`, `active`; unique `(location_id, strategy_id, allowlist_revision)`. `self_improvement_model_route_arm`: `id` PK, `location_id`, `provider_id`, `model_id`, nullable `variant_id`, `allowlist_revision`, `active`; unique `(location_id, provider_id, model_id, variant_id, allowlist_revision)`.

`self_improvement_pull_event`: `id` PK, `location_id`, `action_domain`, `bucket_digest`, `derivation_revision`, `allowlist_revision`, `ordered_eligible_arm_ids_json`, `selected_arm_id`, nullable `proposal_digest`, `session_digest`, `version_id`, `timestamp`; index `(location_id, action_domain, bucket_digest, derivation_revision, allowlist_revision, timestamp, id)`.

`self_improvement_reward_event`: `id` PK, `location_id`, `pull_event_id` unique FK pull, `outcome_class`, nullable `numeric_reward`, `evidence_digest`, `timestamp`; index `(location_id, pull_event_id)`.

`self_improvement_bandit_state`: composite PK `(location_id, action_domain, bucket_digest, derivation_revision, allowlist_revision, arm_id)`, pull/reward totals, cumulative/mean reward, `active`, nullable latest event IDs. It is rebuildable and the only mutable learning projection.

`self_improvement_routing_decision`: `id` PK, `location_id`, session/workload/revision/role digests, precedence, policy/catalog/variant snapshot digests, `ordered_eligible_arms_json`, selected provider/model/variant fields, `reason_code`, nullable `pull_event_id`, `timestamp`; index `(location_id, session_digest, timestamp, id)`.

`self_improvement_audit_entry`: `id` PK, `location_id`, `event_type`, `actor_id`, `payload_json`, `timestamp`, retention tag/timestamps; index `(location_id, timestamp, id)` and `(location_id, event_type, timestamp, id)`.

### Owner 5: context

`self_improvement_context_desired_state`: composite PK `(location_id, artifact_id, rollout_slot)`, nullable desired version/digest/stage, `desired_revision`; absent target stores all desired fields null, present target stores all three non-null, and present `desired_stage = rollout_slot`. This is mutable only with expected `desired_revision` CAS.

`self_improvement_context_outbox`: `id` PK, `location_id`, `artifact_id`, `expected_artifact_revision`, `expected_stage`, `desired_state_revision`, intent version/stage/event/reason/actor/optional ref/idempotency columns, `status`, `attempts`, `next_retry_at`, nullable `cas_result_digest`, `created_at`; index `(status, next_retry_at, id)` and `(location_id, artifact_id, status, id)`. Claim CAS changes `pending` or recoverable `applying` to `applying`; terminal updates are `applied`, `superseded`, or `blocked`.

`self_improvement_context_selection_evidence`: `id` PK, `location_id`, `artifact_id`, `version_id`, `version_digest`, `stage`, `context_epoch`, `session_digest`, `cohort_result`, `outbox_id` FK outbox; unique `(outbox_id, session_digest, cohort_result)`; index `(location_id, artifact_id, context_epoch, id)`.

## Store Interfaces

All stores import S01 types and expose input/output `Schema.Class` values only when boundary decoding is required. Internal row mapping reconstructs S01 classes without casts; JSON is decoded with `Schema.decodeUnknown`/`Schema.decodeUnknownOption` and encoded using `Schema.encode` before insert.

| Store                            | Exports                                                                                                                                                                                                                                                                                                                                |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SelfImprovementArtifactStore`   | `createArtifact(input, tx?)`, `appendVersion(input, tx?)`, `getArtifact({ locationID, artifactID })`, `getVersion({ locationID, versionID })`, `listVersions({ locationID, artifactID })`, `tombstoneArtifact({ locationID, artifactID, expectedRevision, tombstone }, tx?)`, `getIdempotency(identity)`, `putIdempotency(input, tx?)` |
| `SelfImprovementLifecycleStore`  | `appendTransition(input, tx?)`, `getStage({ locationID, versionID })`, `compareAndSetStage({ locationID, versionID, expectedStage, expectedRevision, next }, tx?)`, `createApprovalRequest(input, tx?)`, `decideApproval(input, tx?)`, `consumeApproval(input, tx?)`, `appendRollback(input, tx?)`                                     |
| `SelfImprovementEvaluationStore` | `appendSuiteRevision(input, tx?)`, `appendBaseline(input, tx?)`, `createRun(input, tx?)`, `appendSample(input, tx?)`, `beginDecision(input, tx?)`, `completeDecision(input, tx?)`, `cancelRun(input, tx?)`, `getRun({ locationID, runID })`, `listSamples({ locationID, runID })`                                                      |
| `SelfImprovementLearningStore`   | `appendObservation(input, tx?)`, `acquireLease(input, tx?)`, `completeLease(input, tx?)`, `appendGenerationStrategyArm(input, tx?)`, `appendModelRouteArm(input, tx?)`, `appendPull(input, tx?)`, `appendReward(input, tx?)`, `replaceBanditState(input, tx?)`, `appendRoutingDecision(input, tx?)`, `appendAudit(input, tx?)`         |
| `SelfImprovementContextStore`    | `compareAndSetDesiredState(input, tx?)`, `appendOutbox(input, tx?)`, `claimOutbox(input, tx?)`, `recordOutboxRetry(input, tx?)`, `finalizeOutbox(input, tx?)`, `appendSelectionEvidence(input, tx?)`, `listDueOutbox({ now, limit })`                                                                                                  |

Methods that append immutable rows return the persisted S01 value. `compareAndSet*`, `claimOutbox`, and `completeLease` return `boolean`. `get*` returns `Effect.Effect<T | undefined>`. Duplicate immutable IDs or a unique key with a different request digest fail as a typed store conflict; replay interpretation belongs to S08/API, not S02.

## Dependency Waves

| Wave | Owners                    | Prerequisites                                                                                            | Fan-in gate                                            |
| ---- | ------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| 1    | Owner 1, Owner 3, Owner 4 | S01 schemas                                                                                              | Each owner-ready commit; no inter-owner imports        |
| 2    | Owner 2, Owner 5          | Owner 1 tables/types available at fan-in only; use FK imports but do not require implementation services | Owner-ready commits; slots/outbox constraints verified |
| 3    | Integrator                | all five commits                                                                                         | generation and integrated checks complete              |

## Integrator-Owned Paths

- `packages/core/schema.json`
- `packages/core/src/database/migration/*.ts`
- `packages/core/src/database/schema.gen.ts`
- `packages/core/src/database/migration.gen.ts`
- `packages/core/src/self-improvement/index.ts` only if a shared self-export is required after owners land; no owner may create it.

## Fan-In and Conflict Policy

1. Apply Owner 1, 3, and 4 commits in any order; do not edit their files during fan-in.
2. Apply Owner 2 after Owner 1's schema is present, then Owner 5 after Owner 2's schema is present.
3. If an owner changed an integrator path, reject that change from the owner commit and regenerate it after all owned schemas are present.
4. If store signatures differ from this manifest, preserve this manifest and issue one focused correction to the owning packet; do not adapt consumers silently.
5. From `packages/core`, run `bun migration --name self_improvement_persistence`; never hand-edit generated outputs.
6. Do not add migration assertions to `database-migration.test.ts` in S02; each owner keeps its focused store test. The integrator only verifies migration generation/application.

## Integrated Checks

```bash
cd packages/core
bun migration --name self_improvement_persistence
bun migration --check
bun test test/self-improvement-artifact-store.test.ts test/self-improvement-lifecycle-store.test.ts test/self-improvement-evaluation-store.test.ts test/self-improvement-learning-store.test.ts test/self-improvement-context-store.test.ts
bun typecheck
bunx prettier --check src/self-improvement/*.ts test/self-improvement-*-store.test.ts
bunx eslint src/self-improvement/*.ts test/self-improvement-*-store.test.ts
git diff --check
git diff --name-only HEAD~5..HEAD
```

## Risk Ledger

| Risk                              | Current S02 treatment                             | Deferred owner                    |
| --------------------------------- | ------------------------------------------------- | --------------------------------- |
| simultaneous artifact mutation    | revision/CAS columns and unique slot indexes only | S05 coordinator race tests        |
| duplicate idempotent HTTP request | durable identity/request digest only              | S08 API replay behavior           |
| registry/database split brain     | durable desired state/outbox only                 | S07 reconciler crash recovery     |
| untrusted JSON/content            | store accepts only S01-decoded values             | S04 admission/gates               |
| tenant escape                     | Location predicates and composite uniqueness only | S08/S09 authorization integration |
| retention deletion                | expiry metadata/indexes only; no delete operation | S09/S12 retention job             |
| live migration/data durability    | generated migration and empty-DB application only | release migration rehearsal       |

## Execution Handoff

Each owner brief is at `.superpowers/fanout-fanin/s02/owner-<n>-*.md`. The briefs are ignored workspace coordination artifacts. Owners use `terra-fast` at medium depth, commit only exclusive paths, and provide commit SHA, changed paths, exact command results, assumptions, integration notes, and concerns.
