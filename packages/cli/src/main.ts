import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { Effect } from "effect"
import { Observability } from "@opencode-ai/core/observability"
import { InstallationChannel, InstallationVersion, InstallationLocal } from "@opencode-ai/core/installation/version"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Global } from "@opencode-ai/core/global"
import { AppProcess } from "@opencode-ai/core/process"
import { Npm } from "@opencode-ai/core/npm"
import { Runtime } from "./framework/runtime"
import { Updater } from "./services/updater"
import { Config } from "./config"

type Program = ReturnType<typeof Runtime.run>

export function main(program: Program) {
  Effect.logInfo("cli starting", {
    version: InstallationVersion,
    channel: InstallationChannel,
    local: InstallationLocal,
    args: process.argv.slice(2),
  }).pipe(
    Effect.flatMap(() => program),
    Effect.annotateLogs({ role: "cli" }),
    Effect.provide(Config.layer),
    Effect.provide(Updater.layer),
    Effect.provide(
      LayerNode.compile(LayerNode.group([Global.node, AppProcess.node, Npm.node]), [
        [
          Global.node,
          Global.layerWith(process.env.OPENCODE_CONFIG_DIR ? { config: process.env.OPENCODE_CONFIG_DIR } : {}),
        ],
      ]),
    ),
    Effect.provide(
      Observability.layer({
        endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
        headers: process.env.OTEL_EXPORTER_OTLP_HEADERS,
        client: process.env.OPENCODE_CLIENT ?? "cli",
      }),
    ),
    Effect.provide(NodeServices.layer),
    Effect.scoped,
    Effect.tap(() => Effect.sync(() => process.exit(process.exitCode ?? 0))),
    NodeRuntime.runMain,
  )
}
