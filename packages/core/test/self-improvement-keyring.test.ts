import { afterEach, expect, test } from "bun:test"
import { mkdtemp, rm, stat } from "fs/promises"
import os from "os"
import path from "path"
import { ConfigProvider, Effect, Layer } from "effect"
import { SelfImprovement, SelfImprovementApi, SelfImprovementEvaluation, SelfImprovementLifecycle } from "@opencode-ai/schema"
import { Global } from "@opencode-ai/core/global"
import { SelfImprovementKeyring } from "@opencode-ai/core/self-improvement/keyring"

const directories: string[] = []
const locationID = SelfImprovementLifecycle.LocationID.make("a".repeat(64))
const observation: SelfImprovementKeyring.ObservationFields = {
  workload: SelfImprovementEvaluation.Workload.make("typescript"),
  workloadRevision: SelfImprovementLifecycle.Revision.make(1),
  errorClass: "type-error",
  orderedToolSymbolIDs: ["tool-a", "symbol-b"],
  outcomeClass: "failure",
  taskIDDigest: SelfImprovement.Digest.make("b".repeat(64)),
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

test("generates and persists the self-improvement HMAC key when configuration is absent", async () => {
  const state = await mkdtemp(path.join(os.tmpdir(), "opencode-keyring-"))
  directories.push(state)
  const keyringLayer = SelfImprovementKeyring.layer.pipe(
    Layer.provide(Global.layerWith({ state })),
    Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({}))),
  )
  const digest = () =>
    Effect.runPromise(
      SelfImprovementKeyring.Service.use((keyring) => keyring.digestObservation(locationID, observation)).pipe(
        Effect.provide(keyringLayer),
      ),
    )

  const first = await digest()
  const second = await digest()
  const key = Bun.file(path.join(state, "self-improvement-hmac-key"))

  expect(second).toEqual(first)
  expect(await key.exists()).toBe(true)
  expect((await key.text()).trim()).toHaveLength(64)
  if (process.platform !== "win32") expect((await stat(key.name!)).mode & 0o777).toBe(0o600)
})

test("treats an empty configured HMAC key as absent", async () => {
  const state = await mkdtemp(path.join(os.tmpdir(), "opencode-keyring-empty-"))
  directories.push(state)
  const keyringLayer = SelfImprovementKeyring.layer.pipe(
    Layer.provide(Global.layerWith({ state })),
    Layer.provide(
      ConfigProvider.layer(ConfigProvider.fromUnknown({ OPENCODE_SELF_IMPROVEMENT_HMAC_KEY: "   " })),
    ),
  )

  await Effect.runPromise(
    SelfImprovementKeyring.Service.use((keyring) => keyring.digestObservation(locationID, observation)).pipe(
      Effect.provide(keyringLayer),
    ),
  )

  expect((await Bun.file(path.join(state, "self-improvement-hmac-key")).text()).trim()).toHaveLength(64)
})
