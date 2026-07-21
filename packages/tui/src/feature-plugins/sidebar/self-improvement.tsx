import { Plugin } from "@opencode-ai/plugin/v2/tui"
import { createEffect, createMemo, createSignal, For, on, Show } from "solid-js"
import { useTheme } from "../../context/theme"

const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "short" })
const when = (value: number | undefined) => (value === undefined ? undefined : dateTime.format(new Date(value)))

export function tickSummary(result: {
  eligiblePatterns: number
  generated: number
  prepared: number
  runsCreated: number
  runsDecided: number
  reconciled: number
  failures: number
}) {
  return [
    `${result.eligiblePatterns} eligible`,
    `${result.generated} generated`,
    `${result.prepared} prepared`,
    `${result.runsCreated} runs opened`,
    `${result.runsDecided} decided`,
    `${result.reconciled} reconciled`,
    ...(result.failures > 0 ? [`${result.failures} failure${result.failures === 1 ? "" : "s"}`] : []),
  ].join(" · ")
}

function View(props: { context: Plugin.Context; sessionID: string }) {
  const { themeV2 } = useTheme()
  const [refreshing, setRefreshing] = createSignal(false)
  const session = createMemo(() => props.context.data.session.get(props.sessionID))
  const location = createMemo(() => session()?.location)
  const status = createMemo(() => props.context.data.location.selfImprovement.get(location()))

  const refresh = async () => {
    const ref = location()
    if (!ref || refreshing()) return
    setRefreshing(true)
    props.context.data.location.selfImprovement.invalidate(ref)
    try {
      await props.context.data.location.selfImprovement.sync(ref)
    } finally {
      setRefreshing(false)
    }
  }

  props.context.keymap.layer(() => ({
    mode: "global",
    commands: [
      {
        id: "self-improvement.refresh",
        title: "Refresh self-improvement status",
        description: "Reload privacy-safe evidence, automation, and generated rollout status",
        group: "Session",
        palette: true,
        enabled: () => location() !== undefined && !refreshing(),
        run: refresh,
      },
    ],
  }))

  createEffect(on(location, (ref) => ref && void refresh()))

  return (
    <box>
      <box flexDirection="row" gap={1} onMouseDown={() => void refresh()}>
        <text fg={themeV2.text.default}>
          <b>Self-improvement</b>
        </text>
        <text fg={themeV2.text.subdued}>{refreshing() ? "refreshing…" : "↻"}</text>
      </box>
      <Show when={status()} fallback={<text fg={themeV2.text.subdued}>Status unavailable</text>}>
        {(value) => (
          <>
            <text fg={value().enabled ? themeV2.text.feedback.success.default : themeV2.text.subdued}>
              • {value().enabled ? "Automatic enabled" : "Automatic disabled"}
            </text>
            <text fg={themeV2.text.subdued}>
              {value().autoApprove ? "Auto-approve enabled" : "Manual approval required"} · every {value().intervalSeconds}s
            </text>
            <text fg={themeV2.text.default} marginTop={1}>
              <b>Evidence</b>
            </text>
            <text fg={themeV2.text.subdued}>
              {value().evidence.count} record{value().evidence.count === 1 ? "" : "s"}
              {when(value().evidence.lastObservedAt) ? ` · last ${when(value().evidence.lastObservedAt)}` : ""}
            </text>
            <Show when={value().evidence.reason}>
              {(reason) => <text fg={themeV2.text.feedback.warning.default}>{reason().message}</text>}
            </Show>
            <text fg={themeV2.text.default} marginTop={1}>
              <b>Automation</b>
            </text>
            <text fg={themeV2.text.subdued}>
              {value().automation.running ? "Running" : "Idle"}
              {when(value().automation.lastCompletedAt) ? ` · last ${when(value().automation.lastCompletedAt)}` : ""}
            </text>
            <Show when={value().automation.lastResult}>
              {(result) => <text fg={themeV2.text.subdued}>{tickSummary(result())}</text>}
            </Show>
            <text fg={themeV2.text.default} marginTop={1}>
              <b>Generated slots</b>
            </text>
            <Show
              when={value().generatedSlots.length > 0}
              fallback={<text fg={themeV2.text.subdued}>No generated rollout slots</text>}
            >
              <For each={value().generatedSlots}>
                {(slot) => (
                  <text fg={themeV2.text.subdued}>
                    {slot.slot}: {slot.name} · r{slot.desiredRevision}
                  </text>
                )}
              </For>
            </Show>
          </>
        )}
      </Show>
    </box>
  )
}

export default Plugin.define({
  id: "internal:sidebar-self-improvement",
  setup(context) {
    context.ui.slot("sidebar.content", (props) => <View context={context} sessionID={props.sessionID} />)
  },
})
