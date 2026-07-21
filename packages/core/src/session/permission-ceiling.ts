export * as SessionPermissionCeiling from "./permission-ceiling"

import { Permission } from "@opencode-ai/schema/permission"
import { Schema } from "effect"

export const metadataKey = "opencode.v2.permissionCeiling"

const isRuleset = Schema.is(Permission.Ruleset)

export function denyOnly(...rulesets: ReadonlyArray<Permission.Ruleset | undefined>): Permission.Ruleset {
  const seen = new Set<string>()
  return rulesets.flatMap((rules) =>
    (rules ?? []).flatMap((rule) => {
      if (rule.effect !== "deny") return []
      const key = `${rule.action}\u0000${rule.resource}`
      if (seen.has(key)) return []
      seen.add(key)
      return [{ action: rule.action, resource: rule.resource, effect: "deny" as const }]
    }),
  )
}

export function inherit(
  existing: Permission.Ruleset | undefined,
  caller: Permission.Ruleset | undefined,
): Permission.Ruleset {
  return denyOnly(existing, caller)
}

export function read(metadata: Readonly<Record<string, unknown>> | null | undefined): Permission.Ruleset {
  const value = metadata?.[metadataKey]
  return isRuleset(value) ? denyOnly(value) : []
}

export function write(
  metadata: Readonly<Record<string, unknown>> | undefined,
  rules: Permission.Ruleset | undefined,
): Record<string, unknown> | undefined {
  const ceiling = denyOnly(rules)
  if (ceiling.length === 0) return metadata ? { ...metadata } : undefined
  return { ...metadata, [metadataKey]: ceiling }
}
