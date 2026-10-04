"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from "react"
import { Plus, Pencil, Trash2 } from "lucide-react"
import { Dashboard } from "@/components/dashboard"
import { PresentationStage } from "@/components/presentation-stage"
import { usePresentation } from "@/components/use-presentation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { boardHref, type BoardRecord, type BoardSnapshot, type WorkspaceSnapshot } from "@/lib/board"

const WorkspaceContext = createContext<((snapshot: BoardSnapshot, path: string) => void) | null>(null)
export function useBoardRegistration() {
  const register = useContext(WorkspaceContext)
  if (!register) throw new Error("Board route requires the workspace layout")
  return register
}

type BoardDialog = { kind: "create" } | { kind: "rename" | "delete"; board: BoardRecord }
export function BoardWorkspace({ initialWorkspace, name, image, localUiMode, children }: {
  initialWorkspace: WorkspaceSnapshot; name: string; image?: string | null; localUiMode: boolean; children: React.ReactNode
}) {
  const router = useRouter()
  const pathname = usePathname()
  const host = useRef<HTMLDivElement>(null)
  const expectedPath = useRef<string | null>(null)
  const focusPlay = useRef(false)
  const firstBoard = useRef(true)
  const presenting = useRef(false)
  const metadataVersion = useRef(0)
  const boardMutationPending = useRef(false)
  const [onboardingBoardId, setOnboardingBoardId] = useState<string | null>(null)
  const [workspace, setWorkspace] = useState(initialWorkspace)
  const [snapshot, setSnapshot] = useState<BoardSnapshot | null>(null)
  const [error, setError] = useState("")
  const [dialog, setDialog] = useState<BoardDialog | null>(null)
  const [boardName, setBoardName] = useState("")
  const [dialogError, setDialogError] = useState("")
  const [pending, setPending] = useState(false)
  const presentation = usePresentation({ host,
    onAdvance: useCallback((next: BoardSnapshot) => { expectedPath.current = boardHref(next.board.id) }, []),
    onStop: useCallback((last: BoardSnapshot, message?: string, deleted?: boolean) => {
      focusPlay.current = true
      setSnapshot(last)
      setError(message || "")
      const href = boardHref(deleted ? workspace.originalBoardId : last.board.id)
      expectedPath.current = href
      router.replace(href, { scroll: false })
      router.refresh()
    }, [router, workspace.originalBoardId]),
  })
  const { active, stop } = presentation
  useLayoutEffect(() => { presenting.current = active }, [active])
  const register = useCallback((incoming: BoardSnapshot, path: string) => {
    if (presenting.current || path !== window.location.pathname || path !== boardHref(incoming.board.id)) return
    if (firstBoard.current) {
      firstBoard.current = false
      if (incoming.board.isOriginal && incoming.cards.length === 0) setOnboardingBoardId(incoming.board.id)
    }
    setSnapshot(incoming)
    setWorkspace(current => ({ ...current, boards: current.boards.some(board => board.id === incoming.board.id) ? current.boards.map(board => board.id === incoming.board.id ? incoming.board : board) : [...current.boards, incoming.board] }))
  }, [])

  useEffect(() => {
    if (active && expectedPath.current !== window.location.pathname) stop(false)
  }, [pathname, active, snapshot, stop])
  useEffect(() => {
    if (!active && snapshot && boardHref(snapshot.board.id) === pathname && focusPlay.current) {
      const play = host.current?.querySelector<HTMLButtonElement>('[aria-label="Play slideshow"]')
      if (play) { focusPlay.current = false; play.focus() }
    }
  }, [active, snapshot, pathname])
  useEffect(() => {
    const selected = host.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
    selected?.scrollIntoView({ block: "nearest", inline: "nearest" })
  }, [pathname, workspace.boards])
  useEffect(() => {
    let live = true
    let refreshing = false
    const controller = new AbortController()
    const refresh = async () => {
      if (document.hidden || refreshing || boardMutationPending.current) return
      refreshing = true
      const version = metadataVersion.current
      try {
        const response = await fetch("/api/boards", { cache: "no-store", signal: controller.signal })
        if (!response.ok) return
        const next = await response.json() as WorkspaceSnapshot
        if (live && version === metadataVersion.current && !boardMutationPending.current) setWorkspace(next)
      } catch {}
      finally { refreshing = false }
    }
    const timer = setInterval(refresh, 3000)
    return () => { live = false; controller.abort(); clearInterval(timer) }
  }, [])

  function openDialog(next: BoardDialog) {
    setBoardName(next.kind === "rename" ? next.board.name : "")
    setDialogError("")
    setDialog(next)
  }
  async function saveBoard(event: React.FormEvent) {
    event.preventDefault()
    if (!dialog || pending) return
    const command = dialog
    boardMutationPending.current = true
    metadataVersion.current += 1
    setPending(true)
    setDialogError("")
    try {
      const response = await fetch(command.kind === "create" ? "/api/boards" : `/api/boards/${encodeURIComponent(command.board.id)}`, {
        method: command.kind === "create" ? "POST" : command.kind === "rename" ? "PATCH" : "DELETE",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify(command.kind === "delete" ? {} : { name: boardName }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : "Could not update board. Please try again.")
      if (command.kind === "delete") {
        setWorkspace(current => ({ ...current, boards: current.boards.filter(board => board.id !== command.board.id) }))
        if (pathname === boardHref(command.board.id)) router.push(boardHref(result.originalBoardId))
      } else {
        const board = result.board as BoardRecord
        setWorkspace(current => ({ ...current, boards: command.kind === "create" ? [...current.boards, board] : current.boards.map(existing => existing.id === board.id ? board : existing) }))
        setSnapshot(current => current?.board.id === board.id ? { ...current, board } : current)
        if (command.kind === "create") router.push(boardHref(board.id))
      }
      setDialog(null)
    } catch (cause) { setDialogError(cause instanceof Error ? cause.message : "Could not update board.") }
    finally {
      metadataVersion.current += 1
      boardMutationPending.current = false
      setPending(false)
    }
  }
  const selected = snapshot && boardHref(snapshot.board.id) === pathname ? snapshot : null
  const boardToolbar = <>
    <nav className="board-tabs" role="tablist" aria-label="Boards">
      {workspace.boards.map((board, index) => <Link key={board.id} href={boardHref(board.id)} role="tab" aria-selected={selected?.board.id === board.id} tabIndex={selected?.board.id === board.id ? 0 : -1} className="board-tab" scroll={false} onKeyDown={event => {
        const count = workspace.boards.length
        const nextIndex = event.key === "ArrowRight" ? (index + 1) % count : event.key === "ArrowLeft" ? (index + count - 1) % count : event.key === "Home" ? 0 : event.key === "End" ? count - 1 : null
        if (nextIndex === null) return
        event.preventDefault()
        const next = workspace.boards[nextIndex]
        host.current?.querySelector<HTMLAnchorElement>(`[href="${boardHref(next.id)}"]`)?.focus()
        router.push(boardHref(next.id), { scroll: false })
      }}>{board.name}</Link>)}
    </nav>
    <div className="board-tools">
      <Button size="icon-sm" variant="ghost" aria-label="Create board" title="Create board" onClick={() => openDialog({ kind: "create" })}><Plus /></Button>
      <Button size="icon-sm" variant="ghost" aria-label="Rename board" title="Rename board" disabled={!selected} onClick={() => selected && openDialog({ kind: "rename", board: selected.board })}><Pencil /></Button>
      <Button size="icon-sm" variant="ghost" aria-label="Delete board" title={selected?.board.isOriginal ? "The original board cannot be deleted" : "Delete board"} disabled={!selected || selected.board.isOriginal} onClick={() => selected && openDialog({ kind: "delete", board: selected.board })}><Trash2 /></Button>
    </div>
  </>
  return <WorkspaceContext.Provider value={register}>
    <div ref={host} className="board-workspace" data-presenting={active}>
      {children}
      {error && !active && <div role="alert" className="board-workspace-error">{error}<button onClick={() => setError("")} aria-label="Dismiss error">×</button></div>}
      {!active && (selected ? <Dashboard key={selected.board.id} boardId={selected.board.id} initialCards={selected.cards} boards={workspace.boards} name={name} image={image} localUiMode={localUiMode} boardToolbar={boardToolbar} initialConnectOpen={onboardingBoardId === selected.board.id} onConnectClosed={() => setOnboardingBoardId(null)} onPlay={cards => {
        setError("")
        expectedPath.current = pathname
        presentation.start({ board: selected.board, cards }, workspace.boards.map(board => board.id))
      }} /> : <div className="board-loading" role="status">Loading board…</div>)}
      {active && <PresentationStage state={presentation.state} stop={() => presentation.stop()} reveal={presentation.reveal} focusStop={presentation.focusStop} />}
    </div>
    <Dialog open={dialog !== null} onOpenChange={open => { if (!open && !pending) setDialog(null) }}>
      <DialogContent><form onSubmit={saveBoard} className="board-dialog-form"><DialogHeader><DialogTitle>{dialog?.kind === "create" ? "Create board" : dialog?.kind === "rename" ? "Rename board" : "Delete board?"}</DialogTitle><DialogDescription>{dialog?.kind === "delete" ? `“${dialog.board.name}” and all cards on this board will be permanently deleted.` : "Give this board a name you and your bots can recognize."}</DialogDescription></DialogHeader>
        {dialog?.kind !== "delete" && <label className="board-name-label">Board name<Input autoFocus value={boardName} onChange={event => setBoardName(event.target.value)} required maxLength={240} disabled={pending} /></label>}
        {dialogError && <p role="alert" className="text-destructive">{dialogError}</p>}
        <DialogFooter><Button type="button" variant="outline" disabled={pending} onClick={() => setDialog(null)}>Cancel</Button><Button type="submit" variant={dialog?.kind === "delete" ? "destructive" : "default"} disabled={pending}>{pending ? "Saving…" : dialog?.kind === "delete" ? "Delete board" : "Save board"}</Button></DialogFooter>
      </form></DialogContent>
    </Dialog>
  </WorkspaceContext.Provider>
}
