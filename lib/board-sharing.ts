import "server-only"
import { prisma } from "@/lib/prisma"
import { requireBoard } from "@/lib/board-store"
import { bindBoardGrants, effectiveBoardSnapshot, requireBoardAccess } from "@/lib/board-access"
import { retryWrite, StorageError } from "@/lib/storage-error"
import { objectBody } from "@/lib/card-route"

const shareSelect = { id: true, email: true, userId: true, user: { select: { name: true } } } as const
function serializeShare(grant: { id: string; email: string; userId: string | null; user: { name: string | null } | null }) {
  return { id: grant.id, email: grant.email, name: grant.user?.name ?? null, status: grant.userId ? "active" : "pending" }
}

export async function listShares(userId: string, boardId: string) {
  return prisma.$transaction(async tx => {
    await requireBoard(tx, userId, boardId)
    const grants = await tx.boardGrant.findMany({ where: { boardId }, select: shareSelect, orderBy: [{ createdAt: "asc" }, { id: "asc" }] })
    return grants.map(serializeShare)
  })
}

export async function addShare(userId: string, boardId: string, value: unknown) {
  if (typeof value !== "string") throw new StorageError(400, "Invalid email")
  const email = value.trim().toLowerCase()
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new StorageError(400, "Invalid email")
  return retryWrite(() => prisma.$transaction(async tx => {
    await requireBoard(tx, userId, boardId)
    const owner = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true, googleVerifiedEmail: true } })
    if ([owner.email?.trim().toLowerCase(), owner.googleVerifiedEmail].includes(email)) throw new StorageError(409, "This account already owns the board")
    const account = await tx.user.findFirst({ where: { googleVerifiedEmail: email }, select: { id: true } })
    if (account) await bindBoardGrants(tx, account.id, true, boardId)
    const existing = await tx.boardGrant.findUnique({ where: { boardId_email: { boardId, email } }, select: shareSelect })
    if (existing) return serializeShare(existing)
    if (account) {
      const bound = await tx.boardGrant.findUnique({ where: { boardId_userId: { boardId, userId: account.id } }, select: shareSelect })
      if (bound) return serializeShare(await tx.boardGrant.update({ where: { id: bound.id }, data: { email }, select: shareSelect }))
    }
    return serializeShare(await tx.boardGrant.create({ data: { boardId, email, userId: account?.id ?? null }, select: shareSelect }))
  }))
}

export async function revokeShare(userId: string, boardId: string, shareId: string) {
  return retryWrite(() => prisma.$transaction(async tx => {
    await requireBoard(tx, userId, boardId)
    const grant = await tx.boardGrant.findFirst({ where: { id: shareId, boardId }, select: { userId: true } })
    if (grant?.userId) await bindBoardGrants(tx, grant.userId, true, boardId)
    await tx.boardGrant.deleteMany({ where: { id: shareId, boardId } })
    return { deleted: true }
  }))
}

type Position = { cardId: string; x: number; y: number }
function parseLayout(value: unknown): { expectedLayoutToken: string; positions: Position[] } {
  if (!objectBody(value, ["expectedLayoutToken", "positions"]) || typeof value.expectedLayoutToken !== "string" || !/^[a-f0-9]{64}$/.test(value.expectedLayoutToken) || !Array.isArray(value.positions)) throw new StorageError(400, "Invalid layout")
  const positions: Position[] = []
  for (const position of value.positions) {
    if (!objectBody(position, ["cardId", "x", "y"]) || typeof position.cardId !== "string" || !position.cardId || typeof position.x !== "number" || typeof position.y !== "number" || !Number.isInteger(position.x) || !Number.isInteger(position.y) || position.x < 0 || position.x > 10000 || position.y < 0 || position.y > 10000) throw new StorageError(400, "Invalid layout position")
    positions.push({ cardId: position.cardId, x: position.x, y: position.y })
  }
  if (new Set(positions.map(position => position.cardId)).size !== positions.length) throw new StorageError(400, "Duplicate card positions")
  return { expectedLayoutToken: value.expectedLayoutToken, positions }
}

export async function saveBoardLayout(userId: string, boardId: string, verifiedGoogle: boolean, value: unknown) {
  const { expectedLayoutToken, positions } = parseLayout(value)
  return retryWrite(() => prisma.$transaction(async tx => {
    const access = await requireBoardAccess(tx, userId, boardId, verifiedGoogle)
    const snapshot = await effectiveBoardSnapshot(tx, access)
    const cards = new Map(snapshot.cards.map(card => [card.id, card]))
    if (snapshot.layoutToken !== expectedLayoutToken || cards.size !== positions.length || positions.some(position => !cards.has(position.cardId))) throw new StorageError(409, "Layout changed; reload the board and try again")
    for (const position of positions) {
      const card = cards.get(position.cardId)!
      if (access.role === "author") {
        await tx.dashboardCard.update({ where: { id: card.id }, data: { x: position.x, y: position.y } })
      } else {
        const geometry = { x: position.x, y: position.y, width: card.width, height: card.height }
        await tx.cardLayout.upsert({ where: { userId_boardId_cardId: { userId, boardId, cardId: card.id } }, create: { userId, boardId, cardId: card.id, ...geometry }, update: geometry })
      }
    }
    return effectiveBoardSnapshot(tx, access)
  }))
}

export async function resetBoardLayout(userId: string, boardId: string, verifiedGoogle: boolean) {
  return retryWrite(() => prisma.$transaction(async tx => {
    const access = await requireBoardAccess(tx, userId, boardId, verifiedGoogle)
    if (access.role !== "viewer") throw new StorageError(403, "Only viewers have a personal layout to reset")
    await tx.cardLayout.deleteMany({ where: { userId, boardId } })
    return effectiveBoardSnapshot(tx, access)
  }))
}
