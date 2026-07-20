# Instruction Budget Design

## Goal

Prevent oversized AGENTS.md, CLAUDE.md, CONTEXT.md, configured instruction files, and remote instruction URLs from consuming the model context or durable context snapshots.

## Configuration

Add top-level `instruction_max_bytes` to both V1 and V2 config schemas.

- Default: 51,200 bytes.
- Minimum: 1 byte.
- Maximum: 1,048,576 bytes.
- The closest/highest-priority config value wins through existing config precedence.

## Rendering Contract

A shared Core utility measures UTF-8 bytes and computes a SHA-256 digest.

For content within the budget, it returns the original content unchanged.

For oversized content, it returns a deterministic omission notice containing:

- source path or URL;
- exact UTF-8 byte count;
- configured inline limit;
- source digest;
- the correct on-demand tool (`read` for local files, `webfetch` for URLs).

Do not include a partial prefix of an oversized instruction. Partial instructions can omit exceptions or later constraints and are unsafe to treat as authoritative.

## Core V2 Instruction Context

`InstructionContext.File` stores:

- source path;
- bounded rendered content;
- original byte count;
- original digest;
- whether content was omitted.

This keeps durable SystemContext snapshots bounded while still detecting changes to oversized files whose byte size remains unchanged.

## Legacy Instruction Path

Apply the same renderer to:

- startup/global/project instruction files;
- configured local instruction patterns;
- configured remote URLs;
- nearby instruction files attached after a read tool call.

The existing discovery, precedence, claim, and retry behavior remains unchanged.

## Cache Behavior

Oversized notices are deterministic for unchanged content. The digest changes only when source bytes change, preserving prompt-cache reuse while invalidating correctly after edits.

## Error Handling

Read/fetch failures retain existing behavior. Budget enforcement occurs only after successful content retrieval and cannot turn a successful prompt into a failure.

## Verification

- Pure RED/GREEN tests for UTF-8 byte accounting, omission, digest stability, and tool-specific notices.
- Core InstructionContext integration tests proving bounded baseline and bounded snapshots.
- Legacy Instruction tests for local, remote, and nearby files.
- Config schema and V1-to-V2 migration tests.
- Full instruction/config tests, package typechecks, migration check, and native smoke build.
