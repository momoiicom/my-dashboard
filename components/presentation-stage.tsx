"use client"

import { useEffect, useRef, useState } from "react"
import { Square } from "lucide-react"
import { BotCardRenderer } from "@/components/bot-card-renderer"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { fitCards, type PresentationState } from "@/lib/presentation"
import type { BoardSnapshot } from "@/lib/board"

function BoardPanel({ snapshot, width, height, className = "", hidden }: { snapshot: BoardSnapshot; width: number; height: number; className?: string; hidden: boolean }) {
  const fit = fitCards(snapshot.cards, width, height, width < 600 ? 16 : 24)
  return <section inert aria-hidden={className === "presentation-preloaded"} aria-label={snapshot.board.name} data-board-id={snapshot.board.id} className={`presentation-panel ${className}`} style={{ animationPlayState: hidden ? "paused" : "running" }}>
    {!snapshot.cards.length && <p className="presentation-empty">{snapshot.board.name}</p>}
    <div className="presentation-canvas" style={{ transform: `translate(${fit.x}px, ${fit.y}px) scale(${fit.scale})` }}>
      {snapshot.cards.map(card => <div key={card.id} className="dashboard-card presentation-card" style={{ left: card.x, top: card.y, width: card.width, height: card.height }}>
        <Card className="dashboard-card-inner dashboard-card-view" size="sm"><CardContent className="dashboard-card-content"><h2 className="dashboard-card-title">{card.title}</h2>{card.payload && <BotCardRenderer document={card.payload} acceptedAt={card.acceptedAt} />}</CardContent></Card>
      </div>)}
    </div>
  </section>
}

export function PresentationStage({ state, stop, reveal, focusStop }: { state: PresentationState; stop: () => void; reveal: () => void; focusStop: (focused: boolean) => void }) {
  const stage = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  useEffect(() => {
    if (!stage.current) return
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }))
    observer.observe(stage.current)
    return () => observer.disconnect()
  }, [])
  const phase = state.phase
  if (phase.kind === "idle") return null
  const sliding = phase.kind === "sliding"
  return <div ref={stage} className="presentation-stage" data-phase={phase.kind} data-hidden={state.hidden} aria-label="Slideshow" onPointerMove={reveal} onTouchStart={reveal} onTouchMove={reveal} onFocusCapture={reveal} onWheel={event => { event.preventDefault(); reveal() }}>
    <BoardPanel key={phase.current.board.id} snapshot={phase.current} {...size} hidden={state.hidden} className={sliding ? "presentation-outgoing" : ""} />
    {sliding ? <BoardPanel key={phase.next.board.id} snapshot={phase.next} {...size} hidden={state.hidden} className="presentation-incoming" /> : state.prefetched && <BoardPanel key={state.prefetched.board.id} snapshot={state.prefetched} {...size} hidden={state.hidden} className="presentation-preloaded" />}
    <div className="presentation-shield" onPointerDown={reveal} />
    <Button variant="secondary" size="icon" className={`presentation-stop ${state.controlsVisible ? "" : "presentation-stop-hidden"}`} aria-label="Stop slideshow" title="Stop slideshow" onClick={stop} onFocus={() => focusStop(true)} onBlur={() => focusStop(false)}><Square aria-hidden="true" /></Button>
  </div>
}
