import "server-only"
import { createHash } from "node:crypto"
import type { Prisma } from "@/generated/prisma/client"
import type { BoardSnapshot } from "@/lib/board"
import { isBoardId } from "@/lib/board"
import { cardSelect, serializeCard } from "@/lib/card-store"
import { StorageError } from "@/lib/storage-error"
import { readAppearance } from "@/lib/appearance-store"

export async function bindBoardGrants(tx: Prisma.TransactionClient, userId: string, verifiedGoogle: boolean, boardId?: string) {
  if (!verifiedGoogle) return
  const user = await tx.user.findUnique({ where: { id: userId }, select: { googleVerifiedEmail: true } })
  if (!user?.googleVerifiedEmail) return
  const pending = await tx.boardGrant.findMany({ where: { email: user.googleVerifiedEmail, userId: null, ...(boardId ? { boardId } : {}) }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] })
  for (const grant of pending) {
    const existing = await tx.boardGrant.findUnique({ where: { boardId_userId: { boardId: grant.boardId, userId } } })
    if (existing) {
      await tx.boardGrant.delete({ where: { id: grant.id } })
      await tx.boardGrant.update({ where: { id: existing.id }, data: { email: user.googleVerifiedEmail } })
    } else await tx.boardGrant.update({ where: { id: grant.id }, data: { userId } })
  }
}

export async function requireBoardAccess(tx: Prisma.TransactionClient, userId: string, boardId: string, verifiedGoogle = false) {
  const board = isBoardId(boardId) ? await tx.board.findUnique({ where: { id: boardId }, include: { owner: { select: { name: true, email: true } } } }) : null
  if (!board) throw new StorageError(404, "Board not found")
  if (board.ownerId === userId) return { role: "author" as const, board, userId }
  const user = await tx.user.findUnique({ where: { id: userId }, select: { email: true, googleVerifiedEmail: true } })
  if (!verifiedGoogle || !user?.googleVerifiedEmail) {
    const email = user?.email?.trim().toLowerCase()
    const invitation = await tx.boardGrant.findFirst({ where: { boardId, OR: [{ userId }, ...(email ? [{ email, userId: null }] : [])] }, select: { id: true } })
    if (invitation) throw new StorageError(401, "Sign in with Google again to verify shared-board access")
    throw new StorageError(404, "Board not found")
  }
  await bindBoardGrants(tx, userId, verifiedGoogle)
  const grant = await tx.boardGrant.findUnique({ where: { boardId_userId: { boardId, userId } } })
  if (!grant) throw new StorageError(404, "Board not found")
  return { role: "viewer" as const, board, userId }
}

export async function effectiveBoardSnapshot(tx: Prisma.TransactionClient, access: Awaited<ReturnType<typeof requireBoardAccess>>): Promise<BoardSnapshot> {
  const { board, userId, role } = access
  const source = await tx.dashboardCard.findMany({ where: { boardId: board.id, ownerId: board.ownerId }, select: cardSelect, orderBy: [{ createdAt: "asc" }, { id: "asc" }] })
  const overrides = role === "viewer" ? await tx.cardLayout.findMany({ where: { userId, boardId: board.id } }) : []
  const byId = new Map(overrides.map(item => [item.cardId, item]))
  const cards = source.map(card => {
    const override = byId.get(card.id)
    return { ...serializeCard(card), ...(override ? { x: override.x, y: override.y, width: override.width, height: override.height } : {}), layoutSource: override ? "personal" as const : "author" as const }
  })
  const layoutToken = createHash("sha256").update(JSON.stringify(cards.map(card => [card.id, card.membershipRevision, card.x, card.y, card.width, card.height, card.layoutSource]))).digest("hex")
  return { board: { id: board.id, name: board.name, isOriginal: role === "author" && board.originalOwnerId !== null, createdAt: board.createdAt.toISOString(), role, author: board.owner }, cards, layoutToken, role, appearance: await readAppearance(tx, access) }
}
