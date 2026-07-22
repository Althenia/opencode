export * as SystemContextRegistry from "./registry"

import { Context, Effect, Layer, Ref, Scope } from "effect"
import { SelfImprovement, SelfImprovementLifecycle } from "@opencode-ai/schema"
import { SystemContext } from "./index"
import { makeLocationNode } from "../effect/app-node"

export interface Entry {
  readonly key: SystemContext.Key
  readonly load: Effect.Effect<SystemContext.SystemContext>
}

export interface ContributionState {
  readonly revision: SelfImprovementLifecycle.Revision
  readonly digest: SelfImprovement.Digest
  readonly context: SystemContext.SystemContext
}

export interface Interface {
  readonly register: (entry: Entry) => Effect.Effect<void, never, Scope.Scope>
  readonly load: () => Effect.Effect<SystemContext.SystemContext>
  readonly compareAndSet: (input: {
    readonly key: SystemContext.Key
    readonly expectedRevision: SelfImprovementLifecycle.Revision
    readonly next: ContributionState
  }) => Effect.Effect<{ readonly applied: boolean; readonly current: ContributionState | undefined }>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/SystemContextRegistry") {}

interface RegistryState {
  readonly entries: ReadonlyArray<Entry>
  readonly contributions: ReadonlyMap<SystemContext.Key, ContributionState>
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const registry = yield* Ref.make<RegistryState>({ entries: [], contributions: new Map() })

    return Service.of({
      register: Effect.fn("SystemContextRegistry.register")(function* (entry) {
        yield* Effect.acquireRelease(
          Ref.modify(registry, (current) => {
            if (current.entries.some((item) => item.key === entry.key) || current.contributions.has(entry.key))
              return [false, current]
            return [true, { ...current, entries: [...current.entries, entry] }]
          }).pipe(
            Effect.flatMap((added) =>
              added ? Effect.void : Effect.die(new Error(`Duplicate system context entry key: ${entry.key}`)),
            ),
            Effect.as(entry),
          ),
          (entry) =>
            Ref.update(registry, (current) => ({
              ...current,
              entries: current.entries.filter((item) => item !== entry),
            })),
        )
      }),
      load: Effect.fn("SystemContextRegistry.load")(function* () {
        const current = yield* Ref.get(registry)
        const entries = current.entries.toSorted((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
        const contribution = [...current.contributions.entries()]
          .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([, state]) => state.context)
        return SystemContext.combine([
          ...(yield* Effect.forEach(entries, (entry) => entry.load, { concurrency: "unbounded" })),
          ...contribution,
        ])
      }),
      compareAndSet: Effect.fn("SystemContextRegistry.compareAndSet")(function* (input) {
        return yield* Ref.modify(
          registry,
          (
            current,
          ): readonly [
            { readonly applied: boolean; readonly current: ContributionState | undefined },
            RegistryState,
          ] => {
            if (current.entries.some((entry) => entry.key === input.key))
              return [{ applied: false, current: undefined }, current]
            const previous = current.contributions.get(input.key)
            if (
              (previous !== undefined && previous.revision !== input.expectedRevision) ||
              input.next.revision !== input.expectedRevision + 1
            )
              return [{ applied: false, current: previous }, current] as const
            const next = new Map(current.contributions)
            next.set(input.key, input.next)
            return [
              { applied: true, current: input.next },
              { ...current, contributions: next },
            ] as const
          },
        )
      }),
    })
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [] })
