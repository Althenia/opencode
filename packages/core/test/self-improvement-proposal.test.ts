import { expect, test } from "bun:test"
import { Buffer } from "node:buffer"
import { createHash } from "node:crypto"
import { Schema } from "effect"
import { SelfImprovement } from "@opencode-ai/schema/self-improvement"
import { SelfImprovementProposal } from "../src/self-improvement/proposal"

const strictDecodeOptions = { errors: "all", onExcessProperty: "error" } as const

test("exports only the proposal implementation surface", () => {
  expect(SelfImprovementProposal).toBeDefined()
  expect(SelfImprovementProposal.canonicalJson).toBeFunction()
  expect(SelfImprovementProposal.rejectedByteDigest).toBeFunction()
  expect(SelfImprovementProposal.inputSnapshotDigest).toBeFunction()
  expect(SelfImprovementProposal.parse).toBeFunction()

  const canonicalJson: (input: SelfImprovement.CandidateProposal) => SelfImprovement.CanonicalJson =
    SelfImprovementProposal.canonicalJson
  const rejectedByteDigest: (input: Uint8Array) => SelfImprovement.Digest = SelfImprovementProposal.rejectedByteDigest
  const inputSnapshotDigest: (input: SelfImprovement.CanonicalJson) => SelfImprovement.Digest =
    SelfImprovementProposal.inputSnapshotDigest
  const parse: (input: Uint8Array) => SelfImprovement.ProposalParseResult = SelfImprovementProposal.parse

  expect([canonicalJson, rejectedByteDigest, inputSnapshotDigest, parse].every((value) => typeof value === "function")).toBe(true)
})

test("frames rejected proposal bytes", () => {
  const expectedDigest = (input: Uint8Array) => {
    const length = Buffer.alloc(8)
    length.writeBigUInt64BE(BigInt(input.byteLength))
    return SelfImprovement.Digest.make(
      createHash("sha256")
        .update(
          Buffer.concat([
            Buffer.from("self-improvement/evaluation/rejected-bytes/v1"),
            Buffer.from([0]),
            length,
            Buffer.from(input.buffer, input.byteOffset, input.byteLength),
          ]),
        )
        .digest("hex"),
    )
  }

  for (const size of [0, 1, 255, 256, 262144, 262145]) {
    const input = new Uint8Array(size)
    expect(SelfImprovementProposal.rejectedByteDigest(input)).toBe(expectedDigest(input))
  }

  expect(SelfImprovementProposal.rejectedByteDigest(new Uint8Array())).not.toBe(
    SelfImprovementProposal.rejectedByteDigest(Uint8Array.of(0)),
  )
  expect(SelfImprovementProposal.rejectedByteDigest(Uint8Array.of(0, 1))).not.toBe(
    SelfImprovementProposal.rejectedByteDigest(Uint8Array.of(1)),
  )
  expect(SelfImprovementProposal.rejectedByteDigest(Uint8Array.of(1, 2))).not.toBe(
    SelfImprovementProposal.rejectedByteDigest(Uint8Array.of(2)),
  )
  expect(SelfImprovementProposal.rejectedByteDigest(Uint8Array.of(1, 2, 3))).toBe(
    SelfImprovementProposal.rejectedByteDigest(Uint8Array.of(1, 2, 3)),
  )

  const backing = Uint8Array.of(0xff, 0x61, 0x62, 0x63, 0xee)
  const viewed = backing.subarray(1, 4)
  const standalone = Uint8Array.of(0x61, 0x62, 0x63)
  expect(viewed.byteLength).toBe(3)
  expect(Buffer.from(viewed.buffer, viewed.byteOffset, viewed.byteLength)).toEqual(Buffer.from([0x61, 0x62, 0x63]))
  expect(SelfImprovementProposal.rejectedByteDigest(viewed)).toBe(SelfImprovementProposal.rejectedByteDigest(standalone))
})

test("canonicalizes accepted proposals and snapshots", () => {
  const inputA = '{"references":[],"definition":{"content":"Use X","description":"X"},"name":"x","kind":"skill"}'
  const inputB = '{ "kind": "skill", "name": "x", "definition": { "description": "X", "content": "Use X" }, "references": [] }'
  const expected = SelfImprovement.CanonicalJson.make(
    '{"definition":{"content":"Use X","description":"X"},"kind":"skill","name":"x","references":[]}',
  )
  const expectedDigest = SelfImprovement.Digest.make("62bb61ad54d2d7851c04f5ce14533f3046e81333cd50d33448e46fe704350506")
  const decodedInputA = Schema.decodeUnknownSync(SelfImprovement.SkillProposal, strictDecodeOptions)(JSON.parse(inputA))
  const decodedInputB = Schema.decodeUnknownSync(SelfImprovement.SkillProposal, strictDecodeOptions)(JSON.parse(inputB))

  expect(SelfImprovementProposal.canonicalJson(decodedInputA)).toBe(expected)
  expect(SelfImprovementProposal.canonicalJson(decodedInputB)).toBe(expected)
  expect(SelfImprovementProposal.inputSnapshotDigest(expected)).toBe(expectedDigest)
  expect(SelfImprovementProposal.inputSnapshotDigest(SelfImprovementProposal.canonicalJson(decodedInputA))).toBe(expectedDigest)
  expect(SelfImprovementProposal.inputSnapshotDigest(SelfImprovementProposal.canonicalJson(decodedInputB))).toBe(expectedDigest)

  const changed = Schema.decodeUnknownSync(SelfImprovement.SkillProposal, strictDecodeOptions)({
    kind: "skill",
    name: "x",
    definition: { description: "X", content: "Use Y" },
    references: [],
  })
  expect(SelfImprovementProposal.canonicalJson(changed)).not.toBe(expected)
  expect(SelfImprovementProposal.inputSnapshotDigest(SelfImprovementProposal.canonicalJson(changed))).not.toBe(expectedDigest)

  const workflow = (steps: ReadonlyArray<{ readonly type: "agent" | "skill"; readonly reference: string; readonly input: string }>) =>
    Schema.decodeUnknownSync(SelfImprovement.WorkflowProposal, strictDecodeOptions)({
      kind: "workflow",
      name: "x",
      definition: { steps },
      references: [],
    })
  const first = SelfImprovementProposal.canonicalJson(
    workflow([
      { type: "agent", reference: "a", input: "first" },
      { type: "skill", reference: "b", input: "second" },
    ]),
  )
  const second = SelfImprovementProposal.canonicalJson(
    workflow([
      { type: "skill", reference: "b", input: "second" },
      { type: "agent", reference: "a", input: "first" },
    ]),
  )
  expect(first).not.toBe(second)
  expect(SelfImprovementProposal.inputSnapshotDigest(first)).not.toBe(SelfImprovementProposal.inputSnapshotDigest(second))
})

test("contains strict JSON analysis failures", () => {
  const encode = (value: string) => new TextEncoder().encode(value)
  const assertRejected = (
    input: Uint8Array,
    code: SelfImprovement.ProposalParseFailureCode,
    result = SelfImprovementProposal.parse(input),
  ) => {
    expect(result._tag).toBe("rejected")
    if (result._tag !== "rejected") throw new Error("expected rejected proposal")
    expect(result.failure.code).toBe(code)
    expect(result.rejectedByteDigest).toBe(SelfImprovementProposal.rejectedByteDigest(input))
  }

  const proposalBytesExceeded = new Uint8Array(262145)
  const invalidUtf8 = Uint8Array.from([0xc3, 0x28])
  const invalidJson = [
    encode(""),
    encode("{"),
    encode('{"kind":"skill",}'),
    encode("// comment\n{}"),
    encode('{"value":NaN}'),
    encode("{}{}"),
  ]
  const strictJsonRejections = [encode("/* comment */{}"), encode('[1,]'), encode("{'value':1}")]
  const nonObjectRoots = [encode("null"), encode("[]"), encode('"value"'), encode("1"), encode("true")]

  assertRejected(proposalBytesExceeded, "proposal_bytes_exceeded")
  assertRejected(invalidUtf8, "invalid_utf8")
  for (const input of [...invalidJson, ...strictJsonRejections, ...nonObjectRoots]) assertRejected(input, "invalid_json")

  const prefix = '{"kind":"skill","name":"x","definition":{"description":"x","content":'
  const body = `${"[".repeat(20000)}0${"]".repeat(20000)}`
  const suffix = '},"references":[]}'
  const deepInput = encode(`${prefix}${body}${suffix}`)
  expect(deepInput.byteLength).toBeLessThanOrEqual(262144)
  expect(() => SelfImprovementProposal.parse(deepInput)).not.toThrow()
  assertRejected(deepInput, "invalid_json")
})

test("orders duplicate pointers deterministically", () => {
  const encode = (value: string) => new TextEncoder().encode(value)
  const numeric = Array.from({ length: 11 }, (_, index) => (index === 2 || index === 10 ? '{"x":1,"x":2}' : "0")).join(",")
  const fixtures = [
    { input: encode('{"a":1,"a":2}'), pointer: "/a" },
    { input: encode('{"x":{"a":1,"a":2}}'), pointer: "/x/a" },
    { input: encode('{"x":[{"a":1,"a":2}]}'), pointer: "/x/0/a" },
    { input: encode('{"a":1,"\\u0061":2}'), pointer: "/a" },
    { input: encode('{"a/b":1,"a/b":2}'), pointer: "/a~1b" },
    { input: encode('{"a~b":1,"a~b":2}'), pointer: "/a~0b" },
    { input: encode(`{"a":[${numeric}]}`), pointer: "/a/2/x" },
    { input: encode('{"😀":{"x":1,"x":2},"�":{"x":1,"x":2}}'), pointer: "/�/x" },
    { input: encode('{"a":1,"a":2,"b":{"x":1,"x":2}}'), pointer: "/a" },
    { input: encode('{"b":{"x":1,"x":2},"a":1,"a":2}'), pointer: "/a" },
    { input: encode('{"a":{"b":1,"b":2},"a":[{"c":1,"c":2}]}'), pointer: "/a" },
    { input: encode('{"a":[{"c":1,"c":2}],"a":{"b":1,"b":2}}'), pointer: "/a" },
  ]

  for (const fixture of fixtures) {
    const result = SelfImprovementProposal.parse(fixture.input)
    expect(result._tag).toBe("rejected")
    if (result._tag !== "rejected") throw new Error("expected rejected proposal")
    expect(result.failure.code).toBe("duplicate_key")
    if (result.failure.code !== "duplicate_key") throw new Error("expected duplicate key failure")
    expect(String(result.failure.pointer)).toBe(fixture.pointer)
    expect(result.rejectedByteDigest).toBe(SelfImprovementProposal.rejectedByteDigest(fixture.input))
  }

  for (const input of [encode('{"\\ud800":1,"\\ud800":2}'), encode('{"\\udc00":1,"\\udc00":2}')]) {
    const result = SelfImprovementProposal.parse(input)
    expect(result._tag).toBe("rejected")
    if (result._tag !== "rejected") throw new Error("expected rejected proposal")
    expect(result.failure).toEqual({ code: "invalid_json", pointer: null })
    expect(result.rejectedByteDigest).toBe(SelfImprovementProposal.rejectedByteDigest(input))
  }
})

test("decodes exact candidate members", () => {
  const encode = (value: string) => new TextEncoder().encode(value)
  const unknownKinds = [encode("{}"), encode('{"kind":1}'), encode('{"kind":"other"}')]
  const invalidCandidates = [
    encode('{"kind":"skill"}'),
    encode('{"kind":"skill","name":"x","definition":{"description":"X","content":"Use X"},"references":[],"extra":true}'),
    encode(
      '{"kind":"skill","name":"x","definition":{"description":"X","content":"Use X","extra":true},"references":[]}',
    ),
  ]
  const acceptedInputs = [
    encode(
      '{"kind":"agent","name":"x","definition":{"description":"X","system":"Use X","mode":"primary","steps":1,"permissions":[]},"references":[]}',
    ),
    encode('{"kind":"skill","name":"x","definition":{"description":"X","content":"Use X"},"references":[]}'),
    encode(
      '{"kind":"workflow","name":"x","definition":{"steps":[{"type":"agent","reference":"x","input":"Use X"}]},"references":[]}',
    ),
    encode('{"kind":"mode","name":"x","definition":{"agent":"x","description":"X"},"references":[]}'),
    encode('{"kind":"command","name":"x","definition":{"template":"Use X","subtask":false},"references":[]}'),
    encode(
      '{"kind":"routing-policy","name":"x","definition":{"statements":[{"action":"provider.use","effect":"allow","resource":{"providerPattern":"*"}}]},"references":[]}',
    ),
  ]

  for (const input of acceptedInputs) {
    const result = SelfImprovementProposal.parse(input)
    expect(result._tag).toBe("accepted")
    if (result._tag !== "accepted") throw new Error("expected accepted proposal")
    expect(result.canonicalJson).toBe(SelfImprovementProposal.canonicalJson(result.proposal))
    expect(result.inputSnapshotDigest).toBe(SelfImprovementProposal.inputSnapshotDigest(result.canonicalJson))
    expect(Schema.decodeUnknownSync(SelfImprovement.ProposalParseResult, strictDecodeOptions)(result)).toEqual(result)
  }

  for (const input of unknownKinds) {
    const result = SelfImprovementProposal.parse(input)
    expect(result._tag).toBe("rejected")
    if (result._tag !== "rejected") throw new Error("expected rejected proposal")
    expect(result.failure).toEqual({ code: "unknown_kind", pointer: "/kind" })
    expect(result.rejectedByteDigest).toBe(SelfImprovementProposal.rejectedByteDigest(input))
  }

  for (const input of invalidCandidates) {
    const result = SelfImprovementProposal.parse(input)
    expect(result._tag).toBe("rejected")
    if (result._tag !== "rejected") throw new Error("expected rejected proposal")
    expect(result.failure).toEqual({ code: "invalid_candidate", pointer: null })
    expect(result.rejectedByteDigest).toBe(SelfImprovementProposal.rejectedByteDigest(input))
  }

  const skill = SelfImprovementProposal.parse(acceptedInputs[1])
  expect(skill._tag).toBe("accepted")
  if (skill._tag !== "accepted") throw new Error("expected accepted proposal")
  expect(skill.canonicalJson).toBe(
    SelfImprovement.CanonicalJson.make(
      '{"definition":{"content":"Use X","description":"X"},"kind":"skill","name":"x","references":[]}',
    ),
  )
  expect(skill.inputSnapshotDigest).toBe(
    SelfImprovement.Digest.make("62bb61ad54d2d7851c04f5ce14533f3046e81333cd50d33448e46fe704350506"),
  )
})
