import { SelfImprovementApi, SelfImprovementLifecycle } from "@opencode-ai/schema"
import { LocationMiddleware } from "@opencode-ai/server/location"
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, HttpApiSchema } from "effect/unstable/httpapi"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware } from "../middleware/workspace-routing"

const root = "/private/self-improvement"
const artifactParams = Schema.Struct({ artifactID: SelfImprovementLifecycle.ArtifactID })
const versionParams = Schema.Struct({
  artifactID: SelfImprovementLifecycle.ArtifactID,
  versionID: SelfImprovementLifecycle.ArtifactVersionID,
})
const approvalParams = Schema.Struct({ approvalRequestID: SelfImprovementLifecycle.ApprovalRequestID })
const runParams = Schema.Struct({ runID: SelfImprovementLifecycle.EvaluationRunID })
const apiErrors = [
  HttpApiSchema.status(400)(SelfImprovementApi.ApiError),
  HttpApiSchema.status(403)(SelfImprovementApi.ApiError),
  HttpApiSchema.status(404)(SelfImprovementApi.ApiError),
  HttpApiSchema.status(409)(SelfImprovementApi.ApiError),
  HttpApiSchema.status(503)(SelfImprovementApi.ApiError),
  HttpApiError.BadRequest,
  HttpApiError.Forbidden,
  HttpApiError.NotFound,
  HttpApiError.Conflict,
] as const

// This API is deliberately standalone: server.ts mounts it after Core query wiring exists.
export const PrivateSelfImprovementApi = HttpApi.make("private-self-improvement").add(
  HttpApiGroup.make("private-self-improvement")
    .middleware(LocationMiddleware)
    .middleware(InstanceContextMiddleware)
    .middleware(WorkspaceRoutingMiddleware)
    .middleware(Authorization)
    .add(
      HttpApiEndpoint.get("listArtifacts", `${root}/artifacts`, {
        headers: SelfImprovementApi.LocationHeaders,
        query: SelfImprovementApi.ListArtifactsRequest,
        success: SelfImprovementApi.ListArtifactsResponse,
        error: apiErrors,
      }),
      HttpApiEndpoint.post("createArtifact", `${root}/artifacts`, {
        headers: SelfImprovementApi.MutationHeaders,
        payload: SelfImprovementApi.CreateArtifactRequest,
        success: SelfImprovementApi.CreateArtifactResponse,
        error: apiErrors,
      }),
      HttpApiEndpoint.get("getArtifact", `${root}/artifacts/:artifactID`, {
        headers: SelfImprovementApi.LocationHeaders,
        params: artifactParams,
        success: SelfImprovementApi.GetArtifactResponse,
        error: apiErrors,
      }),
      HttpApiEndpoint.get("listVersions", `${root}/artifacts/:artifactID/versions`, {
        headers: SelfImprovementApi.LocationHeaders,
        params: artifactParams,
        query: SelfImprovementApi.ListVersionsRequest,
        success: SelfImprovementApi.ListVersionsResponse,
        error: apiErrors,
      }),
      HttpApiEndpoint.post("createVersion", `${root}/artifacts/:artifactID/versions`, {
        headers: SelfImprovementApi.ArtifactMutationHeaders,
        params: artifactParams,
        payload: SelfImprovementApi.CreateVersionRequest,
        success: SelfImprovementApi.CreateVersionResponse,
        error: apiErrors,
      }),
      HttpApiEndpoint.get("getVersion", `${root}/artifacts/:artifactID/versions/:versionID`, {
        headers: SelfImprovementApi.LocationHeaders,
        params: versionParams,
        success: SelfImprovementApi.GetVersionResponse,
        error: apiErrors,
      }),
      HttpApiEndpoint.post("archiveVersion", `${root}/artifacts/:artifactID/versions/:versionID/archive`, {
        headers: SelfImprovementApi.ArtifactMutationHeaders,
        params: versionParams,
        payload: SelfImprovementApi.ArchiveVersionRequest,
        success: SelfImprovementApi.ArchiveVersionResponse,
        error: apiErrors,
      }),
      HttpApiEndpoint.post("tombstoneArtifact", `${root}/artifacts/:artifactID/tombstone`, {
        headers: SelfImprovementApi.ArtifactMutationHeaders,
        params: artifactParams,
        payload: SelfImprovementApi.TombstoneArtifactRequest,
        success: SelfImprovementApi.TombstoneArtifactResponse,
        error: apiErrors,
      }),
      HttpApiEndpoint.post("approve", `${root}/approvals/:approvalRequestID/approve`, {
        headers: SelfImprovementApi.MutationHeaders,
        params: approvalParams,
        payload: SelfImprovementApi.ApproveRequest,
        success: SelfImprovementApi.ApproveResponse,
        error: apiErrors,
      }),
      HttpApiEndpoint.post("reject", `${root}/approvals/:approvalRequestID/reject`, {
        headers: SelfImprovementApi.MutationHeaders,
        params: approvalParams,
        payload: SelfImprovementApi.RejectRequest,
        success: SelfImprovementApi.RejectResponse,
        error: apiErrors,
      }),
      HttpApiEndpoint.post("createObservation", `${root}/observations`, {
        headers: SelfImprovementApi.MutationHeaders,
        payload: SelfImprovementApi.CreateObservationRequest,
        success: SelfImprovementApi.CreateObservationResponse,
        error: apiErrors,
      }),
      HttpApiEndpoint.post("createMetricRun", `${root}/metric-runs`, {
        headers: SelfImprovementApi.MutationHeaders,
        payload: SelfImprovementApi.CreateMetricRunRequest,
        success: SelfImprovementApi.CreateMetricRunResponse,
        error: apiErrors,
      }),
      HttpApiEndpoint.post("addMetricSample", `${root}/metric-runs/:runID/samples`, {
        headers: SelfImprovementApi.MutationHeaders,
        params: runParams,
        payload: SelfImprovementApi.AddMetricSampleRequest,
        success: SelfImprovementApi.AddMetricSampleResponse,
        error: apiErrors,
      }),
      HttpApiEndpoint.post("decideMetricRun", `${root}/metric-runs/:runID/decisions`, {
        headers: SelfImprovementApi.MutationHeaders,
        params: runParams,
        payload: SelfImprovementApi.DecideMetricRunRequest,
        success: SelfImprovementApi.DecideMetricRunResponse,
        error: apiErrors,
      }),
      HttpApiEndpoint.get("listBaselines", `${root}/baselines`, {
        headers: SelfImprovementApi.LocationHeaders,
        query: SelfImprovementApi.ListBaselinesRequest,
        success: SelfImprovementApi.ListBaselinesResponse,
        error: apiErrors,
      }),
      HttpApiEndpoint.get("listMetricRuns", `${root}/metric-runs`, {
        headers: SelfImprovementApi.LocationHeaders,
        query: SelfImprovementApi.ListMetricRunsRequest,
        success: SelfImprovementApi.ListMetricRunsResponse,
        error: apiErrors,
      }),
      HttpApiEndpoint.get("listEvaluations", `${root}/evaluations`, {
        headers: SelfImprovementApi.LocationHeaders,
        query: SelfImprovementApi.ListEvaluationsRequest,
        success: SelfImprovementApi.ListEvaluationsResponse,
        error: apiErrors,
      }),
      HttpApiEndpoint.get("listTransitions", `${root}/transitions`, {
        headers: SelfImprovementApi.LocationHeaders,
        query: SelfImprovementApi.ListTransitionsRequest,
        success: SelfImprovementApi.ListTransitionsResponse,
        error: apiErrors,
      }),
      HttpApiEndpoint.get("listApprovals", `${root}/approvals`, {
        headers: SelfImprovementApi.LocationHeaders,
        query: SelfImprovementApi.ListApprovalsRequest,
        success: SelfImprovementApi.ListApprovalsResponse,
        error: apiErrors,
      }),
      HttpApiEndpoint.get("listContextEvidence", `${root}/context-evidence`, {
        headers: SelfImprovementApi.LocationHeaders,
        query: SelfImprovementApi.ListContextEvidenceRequest,
        success: SelfImprovementApi.ListContextEvidenceResponse,
        error: apiErrors,
      }),
      HttpApiEndpoint.get("listRoutingDecisions", `${root}/routing-decisions`, {
        headers: SelfImprovementApi.LocationHeaders,
        query: SelfImprovementApi.ListRoutingDecisionsRequest,
        success: SelfImprovementApi.ListRoutingDecisionsResponse,
        error: apiErrors,
      }),
      HttpApiEndpoint.get("listAudit", `${root}/audit`, {
        headers: SelfImprovementApi.LocationHeaders,
        query: SelfImprovementApi.ListAuditRequest,
        success: SelfImprovementApi.ListAuditResponse,
        error: apiErrors,
      }),
    ),
)
