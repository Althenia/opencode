import { Plugin } from "@opencode-ai/plugin/v2/tui"
import { createMemo, Show } from "solid-js"
import { useTheme } from "../../context/theme"
import { cacheHitPercent } from "../../util/cache-diagnostics"

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
})

function View(props: { context: Plugin.Context; sessionID: string }) {
  const { themeV2 } = useTheme()
  const diagnostics = createMemo(() => props.context.data.session.diagnostics.get(props.sessionID))
  const hitPercent = createMemo(() => cacheHitPercent(diagnostics()?.cache.hitRatio))
  const cost = createMemo(() => props.context.data.session.cost(props.sessionID))

  return (
    <box>
      <text fg={themeV2.text.default}>
        <b>Context</b>
      </text>
      <Show when={diagnostics()} fallback={<text fg={themeV2.text.subdued}>Not measured</text>}>
        {(value) => (
          <>
            <text fg={themeV2.text.subdued}>
              {value().context.total.toLocaleString()}
              {value().context.limit === undefined ? " tokens" : ` / ${Number(value().context.limit).toLocaleString()} tokens`}
            </text>
            <Show when={value().context.percent !== undefined}>
              <text fg={themeV2.text.subdued}>{value().context.percent}% used</text>
            </Show>
            <text fg={themeV2.text.subdued}>Cached tokens still occupy context.</text>
            <text fg={themeV2.text.default} marginTop={1}>
              <b>Cache</b>
            </text>
            <text fg={themeV2.text.subdued}>
              {hitPercent() === undefined ? "No eligible input" : `${hitPercent()}% hit ratio`}
            </text>
            <text fg={themeV2.text.subdued}>{value().tokens.uncachedInput.toLocaleString()} uncached input</text>
            <text fg={themeV2.text.subdued}>{value().tokens.cacheRead.toLocaleString()} cache read</text>
            <text fg={themeV2.text.subdued}>{value().tokens.cacheWrite.toLocaleString()} cache write</text>
            <text fg={themeV2.text.subdued}>{value().cache.mechanism}</text>
          </>
        )}
      </Show>
      <text fg={themeV2.text.subdued} marginTop={1}>{money.format(cost())} spent</text>
    </box>
  )
}

export default Plugin.define({
  id: "internal:sidebar-context",
  setup(context) {
    context.ui.slot("sidebar.content", (props) => <View context={context} sessionID={props.sessionID} />)
  },
})
