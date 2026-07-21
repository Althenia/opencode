import { expect, test } from "bun:test"
import { CommandMap } from "../src/config/v1/keybind"

test("every configurable keybind has a runtime consumer", async () => {
  const files: string[] = []
  for await (const file of new Bun.Glob("src/**/*.{ts,tsx}").scan(".")) {
    if (file === "src/config/v1/keybind.ts" || file === "src/config/keybind.ts") continue
    files.push(await Bun.file(file).text())
  }
  const source = files.join("\n")
  const missing = [...new Set(Object.values(CommandMap))].filter((id) => !source.includes(`"${id}"`))

  expect(missing).toEqual([])
})
