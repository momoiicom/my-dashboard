"use client"

import { useCallback, useEffect, useEffectEvent, useRef, useState, type RefObject } from "react"
import { boardHref, type BoardSnapshot } from "@/lib/board"
import { CONTROLS_MS, idlePresentation, nextBoardId, presentationReducer, type PresentationEvent, type PresentationState } from "@/lib/presentation"

export async function loadBoard(boardId: string, signal: AbortSignal): Promise<BoardSnapshot | null> {
  const response = await fetch(`/api/boards/${encodeURIComponent(boardId)}/cards`, { cache: "no-store", signal })
  if (response.status === 404) return null
  if (!response.ok) throw new Error(response.status === 401 ? "Your session ended. Sign in again to continue." : "Could not load the next board. Please try again.")
  return response.json()
}

type Run = { id: number; snapshot: BoardSnapshot; order: string[] }
export function usePresentation({ host, onStop, onAdvance, fetchBoard = loadBoard }: {
  host: RefObject<HTMLDivElement | null>
  onStop: (snapshot: BoardSnapshot, error?: string, deleted?: boolean) => void
  onAdvance: (snapshot: BoardSnapshot) => void
  fetchBoard?: typeof loadBoard
}) {
  const [run, setRun] = useState<Run | null>(null)
  const [state, setState] = useState<PresentationState>(idlePresentation)
  const generation = useRef(0)
  const stopRun = useRef<(restore?: boolean) => void>(() => {})
  const activity = useRef<() => void>(() => {})
  const stopFocused = useRef(false)
  const stopped = useEffectEvent(onStop)
  const advanced = useEffectEvent(onAdvance)

  const start = useCallback((snapshot: BoardSnapshot, order: string[]) => {
    stopFocused.current = false
    const id = ++generation.current
    const fullscreenHost = host.current
    try {
      const attempt = fullscreenHost?.requestFullscreen?.()
      void attempt?.then(() => {
        if ((generation.current !== id || !fullscreenHost?.isConnected) && document.fullscreenElement === fullscreenHost) void document.exitFullscreen().catch(() => {})
      }, () => {})
    } catch {}
    const nextRun = { id, snapshot, order: [...order] }
    setState(presentationReducer(idlePresentation, { type: "start", runId: id, snapshot, order, hidden: document.hidden }))
    setRun(nextRun)
  }, [host])

  useEffect(() => {
    if (!run) return
    const fullscreenHost = host.current
    let current = presentationReducer(idlePresentation, { type: "start", runId: run.id, snapshot: run.snapshot, order: run.order, hidden: document.hidden })
    let retired = false
    let clock = performance.now()
    let controlsRemaining = CONTROLS_MS
    let timer: ReturnType<typeof setTimeout> | undefined
    let pollTimer: ReturnType<typeof setTimeout> | undefined
    let pollBusy = false
    let fullscreenAttained = document.fullscreenElement === fullscreenHost
    let prefetchedId: string | null = null
    let checkingId: string | null = null
    let ready: BoardSnapshot | null = null
    const requests = new Set<AbortController>()
    const live = () => !retired && generation.current === run.id
    const reduce = (event: PresentationEvent) => { current = presentationReducer(current, event) }
    const publish = () => { if (live()) setState(current) }
    const cancel = () => {
      retired = true
      clearTimeout(timer)
      clearTimeout(pollTimer)
      requests.forEach(request => request.abort())
      requests.clear()
    }
    const stop = (restore = true, error?: string) => {
      if (!live()) return
      const snapshot = current.phase.kind === "idle" ? run.snapshot : current.phase.current
      generation.current++
      cancel()
      setRun(null)
      setState(idlePresentation)
      if (document.fullscreenElement === fullscreenHost) void document.exitFullscreen().catch(() => {})
      if (restore) stopped(snapshot, error, current.deleted.includes(snapshot.board.id))
    }
    stopRun.current = stop
    const elapsed = () => {
      const now = performance.now()
      const previousId = current.phase.kind === "idle" ? "" : current.phase.current.board.id
      if (!current.hidden) {
        reduce({ type: "elapsed", runId: run.id, milliseconds: now - clock })
        if (!stopFocused.current) controlsRemaining = Math.max(0, controlsRemaining - (now - clock))
      }
      clock = now
      commitAdvance(previousId)
    }
    const commitAdvance = (previousId: string) => {
      if (current.phase.kind === "dwelling" && current.phase.current.board.id !== previousId) {
        const snapshot = current.phase.current
        advanced(snapshot)
        window.history.replaceState(null, "", boardHref(snapshot.board.id))
        prefetchedId = null
        ready = null
      }
    }
    const requestTarget = async (id: string, final: boolean) => {
      const controller = new AbortController()
      requests.add(controller)
      try {
        const snapshot = await fetchBoard(id, controller.signal)
        if (!live() || nextBoardId(current) !== id) return
        if (!snapshot) {
          reduce({ type: "deleted", runId: run.id, boardId: id })
          if (prefetchedId === id) prefetchedId = null
          if (ready?.board.id === id) ready = null
        } else if (final && current.phase.kind === "waiting" && nextBoardId(current) === id) ready = snapshot
        else if (!final) reduce({ type: "prefetch", runId: run.id, snapshot })
      } catch (error) {
        if (live() && nextBoardId(current) === id) stop(true, error instanceof Error ? error.message : "Could not load board.")
      } finally {
        requests.delete(controller)
        if (final && checkingId === id) checkingId = null
        if (live()) pump()
      }
    }
    const pump = () => {
      if (!live()) return
      clearTimeout(timer)
      elapsed()
      const nextId = nextBoardId(current)
      if (current.phase.kind === "waiting" && !nextId) {
        if (current.deleted.includes(current.phase.current.board.id)) { stop(true, "This board is no longer available."); return }
      }
      if (nextId && prefetchedId !== nextId) {
        prefetchedId = nextId
        void requestTarget(nextId, false)
      }
      if (current.phase.kind === "waiting" && nextId && !current.hidden) {
        if (ready?.board.id === nextId) {
          const previous = current.phase.current.board.id
          reduce({ type: "ready", runId: run.id, snapshot: ready, reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches })
          ready = null
          clock = performance.now()
          commitAdvance(previous)
        } else if (checkingId !== nextId) {
          checkingId = nextId
          void requestTarget(nextId, true)
        }
      }
      reduce({ type: "controls", runId: run.id, visible: stopFocused.current || controlsRemaining > 0 })
      publish()
      if (current.hidden) return
      const phase = current.phase
      const phaseRemaining = phase.kind === "sliding" || (phase.kind === "dwelling" && nextBoardId(current)) ? phase.remainingMs : Infinity
      const controlTime = !stopFocused.current && controlsRemaining > 0 ? controlsRemaining : Infinity
      const delay = Math.min(phaseRemaining, controlTime)
      if (Number.isFinite(delay)) timer = setTimeout(pump, Math.max(1, delay))
    }
    const reveal = () => {
      if (!live()) return
      elapsed()
      controlsRemaining = CONTROLS_MS
      pump()
    }
    activity.current = reveal
    const visibility = () => {
      elapsed()
      reduce({ type: "visibility", runId: run.id, hidden: document.hidden })
      clearTimeout(pollTimer)
      if (!document.hidden) { controlsRemaining = CONTROLS_MS; pollTimer = setTimeout(poll, 3000) }
      pump()
    }
    const fullscreen = () => {
      if (document.fullscreenElement === fullscreenHost) fullscreenAttained = true
      else if (fullscreenAttained) stop()
    }
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); stop() }
      else reveal()
    }
    const poll = async () => {
      if (!live()) return
      if (!current.hidden && !pollBusy && current.phase.kind !== "idle" && current.phase.kind !== "sliding") {
        pollBusy = true
        const id = current.phase.current.board.id
        const controller = new AbortController()
        requests.add(controller)
        try {
          const snapshot = await fetchBoard(id, controller.signal)
          if (live()) {
            if (snapshot) reduce({ type: "refresh", runId: run.id, snapshot })
            else {
              const shared = current.phase.current.board.id === id && current.phase.current.board.role === "viewer"
              reduce({ type: "deleted", runId: run.id, boardId: id })
              if (shared) { stop(true, "Access to this shared board was removed."); return }
            }
            pump()
          }
        } catch (error) {
          if (live()) stop(true, error instanceof Error ? error.message : "Could not refresh board.")
        } finally { requests.delete(controller); pollBusy = false }
      }
      if (live() && !current.hidden) pollTimer = setTimeout(poll, 3000)
    }
    document.addEventListener("visibilitychange", visibility)
    document.addEventListener("fullscreenchange", fullscreen)
    document.addEventListener("keydown", keyboard)
    pump()
    pollTimer = setTimeout(poll, 3000)
    return () => {
      cancel()
      document.removeEventListener("visibilitychange", visibility)
      document.removeEventListener("fullscreenchange", fullscreen)
      document.removeEventListener("keydown", keyboard)
      if (document.fullscreenElement === fullscreenHost) void document.exitFullscreen().catch(() => {})
    }
  }, [run, host, fetchBoard])

  return {
    state, active: run !== null, start,
    stop: (restore = true) => stopRun.current(restore),
    reveal: () => activity.current(),
    focusStop: (focused: boolean) => { stopFocused.current = focused; activity.current() },
  }
}
