import { expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fetchModelsSnapshot, readModelsSnapshot } from "./models-snapshot"

test("reads and validates a models.dev object snapshot", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "opencode-models-snapshot-"))
  const file = path.join(root, "api.json")
  const text = '{"openrouter":{"name":"OpenRouter","models":{}}}\n'
  try {
    await writeFile(file, text)
    expect(await readModelsSnapshot(file)).toBe(text)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("rejects invalid and non-object snapshots with a clear source", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "opencode-models-snapshot-"))
  const invalid = path.join(root, "invalid.json")
  const array = path.join(root, "array.json")
  try {
    await writeFile(invalid, "not json")
    await writeFile(array, "[]")
    await expect(readModelsSnapshot(invalid)).rejects.toThrow(`Invalid models.dev snapshot: ${invalid}`)
    await expect(readModelsSnapshot(array)).rejects.toThrow(`Models.dev snapshot must be a JSON object: ${array}`)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("fetches a bounded validated refresh and rejects non-success responses", async () => {
  const valid = await fetchModelsSnapshot("https://models.test/api.json", async (_input, init) => {
    expect(init?.signal).toBeInstanceOf(AbortSignal)
    return new Response('{"provider":{"models":{}}}')
  })
  expect(valid).toBe('{"provider":{"models":{}}}')

  await expect(
    fetchModelsSnapshot("https://models.test/api.json", async () => new Response("unavailable", { status: 503 })),
  ).rejects.toThrow("Models.dev refresh failed with status 503")
})

test("normal build generation reads the committed snapshot without fetching", async () => {
  const source = await Bun.file(path.join(import.meta.dir, "generate.ts")).text()
  expect(source).toContain("models-dev.snapshot.json")
  expect(source).not.toContain("fetch(")
})
