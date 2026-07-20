# OpenCode Hardening Batch 1 Design

## Goal

Improve OpenCode's security and prompt-cache reliability using only defects that reproduce on the current branch.

## Evidence and Scope

This batch is based on current source inspection, GitHub issues #6527, #20549, #21518, and the adversarial review at `wren.wtf/shower-thoughts/stop-using-opencode/`.

The current Core session runner already persists queued and steering prompts as ordinary durable user messages, so the historical `<system-reminder>` cache-prefix bug is not present. The current Task tool also enforces `subagent_depth` before permission evaluation. Both behaviors need regression tests.

The current Task path still fails to propagate the calling agent's deny rules into the child session. A read-only or plan agent can therefore delegate to a more permissive subagent and bypass its own hard restrictions.

## Security Model

Child agents keep their own allow and deny policy, but every deny rule from the calling agent and parent session becomes a monotonic child-session ceiling. Parent allow rules are not inherited because delegation must not expand the child agent's declared authority.

The child permission order is:

1. Child agent policy, loaded normally at execution time.
2. Existing child-session restrictions (`todowrite`, `task`, configured primary tools).
3. Parent session external-directory rules and deny rules.
4. Parent agent deny rules.

Because session rules are merged after child-agent rules, inherited denies cannot be overridden by the child.

Resuming a `task_id` is bound to its original parent session and subagent type. A resumed task may acquire new deny ceilings, but it never loses existing restrictions or receives newly inherited allows.

## Cache Reliability

Queued and steering messages must have exactly one model-facing representation. The first request that consumes a promoted message and every later request must contain the same user text and content-part structure. No temporary wrapper may be introduced.

The existing Core runner already has this architecture; this batch adds an exact request-serialization regression test.

## Recursion Reliability

`subagent_depth` is checked before a permission prompt and before child-session creation. A global or agent-level `task: allow` rule must not bypass the depth limit. This batch adds a regression test for that configuration.

## Non-goals

This batch does not attempt to make shell command string filtering a security sandbox. The blog's examples demonstrate that executable aliases, interpreters, redirections, and nested shells defeat textual filtering. A correct fix requires an OS-enforced execution boundary and will be designed separately.

## Verification

- RED/GREEN tests for parent-agent deny inheritance on new and resumed task sessions.
- Regression tests for cross-parent and cross-agent `task_id` rejection.
- Regression test proving global `task: allow` cannot bypass depth limits.
- Regression test proving queued-message request serialization remains stable across turns.
- Full affected OpenCode and Core test suites.
- Core and OpenCode typechecks.
- Native single-platform build and binary smoke test.
