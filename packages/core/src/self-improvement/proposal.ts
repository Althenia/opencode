export * as SelfImprovementProposal from "./proposal"

import { Buffer } from "node:buffer"
import { Exit, Schema } from "effect"
import { getNodeValue, parseTree, type Node, type ParseError } from "jsonc-parser"
import { SelfImprovement } from "@opencode-ai/schema/self-improvement"
import { Hash } from "../util/hash"

const strictDecodeOptions = { errors: "all", onExcessProperty: "error" } as const

type JsonValue = string | boolean | number | JsonValue[] | { [key: string]: JsonValue }
type Segment = string | number

export const canonicalJson = (input: SelfImprovement.CandidateProposal): SelfImprovement.CanonicalJson =>
  SelfImprovement.CanonicalJson.make(JSON.stringify(rebuildJson(input)))

export const rejectedByteDigest = (input: Uint8Array): SelfImprovement.Digest => {
  const length = Buffer.alloc(8)
  length.writeBigUInt64BE(BigInt(input.byteLength))
  return SelfImprovement.Digest.make(
    Hash.sha256(
      Buffer.concat([
        Buffer.from("self-improvement/evaluation/rejected-bytes/v1"),
        Buffer.from([0]),
        length,
        Buffer.from(input.buffer, input.byteOffset, input.byteLength),
      ]),
    ),
  )
}

export const inputSnapshotDigest = (input: SelfImprovement.CanonicalJson): SelfImprovement.Digest =>
  SelfImprovement.Digest.make(Hash.sha256(Buffer.from(`self-improvement/evaluation/input/v2\0${input}`)))

export const parse = (input: Uint8Array): SelfImprovement.ProposalParseResult => {
  if (input.byteLength > 262144) return rejected(input, { code: "proposal_bytes_exceeded", pointer: null })

  const text = decodeUtf8(input)
  if (text === undefined) return rejected(input, { code: "invalid_utf8", pointer: null })

  const analysis = analyzeJson(text)
  if ("failure" in analysis) return rejected(input, analysis.failure)

  const kind = Object.prototype.hasOwnProperty.call(analysis.root, "kind") ? analysis.root.kind : undefined
  switch (kind) {
    case "agent": {
      const decoded = Schema.decodeUnknownExit(SelfImprovement.AgentProposal, strictDecodeOptions)(analysis.root)
      return Exit.isFailure(decoded) ? rejected(input, { code: "invalid_candidate", pointer: null }) : accepted(decoded.value)
    }
    case "skill": {
      const decoded = Schema.decodeUnknownExit(SelfImprovement.SkillProposal, strictDecodeOptions)(analysis.root)
      return Exit.isFailure(decoded) ? rejected(input, { code: "invalid_candidate", pointer: null }) : accepted(decoded.value)
    }
    case "workflow": {
      const decoded = Schema.decodeUnknownExit(SelfImprovement.WorkflowProposal, strictDecodeOptions)(analysis.root)
      return Exit.isFailure(decoded) ? rejected(input, { code: "invalid_candidate", pointer: null }) : accepted(decoded.value)
    }
    case "mode": {
      const decoded = Schema.decodeUnknownExit(SelfImprovement.ModeProposal, strictDecodeOptions)(analysis.root)
      return Exit.isFailure(decoded) ? rejected(input, { code: "invalid_candidate", pointer: null }) : accepted(decoded.value)
    }
    case "command": {
      const decoded = Schema.decodeUnknownExit(SelfImprovement.CommandProposal, strictDecodeOptions)(analysis.root)
      return Exit.isFailure(decoded) ? rejected(input, { code: "invalid_candidate", pointer: null }) : accepted(decoded.value)
    }
    case "routing-policy": {
      const decoded = Schema.decodeUnknownExit(SelfImprovement.RoutingPolicyProposal, strictDecodeOptions)(analysis.root)
      return Exit.isFailure(decoded) ? rejected(input, { code: "invalid_candidate", pointer: null }) : accepted(decoded.value)
    }
  }
  return rejected(input, { code: "unknown_kind", pointer: "/kind" })
}

function compareUnicodeScalars(left: string, right: string) {
  const leftScalars = Array.from(left, (value) => value.codePointAt(0) ?? 0)
  const rightScalars = Array.from(right, (value) => value.codePointAt(0) ?? 0)
  const length = Math.min(leftScalars.length, rightScalars.length)
  for (let index = 0; index < length; index++) {
    if (leftScalars[index] !== rightScalars[index]) return leftScalars[index] - rightScalars[index]
  }
  return leftScalars.length - rightScalars.length
}

function rebuildJson(value: unknown): JsonValue {
  if (typeof value === "string" || typeof value === "boolean") return value
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value
  if (Array.isArray(value)) return value.map(rebuildJson)
  if (isRecord(value)) {
    return Object.keys(value)
      .sort(compareUnicodeScalars)
      .reduce<Record<string, JsonValue>>((rebuilt, key) => {
        rebuilt[key] = rebuildJson(value[key])
        return rebuilt
      }, {})
  }
  throw new TypeError("Candidate proposal contains a non-JSON value")
}

function decodeUtf8(input: Uint8Array) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(input)
  } catch {
    return undefined
  }
}

function rejected(input: Uint8Array, failure: SelfImprovement.ProposalFailure): SelfImprovement.ProposalParseResult {
  return { _tag: "rejected", rejectedByteDigest: rejectedByteDigest(input), failure }
}

function accepted(proposal: SelfImprovement.CandidateProposal): SelfImprovement.ProposalParseResult {
  const canonical = canonicalJson(proposal)
  return { _tag: "accepted", proposal, canonicalJson: canonical, inputSnapshotDigest: inputSnapshotDigest(canonical) }
}

function analyzeJson(text: string): { root: Record<string, unknown> } | { failure: SelfImprovement.ProposalFailure } {
  try {
    const errors: ParseError[] = []
    const rootNode = parseTree(text, errors, { disallowComments: true, allowTrailingComma: false, allowEmptyContent: false })
    if (errors.length > 0 || rootNode?.type !== "object") return { failure: { code: "invalid_json", pointer: null } }

    const duplicates: Segment[][] = []
    collectDuplicates(rootNode, [], duplicates)
    const duplicate = [...new Map(duplicates.map((path) => [JSON.stringify(path), path])).values()].sort(comparePaths)[0]
    if (duplicate) {
      return {
        failure: {
          code: "duplicate_key",
          pointer: SelfImprovement.JsonPointer.make(`/${duplicate.map(renderPointerSegment).join("/")}`),
        },
      }
    }

    const root: unknown = getNodeValue(rootNode)
    if (!isRecord(root)) return { failure: { code: "invalid_json", pointer: null } }
    return { root }
  } catch {
    return { failure: { code: "invalid_json", pointer: null } }
  }
}

function collectDuplicates(node: Node, path: Segment[], duplicates: Segment[][]): void {
  if (node.type === "array") {
    node.children?.forEach((child, index) => collectDuplicates(child, [...path, index], duplicates))
    return
  }
  if (node.type !== "object") return

  const seen = new Set<string>()
  for (const property of node.children ?? []) {
    const keyNode = property.children?.[0]
    const valueNode = property.children?.[1]
    if (!keyNode || !valueNode) throw new Error("invalid property node")
    const key: unknown = getNodeValue(keyNode)
    if (typeof key !== "string" || hasUnpairedSurrogate(key)) throw new Error("invalid property key")
    if (seen.has(key)) duplicates.push([...path, key])
    seen.add(key)
    collectDuplicates(valueNode, [...path, key], duplicates)
  }
}

function comparePaths(left: Segment[], right: Segment[]) {
  const length = Math.min(left.length, right.length)
  for (let index = 0; index < length; index++) {
    const leftSegment = left[index]
    const rightSegment = right[index]
    if (typeof leftSegment === "number" && typeof rightSegment === "number") {
      if (leftSegment !== rightSegment) return leftSegment - rightSegment
      continue
    }
    if (typeof leftSegment === "string" && typeof rightSegment === "string") {
      const compared = compareUnicodeScalars(leftSegment, rightSegment)
      if (compared !== 0) return compared
      continue
    }
    if (typeof leftSegment === "number") return -1
    if (typeof rightSegment === "number") return 1
  }
  return left.length - right.length
}

function renderPointerSegment(segment: Segment) {
  return String(segment).replace(/~/g, "~0").replace(/\//g, "~1")
}

function hasUnpairedSurrogate(value: string) {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    if (code >= 0xd800 && code <= 0xdbff) {
      if (index + 1 >= value.length) return true
      const next = value.charCodeAt(index + 1)
      if (next < 0xdc00 || next > 0xdfff) return true
      index++
      continue
    }
    if (code >= 0xdc00 && code <= 0xdfff) return true
  }
  return false
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}
