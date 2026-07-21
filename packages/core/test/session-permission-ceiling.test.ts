import { expect, test } from "bun:test"
import { SessionPermissionCeiling } from "@opencode-ai/core/session/permission-ceiling"

const allow = { action: "shell", resource: "*", effect: "allow" as const }
const denyShell = { action: "shell", resource: "*", effect: "deny" as const }
const denyRead = { action: "read", resource: "/secret/*", effect: "deny" as const }

test("persists only deny rules without replacing unrelated metadata", () => {
  const metadata = SessionPermissionCeiling.write(
    { owner: "test" },
    [allow, denyShell, denyShell, { action: "edit", resource: "*", effect: "ask" }],
  )

  expect(metadata).toMatchObject({ owner: "test" })
  expect(SessionPermissionCeiling.read(metadata)).toEqual([denyShell])
})

test("inherits every existing and caller deny without inheriting allows", () => {
  expect(SessionPermissionCeiling.inherit([denyRead], [allow, denyShell])).toEqual([denyRead, denyShell])
})

test("ignores malformed stored ceiling metadata", () => {
  expect(SessionPermissionCeiling.read({ [SessionPermissionCeiling.metadataKey]: [{ effect: "deny" }] })).toEqual([])
})
