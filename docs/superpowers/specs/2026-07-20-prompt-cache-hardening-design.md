# Prompt Cache Hardening Design

## Goal

Increase prompt-cache hit rate without changing model-visible semantics or silently increasing cache-write cost.

## Evidence

The design follows the exact-prefix invariant documented by OpenAI, Anthropic, OpenRouter, and observed in Codex: stable tools and instructions must precede volatile turn content; cache routing identifiers should be stable for prompts that can share a prefix.

OpenCode currently has three reproducible gaps:

1. OpenAI `prompt_cache_key` is derived from the session ID, preventing reuse across fresh sessions in the same project.
2. OpenRouter supports sticky routing but the Core runner does not send `session_id`.
3. Tool definitions are emitted in registration order, which can vary when plugins register concurrently.

The cache policy can also mark an empty system or message text block, producing invalid Anthropic requests that remain broken on resume.

## Cache Namespace

Create a deterministic 64-character SHA-256 namespace from:

- version marker `session-prompt-cache/v1`;
- project ID;
- opened directory;
- workspace ID or an empty sentinel;
- selected agent ID;
- provider ID;
- model ID.

Do not include the session ID. Sessions in the same location using the same agent and model share the namespace. Different projects, directories, workspaces, agents, providers, or models remain isolated.

The namespace is sent as:

- `openai.promptCacheKey` for OpenAI Responses routing;
- `openrouter.sessionID` for OpenRouter provider stickiness;
- the legacy AI-SDK provider transform's existing cache-key field, while real session IDs remain unchanged in affinity and tracing headers.

Exact prefix comparison remains authoritative; a shared namespace cannot make different prompts reuse incompatible cached tokens.

## Deterministic Tool Prefix

`ToolRegistry.materialize` sorts registrations lexically by tool name after permission filtering. Definition generation and lookup use the same sorted registration map. Tool behavior and precedence do not change.

## Safe Cache Breakpoints

Automatic cache placement must not attach a cache hint to:

- an empty or whitespace-only system text block;
- an empty or whitespace-only message text block;
- an empty content part when no non-empty text exists.

When no cacheable message content exists, leave the message unmarked. Manual hints are preserved unless they target an invalid empty text block at protocol lowering, where the marker is omitted.

## TTL

Keep the default five-minute TTL. The existing `CachePolicyObject.ttlSeconds` continues to support one-hour TTL explicitly. This avoids silently increasing Anthropic cache-write cost while still enabling long-horizon callers to opt in.

## Verification

- RED/GREEN tests for stable cross-session cache namespaces and isolation dimensions in native and legacy request paths.
- RED/GREEN OpenRouter test for `session_id`.
- RED/GREEN tool-registry ordering test.
- RED/GREEN cache-policy tests for empty system/message blocks.
- Full Core runner, ToolRegistry, LLM cache/provider suites.
- Core, LLM, and OpenCode typechecks.
- Native single-platform build and binary smoke test.
