import { expect, test } from "bun:test"
import { Node } from "@opencode-ai/core/effect/app-node"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Location } from "@opencode-ai/core/location"
import { locationServices } from "@opencode-ai/core/location-services"
import { AbsolutePath } from "@opencode-ai/core/schema"

test("compiles location services without unbound layer nodes", () => {
  const location = LayerNode.hoist(locationServices, Node.tags.values.global, [
    [Location.node, Location.boundNode({ directory: AbsolutePath.make("/project") })],
  ])

  expect(() => LayerNode.compile(location.node)).not.toThrow()
})
