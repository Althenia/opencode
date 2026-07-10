import { createEffect, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { createSimpleContext } from "./helper"
import { usePermission } from "./permission"
import { useRoute } from "./route"
import { useSDK } from "./sdk"

const DEFAULT_GOAL = "Analyze this session and create or update the goal todo list. Keep it concise and actionable."

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
    const [statuses, setStatuses] = createStore<Record<string, GoalStatus | undefined>>({})
    const queues = new Map<string, Promise<void>>()
    const generations = new Map<string, number>()
    let permissionBaseline = permission.mode
    let outstandingStarts = 0
    let startSucceeded = false

    function serialize<T>(sessionID: string, operation: () => Promise<T>) {
      const result = (queues.get(sessionID) ?? Promise.resolve())
        .catch(() => undefined)
        .then(operation)
      const tail = result.then(
        () => undefined,
        () => undefined,
      )
      queues.set(sessionID, tail)
      return result.finally(() => {
        if (queues.get(sessionID) === tail) queues.delete(sessionID)
      })
    }

    function sessionID() {
      return route.data.type === "session" ? route.data.sessionID : undefined
    }

    function current() {
      const id = sessionID()
      return id ? statuses[id] : undefined
    }

    function active(sessionID: string) {
      return statuses[sessionID]?.active === true
    }

    function generation(sessionID: string) {
      return generations.get(sessionID) ?? 0
    }

    function beginStart() {
      if (outstandingStarts === 0) {
        permissionBaseline = permission.mode
        startSucceeded = false
      }
      outstandingStarts++
      permission.set("auto")
    }

    async function requestStart(id: string, goal: string, version: number) {
      try {
        if (generation(id) !== version) return
        const result = await sdk.client.sessions.goalStart({ sessionID: id, goal })
        if (generation(id) !== version) return
        startSucceeded = true
        setStatuses(id, result.active ? result : undefined)
      } finally {
        outstandingStarts--
        if (outstandingStarts === 0) {
          if (!startSucceeded) permission.set(permissionBaseline)
          startSucceeded = false
        }
      }
    }

    async function requestStop(id: string, version: number) {
      if (generation(id) !== version) return
      await sdk.client.sessions.goalStop({ sessionID: id })
      if (generation(id) !== version) return
      setStatuses(id, undefined)
    }

    async function requestStatus(id: string, version: number) {
      if (generation(id) !== version) return
      const result = await sdk.client.sessions.goalStatus({ sessionID: id })
      if (generation(id) !== version) return
      setStatuses(id, result?.active ? result : undefined)
      return result ?? undefined
    }

    async function start(goal: string) {
      const id = sessionID()
      if (!id) return
      const version = generation(id)
      beginStart()
      return serialize(id, () => requestStart(id, goal, version))
    }

    async function stop() {
      const id = sessionID()
      if (!id) return
      const version = generation(id)
      return serialize(id, () => requestStop(id, version))
    }

    function refresh(id: string) {
      const version = generation(id)
      return serialize(id, () => requestStatus(id, version))
    }

    async function status() {
      const id = sessionID()
      if (!id) return
      return refresh(id)
    }

    async function toggle() {
      const id = sessionID()
      if (!id) return
      const version = generation(id)
      return serialize(id, async () => {
        if (generation(id) !== version) return
        const status = statuses[id] ?? (await requestStatus(id, version))
        if (generation(id) !== version) return
        if (status?.active) return requestStop(id, version)
        beginStart()
        return requestStart(id, DEFAULT_GOAL, version)
      })
    }

    function clear(sessionID: string) {
      generations.set(sessionID, generation(sessionID) + 1)
      setStatuses(sessionID, undefined)
    }

    createEffect(() => {
      const id = sessionID()
      if (!id) return
      const poll = () => {
        const version = generation(id)
        return refresh(id).catch(() => {
          if (generation(id) === version) setStatuses(id, undefined)
        })
      }
      void poll()
      const timer = setInterval(poll, 5000)
      onCleanup(() => clearInterval(timer))
    })

    return {
      current,
      active,
      clear,
      start,
      stop,
      status,
      toggle,
    }
  },
})
