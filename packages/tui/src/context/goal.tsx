import { createEffect, createSignal, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { SessionMessage } from "@opencode-ai/core/session/message"
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
    const [homeSelected, setHomeSelected] = createSignal(false)
    const queues = new Map<string, Promise<void>>()
    const generations = new Map<string, number>()
    const selectionRevisions = new Map<string, number>()
    const outstandingStarts = new Map<string, number>()
    const presentation = new Map<string, { goal: string; messageID: string; revision: number }>()

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
      return id ? selections[id] === true : route.data.type === "home" && homeSelected()
    }

    function answering(id: string) {
      return selected(id) && (starting[id] === true || active(id))
    }

    function generation(sessionID: string) {
      return generations.get(sessionID) ?? 0
    }

    function revision(id = sessionID()) {
      return id ? (selectionRevisions.get(id) ?? 0) : 0
    }

    function advanceRevision(id: string) {
      const next = revision(id) + 1
      selectionRevisions.set(id, next)
      return next
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

    async function requestStart(
      id: string,
      goal: string,
      messageID: string,
      version: number,
      files?: Array<{ uri: string; name?: string; source?: { start: number; end: number; text: string } }>,
    ) {
      if (generation(id) !== version) return
      const result = await sdk.client.sessions.goalStart({ sessionID: id, goal, messageID, files })
      if (generation(id) !== version) return
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

    async function start(
      goal: string,
      id = sessionID(),
      files?: Array<{ uri: string; name?: string; source?: { start: number; end: number; text: string } }>,
    ) {
      if (!id) return
      const ownership = advanceRevision(id)
      setSelections(id, true)
      const version = generation(id)
      const messageID = SessionMessage.ID.create()
      presentation.set(id, { goal, messageID, revision: ownership })
      beginStart(id)
      return serialize(id, () => requestStart(id, goal, messageID, version, files))
        .catch((error) => {
          if (presentation.get(id)?.revision === ownership) presentation.delete(id)
          if (revision(id) === ownership) setSelections(id, false)
          throw error
        })
        .finally(() => endStart(id))
    }

    async function stop(id = sessionID()) {
      if (!id) return
      presentation.delete(id)
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
      if (!id) {
        if (route.data.type === "home") setHomeSelected((value) => !value)
        return
      }
      const ownership = advanceRevision(id)
      const next = !selected(id)
      setSelections(id, next)
      if (next) return
      presentation.delete(id)
      const version = generation(id)
      return serialize(id, async () => {
        if (generation(id) !== version) return
        const status = statuses[id]
        if (status && (status.active || status.iteration >= status.cap)) {
          await requestStop(id, version).catch((error) => {
            if (generation(id) === version && revision(id) === ownership) setSelections(id, true)
            throw error
          })
        }
        if (generation(id) !== version) return
        if (revision(id) !== ownership) return
        setStatuses(id, undefined)
      })
    }

    function clear(sessionID: string) {
      advanceRevision(sessionID)
      generations.set(sessionID, generation(sessionID) + 1)
      setStatuses(sessionID, undefined)
      setSelections(sessionID, undefined)
      setStarting(sessionID, undefined)
      outstandingStarts.delete(sessionID)
      presentation.delete(sessionID)
    }

    function deselect(sessionID: string) {
      advanceRevision(sessionID)
      generations.set(sessionID, generation(sessionID) + 1)
      setStatuses(sessionID, undefined)
      setSelections(sessionID, false)
      setStarting(sessionID, undefined)
      outstandingStarts.delete(sessionID)
      presentation.delete(sessionID)
    }

    function adoptHome(sessionID: string) {
      setHomeSelected(false)
      advanceRevision(sessionID)
      setSelections(sessionID, true)
    }

    createEffect(() => {
      if (route.data.type !== "home") setHomeSelected(false)
    })

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
      onCleanup(() => {
        clearInterval(timer)
        presentation.delete(id)
      })
    })

    function takePrompted(id: string, messageID: string) {
      const marker = presentation.get(id)
      if (!marker || marker.revision !== revision(id) || marker.messageID !== messageID) return
      presentation.delete(id)
      return marker.goal
    }

    return {
      current,
      active,
      adoptHome,
      answering,
      revision,
      selected,
      clear,
      deselect,
      start,
      stop,
      status,
      takePrompted,
      toggle,
    }
  },
})
