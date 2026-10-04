import { redirect } from "next/navigation"
import { connection } from "next/server"
import { requireSession } from "@/lib/auth"
import { boardHref } from "@/lib/board"
import { ensureOriginalBoard } from "@/lib/board-store"

export default async function HomePage() {
  await connection()
  const session = await requireSession()
  const board = await ensureOriginalBoard(session.user!.id)
  redirect(boardHref(board.id))
}
