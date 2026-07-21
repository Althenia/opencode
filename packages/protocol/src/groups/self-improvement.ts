import { SelfImprovementStatus } from "@opencode-ai/schema/self-improvement-status"
import { Location } from "@opencode-ai/schema/location"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { LocationQuery, locationQueryOpenApi } from "./location.js"

export const SelfImprovementGroup = HttpApiGroup.make("server.selfImprovement")
  .add(
    HttpApiEndpoint.get("selfImprovement.status", "/api/self-improvement/status", {
      query: LocationQuery,
      success: Location.response(SelfImprovementStatus.Info),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.selfImprovement.status",
          summary: "Get self-improvement status",
          description:
            "Retrieve privacy-safe automatic self-improvement settings, aggregate evidence state, automation activity, and generated rollout slots for a location.",
        }),
      ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "self-improvement",
      description: "Privacy-safe automatic self-improvement diagnostics.",
    }),
  )
