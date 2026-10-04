import { StorageError } from "@/lib/storage-error"
import { notFound, redirect } from "next/navigation"
import { requireSession } from "@/lib/auth"
import { boardHref } from "@/lib/board"
import { getBoardSnapshot } from "@/lib/board-store"
import { BoardRouteSnapshot } from "@/components/board-route-snapshot"

export default async function BoardPage({ params }: { params: Promise<{ boardId: string }> }) {
  const { boardId } = await params
  const session = await requireSession(boardHref(boardId))
  const snapshot = await getBoardSnapshot(session.user!.id, boardId, "googleVerified" in session.user! && session.user!.googleVerified === true).catch(error => {
    if (error instanceof StorageError && error.status === 401) redirect(`/login?reauth=1&callbackUrl=${encodeURIComponent(boardHref(boardId))}`)
    throw error
  })
  if (!snapshot) notFound()
  return <BoardRouteSnapshot snapshot={snapshot} />
}
