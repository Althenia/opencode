export * as SessionRunnerCache from "./cache"

import { Hash } from "../../util/hash"

export interface PromptCacheNamespaceInput {
  readonly projectID: string
  readonly directory: string
  readonly workspaceID?: string
  readonly agentID: string
  readonly providerID: string
  readonly modelID: string
}

export const promptCacheNamespace = (input: PromptCacheNamespaceInput): string =>
  Hash.sha256(
    [
      "session-prompt-cache/v1",
      input.projectID,
      input.directory,
      input.workspaceID ?? "",
      input.agentID,
      input.providerID,
      input.modelID,
    ].join("\0"),
  )
