import { expect, test } from "bun:test"
import { BUN_BINARY, NODE_BINARY, platformBinary } from "../src/binary"

test("published binaries use the opencode command name", async () => {
  expect(BUN_BINARY).toBe("opencode")
  expect(NODE_BINARY).toBe("opencode-node")
  expect(platformBinary(BUN_BINARY, "darwin")).toBe("opencode")
  expect(platformBinary(BUN_BINARY, "win32")).toBe("opencode.exe")
  expect(platformBinary(NODE_BINARY, "win32")).toBe("opencode-node.exe")

  const pkg = await Bun.file(new URL("../package.json", import.meta.url)).json()
  expect(pkg.bin).toEqual({ opencode: "./bin/opencode.cjs" })
  const wrappers = [...new Bun.Glob("*.cjs").scanSync(new URL("../bin/", import.meta.url).pathname)]
  expect(wrappers).toEqual(["opencode.cjs"])
})
