"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import Link from "next/link"
import { Play } from "lucide-react"
import { boardHref, type BoardRecord } from "@/lib/board"
import { Rnd } from "react-rnd"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from "@/components/ui/empty"
import { cn } from "cn"
import { AccountMenu } from "@/components/account-menu"
import { cardKindDetails } from "@/lib/card-kinds"
import { BotCardRenderer } from "@/components/bot-card-renderer"
import { ConnectBotDialog } from "@/components/connect-bot-dialog"
import type { CardPatch, CardRecord } from "@/lib/dashboard-card"

type SaveState = "idle" | "saved" | "saving" | "error"
type LayoutMode = "view" | "edit"
type CardChanges = CardPatch | ((card: CardRecord) => CardPatch)
type ResizePreview = { id: string, width: number, height: number }
const GRID_SIZE = 20

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.max(minimum, Math.min(maximum, Math.round(value)))
const snap = (value: number, minimum: number, maximum: number) =>
  clamp(Math.round(value / GRID_SIZE) * GRID_SIZE, minimum, maximum)

export function Dashboard({ initialCards, name, image, localUiMode = false, boardId, boards, boardToolbar, onPlay, initialConnectOpen, onConnectClosed }: {
  initialConnectOpen: boolean
  onConnectClosed: () => void
  boardId: string
  boards: BoardRecord[]
  boardToolbar: ReactNode
  onPlay: (cards: CardRecord[]) => void
  initialCards: CardRecord[]
  name: string
  image?: string | null
  localUiMode?: boolean
}) {
  const [cards, setCards] = useState(initialCards)
  const [connectOpen, setConnectOpen] = useState(initialConnectOpen)
  const requestEpoch = useRef(0)
  const gesture = useRef(false)
  const [hasGesture, setHasGesture] = useState(false)
  const mounted = useRef(true)
  const [movedTo, setMovedTo] = useState<BoardRecord | null>(null)
  const polling = useRef(false)
  const [mode, setMode] = useState<LayoutMode>("view")
  const [isSigningOut, setIsSigningOut] = useState(false)
  const isEditing = mode === "edit"
  const [saveState, setSaveState] = useState<SaveState>("idle")
  const [error, setError] = useState("")
  const [resizePreview, setResizePreview] = useState<ResizePreview | null>(null)
  const busy = useRef(false)
  const pendingActions = useRef<Array<() => void>>([])
  const idleWaiters = useRef<Array<() => void>>([])
  const cardsRef = useRef(cards)

  const finishMutation = () => {
    requestEpoch.current++
    busy.current = false
    if (!mounted.current) { pendingActions.current = []; return }
    const next = pendingActions.current.shift()
    if (next) next()
    else idleWaiters.current.splice(0).forEach((resolve) => resolve())
  }

  const updateCards = (next: CardRecord[]) => {
    cardsRef.current = next
    if (mounted.current) setCards(next)
  }

  async function mutate(url: string, method: string, body?: unknown) {
    const response = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    })
    if (!response.ok) throw new Error(response.status === 409 ? "This card changed boards. Refresh the board before editing it again." : "Could not save. Please try again.")
    return response.json()
  }

  async function patchCard(id: string, changes: CardChanges) {
    if (!mounted.current) return
    if (busy.current) {
      requestEpoch.current++
      pendingActions.current.push(() => void patchCard(id, changes))
      return
    }
    requestEpoch.current++
    const before = cardsRef.current
    const current = before.find((card) => card.id === id)
    if (!current) {
      finishMutation()
      return
    }
    const resolved = typeof changes === "function" ? changes(current) : changes
    const next = before.map((card) => card.id === id ? { ...card, ...resolved } : card)
    if (JSON.stringify(next) === JSON.stringify(before)) {
      finishMutation()
      return
    }
    busy.current = true
    updateCards(next)
    setSaveState("saving")
    setError("")
    try {
      await mutate(`/api/boards/${encodeURIComponent(boardId)}/cards/${encodeURIComponent(id)}`, "PATCH", { patch: resolved, membershipRevision: current.membershipRevision })
      if (!mounted.current) return
      setSaveState("saved")
    } catch (cause) {
      if (!mounted.current) return
      updateCards(cardsRef.current.map((card) => card.id === id ? { ...card, x: current.x, y: current.y, width: current.width, height: current.height } : card))
      setSaveState("error")
      setError(cause instanceof Error ? cause.message : "Could not save card.")
    } finally {
      finishMutation()
    }
  }

  async function removeCard(id: string) {
    if (!mounted.current) return
    if (busy.current) {
      requestEpoch.current++
      pendingActions.current.push(() => void removeCard(id))
      return
    }
    requestEpoch.current++
    const current = cardsRef.current.find(card => card.id === id)
    if (!current) { finishMutation(); return }
    busy.current = true
    setSaveState("saving")
    setError("")
    try {
      await mutate(`/api/boards/${encodeURIComponent(boardId)}/cards/${encodeURIComponent(id)}`, "DELETE", { membershipRevision: current.membershipRevision })
      if (!mounted.current) return
      updateCards(cardsRef.current.filter((card) => card.id !== id))
      setSaveState("saved")
    } catch (cause) {
      if (!mounted.current) return
      setSaveState("error")
      setError(cause instanceof Error ? cause.message : "Could not remove card.")
    } finally {
      finishMutation()
    }
  }

  async function moveCard(id: string, destinationBoardId: string) {
    if (busy.current || gesture.current || !mounted.current || destinationBoardId === boardId) return
    requestEpoch.current++
    busy.current = true
    setSaveState("saving")
    setError("")
    setMovedTo(null)
    try {
      await mutate(`/api/cards/${encodeURIComponent(id)}/move`, "POST", { sourceBoardId: boardId, destinationBoardId })
      if (!mounted.current) return
      requestEpoch.current++
      updateCards(cardsRef.current.filter(card => card.id !== id))
      setMovedTo(boards.find(board => board.id === destinationBoardId) || null)
      setSaveState("saved")
    } catch (cause) {
      if (!mounted.current) return
      setSaveState("error")
      setError(cause instanceof Error ? cause.message : "Could not move card.")
    } finally { finishMutation() }
  }

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; pendingActions.current = [] }
  }, [])

  useEffect(() => {
    if (saveState !== "saved") return
    const timer = window.setTimeout(() => setSaveState("idle"), 2000)
    return () => window.clearTimeout(timer)
  }, [saveState])

  useEffect(() => {
    let active = true
    const controller = new AbortController()
    async function refresh() {
      if (!active || document.visibilityState !== "visible" || polling.current || busy.current || pendingActions.current.length || gesture.current) return
      polling.current = true
      const epoch = requestEpoch.current
      try {
        const response = await fetch(`/api/boards/${encodeURIComponent(boardId)}/cards`, { cache: "no-store", credentials: "same-origin", signal: controller.signal })
        if (!response.ok) return
        const result = await response.json() as { cards: CardRecord[] }
        if (!active || epoch !== requestEpoch.current || busy.current || pendingActions.current.length || gesture.current) return
        const local = new Map(cardsRef.current.map((card) => [card.id, card]))
        const merged = result.cards.map((remote) => {
          const existing = local.get(remote.id)
          return existing && existing.membershipRevision === remote.membershipRevision ? { ...existing, title: remote.title, kind: remote.kind, externalKey: remote.externalKey ?? null, payload: remote.payload ?? null, acceptedAt: remote.acceptedAt ?? null, contentRevision: remote.contentRevision ?? 0 } : remote
        })
        if (JSON.stringify(merged) !== JSON.stringify(cardsRef.current)) updateCards(merged)
      } catch {}
      finally { polling.current = false }
    }
    const timer = window.setInterval(() => void refresh(), 3000)
    const visible = () => { if (document.visibilityState === "visible") void refresh() }
    document.addEventListener("visibilitychange", visible)
    return () => { active = false; controller.abort(); window.clearInterval(timer); document.removeEventListener("visibilitychange", visible) }
  }, [boardId])

  const canvasWidth = Math.max(1200, ...cards.map((card) => card.x + card.width + 32))
  const canvasHeight = Math.max(900, ...cards.map((card) => card.y + card.height + 32))

  return (
    <main className="dashboard-shell">
      <header className="dashboard-topbar">
        <div className="dashboard-brand"><span className="dashboard-brand-mark" aria-hidden="true">▦</span><h1>Dashboard</h1><Badge variant="secondary" className="dashboard-private">{localUiMode ? "Local" : "Private"}</Badge></div>
        <div className="dashboard-actions">
          <span className={cn("dashboard-save", `dashboard-save-${saveState}`)} role="status" aria-live="polite">{saveState === "saving" ? "Saving…" : saveState === "error" ? "Save failed" : saveState === "saved" ? "Saved" : ""}</span>
          <Button size="sm" variant="outline" onClick={() => setConnectOpen(true)}>Connect your bot</Button>
          <Button size="sm" disabled={isSigningOut} variant={isEditing ? "secondary" : "default"} aria-pressed={isEditing} onClick={() => setMode(isEditing ? "view" : "edit")}>{isEditing ? "Done editing" : "Edit layout"}</Button>
        </div>
        <div className="dashboard-account">
          <AccountMenu name={name} image={image} localUiMode={localUiMode} onPendingChange={setIsSigningOut} beforeSignOut={() => {
            setMode("view")
            return new Promise<void>((resolve) => {
              if (!busy.current && pendingActions.current.length === 0) resolve()
              else idleWaiters.current.push(resolve)
            })
          }} />
        </div>
      </header>
      <div className="board-toolbar"><div className="board-toolbar-navigation" inert={hasGesture}>{boardToolbar}</div><Button size="icon-sm" variant="ghost" aria-label="Play slideshow" title="Play slideshow" disabled={hasGesture || saveState === "saving" || isSigningOut} onClick={() => {
        if (busy.current || pendingActions.current.length || gesture.current) return
        setMode("view")
        onPlay(cardsRef.current)
      }}><Play aria-hidden="true" /></Button></div>
      {movedTo && <div className="board-move-notice" role="status">Card moved to <Link href={boardHref(movedTo.id)}>{movedTo.name}</Link>.</div>}
      {error && <Alert variant="destructive" className="dashboard-error"><AlertDescription>{error}</AlertDescription></Alert>}
      <div className="dashboard-scroll">
        <div className={cn("dashboard-canvas", isEditing && "dashboard-canvas-editing")} style={{ minWidth: canvasWidth, minHeight: canvasHeight }}>
          {cards.length === 0 && <Empty className="dashboard-empty"><EmptyHeader><EmptyTitle>Your space is ready.</EmptyTitle><EmptyDescription>Connect a bot to fill this board with live content.</EmptyDescription></EmptyHeader></Empty>}
          {cards.map((card) => (
            <Rnd
              key={card.id}
              className="dashboard-card"
              size={{ width: card.width, height: card.height }}
              position={{ x: card.x, y: card.y }}
              minWidth={240}
              minHeight={160}
              maxWidth={1600}
              maxHeight={1200}
              dragGrid={[GRID_SIZE, GRID_SIZE]}
              resizeGrid={[GRID_SIZE, GRID_SIZE]}
              dragHandleClassName="dashboard-card-handle"
              resizeHandleClasses={{ bottomRight: "react-resizable-handle" }}
              disableDragging={!isEditing || saveState === "saving"}
              enableResizing={isEditing && saveState !== "saving" ? { bottomRight: true } : false}
              onDragStart={() => { gesture.current = true; setHasGesture(true); requestEpoch.current++ }}
              onDragStop={(_event, position) => { gesture.current = false; setHasGesture(false); requestEpoch.current++; void patchCard(card.id, {
                x: snap(position.x, 0, 10000), y: snap(position.y, 0, 10000),
                width: snap(card.width, 240, 1600), height: snap(card.height, 160, 1200),
              }) }}
              onResizeStart={() => { gesture.current = true; setHasGesture(true); requestEpoch.current++ }}
              onResize={(_event, _direction, ref) => setResizePreview({
                id: card.id, width: ref.offsetWidth, height: ref.offsetHeight,
              })}
              onResizeStop={(_event, _direction, ref, _delta, position) => {
                gesture.current = false
                setHasGesture(false)
                requestEpoch.current++
                setResizePreview(null)
                void patchCard(card.id, {
                  x: snap(position.x, 0, 10000), y: snap(position.y, 0, 10000),
                  width: snap(ref.offsetWidth, 240, 1600), height: snap(ref.offsetHeight, 160, 1200),
                })
              }}
            >
              <Card className={cn("dashboard-card-inner", !isEditing && "dashboard-card-view")} size="sm">
                {isEditing && <CardHeader className="dashboard-card-head">
                  <div className="dashboard-card-handle" tabIndex={0} role="button" aria-label={`Move or resize ${card.title || "Untitled card"}. Arrow keys move, Shift and arrow keys resize.`}
                    onKeyDown={(event) => {
                      const directions: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }
                      const direction = directions[event.key]
                      if (!direction) return
                      event.preventDefault()
                      const step = GRID_SIZE
                      if (event.shiftKey) void patchCard(card.id, (current) => ({
                        x: snap(current.x, 0, 10000), y: snap(current.y, 0, 10000),
                        width: snap(current.width + direction[0] * step, 240, 1600),
                        height: snap(current.height + direction[1] * step, 160, 1200),
                      }))
                      else void patchCard(card.id, (current) => ({
                        x: snap(current.x + direction[0] * step, 0, 10000),
                        y: snap(current.y + direction[1] * step, 0, 10000),
                        width: snap(current.width, 240, 1600), height: snap(current.height, 160, 1200),
                      }))
                    }}>
                    <span className="dashboard-grip" aria-hidden="true">⠿</span><span className="dashboard-card-label">{!card.kind || card.kind === "blank" ? "Card" : cardKindDetails[card.kind].label}</span>
                  </div>
                  <select className="card-board-select" aria-label={`Board for ${card.title || "untitled card"}`} value={boardId} disabled={saveState === "saving" || hasGesture} onChange={event => void moveCard(card.id, event.target.value)}>
                    {boards.map(board => <option key={board.id} value={board.id}>{board.name}</option>)}
                  </select>
                  <Button variant="ghost" size="icon-xs" aria-label={`Remove ${card.title || "untitled card"}`} title="Remove card" onClick={() => void removeCard(card.id)}>×</Button>
                </CardHeader>}
                <CardContent className="dashboard-card-content"><h2 className="dashboard-card-title">{card.title}</h2>{card.payload ? <BotCardRenderer document={card.payload} acceptedAt={card.acceptedAt} /> : card.kind && card.kind !== "blank" ? <Empty className="mt-4 min-h-20 flex-none rounded-md border border-border p-3"><EmptyDescription>{cardKindDetails[card.kind].empty}</EmptyDescription></Empty> : null}</CardContent>
                {isEditing && <CardFooter className="dashboard-card-footer">Drag the top edge · Resize from the corner</CardFooter>}
              </Card>
              {isEditing && <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
                <span role="status" aria-live="polite" aria-atomic="true" className="rounded-md bg-slate-950/90 px-2.5 py-1 font-mono text-xs font-semibold tabular-nums text-white shadow-lg ring-1 ring-white/20" aria-label={`${resizePreview?.id === card.id ? resizePreview.width : card.width} pixels wide by ${resizePreview?.id === card.id ? resizePreview.height : card.height} pixels high`}>
                  {resizePreview?.id === card.id ? resizePreview.width : card.width}x{resizePreview?.id === card.id ? resizePreview.height : card.height}
                </span>
              </div>}
            </Rnd>
          ))}
        </div>
      </div>
      {connectOpen && <ConnectBotDialog open={connectOpen} onOpenChange={open => { setConnectOpen(open); if (!open) onConnectClosed() }} />}
    </main>
  )
}
