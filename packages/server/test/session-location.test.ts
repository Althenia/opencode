import { expect, test } from "bun:test"
import { sessionLocationID } from "../src/middleware/session-location"

test("resolves Session location from standard and parent route parameters", () => {
  expect(sessionLocationID({ sessionID: "ses_direct" })).toBe("ses_direct")
  expect(sessionLocationID({ parentID: "ses_parent" })).toBe("ses_parent")
})
