export * as SelfImprovement from "./self-improvement.js"

import { Schema } from "effect"
import { optional } from "./schema.js"

export const ArtifactKind = Schema.Literals(["agent", "skill", "workflow", "mode", "command", "routing-policy"]).annotate({
  identifier: "SelfImprovement.ArtifactKind",
})
export type ArtifactKind = typeof ArtifactKind.Type

export const ProposalParseFailureCode = Schema.Literals([
  "proposal_bytes_exceeded",
  "invalid_utf8",
  "invalid_json",
  "duplicate_key",
  "unknown_kind",
  "invalid_candidate",
]).annotate({ identifier: "SelfImprovement.ProposalParseFailureCode" })
export type ProposalParseFailureCode = typeof ProposalParseFailureCode.Type

export const Digest = Schema.String.pipe(Schema.brand("SelfImprovement.Digest"))
  .annotate({ identifier: "SelfImprovement.Digest" })
  .check(Schema.isPattern(/^[0-9a-f]{64}$/))
export type Digest = typeof Digest.Type

export const CandidateName = Schema.String.pipe(Schema.brand("SelfImprovement.CandidateName"))
  .annotate({ identifier: "SelfImprovement.CandidateName" })
  .check(Schema.isPattern(/^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/))
export type CandidateName = typeof CandidateName.Type

export const CanonicalJson = Schema.String.pipe(Schema.brand("SelfImprovement.CanonicalJson")).annotate({
  identifier: "SelfImprovement.CanonicalJson",
})
export type CanonicalJson = typeof CanonicalJson.Type

export const JsonPointer = Schema.String.pipe(Schema.brand("SelfImprovement.JsonPointer"))
  .annotate({ identifier: "SelfImprovement.JsonPointer" })
  .check(Schema.isPattern(/^(?:\/(?:[^~/]|~0|~1)*)+$/))
export type JsonPointer = typeof JsonPointer.Type

const textEncoder = new TextEncoder()

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

function boundedText(minimumScalars: number, maximumScalars: number, maximumBytes: number) {
  return Schema.String.check(
    Schema.makeFilter((value) => {
      if (hasUnpairedSurrogate(value)) return false
      const scalars = Array.from(value).length
      return scalars >= minimumScalars && scalars <= maximumScalars && textEncoder.encode(value).byteLength <= maximumBytes
    }),
  )
}

function asciiText(minimum: number, maximum: number) {
  return Schema.String.check(Schema.isPattern(/^[\x20-\x7e]+$/), Schema.isLengthBetween(minimum, maximum))
}

function definitionByteLimit(maximumBytes: number) {
  return Schema.makeFilter((definition: object) => textEncoder.encode(JSON.stringify(definition)).byteLength <= maximumBytes)
}

export class DenyRule extends Schema.Class<DenyRule>("SelfImprovement.DenyRule")({
  action: boundedText(1, 128, 512),
  resource: boundedText(1, 512, 2048),
  effect: Schema.Literal("deny"),
}) {}

export class ModelRef extends Schema.Class<ModelRef>("SelfImprovement.ModelRef")({
  providerID: asciiText(1, 128),
  modelID: boundedText(1, 256, 1024),
}) {}

export class WorkflowStep extends Schema.Class<WorkflowStep>("SelfImprovement.WorkflowStep")({
  type: Schema.Literals(["agent", "skill", "command"]),
  reference: CandidateName,
  input: boundedText(1, 2000, 8000),
}) {}

export class RoutingResource extends Schema.Class<RoutingResource>("SelfImprovement.RoutingResource")({
  providerPattern: Schema.String.check(Schema.isPattern(/^[A-Za-z0-9._:*?-]{1,128}$/)),
  modelPattern: boundedText(1, 256, 1024)
    .check(Schema.isPattern(/^[A-Za-z0-9/@._:*?-]+$/))
    .pipe(optional),
}) {}

export class RoutingStatement extends Schema.Class<RoutingStatement>("SelfImprovement.RoutingStatement")({
  action: Schema.Literal("provider.use"),
  effect: Schema.Literals(["allow", "deny"]),
  resource: RoutingResource,
}) {}

const AgentDefinitionFields = Schema.Struct({
  description: boundedText(0, 512, 2048),
  system: boundedText(1, 16384, 65536),
  mode: Schema.Literals(["primary", "subagent"]),
  model: ModelRef.pipe(optional),
  hidden: Schema.Boolean.pipe(optional),
  color: Schema.String.check(Schema.isPattern(/^#[0-9A-Fa-f]{6}$/)).pipe(optional),
  steps: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 })),
  permissions: Schema.Array(DenyRule).check(Schema.isMaxLength(64)),
})

const ModeDefinitionFields = Schema.Struct({
  agent: CandidateName,
  description: boundedText(0, 512, 2048),
})

const SkillDefinitionFields = Schema.Struct({
  description: boundedText(0, 512, 2048),
  content: boundedText(1, 32768, 131072),
})

const CommandDefinitionFields = Schema.Struct({
  template: boundedText(1, 16384, 65536),
  description: boundedText(0, 512, 2048).pipe(optional),
  agent: CandidateName.pipe(optional),
  model: ModelRef.pipe(optional),
  subtask: Schema.Boolean,
})

const WorkflowDefinitionFields = Schema.Struct({
  description: boundedText(0, 512, 2048).pipe(optional),
  steps: Schema.Array(WorkflowStep).check(Schema.isLengthBetween(1, 32)),
})

const RoutingPolicyDefinitionFields = Schema.Struct({
  statements: Schema.Array(RoutingStatement).check(Schema.isLengthBetween(1, 64)),
})

export interface AgentDefinition extends Schema.Schema.Type<typeof AgentDefinition> {}
export const AgentDefinition = AgentDefinitionFields.annotate({ identifier: "SelfImprovement.AgentDefinition" }).check(
  definitionByteLimit(131072),
)

export interface ModeDefinition extends Schema.Schema.Type<typeof ModeDefinition> {}
export const ModeDefinition = ModeDefinitionFields.annotate({ identifier: "SelfImprovement.ModeDefinition" })

export interface SkillDefinition extends Schema.Schema.Type<typeof SkillDefinition> {}
export const SkillDefinition = SkillDefinitionFields.annotate({ identifier: "SelfImprovement.SkillDefinition" }).check(
  definitionByteLimit(163840),
)

export interface CommandDefinition extends Schema.Schema.Type<typeof CommandDefinition> {}
export const CommandDefinition = CommandDefinitionFields.annotate({ identifier: "SelfImprovement.CommandDefinition" }).check(
  definitionByteLimit(81920),
)

export interface WorkflowDefinition extends Schema.Schema.Type<typeof WorkflowDefinition> {}
export const WorkflowDefinition = WorkflowDefinitionFields.annotate({ identifier: "SelfImprovement.WorkflowDefinition" }).check(
  definitionByteLimit(262144),
)

export interface RoutingPolicyDefinition extends Schema.Schema.Type<typeof RoutingPolicyDefinition> {}
export const RoutingPolicyDefinition = RoutingPolicyDefinitionFields.annotate({
  identifier: "SelfImprovement.RoutingPolicyDefinition",
})

const References = Schema.Array(CandidateName).check(Schema.isMaxLength(64), Schema.isUnique())

export class AgentProposal extends Schema.Class<AgentProposal>("SelfImprovement.AgentProposal")({
  kind: Schema.Literal("agent"),
  name: CandidateName,
  definition: AgentDefinition,
  rationale: boundedText(0, 512, 2048).pipe(optional),
  references: References,
}) {}

export class SkillProposal extends Schema.Class<SkillProposal>("SelfImprovement.SkillProposal")({
  kind: Schema.Literal("skill"),
  name: CandidateName,
  definition: SkillDefinition,
  rationale: boundedText(0, 512, 2048).pipe(optional),
  references: References,
}) {}

export class WorkflowProposal extends Schema.Class<WorkflowProposal>("SelfImprovement.WorkflowProposal")({
  kind: Schema.Literal("workflow"),
  name: CandidateName,
  definition: WorkflowDefinition,
  rationale: boundedText(0, 512, 2048).pipe(optional),
  references: References,
}) {}

export class ModeProposal extends Schema.Class<ModeProposal>("SelfImprovement.ModeProposal")({
  kind: Schema.Literal("mode"),
  name: CandidateName,
  definition: ModeDefinition,
  rationale: boundedText(0, 512, 2048).pipe(optional),
  references: References,
}) {}

export class CommandProposal extends Schema.Class<CommandProposal>("SelfImprovement.CommandProposal")({
  kind: Schema.Literal("command"),
  name: CandidateName,
  definition: CommandDefinition,
  rationale: boundedText(0, 512, 2048).pipe(optional),
  references: References,
}) {}

export class RoutingPolicyProposal extends Schema.Class<RoutingPolicyProposal>("SelfImprovement.RoutingPolicyProposal")({
  kind: Schema.Literal("routing-policy"),
  name: CandidateName,
  definition: RoutingPolicyDefinition,
  rationale: boundedText(0, 512, 2048).pipe(optional),
  references: References,
}) {}

export const CandidateProposal = Schema.Union([
  AgentProposal,
  SkillProposal,
  WorkflowProposal,
  ModeProposal,
  CommandProposal,
  RoutingPolicyProposal,
])
  .annotate({ identifier: "SelfImprovement.CandidateProposal" })
  .pipe(Schema.toTaggedUnion("kind"))
export type CandidateProposal = typeof CandidateProposal.Type

const ProposalBytesExceededFailure = Schema.Struct({
  code: Schema.Literal("proposal_bytes_exceeded"),
  pointer: Schema.Null,
})
const InvalidUtf8Failure = Schema.Struct({ code: Schema.Literal("invalid_utf8"), pointer: Schema.Null })
const InvalidJsonFailure = Schema.Struct({ code: Schema.Literal("invalid_json"), pointer: Schema.Null })
const InvalidCandidateFailure = Schema.Struct({ code: Schema.Literal("invalid_candidate"), pointer: Schema.Null })
const UnknownKindFailure = Schema.Struct({ code: Schema.Literal("unknown_kind"), pointer: Schema.Literal("/kind") })
const DuplicateKeyFailure = Schema.Struct({ code: Schema.Literal("duplicate_key"), pointer: JsonPointer })

export const ProposalFailure = Schema.Union([
  ProposalBytesExceededFailure,
  InvalidUtf8Failure,
  InvalidJsonFailure,
  InvalidCandidateFailure,
  UnknownKindFailure,
  DuplicateKeyFailure,
])
  .annotate({ identifier: "SelfImprovement.ProposalFailure" })
  .pipe(Schema.toTaggedUnion("code"))
export type ProposalFailure = typeof ProposalFailure.Type

export class ProposalRejected extends Schema.TaggedClass<ProposalRejected>("SelfImprovement.ProposalRejected")(
  "rejected",
  {
    rejectedByteDigest: Digest,
    failure: ProposalFailure,
  },
) {}

export class ProposalAccepted extends Schema.TaggedClass<ProposalAccepted>("SelfImprovement.ProposalAccepted")(
  "accepted",
  {
    proposal: CandidateProposal,
    canonicalJson: CanonicalJson,
    inputSnapshotDigest: Digest,
  },
) {}

export const ProposalParseResult = Schema.Union([ProposalRejected, ProposalAccepted])
  .annotate({ identifier: "SelfImprovement.ProposalParseResult" })
  .pipe(Schema.toTaggedUnion("_tag"))
export type ProposalParseResult = typeof ProposalParseResult.Type
