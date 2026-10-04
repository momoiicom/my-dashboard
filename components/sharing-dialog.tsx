"use client"

import { useEffect, useRef, useState } from "react"
import { boardHref, type BoardRecord } from "@/lib/board"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"

type Share = { id: string; email: string; name: string | null; status: "pending" | "active" }
export function SharingDialog({ board, onClose }: { board: BoardRecord; onClose: () => void }) {
  const [shares, setShares] = useState<Share[]>([])
  const [email, setEmail] = useState("")
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState("")
  const [copied, setCopied] = useState(false)
  const requestController = useRef<AbortController | null>(null)
  const endpoint = `/api/boards/${encodeURIComponent(board.id)}/shares`
  useEffect(() => {
    const controller = new AbortController()
    requestController.current = controller
    void fetch(endpoint, { cache: "no-store", signal: controller.signal }).then(async response => {
      const result = await response.json()
      if (controller.signal.aborted) return
      if (!response.ok) throw new Error(result.error || "Could not load access.")
      setShares(result.shares)
    }).catch(cause => { if (!controller.signal.aborted) setError(cause.message) }).finally(() => { if (!controller.signal.aborted) setBusy(false) })
    return () => requestController.current?.abort()
  }, [endpoint])
  async function change(method: "POST" | "DELETE", id?: string) {
    if (busy) return
    setBusy(true)
    setError("")
    const controller = new AbortController()
    requestController.current = controller
    try {
      const response = await fetch(id ? `${endpoint}/${encodeURIComponent(id)}` : endpoint, {
        method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(id ? {} : { email }), signal: controller.signal,
      })
      const result = await response.json()
      if (controller.signal.aborted) return
      if (!response.ok) throw new Error(result.error || "Could not update access.")
      const refreshed = await fetch(endpoint, { cache: "no-store", signal: controller.signal })
      const access = await refreshed.json()
      if (controller.signal.aborted) return
      if (!refreshed.ok) throw new Error(access.error || "Could not reload access.")
      setShares(access.shares)
      if (!id) setEmail("")
    } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not update access.") }
    finally { if (!controller.signal.aborted) setBusy(false) }
  }
  return <Dialog open onOpenChange={open => { if (!open) { requestController.current?.abort(); onClose() } }}>
    <DialogContent><DialogHeader><DialogTitle>Sharing · {board.name}</DialogTitle><DialogDescription>Invited accounts see live content and save their own layout. Send the board link yourself.</DialogDescription></DialogHeader>
      <form className="sharing-add" onSubmit={event => { event.preventDefault(); void change("POST") }}>
        <label>Email address<Input type="email" autoFocus required value={email} disabled={busy} onChange={event => setEmail(event.target.value)} /></label>
        <Button type="submit" disabled={busy}>Add access</Button>
      </form>
      <p className="text-sm text-muted-foreground">You own this board. Your access cannot be removed.</p>
      <ul className="sharing-list" aria-label="Board access">{shares.map(share => <li key={share.id}>
        <div><strong>{share.name || share.email}</strong>{share.name && <span>{share.email}</span>}<span>{share.status === "active" ? "Active" : "Pending registration or sign-in"}</span></div>
        <Button variant="outline" size="sm" disabled={busy} aria-label={`Remove access for ${share.email}`} onClick={() => void change("DELETE", share.id)}>Remove access</Button>
      </li>)}</ul>
      {busy && <p role="status">Updating access…</p>}
      {error && <p role="alert" className="text-destructive">{error}</p>}
      <Button variant="outline" onClick={() => { void navigator.clipboard.writeText(new URL(boardHref(board.id), window.location.origin).href).then(() => setCopied(true), () => setError("Could not copy the link. Copy this board’s address from your browser.")) }}>{copied ? "Link copied" : "Copy board link"}</Button>
    </DialogContent>
  </Dialog>
}
