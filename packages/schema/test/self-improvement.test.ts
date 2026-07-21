import { expect, test } from "bun:test"
import { Exit, Schema } from "effect"
import { SelfImprovement as DirectSelfImprovement } from "../src/self-improvement.js"
import { SelfImprovement } from "../src/index.js"

const strictDecodeOptions = { errors: "all", onExcessProperty: "error" } as const

function expectDecodeSuccess<S extends Schema.Decoder<unknown>>(schema: S, input: unknown): S["Type"] {
  const result = Schema.decodeUnknownExit(schema, strictDecodeOptions)(input)
  expect(Exit.isSuccess(result)).toBe(true)
  if (Exit.isFailure(result)) throw new Error("expected schema decode to succeed")
  return result.value
}

function expectDecodeFailure(schema: Schema.Decoder<unknown>, input: unknown) {
  expect(Exit.isFailure(Schema.decodeUnknownExit(schema, strictDecodeOptions)(input))).toBe(true)
}

const textEncoder = new TextEncoder()

function definitionBytes(value: unknown) {
  return textEncoder.encode(JSON.stringify(value)).byteLength
}

interface PaddingSlot {
  value: string
  readonly minimumScalars: number
  readonly maximumScalars: number
  readonly maximumBytes: number
  readonly write: (value: string) => void
}

function padDefinition<T extends object>(definition: T, targetBytes: number, slots: Array<PaddingSlot>) {
  for (const slot of slots) {
    slot.value = "a".repeat(slot.minimumScalars)
    slot.write(slot.value)
  }

  let remaining = targetBytes - definitionBytes(definition)
  for (const slot of slots) {
    const available = slot.maximumScalars - Array.from(slot.value).length
    const controls = Math.min(Math.floor(remaining / 6), available)
    slot.value += "\u0001".repeat(controls)
    remaining -= controls * 6

    const ascii = Math.min(remaining, slot.maximumScalars - Array.from(slot.value).length)
    slot.value += "a".repeat(ascii)
    remaining -= ascii
    slot.write(slot.value)
  }

  expect(remaining).toBe(0)
  for (const slot of slots) {
    expect(Array.from(slot.value).length).toBeGreaterThanOrEqual(slot.minimumScalars)
    expect(Array.from(slot.value).length).toBeLessThanOrEqual(slot.maximumScalars)
    expect(textEncoder.encode(slot.value).byteLength).toBeLessThanOrEqual(slot.maximumBytes)
  }
  expect(definitionBytes(definition)).toBe(targetBytes)
  return definition
}

test("defines Slice 1A primitives and module exports", () => {
  expect(DirectSelfImprovement).toBe(SelfImprovement)

  const schemas = [
    SelfImprovement.ArtifactKind,
    SelfImprovement.ProposalParseFailureCode,
    SelfImprovement.Digest,
    SelfImprovement.CandidateName,
    SelfImprovement.CanonicalJson,
    SelfImprovement.JsonPointer,
  ]
  expect(schemas.every(Schema.isSchema)).toBe(true)

  const artifactKind: SelfImprovement.ArtifactKind = "agent"
  const failureCode: SelfImprovement.ProposalParseFailureCode = "invalid_json"
  const digest: SelfImprovement.Digest = Schema.decodeUnknownSync(SelfImprovement.Digest)("a".repeat(64))
  const candidateName: SelfImprovement.CandidateName = Schema.decodeUnknownSync(SelfImprovement.CandidateName)("candidate")
  const canonicalJson: SelfImprovement.CanonicalJson = Schema.decodeUnknownSync(SelfImprovement.CanonicalJson)("{}")
  const jsonPointer: SelfImprovement.JsonPointer = Schema.decodeUnknownSync(SelfImprovement.JsonPointer)("/kind")
  expect(artifactKind).toBe("agent")
  expect(failureCode).toBe("invalid_json")
  expect(String(digest)).toBe("a".repeat(64))
  expect(String(candidateName)).toBe("candidate")
  expect(String(canonicalJson)).toBe("{}")
  expect(String(jsonPointer)).toBe("/kind")

  for (const value of ["0".repeat(64), "0123456789abcdef".repeat(4)]) {
    expectDecodeSuccess(SelfImprovement.Digest, value)
  }
  for (const value of ["a".repeat(63), "a".repeat(65), "A".repeat(64), `${"a".repeat(63)}g`]) {
    expectDecodeFailure(SelfImprovement.Digest, value)
  }

  for (const value of ["a", "a".repeat(64), "a.b_c-d0"]) {
    expectDecodeSuccess(SelfImprovement.CandidateName, value)
  }
  for (const value of ["", ".candidate", "candidate-", "Candidate", "a".repeat(65)]) {
    expectDecodeFailure(SelfImprovement.CandidateName, value)
  }

  for (const value of ["/", "/a", "/a/b", "/a~0b", "/a~1b", "/~0/~1"]) {
    expectDecodeSuccess(SelfImprovement.JsonPointer, value)
  }
  for (const value of ["", "a", "~1", "/~", "/~2", "/a~3b"]) {
    expectDecodeFailure(SelfImprovement.JsonPointer, value)
  }

  const identifiers = schemas.map((schema) => schema.ast.annotations?.identifier)
  expect(identifiers).toEqual([
    "SelfImprovement.ArtifactKind",
    "SelfImprovement.ProposalParseFailureCode",
    "SelfImprovement.Digest",
    "SelfImprovement.CandidateName",
    "SelfImprovement.CanonicalJson",
    "SelfImprovement.JsonPointer",
  ])
  expect(identifiers.every((identifier) => typeof identifier === "string")).toBe(true)
  expect(new Set(identifiers).size).toBe(6)
})

test("defines exact nested proposal schemas", () => {
  const nestedSchemas = [
    SelfImprovement.DenyRule,
    SelfImprovement.ModelRef,
    SelfImprovement.WorkflowStep,
    SelfImprovement.RoutingResource,
    SelfImprovement.RoutingStatement,
    SelfImprovement.AgentDefinition,
    SelfImprovement.ModeDefinition,
    SelfImprovement.SkillDefinition,
    SelfImprovement.CommandDefinition,
    SelfImprovement.WorkflowDefinition,
    SelfImprovement.RoutingPolicyDefinition,
  ]
  expect(nestedSchemas.every(Schema.isSchema)).toBe(true)

  const candidateName = Schema.decodeUnknownSync(SelfImprovement.CandidateName)("candidate")
  const denyRuleInput = { action: "read", resource: "src/**", effect: "deny" } as const
  const modelRefInput = { providerID: "provider", modelID: "model" } as const
  const workflowStepInput = { type: "agent", reference: candidateName, input: "run" } as const
  const routingResourceInput = { providerPattern: "*", modelPattern: "provider/model:*" } as const
  const routingStatementInput = { action: "provider.use", effect: "allow", resource: routingResourceInput } as const
  const agentDefinitionInput = {
    description: "agent",
    system: "system",
    mode: "primary",
    steps: 1,
    permissions: [denyRuleInput],
  } as const
  const modeDefinitionInput = { agent: candidateName, description: "mode" } as const
  const skillDefinitionInput = { description: "skill", content: "content" } as const
  const commandDefinitionInput = { template: "template", subtask: false } as const
  const workflowDefinitionInput = { steps: [workflowStepInput] } as const
  const routingPolicyDefinitionInput = { statements: [routingStatementInput] } as const

  const denyRule: SelfImprovement.DenyRule = expectDecodeSuccess(SelfImprovement.DenyRule, denyRuleInput)
  const modelRef: SelfImprovement.ModelRef = expectDecodeSuccess(SelfImprovement.ModelRef, modelRefInput)
  const workflowStep: SelfImprovement.WorkflowStep = expectDecodeSuccess(SelfImprovement.WorkflowStep, workflowStepInput)
  const routingResource: SelfImprovement.RoutingResource = expectDecodeSuccess(
    SelfImprovement.RoutingResource,
    routingResourceInput,
  )
  const routingStatement: SelfImprovement.RoutingStatement = expectDecodeSuccess(
    SelfImprovement.RoutingStatement,
    routingStatementInput,
  )
  const agentDefinition: SelfImprovement.AgentDefinition = expectDecodeSuccess(
    SelfImprovement.AgentDefinition,
    agentDefinitionInput,
  )
  const modeDefinition: SelfImprovement.ModeDefinition = expectDecodeSuccess(
    SelfImprovement.ModeDefinition,
    modeDefinitionInput,
  )
  const skillDefinition: SelfImprovement.SkillDefinition = expectDecodeSuccess(
    SelfImprovement.SkillDefinition,
    skillDefinitionInput,
  )
  const commandDefinition: SelfImprovement.CommandDefinition = expectDecodeSuccess(
    SelfImprovement.CommandDefinition,
    commandDefinitionInput,
  )
  const workflowDefinition: SelfImprovement.WorkflowDefinition = expectDecodeSuccess(
    SelfImprovement.WorkflowDefinition,
    workflowDefinitionInput,
  )
  const routingPolicyDefinition: SelfImprovement.RoutingPolicyDefinition = expectDecodeSuccess(
    SelfImprovement.RoutingPolicyDefinition,
    routingPolicyDefinitionInput,
  )

  expect(routingResource).toEqual(routingResourceInput)
  expect([
    Object.keys(denyRule),
    Object.keys(modelRef),
    Object.keys(workflowStep),
    Object.keys(routingStatement),
    Object.keys(agentDefinition),
    Object.keys(modeDefinition),
    Object.keys(skillDefinition),
    Object.keys(commandDefinition),
    Object.keys(workflowDefinition),
    Object.keys(routingPolicyDefinition),
  ]).toEqual([
    ["action", "resource", "effect"],
    ["providerID", "modelID"],
    ["type", "reference", "input"],
    ["action", "effect", "resource"],
    ["description", "system", "mode", "steps", "permissions"],
    ["agent", "description"],
    ["description", "content"],
    ["template", "subtask"],
    ["steps"],
    ["statements"],
  ])

  const requiredCases = [
    [SelfImprovement.DenyRule, denyRuleInput, ["action", "resource", "effect"]],
    [SelfImprovement.ModelRef, modelRefInput, ["providerID", "modelID"]],
    [SelfImprovement.WorkflowStep, workflowStepInput, ["type", "reference", "input"]],
    [SelfImprovement.RoutingResource, routingResourceInput, ["providerPattern"]],
    [SelfImprovement.RoutingStatement, routingStatementInput, ["action", "effect", "resource"]],
    [SelfImprovement.AgentDefinition, agentDefinitionInput, ["description", "system", "mode", "steps", "permissions"]],
    [SelfImprovement.ModeDefinition, modeDefinitionInput, ["agent", "description"]],
    [SelfImprovement.SkillDefinition, skillDefinitionInput, ["description", "content"]],
    [SelfImprovement.CommandDefinition, commandDefinitionInput, ["template", "subtask"]],
    [SelfImprovement.WorkflowDefinition, workflowDefinitionInput, ["steps"]],
    [SelfImprovement.RoutingPolicyDefinition, routingPolicyDefinitionInput, ["statements"]],
  ] as const
  for (const [schema, input, fields] of requiredCases) {
    for (const field of fields) {
      const missing = { ...input }
      delete (missing as Record<string, unknown>)[field]
      expectDecodeFailure(schema, missing)
    }
  }

  expectDecodeFailure(SelfImprovement.DenyRule, { ...denyRuleInput, effect: "allow" })
  expectDecodeFailure(SelfImprovement.WorkflowStep, { ...workflowStepInput, type: "workflow" })
  expectDecodeFailure(SelfImprovement.RoutingStatement, { ...routingStatementInput, action: "provider.read" })
  expectDecodeFailure(SelfImprovement.RoutingStatement, { ...routingStatementInput, effect: "ask" })
  expectDecodeFailure(SelfImprovement.AgentDefinition, { ...agentDefinitionInput, mode: "all" })

  const boundedTextCases = [
    [SelfImprovement.DenyRule, denyRuleInput, "action", 1, 128],
    [SelfImprovement.DenyRule, denyRuleInput, "resource", 1, 512],
    [SelfImprovement.ModelRef, modelRefInput, "modelID", 1, 256],
    [SelfImprovement.WorkflowStep, workflowStepInput, "input", 1, 2000],
    [SelfImprovement.AgentDefinition, agentDefinitionInput, "description", 0, 512],
    [SelfImprovement.AgentDefinition, agentDefinitionInput, "system", 1, 16384],
    [SelfImprovement.ModeDefinition, modeDefinitionInput, "description", 0, 512],
    [SelfImprovement.SkillDefinition, skillDefinitionInput, "description", 0, 512],
    [SelfImprovement.SkillDefinition, skillDefinitionInput, "content", 1, 32768],
    [SelfImprovement.CommandDefinition, { ...commandDefinitionInput, description: "description" }, "template", 1, 16384],
    [SelfImprovement.CommandDefinition, { ...commandDefinitionInput, description: "description" }, "description", 0, 512],
    [SelfImprovement.WorkflowDefinition, { ...workflowDefinitionInput, description: "description" }, "description", 0, 512],
  ] as const
  for (const [schema, input, field, minimum, maximum] of boundedTextCases) {
    expectDecodeSuccess(schema, { ...input, [field]: minimum === 0 ? "" : "a".repeat(minimum) })
    expectDecodeSuccess(schema, { ...input, [field]: "😀".repeat(maximum) })
    expectDecodeFailure(schema, { ...input, [field]: "a".repeat(maximum + 1) })
    expectDecodeFailure(schema, { ...input, [field]: "😀".repeat(maximum) + "a" })
    expectDecodeFailure(schema, { ...input, [field]: "\ud800" })
    expectDecodeFailure(schema, { ...input, [field]: "\udc00" })
    if (minimum === 1) expectDecodeFailure(schema, { ...input, [field]: "" })
  }

  expectDecodeSuccess(SelfImprovement.ModelRef, { ...modelRefInput, providerID: "A".repeat(128) })
  expectDecodeFailure(SelfImprovement.ModelRef, { ...modelRefInput, providerID: "" })
  expectDecodeFailure(SelfImprovement.ModelRef, { ...modelRefInput, providerID: "A".repeat(129) })
  expectDecodeFailure(SelfImprovement.ModelRef, { ...modelRefInput, providerID: "é" })

  expectDecodeSuccess(SelfImprovement.RoutingResource, { providerPattern: "A".repeat(128) })
  expectDecodeFailure(SelfImprovement.RoutingResource, { providerPattern: "" })
  expectDecodeFailure(SelfImprovement.RoutingResource, { providerPattern: "A".repeat(129) })
  expectDecodeFailure(SelfImprovement.RoutingResource, { providerPattern: "/" })
  expectDecodeSuccess(SelfImprovement.RoutingResource, {
    providerPattern: "*",
    modelPattern: "A".repeat(256),
  })
  expectDecodeFailure(SelfImprovement.RoutingResource, { providerPattern: "*", modelPattern: "" })
  expectDecodeFailure(SelfImprovement.RoutingResource, { providerPattern: "*", modelPattern: "A".repeat(257) })
  expectDecodeFailure(SelfImprovement.RoutingResource, { providerPattern: "*", modelPattern: "é" })

  const optionalCases = [
    [SelfImprovement.RoutingResource, { providerPattern: "*" }, "modelPattern", "provider/model:*"],
    [SelfImprovement.AgentDefinition, agentDefinitionInput, "model", modelRefInput],
    [SelfImprovement.AgentDefinition, agentDefinitionInput, "hidden", true],
    [SelfImprovement.AgentDefinition, agentDefinitionInput, "color", "#aBc123"],
    [SelfImprovement.CommandDefinition, commandDefinitionInput, "description", ""],
    [SelfImprovement.CommandDefinition, commandDefinitionInput, "agent", candidateName],
    [SelfImprovement.CommandDefinition, commandDefinitionInput, "model", modelRefInput],
    [SelfImprovement.WorkflowDefinition, workflowDefinitionInput, "description", ""],
  ] as const
  for (const [schema, input, field, value] of optionalCases) {
    expectDecodeSuccess(schema, input)
    expectDecodeSuccess(schema, { ...input, [field]: value })
    expectDecodeFailure(schema, { ...input, [field]: undefined })
  }
  expectDecodeFailure(SelfImprovement.AgentDefinition, { ...agentDefinitionInput, hidden: "true" })
  expectDecodeFailure(SelfImprovement.AgentDefinition, { ...agentDefinitionInput, color: "red" })

  expectDecodeSuccess(SelfImprovement.AgentDefinition, { ...agentDefinitionInput, steps: 100 })
  expectDecodeFailure(SelfImprovement.AgentDefinition, { ...agentDefinitionInput, steps: 0 })
  expectDecodeFailure(SelfImprovement.AgentDefinition, { ...agentDefinitionInput, steps: 101 })
  expectDecodeFailure(SelfImprovement.AgentDefinition, { ...agentDefinitionInput, steps: 1.5 })
  expectDecodeSuccess(SelfImprovement.AgentDefinition, { ...agentDefinitionInput, permissions: Array(64).fill(denyRuleInput) })
  expectDecodeFailure(SelfImprovement.AgentDefinition, { ...agentDefinitionInput, permissions: Array(65).fill(denyRuleInput) })
  expectDecodeSuccess(SelfImprovement.WorkflowDefinition, {
    ...workflowDefinitionInput,
    steps: Array(32).fill(workflowStepInput),
  })
  expectDecodeFailure(SelfImprovement.WorkflowDefinition, { ...workflowDefinitionInput, steps: [] })
  expectDecodeFailure(SelfImprovement.WorkflowDefinition, {
    ...workflowDefinitionInput,
    steps: Array(33).fill(workflowStepInput),
  })
  expectDecodeSuccess(SelfImprovement.RoutingPolicyDefinition, {
    statements: Array(64).fill(routingStatementInput),
  })
  expectDecodeFailure(SelfImprovement.RoutingPolicyDefinition, { statements: [] })
  expectDecodeFailure(SelfImprovement.RoutingPolicyDefinition, {
    statements: Array(65).fill(routingStatementInput),
  })

  expectDecodeFailure(SelfImprovement.AgentDefinition, { ...agentDefinitionInput, unknown: true })
  expectDecodeFailure(SelfImprovement.AgentDefinition, {
    ...agentDefinitionInput,
    model: { ...modelRefInput, unknown: true },
  })

  const identifiers = [
    SelfImprovement.ArtifactKind,
    SelfImprovement.ProposalParseFailureCode,
    SelfImprovement.Digest,
    SelfImprovement.CandidateName,
    SelfImprovement.CanonicalJson,
    SelfImprovement.JsonPointer,
    ...nestedSchemas,
  ].map((schema) => schema.ast.annotations?.identifier)
  expect(identifiers).toEqual([
    "SelfImprovement.ArtifactKind",
    "SelfImprovement.ProposalParseFailureCode",
    "SelfImprovement.Digest",
    "SelfImprovement.CandidateName",
    "SelfImprovement.CanonicalJson",
    "SelfImprovement.JsonPointer",
    "SelfImprovement.DenyRule",
    "SelfImprovement.ModelRef",
    "SelfImprovement.WorkflowStep",
    "SelfImprovement.RoutingResource",
    "SelfImprovement.RoutingStatement",
    "SelfImprovement.AgentDefinition",
    "SelfImprovement.ModeDefinition",
    "SelfImprovement.SkillDefinition",
    "SelfImprovement.CommandDefinition",
    "SelfImprovement.WorkflowDefinition",
    "SelfImprovement.RoutingPolicyDefinition",
  ])
  expect(identifiers.every((identifier) => typeof identifier === "string")).toBe(true)
  expect(new Set(identifiers).size).toBe(17)
})

test("enforces reachable and implied definition limits", async () => {
  const candidateName = Schema.decodeUnknownSync(SelfImprovement.CandidateName)("candidate")
  const denyRule = { action: "read", resource: "src/**", effect: "deny" } as const
  const workflowStep = { type: "agent", reference: candidateName, input: "run" } as const

  const sourceOrderCases = [
    [
      SelfImprovement.AgentDefinition,
      { description: "agent", system: "system", mode: "primary", steps: 1, permissions: [denyRule] },
      { permissions: [denyRule], steps: 1, mode: "primary", system: "system", description: "agent" },
    ],
    [
      SelfImprovement.SkillDefinition,
      { description: "skill", content: "content" },
      { content: "content", description: "skill" },
    ],
    [
      SelfImprovement.CommandDefinition,
      { template: "template", description: "command", subtask: false },
      { subtask: false, description: "command", template: "template" },
    ],
    [
      SelfImprovement.WorkflowDefinition,
      { description: "workflow", steps: [workflowStep] },
      { steps: [workflowStep], description: "workflow" },
    ],
  ] as const
  for (const [schema, first, second] of sourceOrderCases) {
    expect(definitionBytes(expectDecodeSuccess(schema, first))).toBe(definitionBytes(expectDecodeSuccess(schema, second)))
  }

  const makeAgentDefinition = (targetBytes: number) => {
    const permissions = Array.from({ length: 64 }, () => ({ action: "", resource: "", effect: "deny" as const }))
    const definition = {
      description: "",
      system: "",
      mode: "primary" as const,
      steps: 100,
      permissions,
    }
    const slots: Array<PaddingSlot> = [
      {
        value: definition.description,
        minimumScalars: 0,
        maximumScalars: 512,
        maximumBytes: 2048,
        write: (value) => (definition.description = value),
      },
      {
        value: definition.system,
        minimumScalars: 1,
        maximumScalars: 16384,
        maximumBytes: 65536,
        write: (value) => (definition.system = value),
      },
      ...permissions.flatMap((permission) => [
        {
          value: permission.action,
          minimumScalars: 1,
          maximumScalars: 128,
          maximumBytes: 512,
          write: (value: string) => (permission.action = value),
        },
        {
          value: permission.resource,
          minimumScalars: 1,
          maximumScalars: 512,
          maximumBytes: 2048,
          write: (value: string) => (permission.resource = value),
        },
      ]),
    ]
    return padDefinition(definition, targetBytes, slots)
  }

  const makeSkillDefinition = (targetBytes: number) => {
    const definition = { description: "", content: "" }
    return padDefinition(definition, targetBytes, [
      {
        value: definition.description,
        minimumScalars: 0,
        maximumScalars: 512,
        maximumBytes: 2048,
        write: (value) => (definition.description = value),
      },
      {
        value: definition.content,
        minimumScalars: 1,
        maximumScalars: 32768,
        maximumBytes: 131072,
        write: (value) => (definition.content = value),
      },
    ])
  }

  const makeCommandDefinition = (targetBytes: number) => {
    const definition = { template: "", description: "", subtask: false }
    return padDefinition(definition, targetBytes, [
      {
        value: definition.template,
        minimumScalars: 1,
        maximumScalars: 16384,
        maximumBytes: 65536,
        write: (value) => (definition.template = value),
      },
      {
        value: definition.description,
        minimumScalars: 0,
        maximumScalars: 512,
        maximumBytes: 2048,
        write: (value) => (definition.description = value),
      },
    ])
  }

  const makeWorkflowDefinition = (targetBytes: number) => {
    const steps = Array.from({ length: 32 }, () => ({ type: "agent" as const, reference: candidateName, input: "" }))
    const definition = { description: "", steps }
    return padDefinition(definition, targetBytes, [
      {
        value: definition.description,
        minimumScalars: 0,
        maximumScalars: 512,
        maximumBytes: 2048,
        write: (value) => (definition.description = value),
      },
      ...steps.map((step) => ({
        value: step.input,
        minimumScalars: 1,
        maximumScalars: 2000,
        maximumBytes: 8000,
        write: (value: string) => (step.input = value),
      })),
    ])
  }

  const agentAtLimit = makeAgentDefinition(131072)
  const skillAtLimit = makeSkillDefinition(163840)
  const commandAtLimit = makeCommandDefinition(81920)
  const workflowAtLimit = makeWorkflowDefinition(262144)
  const decodedAgent: SelfImprovement.AgentDefinition = expectDecodeSuccess(SelfImprovement.AgentDefinition, agentAtLimit)
  const decodedSkill: SelfImprovement.SkillDefinition = expectDecodeSuccess(SelfImprovement.SkillDefinition, skillAtLimit)
  const decodedCommand: SelfImprovement.CommandDefinition = expectDecodeSuccess(
    SelfImprovement.CommandDefinition,
    commandAtLimit,
  )
  const decodedWorkflow: SelfImprovement.WorkflowDefinition = expectDecodeSuccess(
    SelfImprovement.WorkflowDefinition,
    workflowAtLimit,
  )
  expect([decodedAgent, decodedSkill, decodedCommand, decodedWorkflow].map(definitionBytes)).toEqual([
    131072,
    163840,
    81920,
    262144,
  ])

  expectDecodeFailure(SelfImprovement.AgentDefinition, makeAgentDefinition(131073))
  expectDecodeFailure(SelfImprovement.SkillDefinition, makeSkillDefinition(163841))
  expectDecodeFailure(SelfImprovement.CommandDefinition, makeCommandDefinition(81921))
  expectDecodeFailure(SelfImprovement.WorkflowDefinition, makeWorkflowDefinition(262145))

  const maximalMode = expectDecodeSuccess(SelfImprovement.ModeDefinition, {
    agent: Schema.decodeUnknownSync(SelfImprovement.CandidateName)("a".repeat(64)),
    description: "\u0001".repeat(512),
  })
  expect(definitionBytes(maximalMode)).toBe(3165)
  const maximalRoutingStatement = {
    action: "provider.use" as const,
    effect: "allow" as const,
    resource: { providerPattern: "A".repeat(128), modelPattern: "A".repeat(256) },
  }
  expect(definitionBytes(expectDecodeSuccess(SelfImprovement.RoutingStatement, maximalRoutingStatement))).toBe(478)
  const maximalRoutingPolicy: SelfImprovement.RoutingPolicyDefinition = expectDecodeSuccess(
    SelfImprovement.RoutingPolicyDefinition,
    { statements: Array(64).fill(maximalRoutingStatement) },
  )
  expect(definitionBytes(maximalRoutingPolicy)).toBe(30672)

  expect([
    SelfImprovement.AgentDefinition,
    SelfImprovement.ModeDefinition,
    SelfImprovement.SkillDefinition,
    SelfImprovement.CommandDefinition,
    SelfImprovement.WorkflowDefinition,
    SelfImprovement.RoutingPolicyDefinition,
  ].map((schema) => schema.ast.annotations?.identifier)).toEqual([
    "SelfImprovement.AgentDefinition",
    "SelfImprovement.ModeDefinition",
    "SelfImprovement.SkillDefinition",
    "SelfImprovement.CommandDefinition",
    "SelfImprovement.WorkflowDefinition",
    "SelfImprovement.RoutingPolicyDefinition",
  ])

  const source = await Bun.file(new URL("../src/self-improvement.ts", import.meta.url)).text()
  for (const name of [
    "AgentDefinition",
    "ModeDefinition",
    "SkillDefinition",
    "CommandDefinition",
    "WorkflowDefinition",
    "RoutingPolicyDefinition",
  ]) {
    expect(source).toContain(`export interface ${name} extends`)
    expect(source).not.toContain(`export type ${name} =`)
  }
})

test("decodes proposals and enforces result unions", () => {
  const proposalSchemas = [
    SelfImprovement.AgentProposal,
    SelfImprovement.SkillProposal,
    SelfImprovement.WorkflowProposal,
    SelfImprovement.ModeProposal,
    SelfImprovement.CommandProposal,
    SelfImprovement.RoutingPolicyProposal,
  ]
  expect([...proposalSchemas, SelfImprovement.CandidateProposal].every(Schema.isSchema)).toBe(true)

  const agentProposal = {
    kind: "agent",
    name: "default",
    definition: {
      description: "agent",
      system: "../../outside",
      mode: "primary",
      steps: 1,
      permissions: [],
    },
    references: ["missing-skill"],
  } as const
  const skillProposal = {
    kind: "skill",
    name: "system",
    definition: { description: "skill", content: "/tmp/inert" },
    references: ["missing-agent"],
  } as const
  const workflowProposal = {
    kind: "workflow",
    name: "root",
    definition: {
      description: "workflow",
      steps: [{ type: "agent", reference: "missing-agent", input: "/tmp/inert" }],
    },
    references: ["missing-agent", "missing-skill"],
  } as const
  const modeProposal = {
    kind: "mode",
    name: "default",
    definition: { agent: "missing-agent", description: "mode" },
    references: ["missing-agent"],
  } as const
  const commandProposal = {
    kind: "command",
    name: "system",
    definition: {
      template: "../../outside /tmp/inert",
      description: "command",
      agent: "missing-agent",
      subtask: true,
    },
    references: ["missing-agent"],
  } as const
  const routingPolicyProposal = {
    kind: "routing-policy",
    name: "root",
    definition: {
      statements: [
        {
          action: "provider.use",
          effect: "allow",
          resource: { providerPattern: "*", modelPattern: "provider/model:*" },
        },
      ],
    },
    references: [],
  } as const
  const proposalInputs = [
    agentProposal,
    skillProposal,
    workflowProposal,
    modeProposal,
    commandProposal,
    routingPolicyProposal,
  ] as const

  for (let index = 0; index < proposalSchemas.length; index++) {
    const schema = proposalSchemas[index]
    const input = proposalInputs[index]
    expectDecodeSuccess(schema, input)
    expectDecodeSuccess(SelfImprovement.CandidateProposal, input)
    expectDecodeSuccess(schema, { ...input, rationale: "" })
    expectDecodeSuccess(schema, { ...input, rationale: "😀" })
    expectDecodeSuccess(schema, { ...input, rationale: "😀".repeat(512) })
    expectDecodeFailure(schema, { ...input, rationale: "a".repeat(513) })
    expectDecodeFailure(schema, { ...input, rationale: "😀".repeat(512) + "a" })
    expectDecodeFailure(schema, { ...input, rationale: undefined })
    expectDecodeFailure(schema, { ...input, rationale: "\ud800" })
    expectDecodeFailure(schema, { ...input, rationale: "\udc00" })
  }

  const referenceLimit = Array.from({ length: 64 }, (_, index) => `ref-${index}`)
  expectDecodeSuccess(SelfImprovement.AgentProposal, { ...agentProposal, references: referenceLimit })
  expectDecodeFailure(SelfImprovement.AgentProposal, { ...agentProposal, references: [...referenceLimit, "overflow"] })
  expectDecodeFailure(SelfImprovement.AgentProposal, { ...agentProposal, references: ["duplicate", "duplicate"] })
  expectDecodeFailure(SelfImprovement.CandidateProposal, { ...agentProposal, unknown: true })
  expectDecodeFailure(SelfImprovement.AgentProposal, { ...agentProposal, kind: "skill" })

  const candidateProposal: SelfImprovement.CandidateProposal = expectDecodeSuccess(
    SelfImprovement.CandidateProposal,
    routingPolicyProposal,
  )
  expect(candidateProposal.kind).toBe("routing-policy")

  const validFailures = [
    { code: "proposal_bytes_exceeded", pointer: null },
    { code: "invalid_utf8", pointer: null },
    { code: "invalid_json", pointer: null },
    { code: "invalid_candidate", pointer: null },
    { code: "unknown_kind", pointer: "/kind" },
    { code: "duplicate_key", pointer: "/a" },
  ] as const
  const proposalFailures = validFailures.map((failure) => expectDecodeSuccess(SelfImprovement.ProposalFailure, failure))
  const proposalFailure: SelfImprovement.ProposalFailure = proposalFailures[0]
  expect(proposalFailure.code).toBe("proposal_bytes_exceeded")
  expect(Object.keys(SelfImprovement.ProposalFailure.cases)).toEqual([
    "proposal_bytes_exceeded",
    "invalid_utf8",
    "invalid_json",
    "invalid_candidate",
    "unknown_kind",
    "duplicate_key",
  ])
  for (const failure of proposalFailures) {
    for (const { code } of validFailures) {
      expect(SelfImprovement.ProposalFailure.guards[code](failure)).toBe(code === failure.code)
    }
  }

  for (const failure of [
    { code: "proposal_bytes_exceeded", pointer: "/kind" },
    { code: "invalid_utf8", pointer: "/kind" },
    { code: "invalid_json", pointer: "/kind" },
    { code: "invalid_candidate", pointer: "/kind" },
    { code: "unknown_kind", pointer: null },
    { code: "unknown_kind", pointer: "/other" },
    { code: "duplicate_key", pointer: null },
  ]) {
    expectDecodeFailure(SelfImprovement.ProposalFailure, failure)
  }

  const rejectedInput = {
    _tag: "rejected",
    rejectedByteDigest: "a".repeat(64),
    failure: validFailures[0],
  } as const
  const acceptedInput = {
    _tag: "accepted",
    proposal: routingPolicyProposal,
    canonicalJson: "{}",
    inputSnapshotDigest: "b".repeat(64),
  } as const
  const proposalRejected: SelfImprovement.ProposalRejected = expectDecodeSuccess(
    SelfImprovement.ProposalRejected,
    rejectedInput,
  )
  const proposalAccepted: SelfImprovement.ProposalAccepted = expectDecodeSuccess(
    SelfImprovement.ProposalAccepted,
    acceptedInput,
  )
  const rejectedResult: SelfImprovement.ProposalParseResult = expectDecodeSuccess(
    SelfImprovement.ProposalParseResult,
    rejectedInput,
  )
  const acceptedResult: SelfImprovement.ProposalParseResult = expectDecodeSuccess(
    SelfImprovement.ProposalParseResult,
    acceptedInput,
  )
  expect([proposalRejected._tag, proposalAccepted._tag, rejectedResult._tag, acceptedResult._tag]).toEqual([
    "rejected",
    "accepted",
    "rejected",
    "accepted",
  ])
  expectDecodeFailure(SelfImprovement.ProposalRejected, { ...rejectedInput, unknown: true })
  expectDecodeFailure(SelfImprovement.ProposalAccepted, { ...acceptedInput, unknown: true })
  expectDecodeFailure(SelfImprovement.ProposalParseResult, { ...acceptedInput, _tag: "rejected" })

  const identifiers = [
    SelfImprovement.ArtifactKind,
    SelfImprovement.ProposalParseFailureCode,
    SelfImprovement.Digest,
    SelfImprovement.CandidateName,
    SelfImprovement.CanonicalJson,
    SelfImprovement.JsonPointer,
    SelfImprovement.DenyRule,
    SelfImprovement.ModelRef,
    SelfImprovement.WorkflowStep,
    SelfImprovement.RoutingResource,
    SelfImprovement.RoutingStatement,
    SelfImprovement.AgentDefinition,
    SelfImprovement.ModeDefinition,
    SelfImprovement.SkillDefinition,
    SelfImprovement.CommandDefinition,
    SelfImprovement.WorkflowDefinition,
    SelfImprovement.RoutingPolicyDefinition,
    ...proposalSchemas,
    SelfImprovement.CandidateProposal,
    SelfImprovement.ProposalFailure,
    SelfImprovement.ProposalRejected,
    SelfImprovement.ProposalAccepted,
    SelfImprovement.ProposalParseResult,
  ].map((schema) => schema.ast.annotations?.identifier)
  expect(identifiers).toEqual([
    "SelfImprovement.ArtifactKind",
    "SelfImprovement.ProposalParseFailureCode",
    "SelfImprovement.Digest",
    "SelfImprovement.CandidateName",
    "SelfImprovement.CanonicalJson",
    "SelfImprovement.JsonPointer",
    "SelfImprovement.DenyRule",
    "SelfImprovement.ModelRef",
    "SelfImprovement.WorkflowStep",
    "SelfImprovement.RoutingResource",
    "SelfImprovement.RoutingStatement",
    "SelfImprovement.AgentDefinition",
    "SelfImprovement.ModeDefinition",
    "SelfImprovement.SkillDefinition",
    "SelfImprovement.CommandDefinition",
    "SelfImprovement.WorkflowDefinition",
    "SelfImprovement.RoutingPolicyDefinition",
    "SelfImprovement.AgentProposal",
    "SelfImprovement.SkillProposal",
    "SelfImprovement.WorkflowProposal",
    "SelfImprovement.ModeProposal",
    "SelfImprovement.CommandProposal",
    "SelfImprovement.RoutingPolicyProposal",
    "SelfImprovement.CandidateProposal",
    "SelfImprovement.ProposalFailure",
    "SelfImprovement.ProposalRejected",
    "SelfImprovement.ProposalAccepted",
    "SelfImprovement.ProposalParseResult",
  ])
  expect(identifiers.every((identifier) => typeof identifier === "string")).toBe(true)
  expect(new Set(identifiers).size).toBe(28)
})
