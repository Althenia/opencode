export * as SelfImprovementKeyring from "./keyring"

import { chmod, mkdir, writeFile } from "fs/promises"
import path from "path"
import { Config, Context, Effect, Layer, Option, Redacted } from "effect"
import { SelfImprovement, SelfImprovementApi, SelfImprovementLifecycle } from "@opencode-ai/schema"
import { makeGlobalNode } from "../effect/app-node"
import { Global } from "../global"

export type ObservationFields = Pick<
  SelfImprovementApi.CreateObservationRequest,
  "workload" | "workloadRevision" | "errorClass" | "orderedToolSymbolIDs" | "outcomeClass" | "taskIDDigest"
>

export interface Interface {
  readonly digestObservation: (
    locationID: SelfImprovementLifecycle.LocationID,
    fields: ObservationFields,
  ) => Effect.Effect<{
    readonly patternDigest: SelfImprovement.Digest
    readonly identityDigest: SelfImprovement.Digest
  }>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SelfImprovementKeyring") {}

const encode = (values: ReadonlyArray<string>) => values.map((value) => `${value.length}:${value}`).join("")
const hex = (bytes: ArrayBuffer | Uint8Array) =>
  Array.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("")

export const make = (key: string): Interface => ({
  digestObservation: (locationID, fields) =>
    Effect.promise(async () => {
      const data = new TextEncoder()
      const cryptoKey = await crypto.subtle.importKey(
        "raw",
        data.encode(key),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
      )
      const toolDigest = hex(await crypto.subtle.digest("SHA-256", data.encode(encode(fields.orderedToolSymbolIDs))))
      const sign = async (value: string) => hex(await crypto.subtle.sign("HMAC", cryptoKey, data.encode(value)))
      const patternDigest = SelfImprovement.Digest.make(
        await sign(
          encode([
            locationID,
            fields.workload,
            String(fields.workloadRevision),
            fields.errorClass,
            toolDigest,
            fields.outcomeClass,
          ]),
        ),
      )
      return {
        patternDigest,
        identityDigest: SelfImprovement.Digest.make(
          await sign(encode([locationID, patternDigest, fields.taskIDDigest])),
        ),
      }
    }),
})

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const configured = yield* Config.option(Config.redacted("OPENCODE_SELF_IMPROVEMENT_HMAC_KEY")).pipe(Effect.orDie)
    if (Option.isSome(configured)) {
      const value = Redacted.value(configured.value)
      if (value.trim().length > 0) return Service.of(make(value))
    }

    const global = yield* Global.Service
    const key = yield* Effect.promise(async () => {
      const file = path.join(global.state, "self-improvement-hmac-key")
      const generated = hex(crypto.getRandomValues(new Uint8Array(32)))
      await mkdir(global.state, { recursive: true, mode: 0o700 })
      const created = await writeFile(file, `${generated}\n`, { flag: "wx", mode: 0o600 })
        .then(() => true)
        .catch((error: unknown) => {
          if (error instanceof Error && "code" in error && error.code === "EEXIST") return false
          throw error
        })
      if (created) return generated
      if (process.platform !== "win32") await chmod(file, 0o600)
      const existing = (await Bun.file(file).text()).trim()
      if (existing.length === 0) throw new Error(`Self-improvement HMAC key file is empty: ${file}`)
      return existing
    })
    return Service.of(make(key))
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [Global.node] })
