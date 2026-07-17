# S02 Self-Improvement Persistence Fanout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add only the approved S02 persistence foundation: artifacts/versions, immutable transitions and audit entries, idempotency replay storage, and stage-slot/revision/tombstone projections.

**Architecture:** Owner 1 establishes artifact/version tables and the only shared table exports. Owners 2-5 branch from that commit and add independent transition, audit, idempotency, and projection/mutation stores. The final integrator alone generates database artifacts after all five owner commits are present.

**Tech Stack:** Bun, TypeScript, Effect v4, Drizzle SQLite, `@opencode-ai/schema`, Bun test.

## Global Constraints

- Work only in `/Users/kritthapas.phe/Workspace/Personal/opencode/.worktrees/self-improvement-s02` on `self-improvement-s02`.
- Use existing S01 contracts. No schema changes, dependencies, handlers, coordinators, evaluators, reconciliation, generation, routing, APIs, or production behavior.
- Use snake_case columns. IDs/digests/canonical JSON are `text`; timestamps/revisions/status codes are `integer`; booleans use Drizzle SQLite booleans.
- Encode/decode JSON with existing S01 Effect schemas. Store `CanonicalJson` as text. Do not use `any`, casts, raw `JSON.parse`, or a new dependency.
- Every read and mutation signature requires `locationID`. Every SQL predicate includes `location_id`, including joins through artifacts/versions. There is no cross-Location fallback.
- Artifact versions, transitions, audit entries, and idempotency records are append-only. `artifact.revision`, tombstone fields, and projection slots are the only mutable S02 state.
- Store modules export `Transaction = Parameters<Parameters<DatabaseClient["transaction"]>[0]>[0]`. Every mutation takes `(input, tx?: Transaction)` except `tombstoneAndClearSlots(input, tx: Transaction)`; callers own transaction boundaries and must invoke that method inside one database transaction.
- A tombstoned artifact keeps `(location_id, kind, name)` reserved permanently and blocks version append and slot mutation. `tombstoneAndClearSlots` atomically writes its tombstone and clears every slot, or rolls both changes back.
- S02 defers suite/baseline/run/sample/finding/decision persistence to S03; approval/rollback to S06; desired-state/outbox/context evidence to S07; observations to S09; leases to S10; bandit/reward/routing persistence to S11.

## Completion Definition

- **Owner-ready:** one owner has exactly one `*.sql.ts`, one store module, one focused test, and passes static/unit checks. Database constraint/CAS tests may be integration-deferred until the combined migration exists.
- **Integrated:** Owner 1 then all Wave 2 commits are assembled; the integrator creates the migration and generated files and runs all database-focused tests.
- **Production-ready:** explicitly not claimed. Race stress, live migration rehearsal, API authorization, retention jobs, and environment validation remain deferred.

## Ownership Map

| Owner         | Wave/base                                   | Create                                                                                     | Responsibility                                                                                                                      |
| ------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| 1 Foundation  | Wave 1; current `self-improvement-s02` HEAD | `artifact.sql.ts`, `artifact-store.ts`, `self-improvement-artifact-store.test.ts`          | Artifact, immutable version, capability/generated JSON boundaries, Location/name uniqueness, version numbering, revision, tombstone |
| 2 Transition  | Wave 2; Owner 1 commit                      | `transition.sql.ts`, `transition-store.ts`, `self-improvement-transition-store.test.ts`    | Immutable `StageTransition` only                                                                                                    |
| 3 Audit       | Wave 2; Owner 1 commit                      | `audit.sql.ts`, `audit-store.ts`, `self-improvement-audit-store.test.ts`                   | Immutable `AuditEntry` journal and retention                                                                                        |
| 4 Idempotency | Wave 2; Owner 1 commit                      | `idempotency.sql.ts`, `idempotency-store.ts`, `self-improvement-idempotency-store.test.ts` | Four-part identity, request digest, stored replay response, expiry                                                                  |
| 5 Projection  | Wave 2; Owner 1 commit                      | `projection.sql.ts`, `mutation-store.ts`, `self-improvement-mutation-store.test.ts`        | active/shadow/canary slots and artifact revision/tombstone CAS                                                                      |

Generated and shared paths are final-integrator only: `packages/core/schema.json`, `packages/core/src/database/migration/*.ts`, `packages/core/src/database/schema.gen.ts`, `packages/core/src/database/migration.gen.ts`, and any new shared self-improvement barrel. Owners must not edit generated files or lockfiles.

## Tables and Constraints

### Owner 1: `artifact.sql.ts`

`self_improvement_artifact`: `id` PK, `location_id`, `kind`, `name`, `status`, `created_by`, `created_at`, `revision`, nullable `tombstone_actor_id`, `tombstone_reason`, `tombstone_at`. Unique `(location_id, kind, name)` includes tombstones. Index `(location_id, status, kind, name, id)`. Check: all tombstone columns are null for `live`; all are non-null for `tombstoned`.

`self_improvement_artifact_version`: `id` PK, `artifact_id`, `version_number`, `source`, `behavior_class`, `proposal_json`, `canonical_json`, `proposal_digest`, `input_snapshot_digest`, `version_digest`, `capability_manifest_json`, `capability_manifest_digest`, `creator_id`, `created_at`, nullable `generation_lease_id`, `strategy_pull_id`, `originating_task_id_digest`, `model_request_digest`, `model_output_digest`, `retention_deadline`. Unique `(artifact_id, version_number)` and `version_digest`. Check: generated metadata columns are all null or all non-null; generated metadata requires `source = 'generated'`; human source requires all null. `create` rejects unless `input.locationID === artifact.key.locationID` and `version.artifactID === artifact.id` before insert. Version Location is inherited through artifact and every version query joins and predicates `artifact.location_id`.

### Owner 2: `transition.sql.ts`

`self_improvement_stage_transition`: `id` PK, `version_id`, `previous_stage`, `next_stage`, `event`, `reason`, `actor_id`, `timestamp`, nullable `evaluation_run_id`, `approval_id`, `rollback_id`, `context_outbox_id`, `idempotency_record_id`, `idempotency_digest`. Index `(version_id, timestamp, id)`. This table has no stage projection and no approval/rollback table.

### Owner 3: `audit.sql.ts`

`self_improvement_audit_entry`: `id` PK, `location_id`, `event_type`, `actor_id`, `payload_json`, `timestamp`, `retention_tag`, `retention_created_at`, nullable `retention_expires_at`. Index `(location_id, timestamp, id)` and `(location_id, event_type, timestamp, id)`. The payload is the S01 `AuditPayload`; linked IDs remain payload fields, not columns/FKs. `append` rejects unless `input.locationID === entry.locationID` before insert.

### Owner 4: `idempotency.sql.ts`

`self_improvement_idempotency`: `id` PK, `principal_id`, `location_id`, `operation`, `key`, `request_digest`, `status`, `body_digest`, `body_json`, `created_at`, `expires_at`. Unique `(principal_id, location_id, operation, key)`. Index `(location_id, expires_at, id)`. Stored `body_json` is the schema-encoded `SelfImprovementApi.StoredResponse` payload, not a raw parsed object.

### Owner 5: `projection.sql.ts`

`self_improvement_artifact_slot`: composite PK `(location_id, artifact_id, slot)`, `version_id`, `artifact_revision`, `updated_at`. `slot` is exactly `active`, `shadow`, or `canary`. Unique `version_id`; index `(location_id, artifact_id, slot)`. Store writes require live artifact status and matching artifact revision. Slot rows are rebuildable projections and may be deleted only by successful tombstone CAS.

## Foreign Key Matrix

| Table.column                             | Target                            | Delete action | Notes                                                     |
| ---------------------------------------- | --------------------------------- | ------------- | --------------------------------------------------------- |
| `artifact_version.artifact_id`           | `artifact.id`                     | `RESTRICT`    | Owner 1; version inherits artifact Location               |
| `stage_transition.version_id`            | `artifact_version.id`             | `RESTRICT`    | Owner 2; store joins artifact for Location predicate      |
| `stage_transition.evaluation_run_id`     | opaque future S03 ID              | none          | no future-slice FK                                        |
| `stage_transition.approval_id`           | opaque future S06 ID              | none          | no future-slice FK                                        |
| `stage_transition.rollback_id`           | opaque future S06 ID              | none          | no future-slice FK                                        |
| `stage_transition.context_outbox_id`     | opaque future S07 ID              | none          | no future-slice FK                                        |
| `stage_transition.idempotency_record_id` | opaque Owner 4 ID                 | none          | preserves Wave 2 independence; store does not dereference |
| `audit_entry.payload_json` linked IDs    | opaque S01 payload IDs            | none          | immutable journal payload                                 |
| `idempotency` identity fields            | opaque principal/operation values | none          | identity is validated at higher boundary                  |
| `artifact_slot.artifact_id`              | `artifact.id`                     | `RESTRICT`    | Owner 5 imports Owner 1 table                             |
| `artifact_slot.version_id`               | `artifact_version.id`             | `RESTRICT`    | Owner 5 verifies artifact and Location match in SQL       |

## Store Contracts

Every module exports its `Transaction` alias and service namespace. Inputs below are exact required public methods; all include `locationID`.

| Store                             | Exact methods                                                                                                                                                                                                                                                                                                                                                          |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SelfImprovementArtifactStore`    | `create(input: { locationID; artifact; version }, tx?)`, `getArtifact(input: { locationID; artifactID })`, `getVersion(input: { locationID; versionID })`, `appendVersion(input: { locationID; artifactID; expectedRevision; version }, tx?)`, `listVersions(input: { locationID; artifactID })`                                                                       |
| `SelfImprovementTransitionStore`  | `append(input: { locationID; transition }, tx?)`, `listByVersion(input: { locationID; versionID })`                                                                                                                                                                                                                                                                    |
| `SelfImprovementAuditStore`       | `append(input: { locationID; entry }, tx?)`, `list(input: { locationID; eventType?: string })`                                                                                                                                                                                                                                                                         |
| `SelfImprovementIdempotencyStore` | `put(input: { locationID; record }, tx?)`, `get(input: { locationID; identity })`, `listExpired(input: { locationID; now })`                                                                                                                                                                                                                                           |
| `SelfImprovementMutationStore`    | `compareAndSetRevision(input: { locationID; artifactID; expectedRevision; nextRevision }, tx?)`, `tombstoneAndClearSlots(input: { locationID; artifactID; expectedRevision; tombstone }, tx: Transaction)`, `upsertSlot(input: { locationID; artifactID; versionID; slot; expectedArtifactRevision; updatedAt }, tx?)`, `listSlots(input: { locationID; artifactID })` |

Types use exact S01 names: `SelfImprovementLifecycle.Artifact`, `ArtifactVersion`, `StageTransition`, `Tombstone`, `Revision`, `LocationID`; `SelfImprovementLearning.AuditEntry`, `IdempotencyIdentity`; and `SelfImprovementApi.IdempotencyRecord`. Mutable methods return `Effect.Effect<boolean>` except `tombstoneAndClearSlots`, which requires the caller's `Transaction`, uses only that supplied transaction for artifact update and slot deletion, and returns `Effect.Effect<{ readonly revision: Revision } | undefined>` after a committed atomic transaction. Append/get/list methods return the stored S01 value, `undefined`, or `ReadonlyArray` as applicable. Immutable duplicate conflicts surface as typed store conflicts; API replay policy remains S08.

## Owner Checks and Database Expectations

Owners run static/unit checks before committing:

```bash
cd packages/core
bun test test/<owner-focused-test>.test.ts
bun typecheck
bunx prettier --check src/self-improvement/<owner-files>.ts test/<owner-focused-test>.test.ts
bunx eslint src/self-improvement/<owner-files>.ts test/<owner-focused-test>.test.ts
```

Focused database tests run after final migration generation if an owner branch cannot apply the combined migration. Required integration-deferred expectations are: artifact revision CAS accepts one contender and rejects stale revisions; idempotency four-part key accepts one stored replay; only one active/shadow/canary slot exists per artifact; `tombstoneAndClearSlots` is called inside `db.transaction`, receives that transaction explicitly, uses it for both artifact and slot statements, rejects stale revision, wrong Location, and already-tombstoned artifacts, clears all three slots, increments revision exactly once, and leaves neither tombstone nor slots changed on any failed transaction; tombstone keeps the artifact key reserved and blocks append/slot mutation; immutable artifact version, transition, audit, and idempotency rows have no update/delete store method.

Owner handoffs state static/unit results separately from `integration_deferred_db_checks`, including the exact blocked command and reason. Each owner uses terra-fast medium depth and commits only its three exclusive paths.

## Waves and Fan-In

1. **Wave 1:** Owner 1 works from current `self-improvement-s02` HEAD and commits foundation tables/store/test.
2. **Wave 2:** Owners 2, 3, 4, and 5 each branch from Owner 1's commit and run concurrently. Owner 5 depends only on Owner 1 table exports, not Owner 2.
3. **Final integration:** apply Owner 1, then Owner 2, Owner 3, Owner 4, and Owner 5 commits. Reject changes to integrator paths from owner commits. Resolve cross-owner signature mismatches in the owning packet, not by silent consumer adaptation.
4. From `packages/core`, run `bun migration --name self_improvement_persistence`; never hand-edit generated outputs.

## Integrated Checks

```bash
cd packages/core
bun migration --name self_improvement_persistence
bun migration --check
bun test test/database-migration.test.ts
bun test test/self-improvement-artifact-store.test.ts test/self-improvement-transition-store.test.ts test/self-improvement-audit-store.test.ts test/self-improvement-idempotency-store.test.ts test/self-improvement-mutation-store.test.ts
bun typecheck
bunx prettier --check src/self-improvement/*.ts test/self-improvement-*.test.ts
bunx eslint src/self-improvement/*.ts test/self-improvement-*.test.ts
```

## Risk Ledger

| Risk                           | S02 treatment                                  | Deferred to                     |
| ------------------------------ | ---------------------------------------------- | ------------------------------- |
| concurrent mutations           | CAS columns and focused constraint tests only  | S05 coordinator race validation |
| duplicate request replay       | durable identity/request/response storage only | S08 API behavior                |
| stale stage policy             | immutable event journal only                   | S05 lifecycle policy            |
| evaluation evidence            | no tables                                      | S03                             |
| approval/rollback              | no tables                                      | S06                             |
| registry split-brain           | no desired state/outbox                        | S07                             |
| observation/generation/routing | no tables                                      | S09/S10/S11                     |
| retention deletion             | metadata only; no deletion worker              | S09/S12                         |

## Execution Handoff

Ignored owner briefs are `.superpowers/fanout-fanin/s02/owner-1-artifacts.md` through `owner-5-context.md`. Each handoff contains `commit`, `changed_paths`, `static_unit_checks`, `integration_deferred_db_checks`, `assumptions`, `integration_notes`, and `concerns`; Owner 5 additionally records transaction-call evidence for `tombstoneAndClearSlots`.
