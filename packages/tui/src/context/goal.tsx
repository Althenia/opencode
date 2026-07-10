import { createEffect, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { createSimpleContext } from "./helper"
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
    const [statuses, setStatuses] = createStore<Record<string, GoalStatus | undefined>>({})
    const [selections, setSelections] = createStore<Record<string, boolean | undefined>>({})
    const [starting, setStarting] = createStore<Record<string, boolean | undefined>>({})
    const queues = new Map<string, Promise<void>>()
    const generations = new Map<string, number>()
    const outstandingStarts = new Map<string, number>()

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

    function selected(id = sessionID()) {
      return id ? selections[id] === true : false
    }

    function answering(id: string) {
      return starting[id] === true || active(id)
    }

    function generation(sessionID: string) {
      return generations.get(sessionID) ?? 0
    }

    function beginStart(id: string) {
      outstandingStarts.set(id, (outstandingStarts.get(id) ?? 0) + 1)
      setStarting(id, true)
    }

    function endStart(id: string) {
      const count = (outstandingStarts.get(id) ?? 1) - 1
      if (count > 0) return outstandingStarts.set(id, count)
      outstandingStarts.delete(id)
      setStarting(id, undefined)
    }

    async function requestStart(id: string, goal: string, version: number) {
      if (generation(id) !== version) return
      const result = await sdk.client.sessions.goalStart({ sessionID: id, goal })
      if (generation(id) !== version) return
      setSelections(id, true)
      setStatuses(id, result)
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
      if (selections[id] === false) {
        setStatuses(id, undefined)
        return result ?? undefined
      }
      if (result && (result.active || result.iteration >= result.cap)) setSelections(id, true)
      setStatuses(
        id,
        result && (selected(id) || result.active)
          ? result
          : undefined,
      )
      return result ?? undefined
    }

    async function start(goal: string, id = sessionID()) {
      if (!id) return
      const version = generation(id)
      beginStart(id)
      return serialize(id, () => requestStart(id, goal, version)).finally(() => endStart(id))
    }

    async function stop(id = sessionID()) {
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
        if (!selected(id)) {
          setSelections(id, true)
          return
        }
        const status = statuses[id]
        if (status && (status.active || status.iteration >= status.cap)) await requestStop(id, version)
        if (generation(id) !== version) return
        setSelections(id, false)
        setStatuses(id, undefined)
      })
    }

    function clear(sessionID: string) {
      generations.set(sessionID, generation(sessionID) + 1)
      setStatuses(sessionID, undefined)
      setSelections(sessionID, undefined)
      setStarting(sessionID, undefined)
      outstandingStarts.delete(sessionID)
    }

    function deselect(sessionID: string) {
      generations.set(sessionID, generation(sessionID) + 1)
      setStatuses(sessionID, undefined)
      setSelections(sessionID, false)
      setStarting(sessionID, undefined)
      outstandingStarts.delete(sessionID)
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
      answering,
      selected,
      clear,
      deselect,
      start,
      stop,
      status,
      toggle,
    }
  },
})
