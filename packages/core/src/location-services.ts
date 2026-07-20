import { Effect, Layer, LayerMap } from "effect"
import { AgentV2 } from "./agent"
import { AISDK } from "./aisdk"
import { Catalog } from "./catalog"
import { CommandV2 } from "./command"
import { Config } from "./config"
import { LayerNode } from "./effect/layer-node"
import { Node } from "./effect/app-node"
import { FileMutation } from "./file-mutation"
import { FileSystem } from "./filesystem"
import { FileSystemSearch } from "./filesystem/search"
import { Watcher } from "./filesystem/watcher"
import { Image } from "./image"
import { Integration } from "./integration"
import { Location } from "./location"
import { LocationMutation } from "./location-mutation"
import { LocationServiceMap } from "./location-service-map"
import { PermissionV2 } from "./permission"
import { PluginV2 } from "./plugin"
import { PluginInternal } from "./plugin/internal"
import { Policy } from "./policy"
import { ProjectCopy } from "./project/copy"
import { Pty } from "./pty"
import { QuestionV2 } from "./question"
import { Reference } from "./reference"
import { ReferenceGuidance } from "./reference/guidance"
import * as SessionRunnerLLM from "./session/runner/llm"
import { SessionRunnerModel } from "./session/runner/model"
import { SessionTodo } from "./session/todo"
import { SkillV2 } from "./skill"
import { SkillGuidance } from "./skill/guidance"
import { Snapshot } from "./snapshot"
import { SystemContextBuiltIns } from "./system-context/builtins"
import { SystemContextRegistry } from "./system-context/registry"
import { SelfImprovementApprovalStore } from "./self-improvement/approval-store"
import { SelfImprovementAdmission } from "./self-improvement/admission"
import { SelfImprovementArtifactStore } from "./self-improvement/artifact-store"
import { SelfImprovementAutomation } from "./self-improvement/automation"
import { SelfImprovementAuditStore } from "./self-improvement/audit-store"
import { SelfImprovementContextReconciler } from "./self-improvement/context-reconciler"
import { SelfImprovementContextStore } from "./self-improvement/context-store"
import { SelfImprovementEvaluationStore } from "./self-improvement/evaluation-store"
import { SelfImprovementGeneration } from "./self-improvement/generation"
import { SelfImprovementGenerationStore } from "./self-improvement/generation-store"
import { SelfImprovementIdempotencyStore } from "./self-improvement/idempotency-store"
import { SelfImprovementLearningStore } from "./self-improvement/learning-store"
import { Routing } from "./self-improvement/routing"
import { SelfImprovementRetention } from "./self-improvement/retention"
import { SelfImprovementLifecycleCoordinator } from "./self-improvement/lifecycle-coordinator"
import { SelfImprovementLifecycleWorkflow } from "./self-improvement/lifecycle-workflow"
import { SelfImprovementMutationStore } from "./self-improvement/mutation-store"
import { SelfImprovementPrivateArtifactCommand } from "./self-improvement/private-artifact-command"
import { SelfImprovementPrivateEvidenceCommand } from "./self-improvement/private-evidence-command"
import { SelfImprovementPrivateQuery } from "./self-improvement/private-query"
import { SelfImprovementTransitionStore } from "./self-improvement/transition-store"
import { BuiltInTools } from "./tool/builtins"
import { ReadToolFileSystem } from "./tool/read-filesystem"
import { ToolRegistry } from "./tool/registry"
import { ToolOutputStore } from "./tool-output-store"

export { LocationServiceMap } from "./location-service-map"

export const locationServices = LayerNode.group([
  Location.node,
  Policy.node,
  Config.node,
  AgentV2.node,
  CommandV2.node,
  Reference.node,
  Integration.node,
  Catalog.node,
  AISDK.node,
  PluginV2.node,
  PluginInternal.node,
  ProjectCopy.node,
  ProjectCopy.refreshNode,
  FileSystemSearch.node,
  FileSystem.node,
  Watcher.node,
  Pty.node,
  SkillV2.node,
  SystemContextRegistry.node,
  SelfImprovementArtifactStore.node,
  SelfImprovementApprovalStore.node,
  SelfImprovementAuditStore.node,
  SelfImprovementEvaluationStore.node,
  SelfImprovementRetention.node,
  SelfImprovementContextStore.node,
  SelfImprovementIdempotencyStore.node,
  SelfImprovementLearningStore.node,
  SelfImprovementMutationStore.node,
  SelfImprovementTransitionStore.node,
  SelfImprovementPrivateQuery.node,
  SelfImprovementPrivateArtifactCommand.node,
  SelfImprovementPrivateEvidenceCommand.node,
  SelfImprovementAdmission.node,
  SelfImprovementContextReconciler.materializerNode,
  SelfImprovementContextReconciler.node,
  SelfImprovementLifecycleCoordinator.node,
  SelfImprovementLifecycleWorkflow.node,
  SystemContextBuiltIns.node,
  LocationMutation.node,
  FileMutation.node,
  PermissionV2.node,
  ToolOutputStore.node,
  ToolRegistry.node,
  ToolRegistry.toolsNode,
  Image.node,
  SkillGuidance.node,
  ReferenceGuidance.node,
  SessionTodo.node,
  QuestionV2.node,
  ReadToolFileSystem.node,
  BuiltInTools.node,
  Routing.node,
  SessionRunnerModel.node,
  Snapshot.node,
  SessionRunnerLLM.node,
  SelfImprovementGenerationStore.node,
  SelfImprovementGeneration.node,
  SelfImprovementAutomation.node,
])

export type LocationServices = LayerNode.Output<typeof locationServices>
export type LocationError = LayerNode.Error<typeof locationServices>

export function buildLocationServiceMap(
  replacements: LayerNode.Replacements = [],
): Layer.Layer<LocationServiceMap.Service> {
  return Layer.effect(
    LocationServiceMap.Service,
    LayerMap.make(
      (ref: Location.Ref) => {
        const allReplacements = replacements.concat([[Location.node, Location.boundNode(ref)]])
        // Apply replacements during hoist, not afterward: replacements can
        // introduce new tagged dependencies (Location.boundNode depends on
        // Project), and the hoist walk is the only pass that can still slice
        // those back out.
        const location = LayerNode.hoist(locationServices, Node.tags.values.global, allReplacements)

        return LayerNode.compile(location.node).pipe(
          Layer.fresh,
          Layer.tap(() =>
            Effect.logInfo("booting location services", {
              directory: ref.directory,
              workspaceID: ref.workspaceID,
            }),
          ),
          Layer.provide(LayerNode.compile(location.hoisted)),
        )
      },
      { idleTimeToLive: "60 minutes" },
    ),
  )
}

// This is temporary for backwards compatibility
export const locationServiceMapLayer = buildLocationServiceMap()
