# OpenCode Hardening Sweep Design

## Scope

This sweep addresses the remaining confirmed or high-confidence findings in five independently reviewable batches:

1. Normalize legacy compaction headroom when models expose both `limit.input` and `limit.context`.
2. Prevent successful compaction from terminating `opencode run` before one bounded continuation attempt.
3. Give compaction models a bounded constraint context that includes active ambient instructions and other durable rules without copying the entire normal system prompt.
4. Materialize promoted self-improvement skills into an inspectable generated-skill directory and register that directory as a normal skill source.
5. Strengthen shell execution safety with enforceable process/filesystem boundaries where the current platform supports them; otherwise fail closed for explicitly sandbox-required execution instead of adding misleading command-string filters.

## Design Principles

- Every behavior change follows RED -> GREEN -> refactor.
- Each batch is committed independently after focused and broad verification.
- Existing configuration remains backward compatible.
- Cache-stable prefixes remain deterministic.
- Generated artifacts use atomic writes and never overwrite user-authored skills.
- Security controls are monotonic: child or resumed execution can become more restricted, never less restricted.
- Unsupported sandbox guarantees are reported explicitly rather than simulated with regex filtering.

## Batch 1: Compaction Headroom

Compute the usable legacy input budget as the minimum of:

- the explicit provider input limit, when present; and
- context limit minus reserved output/headroom.

This removes the current asymmetry where explicit `limit.input` can allow substantially more context than an equivalent context-only model.

## Batch 2: Compaction Continuation

A successful automatic compaction must create exactly one continuation opportunity. The continuation is skipped only when:

- auto-compaction is disabled;
- the compaction itself failed;
- a plugin explicitly disables auto-continuation; or
- a replayed user turn already provides the continuation input.

The loop must never create an unbounded compaction/continuation cycle.

## Batch 3: Bounded Compaction Constraints

Create a dedicated compaction-constraint assembler rather than passing the entire normal system prompt. It includes:

- bounded ambient instructions;
- active agent rules needed to preserve behavior;
- compact durable system-context guidance;
- bounded skill guidance when relevant.

It excludes volatile environment details, large MCP descriptions, tool schemas, and ordinary conversation history already provided separately. A strict byte budget prevents the summary request from recreating the overflow condition.

## Batch 4: Generated Skill Materialization

Promoted generated skills are written atomically to:

`~/.config/opencode/generated/<stable-name>/SKILL.md`

Requirements:

- stable, collision-resistant names derived from artifact identity;
- frontmatter records artifact/version/provenance;
- only promoted active versions are materialized;
- rollback or retirement removes only files owned by the same artifact/version;
- the generated root is registered as a normal skill source;
- user-authored skill directories are never overwritten;
- database/runtime context remains the source of truth if filesystem reconciliation fails, with explicit diagnostics.

## Batch 5: Shell Isolation

Do not treat command parsing as a security boundary. Introduce a capability check for sandboxed shell execution:

- use the existing OS/container sandbox backend when available;
- allow configuration to require sandboxing;
- when required but unavailable, reject execution before spawning;
- preserve current behavior by default for backward compatibility;
- expose clear diagnostics and tests for supported/unsupported paths.

This is a safe incremental boundary. A complete cross-platform sandbox backend may require platform-specific follow-up work, but the product will no longer claim a guarantee it cannot enforce.

## Verification

For every batch:

- focused regression tests;
- affected package suites;
- package typechecks;
- migration verification when schemas change;
- native single-platform build and binary smoke test;
- clean git status;
- independent commit.

The user has explicitly pre-approved this design and authorized implementation without additional confirmation prompts.
