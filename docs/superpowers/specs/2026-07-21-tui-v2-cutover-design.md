# TUI V2 Cutover Design

## Goal

Ship a TUI-only OpenCode fork whose runtime is based on upstream `opencode/v2`, with no dependency on the deleted legacy `packages/opencode` session engine. Preserve the fork's self-improvement, caching, compaction, generated-skill, task-permission, instruction-budget, and shell-security features. Keep desktop support out of scope while making later repository extraction straightforward.

## Architecture

- `packages/tui`: presentation only. It reads session/cache/self-improvement state through V2 client APIs and sends commands through V2 services.
- `packages/cli`: TUI launch, local service lifecycle, config, and standalone process ownership.
- `packages/server`: V2 HTTP/API surface for sessions, self-improvement status, and cache diagnostics.
- `packages/core`: the only session/runtime engine, including model request preparation, tools, compaction, persistence, self-improvement, generated skills, and provider-aware cache policy.
- `packages/ai`: provider protocol lowering and cache usage normalization.

No new legacy adapters may execute prompts. Temporary compatibility adapters are allowed only for config/data migration and must not contain model, tool, compaction, or observation logic.

## Upstream Base

Base the migration branch on current `opencode/v2` (`44b6938b2a` at migration start). Upstream V2 already removes `packages/opencode` and separates TUI, CLI, Core, Server, and Client packages. Fork features are replayed as V2-native services rather than restoring deleted packages.

## Self-Improvement Behavior

When `experimental.self_improvement.automatic` is `true`, each terminal TUI task records one privacy-safe session evidence row automatically. The automation loop runs on the configured interval, evaluates patterns within the configured window, generates eligible instruction-only skills, optionally auto-approves them, and projects promoted generated skills into the generated skill directory. It does not rewrite source code or silently change arbitrary tools.

The TUI must display:

- enabled/disabled state;
- last observation time;
- evidence count;
- last automation tick and result;
- active/shadow/canary generated skills;
- actionable failure reason when no records are produced.

## Provider-Aware Cache Policy

Caching must preserve deterministic, stable prompt prefixes and use provider-native mechanisms only when applicable.

- OpenAI and compatible Responses endpoints: stable project/location/agent/provider/model namespace via `prompt_cache_key`; no per-session random key.
- OpenRouter: stable `prompt_cache_key` plus a stable `session_id` for provider stickiness. Do not enable response caching for ordinary agent turns because identical tool-capable responses must not be replayed verbatim.
- Anthropic direct: explicit cache breakpoints on stable tool/system/history boundaries, limited to protocol maximum; default 5-minute TTL. One-hour TTL remains opt-in because writes cost more.
- Amazon Bedrock Claude: explicit cache points ordered tools → system → messages; preserve the protocol checkpoint limit and token minimum behavior.
- Gemini direct/Vertex: rely on implicit prefix caching by default; explicit cached-content resources are out of scope for ordinary growing chat history. Keep stable system/tool prefixes.
- Providers with implicit caching only (DeepSeek, Grok, selected Qwen/Groq models): no fake controls; maximize hits through stable prefixes and deterministic request serialization.
- Unsupported providers: no cache markers.

Cache usage normalization must report uncached input, cache reads, cache writes, total context tokens, and cache-hit ratio separately.

## TUI Cache Metrics

The context occupancy percentage measures total tokens currently consuming the model context window. It is not a cache-hit percentage. The TUI must show separate fields:

- Context: total / limit and percentage;
- Uncached input tokens;
- Cache read tokens;
- Cache write tokens;
- Cache hit ratio = cache read / (uncached input + cache read + cache write), when denominator is positive;
- provider cache mechanism/status label.

## Security and Correctness

- Parent task permission denies remain hard ceilings.
- Ambient instructions remain bounded and oversized sources are represented by digest notices.
- Compaction respects `auto: false`, uses normalized input/output headroom, preserves bounded durable constraints, and continues exactly once after successful overflow recovery.
- Generated skill projection is atomic, provenance-checked, and ownership-safe.
- Shell sandbox modes remain `disabled`, `optional`, and `required`; required mode fails before approval or spawn when no enforceable backend exists.
- No regex or command parsing is described as an OS sandbox.

## Migration Stages

1. Establish upstream V2 build/test baseline and extraction-oriented package boundaries.
2. Port self-improvement persistence/services and register them in V2 location/runtime graphs.
3. Connect V2 session terminal events to self-improvement observation and automation.
4. Port hardening features: permissions, instruction bounds, compaction, generated skills, and shell sandboxing.
5. Implement provider-aware cache policy and normalized usage in Core/AI.
6. Add V2 server/client endpoints and TUI diagnostics for self-improvement and cache metrics.
7. Remove obsolete compatibility code, verify TUI-only build, and document extraction boundaries.

## Acceptance Evidence

- TUI prompt creates one session evidence row with automatic self-improvement enabled.
- Repeated equivalent prompts retain the same provider cache namespace and expose cache-read tokens when the provider reports them.
- Context occupancy and cache-hit ratio are displayed as different metrics.
- Full Core, AI, Server, CLI, Client, and TUI typechecks pass.
- Focused self-improvement, cache, compaction, permission, skill, and shell tests pass.
- A TUI binary starts, performs a real V2 prompt cycle, and persists data in a disposable SQLite database.
- No runtime import or package dependency on deleted `packages/opencode` remains.
