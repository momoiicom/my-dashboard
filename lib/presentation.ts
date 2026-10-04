import type { BoardSnapshot } from "@/lib/board"
import type { CardRecord } from "@/lib/dashboard-card"

export const DWELL_MS = 15000
export const SLIDE_MS = 300
export const CONTROLS_MS = 3000
export type PresentationPhase =
  | { kind: "idle" }
  | { kind: "dwelling"; current: BoardSnapshot; remainingMs: number }
  | { kind: "waiting"; current: BoardSnapshot }
  | { kind: "sliding"; current: BoardSnapshot; next: BoardSnapshot; remainingMs: number }
export type PresentationState = {
  runId: number
  phase: PresentationPhase
  order: string[]
  deleted: string[]
  prefetched: BoardSnapshot | null
  hidden: boolean
  controlsVisible: boolean
}
export const idlePresentation: PresentationState = { runId: 0, phase: { kind: "idle" }, order: [], deleted: [], prefetched: null, hidden: false, controlsVisible: true }
export type PresentationEvent =
  | { type: "start"; runId: number; snapshot: BoardSnapshot; order: string[]; hidden: boolean }
  | { type: "prefetch"; runId: number; snapshot: BoardSnapshot }
  | { type: "stop"; runId: number }
  | { type: "elapsed"; runId: number; milliseconds: number }
  | { type: "ready"; runId: number; snapshot: BoardSnapshot; reducedMotion: boolean }
  | { type: "deleted"; runId: number; boardId: string }
  | { type: "refresh"; runId: number; snapshot: BoardSnapshot }
  | { type: "visibility"; runId: number; hidden: boolean }
  | { type: "controls"; runId: number; visible: boolean }

export function nextBoardId(state: PresentationState): string | null {
  if (state.phase.kind === "idle") return null
  const current = state.phase.current.board.id
  const index = state.order.indexOf(current)
  for (let step = 1; step <= state.order.length; step++) {
    const id = state.order[(index + step) % state.order.length]
    if (id !== current && !state.deleted.includes(id)) return id
  }
  return null
}

export function presentationReducer(state: PresentationState, event: PresentationEvent): PresentationState {
  if (event.type === "start") return { runId: event.runId, phase: { kind: "dwelling", current: event.snapshot, remainingMs: DWELL_MS }, order: [...event.order], deleted: [], prefetched: null, hidden: event.hidden, controlsVisible: true }
  if (event.runId !== state.runId) return state
  if (event.type === "stop") return { ...idlePresentation, runId: state.runId + 1 }
  if (event.type === "visibility") return { ...state, hidden: event.hidden }
  if (event.type === "controls") return { ...state, controlsVisible: event.visible }
  if (event.type === "prefetch") return nextBoardId(state) === event.snapshot.board.id ? { ...state, prefetched: event.snapshot } : state
  if (event.type === "deleted") return { ...state, deleted: [...new Set([...state.deleted, event.boardId])], prefetched: state.prefetched?.board.id === event.boardId ? null : state.prefetched, phase: state.phase.kind !== "idle" && state.phase.current.board.id === event.boardId ? { kind: "waiting", current: state.phase.current } : state.phase }
  const phase = state.phase
  if (phase.kind === "idle") return state
  if (event.type === "refresh") return phase.current.board.id === event.snapshot.board.id ? { ...state, phase: { ...phase, current: event.snapshot } } : state
  if (event.type === "ready") {
    if (phase.kind !== "waiting" || state.hidden || nextBoardId(state) !== event.snapshot.board.id) return state
    return { ...state, prefetched: null, phase: event.reducedMotion ? { kind: "dwelling", current: event.snapshot, remainingMs: DWELL_MS } : { kind: "sliding", current: phase.current, next: event.snapshot, remainingMs: SLIDE_MS } }
  }
  if (event.type !== "elapsed" || state.hidden || (phase.kind !== "dwelling" && phase.kind !== "sliding")) return state
  if (phase.kind === "dwelling" && !nextBoardId(state)) return state
  const remainingMs = Math.max(0, phase.remainingMs - event.milliseconds)
  if (remainingMs) return { ...state, phase: { ...phase, remainingMs } }
  return { ...state, prefetched: phase.kind === "sliding" ? null : state.prefetched, phase: phase.kind === "sliding" ? { kind: "dwelling", current: phase.next, remainingMs: DWELL_MS } : { kind: "waiting", current: phase.current } }
}

export function fitCards(cards: Pick<CardRecord, "x" | "y" | "width" | "height">[], width: number, height: number, padding = 24) {
  if (!cards.length) return { scale: 1, x: 0, y: 0 }
  const minX = Math.min(...cards.map(card => card.x))
  const minY = Math.min(...cards.map(card => card.y))
  const occupiedWidth = Math.max(...cards.map(card => card.x + card.width)) - minX
  const occupiedHeight = Math.max(...cards.map(card => card.y + card.height)) - minY
  const scale = Math.max(0, Math.min(1, Math.max(0, width - 2 * padding) / occupiedWidth, Math.max(0, height - 2 * padding) / occupiedHeight))
  return { scale, x: (width - occupiedWidth * scale) / 2 - minX * scale, y: (height - occupiedHeight * scale) / 2 - minY * scale }
}
