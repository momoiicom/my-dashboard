import { notFound } from "next/navigation"
import { requireSession } from "@/lib/auth"
import { boardHref } from "@/lib/board"
import { getBoardSnapshot } from "@/lib/board-store"
import { BoardRouteSnapshot } from "@/components/board-route-snapshot"

export default async function BoardPage({ params }: { params: Promise<{ boardId: string }> }) {
  const { boardId } = await params
  const session = await requireSession(boardHref(boardId))
  const snapshot = await getBoardSnapshot(session.user!.id, boardId)
  if (!snapshot) notFound()
  return <BoardRouteSnapshot snapshot={snapshot} />
}
