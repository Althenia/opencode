import { describe, expect } from "bun:test"
import { Cause, Effect, Exit, Schema, Scope } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { SelfImprovement, SelfImprovementLifecycle } from "@opencode-ai/schema"
import { SystemContext } from "@opencode-ai/core/system-context"
import { SystemContextRegistry } from "@opencode-ai/core/system-context/registry"
import { testEffect } from "../lib/effect"

const entry = (key: string, text: string, sourceKey = key) => ({
  key: SystemContext.Key.make(key),
  load: Effect.succeed(
    SystemContext.make({
      key: SystemContext.Key.make(sourceKey),
      codec: Schema.toCodecJson(Schema.String),
      load: Effect.succeed(text),
      baseline: String,
      update: (_previous, current) => current,
    }),
  ),
})

const it = testEffect(AppNodeBuilder.build(SystemContextRegistry.node))

describe("SystemContextRegistry", () => {
  it.effect("loads empty system context when there are no entries", () =>
    Effect.gen(function* () {
      const registry = yield* SystemContextRegistry.Service

      expect(yield* SystemContext.initialize(yield* registry.load())).toEqual({ baseline: "", snapshot: {} })
    }),
  )

  it.effect("loads scoped entries in stable key order", () =>
    Effect.gen(function* () {
      const registry = yield* SystemContextRegistry.Service
      yield* registry.register(entry("test/second", "second"))
      yield* registry.register(entry("test/first", "first"))

      expect((yield* SystemContext.initialize(yield* registry.load())).baseline).toBe("first\n\nsecond")
    }),
  )

  it.effect("re-evaluates entry producers on each load", () =>
    Effect.gen(function* () {
      const registry = yield* SystemContextRegistry.Service
      let loads = 0
      yield* registry.register({
        key: SystemContext.Key.make("test/dynamic"),
        load: Effect.sync(() => {
          loads++
          return SystemContext.empty
        }),
      })

      yield* registry.load()
      yield* registry.load()

      expect(loads).toBe(2)
    }),
  )

  it.effect("propagates entry producer failures", () =>
    Effect.gen(function* () {
      const registry = yield* SystemContextRegistry.Service
      const failure = new Error("entry failed")
      yield* registry.register({ key: SystemContext.Key.make("test/failure"), load: Effect.die(failure) })

      const exit = yield* registry.load().pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) expect(Cause.squash(exit.cause)).toBe(failure)
    }),
  )

  it.effect("rejects duplicate source keys from separate entries", () =>
    Effect.gen(function* () {
      const registry = yield* SystemContextRegistry.Service
      yield* registry.register(entry("test/first", "first", "test/duplicate"))
      yield* registry.register(entry("test/second", "second", "test/duplicate"))

      const exit = yield* registry.load().pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        expect(Cause.squash(exit.cause)).toBeInstanceOf(SystemContext.DuplicateKeyError)
        expect(Cause.squash(exit.cause)).toMatchObject({ key: SystemContext.Key.make("test/duplicate") })
      }
    }),
  )

  it.effect("rejects duplicate entry keys", () =>
    Effect.gen(function* () {
      const registry = yield* SystemContextRegistry.Service
      yield* registry.register(entry("test/duplicate", "first"))

      const exit = yield* registry.register(entry("test/duplicate", "second", "test/other")).pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        expect(Cause.pretty(exit.cause)).toContain("Duplicate system context entry key")
        expect(Cause.pretty(exit.cause)).toContain("test/duplicate")
      }
    }),
  )

  it.effect("removes an entry when its owning scope closes", () =>
    Effect.gen(function* () {
      const registry = yield* SystemContextRegistry.Service
      const scope = yield* Scope.make()
      yield* registry.register(entry("test/scoped", "scoped")).pipe(Scope.provide(scope))

      expect((yield* SystemContext.initialize(yield* registry.load())).baseline).toBe("scoped")

      yield* Scope.close(scope, Exit.void)
      expect(yield* SystemContext.initialize(yield* registry.load())).toEqual({ baseline: "", snapshot: {} })
    }),
  )

  it.effect("rejects stale contribution revisions without replacing the visible context", () =>
    Effect.gen(function* () {
      const registry = yield* SystemContextRegistry.Service
      const key = SystemContext.Key.make("test/contribution")
      const first = {
        revision: SelfImprovementLifecycle.Revision.make(1),
        digest: SelfImprovement.Digest.make("a".repeat(64)),
        context: yield* entry("test/contribution", "first").load,
      }

      expect(
        yield* registry.compareAndSet({
          key,
          expectedRevision: SelfImprovementLifecycle.Revision.make(0),
          next: first,
        }),
      ).toEqual({
        applied: true,
        current: first,
      })
      expect(
        yield* registry.compareAndSet({
          key,
          expectedRevision: SelfImprovementLifecycle.Revision.make(0),
          next: {
            ...first,
            revision: SelfImprovementLifecycle.Revision.make(2),
            digest: SelfImprovement.Digest.make("b".repeat(64)),
          },
        }),
      ).toEqual({ applied: false, current: first })
      expect((yield* SystemContext.initialize(yield* registry.load())).baseline).toBe("first")
    }),
  )

  it.effect("rejects keys shared between scoped entries and contributions", () =>
    Effect.gen(function* () {
      const registry = yield* SystemContextRegistry.Service
      const key = SystemContext.Key.make("test/collision")
      const contribution = {
        revision: SelfImprovementLifecycle.Revision.make(1),
        digest: SelfImprovement.Digest.make("c".repeat(64)),
        context: yield* entry("test/collision", "contribution").load,
      }

      yield* registry.register(entry("test/collision", "scoped"))
      expect(
        yield* registry.compareAndSet({
          key,
          expectedRevision: SelfImprovementLifecycle.Revision.make(0),
          next: contribution,
        }),
      ).toEqual({ applied: false, current: undefined })

      expect(
        yield* registry.compareAndSet({
          key: SystemContext.Key.make("test/contribution-collision"),
          expectedRevision: SelfImprovementLifecycle.Revision.make(0),
          next: { ...contribution, context: yield* entry("test/contribution-collision", "contribution").load },
        }),
      ).toMatchObject({ applied: true })

      const exit = yield* registry.register(entry("test/contribution-collision", "scoped")).pipe(Effect.exit)
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) expect(Cause.pretty(exit.cause)).toContain("Duplicate system context entry key")
    }),
  )
})
