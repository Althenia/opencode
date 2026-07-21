export * as SystemContextInstructions from "./system-context"

import { Context, Effect, Layer, Schema } from "effect"
import { makeLocationNode } from "../effect/app-node"
import { SystemContext } from "../system-context"
import { SystemContextRegistry } from "../system-context/registry"
import { Instructions } from "./index"

const Generation = Schema.Struct({
  baseline: Schema.NonEmptyString,
  snapshot: SystemContext.Snapshot,
})

type Generation = typeof Generation.Type

const key = Instructions.Key.make("self-improvement/context")

export interface Interface {
  readonly load: () => Effect.Effect<Instructions.Instructions>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/SystemContextInstructions") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const registry = yield* SystemContextRegistry.Service

    const observe: Effect.Effect<Generation | Instructions.Unavailable | Instructions.Removed> = registry.load().pipe(
      Effect.flatMap(SystemContext.initialize),
      Effect.map((generation) =>
        generation.baseline.length === 0
          ? Instructions.removed
          : ({ baseline: generation.baseline, snapshot: generation.snapshot } satisfies Generation),
      ),
      Effect.catchTag("SystemContext.InitializationBlocked", () => Effect.succeed(Instructions.unavailable)),
    )

    const source = Instructions.make<Generation>({
      key,
      codec: Schema.toCodecJson(Generation),
      read: observe,
      render: {
        initial: (generation) => generation.baseline,
        changed: (_previous, generation) =>
          [
            "These governed self-improvement instructions replace the previously active generated instructions:",
            generation.baseline,
          ].join("\n\n"),
        removed: () => "Previously active generated self-improvement instructions no longer apply.",
      },
    })

    return Service.of({ load: () => Effect.succeed(source) })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [SystemContextRegistry.node],
})
