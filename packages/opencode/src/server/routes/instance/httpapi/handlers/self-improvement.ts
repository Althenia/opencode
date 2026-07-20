import { Config } from "@/config/config"
import { ConfigSelfImprovement } from "@/config/self-improvement"
import { Effect, Redacted } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { PrivateSelfImprovementApi } from "../groups/self-improvement"
import { createCursorCodec } from "../middleware/self-improvement-authorization"
import { makeSelfImprovementArtifactHandlers } from "./self-improvement-artifacts"
import { makeSelfImprovementEvidenceHandlers } from "./self-improvement-evidence"

export const selfImprovementHandlers = HttpApiBuilder.group(
  PrivateSelfImprovementApi,
  "private-self-improvement",
  (handlers) =>
    Effect.gen(function* () {
      const config = yield* Config.Service
      const settings = ConfigSelfImprovement.settings(yield* config.getGlobal())
      const input = {
        tokens: settings?.tokens ?? ConfigSelfImprovement.tokens(undefined),
        cursor: createCursorCodec(settings?.cursorSecret ?? Redacted.make("")),
      }
      const artifacts = makeSelfImprovementArtifactHandlers(input)
      const evidence = makeSelfImprovementEvidenceHandlers(input)

      return handlers
        .handle("listArtifacts", artifacts.listArtifacts)
        .handle("getArtifact", artifacts.getArtifact)
        .handle("listVersions", artifacts.listVersions)
        .handle("getVersion", artifacts.getVersion)
        .handle("createArtifact", artifacts.createArtifact)
        .handle("createVersion", artifacts.createVersion)
        .handle("archiveVersion", artifacts.archiveVersion)
        .handle("tombstoneArtifact", artifacts.tombstoneArtifact)
        .handle("approve", artifacts.approve)
        .handle("reject", artifacts.reject)
        .handleRaw("createObservation", evidence.createObservationRaw)
        .handle("createMetricRun", evidence.createMetricRun)
        .handle("addMetricSample", evidence.addMetricSample)
        .handle("decideMetricRun", evidence.decideMetricRun)
        .handle("listBaselines", evidence.listBaselines)
        .handle("listMetricRuns", evidence.listMetricRuns)
        .handle("listEvaluations", evidence.listEvaluations)
        .handle("listTransitions", evidence.listTransitions)
        .handle("listApprovals", evidence.listApprovals)
        .handle("listContextEvidence", evidence.listContextEvidence)
        .handle("listRoutingDecisions", evidence.listRoutingDecisions)
        .handle("listAudit", evidence.listAudit)
    }),
)
