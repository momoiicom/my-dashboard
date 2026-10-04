import "server-only"
import type { Prisma } from "@/generated/prisma/client"
import { parseBotDocument } from "@/lib/bot-document"
import { requireBoard } from "@/lib/board-store"
import type { MoveInput, MoveResult } from "@/lib/board"
import { prisma } from "@/lib/prisma"
import { retryWrite, StorageError } from "@/lib/storage-error"
import type { CardInput, CardPatch, CardRecord } from "@/lib/dashboard-card"

export const cardSelect = {
  id: true,
  boardId: true,
  membershipRevision: true,
  title: true,
  kind: true,
  x: true,
  y: true,
  width: true,
  height: true,
  externalKey: true,
  payload: true,
  acceptedAt: true,
  contentRevision: true,
} satisfies Prisma.DashboardCardSelect
export function serializeCard(
  card: Prisma.DashboardCardGetPayload<{ select: typeof cardSelect }>
): CardRecord {
  return {
    id: card.id,
    boardId: card.boardId,
    membershipRevision: card.membershipRevision,
    title: card.title,
    kind: card.kind,
    x: card.x,
    y: card.y,
    width: card.width,
    height: card.height,
    externalKey: card.externalKey,
    contentRevision: card.contentRevision,
    payload:
      card.payload === null ? null : parseBotDocument(JSON.parse(card.payload)),
    acceptedAt: card.acceptedAt?.toISOString() ?? null,
  }
}

export async function createCard(
  ownerId: string,
  boardId: string,
  input: CardInput
) {
  return retryWrite(() =>
    prisma.$transaction(async (tx) => {
      await requireBoard(tx, ownerId, boardId)
      return serializeCard(
        await tx.dashboardCard.create({
          data: { ...input, ownerId, boardId },
          select: cardSelect,
        })
      )
    })
  )
}

async function requireMembership(
  tx: Prisma.TransactionClient,
  ownerId: string,
  boardId: string,
  id: string,
  membershipRevision: number
) {
  await requireBoard(tx, ownerId, boardId)
  const card = await tx.dashboardCard.findFirst({
    where: { id, ownerId },
    select: cardSelect,
  })
  if (!card) throw new StorageError(404, "Card not found")
  if (
    card.boardId !== boardId ||
    card.membershipRevision !== membershipRevision
  )
    throw new StorageError(409, "Card has moved; reload the board")
  return card
}

export async function patchCard(
  ownerId: string,
  boardId: string,
  id: string,
  membershipRevision: number,
  patch: CardPatch
) {
  return retryWrite(() =>
    prisma.$transaction(async (tx) => {
      const previous = await requireMembership(
        tx,
        ownerId,
        boardId,
        id,
        membershipRevision
      )
      if ("title" in patch && previous.externalKey !== null)
        throw new StorageError(403, "Bot card content is read-only")
      const updated = await tx.dashboardCard.updateMany({
        where: { id, ownerId, boardId, membershipRevision },
        data: patch,
      })
      if (!updated.count)
        throw new StorageError(409, "Card has moved; reload the board")
      return serializeCard(
        await tx.dashboardCard.findUniqueOrThrow({
          where: { id },
          select: cardSelect,
        })
      )
    })
  )
}

export async function deleteCard(
  ownerId: string,
  boardId: string,
  id: string,
  membershipRevision: number
) {
  return retryWrite(() =>
    prisma.$transaction(async (tx) => {
      await requireMembership(tx, ownerId, boardId, id, membershipRevision)
      const deleted = await tx.dashboardCard.deleteMany({
        where: { id, ownerId, boardId, membershipRevision },
      })
      if (!deleted.count)
        throw new StorageError(409, "Card has moved; reload the board")
      return { deleted: true }
    })
  )
}

export async function nextCardY(
  tx: Prisma.TransactionClient,
  ownerId: string,
  boardId: string
) {
  const geometry = await tx.dashboardCard.findMany({
    where: { ownerId, boardId },
    select: { y: true, height: true },
  })
  const y = geometry.reduce(
    (bottom, card) => Math.max(bottom, card.y + card.height + 20),
    20
  )
  if (y > 10000)
    throw new StorageError(
      409,
      "No space below existing cards. Move or remove cards, then retry."
    )
  return y
}

export async function moveCard(
  ownerId: string,
  id: string,
  input: MoveInput
): Promise<MoveResult> {
  return retryWrite(() =>
    prisma.$transaction(async (tx) => {
      const { sourceBoardId, destinationBoardId } = input
      const previous = await tx.dashboardCard.findFirst({
        where: { id, ownerId },
        select: { ...cardSelect, lastMoveSourceBoardId: true },
      })
      if (!previous) throw new StorageError(404, "Card not found")
      await requireBoard(tx, ownerId, destinationBoardId)
      if (
        previous.boardId === destinationBoardId &&
        previous.lastMoveSourceBoardId === sourceBoardId
      ) {
        return { card: serializeCard(previous), moved: false }
      }
      await requireBoard(tx, ownerId, sourceBoardId)
      if (previous.boardId !== sourceBoardId)
        throw new StorageError(409, "Card has moved; reload the board")
      if (sourceBoardId === destinationBoardId)
        return { card: serializeCard(previous), moved: false }
      const y = await nextCardY(tx, ownerId, destinationBoardId)
      const updated = await tx.dashboardCard.updateMany({
        where: {
          id,
          ownerId,
          boardId: sourceBoardId,
          membershipRevision: previous.membershipRevision,
        },
        data: {
          boardId: destinationBoardId,
          membershipRevision: { increment: 1 },
          lastMoveSourceBoardId: sourceBoardId,
          x: 20,
          y,
        },
      })
      if (!updated.count)
        throw new StorageError(409, "Card has moved; reload the board")
      const card = await tx.dashboardCard.findUniqueOrThrow({
        where: { id },
        select: cardSelect,
      })
      return { card: serializeCard(card), moved: true }
    })
  )
}
