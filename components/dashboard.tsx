"use client"

import { useRef, useState } from "react"
import { Rnd } from "react-rnd"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from "@/components/ui/empty"
import { cn } from "cn"
import { Input } from "@/components/ui/input"
import { SignOutButton } from "@/components/sign-out-button"
import type { CardInput, CardRecord } from "@/lib/dashboard-card"

type SaveState = "saved" | "saving" | "error"
type LayoutMode = "view" | "edit"
type CardChanges = Partial<CardInput> | ((card: CardRecord) => Partial<CardInput>)
type ResizePreview = { id: string, width: number, height: number }
const GRID_SIZE = 20

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.max(minimum, Math.min(maximum, Math.round(value)))
const snap = (value: number, minimum: number, maximum: number) =>
  clamp(Math.round(value / GRID_SIZE) * GRID_SIZE, minimum, maximum)

export function Dashboard({ initialCards, name, image }: {
  initialCards: CardRecord[]
  name: string
  image?: string | null
}) {
  const [cards, setCards] = useState(initialCards)
  const [mode, setMode] = useState<LayoutMode>("view")
  const [isSigningOut, setIsSigningOut] = useState(false)
  const isEditing = mode === "edit"
  const [saveState, setSaveState] = useState<SaveState>("saved")
  const [error, setError] = useState("")
  const [resizePreview, setResizePreview] = useState<ResizePreview | null>(null)
  const busy = useRef(false)
  const pendingActions = useRef<Array<() => void>>([])
  const idleWaiters = useRef<Array<() => void>>([])
  const cardsRef = useRef(cards)

  const finishMutation = () => {
    busy.current = false
    const next = pendingActions.current.shift()
    if (next) next()
    else idleWaiters.current.splice(0).forEach((resolve) => resolve())
  }

  const updateCards = (next: CardRecord[]) => {
    cardsRef.current = next
    setCards(next)
  }

  async function mutate(url: string, method: string, body?: CardInput | Partial<CardInput>) {
    const response = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    })
    if (!response.ok) throw new Error("Could not save. Please try again.")
    return response.json()
  }

  async function addCard() {
    if (busy.current) {
      pendingActions.current.push(() => void addCard())
      return
    }
    const nextY = Math.max(GRID_SIZE, ...cardsRef.current.map((item) => item.y + item.height + GRID_SIZE))
    if (nextY > 10000) {
      setSaveState("error")
      setError("This layout has reached its lower limit. Move a card higher before adding another.")
      finishMutation()
      return
    }
    busy.current = true
    setSaveState("saving")
    setError("")
    const card: CardInput = { title: "Untitled card", x: GRID_SIZE, y: snap(nextY, 0, 10000), width: 320, height: 220 }
    try {
      const result = await mutate("/api/cards", "POST", card) as { card: CardRecord }
      updateCards([...cardsRef.current, result.card])
      setSaveState("saved")
    } catch (cause) {
      setSaveState("error")
      setError(cause instanceof Error ? cause.message : "Could not add card.")
    } finally {
      finishMutation()
    }
  }

  async function patchCard(id: string, changes: CardChanges) {
    if (busy.current) {
      pendingActions.current.push(() => void patchCard(id, changes))
      return
    }
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
      await mutate(`/api/cards/${encodeURIComponent(id)}`, "PATCH", resolved)
      setSaveState("saved")
    } catch (cause) {
      updateCards(before)
      setSaveState("error")
      setError(cause instanceof Error ? cause.message : "Could not save card.")
    } finally {
      finishMutation()
    }
  }

  async function removeCard(id: string) {
    if (busy.current) {
      pendingActions.current.push(() => void removeCard(id))
      return
    }
    busy.current = true
    setSaveState("saving")
    setError("")
    try {
      await mutate(`/api/cards/${encodeURIComponent(id)}`, "DELETE")
      updateCards(cardsRef.current.filter((card) => card.id !== id))
      setSaveState("saved")
    } catch (cause) {
      setSaveState("error")
      setError(cause instanceof Error ? cause.message : "Could not remove card.")
    } finally {
      finishMutation()
    }
  }

  const canvasWidth = Math.max(1200, ...cards.map((card) => card.x + card.width + 32))
  const canvasHeight = Math.max(900, ...cards.map((card) => card.y + card.height + 32))

  return (
    <main className="dashboard-shell">
      <header className="dashboard-topbar">
        <div className="dashboard-brand"><span className="dashboard-brand-mark" aria-hidden="true">▦</span><strong>My dashboard</strong></div>
        <div className="dashboard-account">
          <Avatar size="sm" className="dashboard-avatar">{image && <AvatarImage src={image} alt="" referrerPolicy="no-referrer" />}<AvatarFallback>{name.slice(0, 1).toUpperCase()}</AvatarFallback></Avatar>
          <span className="dashboard-account-name">{name}</span>
          <SignOutButton onPendingChange={setIsSigningOut} beforeSignOut={() => {
            setMode("view")
            return new Promise<void>((resolve) => {
              if (!busy.current && pendingActions.current.length === 0) resolve()
              else idleWaiters.current.push(resolve)
            })
          }} />
        </div>
      </header>
      <div className="dashboard-toolbar">
        <div className="dashboard-toolbar-title"><h1>Dashboard</h1><Badge variant="secondary" className="dashboard-private">Private</Badge></div>
        <div className="dashboard-toolbar-actions">
          <span className={cn("dashboard-save", `dashboard-save-${saveState}`)} role="status" aria-live="polite">{saveState === "saving" ? "Saving…" : saveState === "error" ? "Save failed" : "Saved"}</span>
          {isEditing && <Button size="sm" onClick={() => void addCard()}>+ Add card</Button>}
          <Button size="sm" disabled={isSigningOut} variant={isEditing ? "secondary" : "default"} aria-pressed={isEditing} onClick={() => setMode(isEditing ? "view" : "edit")}>{isEditing ? "Done editing" : "Edit layout"}</Button>
        </div>
      </div>
      {error && <Alert variant="destructive" className="dashboard-error"><AlertDescription>{error}</AlertDescription></Alert>}
      <div className="dashboard-scroll">
        <div className={cn("dashboard-canvas", isEditing && "dashboard-canvas-editing")} style={{ minWidth: canvasWidth, minHeight: canvasHeight }}>
          {cards.length === 0 && <Empty className="dashboard-empty"><EmptyHeader><EmptyTitle>Your space is ready.</EmptyTitle><EmptyDescription>{isEditing ? "Add a card to make it yours." : "Edit layout to add a card."}</EmptyDescription></EmptyHeader></Empty>}
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
              onDragStop={(_event, position) => void patchCard(card.id, {
                x: snap(position.x, 0, 10000), y: snap(position.y, 0, 10000),
                width: snap(card.width, 240, 1600), height: snap(card.height, 160, 1200),
              })}
              onResize={(_event, _direction, ref) => setResizePreview({
                id: card.id, width: ref.offsetWidth, height: ref.offsetHeight,
              })}
              onResizeStop={(_event, _direction, ref, _delta, position) => {
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
                    <span className="dashboard-grip" aria-hidden="true">⠿</span><span className="dashboard-card-label">Card</span>
                  </div>
                  <Button variant="ghost" size="icon-xs" aria-label={`Remove ${card.title || "untitled card"}`} title="Remove card" onClick={() => void removeCard(card.id)}>×</Button>
                </CardHeader>}
                <CardContent className="dashboard-card-content">{isEditing ? <Input key={`${card.id}-${card.title}`} defaultValue={card.title} placeholder="Untitled card" aria-label="Card title" maxLength={120} className="dashboard-card-title" disabled={saveState === "saving"}
                  onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur() }}
                  onBlur={(event) => {
                    const title = event.currentTarget.value.trim() || "Untitled card"
                    event.currentTarget.value = title
                    if (title !== card.title) void patchCard(card.id, { title })
                  }} /> : <h2 className="dashboard-card-title">{card.title}</h2>}</CardContent>
                {isEditing && <CardFooter className="dashboard-card-footer">Drag the top edge · Resize from the corner</CardFooter>}
              </Card>
              {isEditing && <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
                <span className="rounded-md bg-slate-950/90 px-2.5 py-1 font-mono text-xs font-semibold tabular-nums text-white shadow-lg ring-1 ring-white/20" aria-label={`${resizePreview?.id === card.id ? resizePreview.width : card.width} pixels wide by ${resizePreview?.id === card.id ? resizePreview.height : card.height} pixels high`}>
                  {resizePreview?.id === card.id ? resizePreview.width : card.width}x{resizePreview?.id === card.id ? resizePreview.height : card.height}
                </span>
              </div>}
            </Rnd>
          ))}
        </div>
      </div>
    </main>
  )
}
