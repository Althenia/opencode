export * as SelfImprovementKeyring from "./keyring"

import { Config, Context, Effect, Layer, Redacted } from "effect"
import { SelfImprovement, SelfImprovementApi, SelfImprovementLifecycle } from "@opencode-ai/schema"

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
const hex = (bytes: ArrayBuffer) =>
  Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("")

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
    const key = yield* Config.redacted("OPENCODE_SELF_IMPROVEMENT_HMAC_KEY")
    return Service.of(make(Redacted.value(key)))
  }),
)
