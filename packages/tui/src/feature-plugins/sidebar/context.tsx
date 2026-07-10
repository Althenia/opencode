import type { AssistantMessage } from "@opencode-ai/sdk/v2"
import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { BuiltinTuiPlugin } from "../builtins"
import { createMemo, createSignal, Show } from "solid-js"

const id = "internal:sidebar-context"

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
})

export function SidebarContextView(props: { api: TuiPluginApi; session_id: string; defaultCollapsed?: boolean }) {
  const theme = () => props.api.theme.current
  const msg = createMemo(() => props.api.state.session.messages(props.session_id))
  const session = createMemo(() => props.api.state.session.get(props.session_id))
  const cost = createMemo(() => session()?.cost ?? 0)
  const [collapsed, setCollapsed] = createSignal(props.defaultCollapsed === true)

  const state = createMemo(() => {
    const last = msg().findLast((item): item is AssistantMessage => item.role === "assistant" && item.tokens.output > 0)
    if (!last) {
      return {
        input: 0,
        output: 0,
        reasoning: 0,
        cacheRead: 0,
        cacheWrite: 0,
        cache: 0,
        total: 0,
        max: null,
        percent: null,
        cachePercent: 0,
      }
    }

    const total =
      last.tokens.input + last.tokens.output + last.tokens.reasoning + last.tokens.cache.read + last.tokens.cache.write
    const cache = last.tokens.cache.read + last.tokens.cache.write
    const model = props.api.state.provider.find((item) => item.id === last.providerID)?.models[last.modelID]
    return {
      input: last.tokens.input,
      output: last.tokens.output,
      reasoning: last.tokens.reasoning,
      cacheRead: last.tokens.cache.read,
      cacheWrite: last.tokens.cache.write,
      cache,
      total,
      max: model?.limit.context ?? null,
      percent: model?.limit.context ? Math.round((total / model.limit.context) * 100) : null,
      cachePercent: total ? Math.round((cache / total) * 100) : 0,
    }
  })

  return (
    <box>
      <box onMouseDown={() => setCollapsed((value) => !value)}>
        <text fg={theme().text}>
          <b>{collapsed() ? "▸" : "▾"} Context</b>
        </text>
      </box>
      <Show
        when={!collapsed()}
        fallback={
          <>
            <text fg={theme().textMuted}>
              {state().total.toLocaleString()}
              {state().max ? ` / ${state().max?.toLocaleString()}` : ""} tokens
            </text>
            <text fg={theme().textMuted}>{state().percent ?? 0}% used</text>
          </>
        }
      >
        <text fg={theme().textMuted}>Input {state().input.toLocaleString()}</text>
        <text fg={theme().textMuted}>Output {state().output.toLocaleString()}</text>
        <text fg={theme().textMuted}>Reasoning {state().reasoning.toLocaleString()}</text>
        <text fg={theme().textMuted}>Cache read {state().cacheRead.toLocaleString()}</text>
        <text fg={theme().textMuted}>Cache write {state().cacheWrite.toLocaleString()}</text>
        <text fg={theme().textMuted}>Total {state().total.toLocaleString()}</text>
        <Show when={state().max} keyed>
          {(max) => <text fg={theme().textMuted}>Max {max.toLocaleString()}</text>}
        </Show>
        <text fg={theme().textMuted}>{state().percent ?? 0}% used</text>
        <text fg={theme().textMuted}>Cache {state().cachePercent}%</text>
      </Show>
      <text fg={theme().textMuted}>{money.format(cost())} spent</text>
    </box>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 100,
    slots: {
      sidebar_content(_ctx, props) {
        return <SidebarContextView api={api} session_id={props.session_id} />
      },
    },
  })
}

const plugin: BuiltinTuiPlugin = {
  id,
  tui,
}

export default plugin
