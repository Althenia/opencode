export * as SessionGenerateNode from "./generate-node"

import { LLM, LLMClient, Message, SystemPart } from "@opencode-ai/ai"
import { CACHE_POLICY_REVISION } from "@opencode-ai/ai/cache-policy"
import { Effect, Layer } from "effect"
import { Database } from "../database/database"
import { makeLocationNode } from "../effect/app-node"
import { llmClient } from "../effect/app-node-platform"
import { PluginHooks } from "../plugin/hooks"
import { PermissionV2 } from "../permission"
import { SessionContext } from "./context"
import { SessionGenerate } from "./generate"
import { SessionHistory } from "./history"
import { SessionModelHeaders } from "./model-headers"
import { SessionRunnerCache } from "./runner/cache"
import { SessionRunnerModel } from "./runner/model"
import PROMPT_DEFAULT from "./runner/prompt/base.txt"
import { toLLMMessages } from "./runner/to-llm-message"

export const layer = (options?: SessionModelHeaders.Options) =>
  Layer.effect(
    SessionGenerate.Service,
    Effect.gen(function* () {
      const context = yield* SessionContext.Service
      const database = yield* Database.Service
      const hooks = yield* PluginHooks.Service
      const llm = yield* LLMClient.Service
      const models = yield* SessionRunnerModel.Service

      return SessionGenerate.Service.of({
        generate: Effect.fn("SessionGenerate.generate")(function* (input) {
          const selection = yield* context.select(input.sessionID)
          const model = yield* models.resolve(selection.session)
          const history = yield* SessionHistory.preview(database.db, selection.session.id, selection.instructions)
          const providerMetadataKey = model.model.route.providerMetadataKey ?? model.model.provider
          const permissions = PermissionV2.merge(
            selection.agent.info.permissions,
            selection.session.permissionCeiling ?? [],
          )
          const contextEvent = yield* hooks.trigger("session", "context", {
            sessionID: selection.session.id,
            agent: selection.agent.id,
            model: model.ref,
            system: [selection.agent.info.system ? selection.agent.info.system : PROMPT_DEFAULT, history.initial]
              .filter((part) => part.length > 0)
              .map(SystemPart.make),
            messages: [
              ...toLLMMessages(history.messages, model.ref, providerMetadataKey),
              ...(history.instructionUpdate ? [Message.system(history.instructionUpdate)] : []),
              Message.user(input.prompt),
            ],
            tools: {},
          })
          const promptCacheKey = SessionRunnerCache.promptCacheNamespace({
            projectID: selection.session.projectID,
            directory: selection.session.location.directory,
            workspaceID: selection.session.location.workspaceID,
            providerID: model.ref.providerID,
            modelID: model.ref.id,
            variant: model.ref.variant ?? "default",
            policyRevision: CACHE_POLICY_REVISION,
            permissions,
            system: contextEvent.system,
            tools: [],
          })
          return (yield* llm.generate(
            LLM.request({
              model: model.model,
              http: { headers: SessionModelHeaders.make(selection.session, options) },
              providerOptions: {
                openai: { promptCacheKey },
                openrouter: { promptCacheKey, sessionID: promptCacheKey },
              },
              system: contextEvent.system,
              messages: contextEvent.messages,
              tools: [],
              toolChoice: "none",
            }),
          )).text
        }),
      })
    }),
  )

export function configured(options?: SessionModelHeaders.Options) {
  return makeLocationNode({
    service: SessionGenerate.Service,
    layer: layer(options),
    deps: [SessionContext.node, Database.node, PluginHooks.node, SessionRunnerModel.node, llmClient],
  })
}

export const node = configured()
