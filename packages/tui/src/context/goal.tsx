import { createEffect, createSignal, onCleanup } from "solid-js"
import { createSimpleContext } from "./helper"
import { usePermission } from "./permission"
import { useRoute } from "./route"
import { useSDK } from "./sdk"

export type GoalStatus = {
  goal: string
  active: boolean
  iteration: number
  cap: number
}

export const { use: useGoal, provider: GoalProvider } = createSimpleContext({
  name: "Goal",
  init: () => {
    const sdk = useSDK()
    const route = useRoute()
    const permission = usePermission()
    const [current, setCurrent] = createSignal<GoalStatus>()

    function sessionID() {
      return route.data.type === "session" ? route.data.sessionID : undefined
    }

    async function start(goal: string) {
      const id = sessionID()
      if (!id) return
      const previous = permission.mode
      permission.set("auto")
      try {
        const result = await sdk.client.sessions.goalStart({ sessionID: id, goal })
        setCurrent(result.active ? result : undefined)
      } catch (error) {
        permission.set(previous)
        throw error
      }
    }

    async function stop() {
      const id = sessionID()
      if (!id) return
      await sdk.client.sessions.goalStop({ sessionID: id })
      setCurrent(undefined)
    }

    async function status() {
      const id = sessionID()
      if (!id) {
        setCurrent(undefined)
        return
      }
      const result = await sdk.client.sessions.goalStatus({ sessionID: id })
      setCurrent(result?.active ? result : undefined)
      return result ?? undefined
    }

    createEffect(() => {
      const id = sessionID()
      if (!id) {
        setCurrent(undefined)
        return
      }
      const poll = () => status().catch(() => setCurrent(undefined))
      void poll()
      const timer = setInterval(poll, 5000)
      onCleanup(() => clearInterval(timer))
    })

    return {
      current,
      start,
      stop,
      status,
    }
  },
})
