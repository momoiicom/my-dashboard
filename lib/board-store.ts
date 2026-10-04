import "server-only"
import { randomBytes } from "node:crypto"
import type { Prisma } from "@/generated/prisma/client"
import type { BoardRecord, BoardSnapshot, WorkspaceSnapshot } from "@/lib/board"
import { isBoardId, parseBoardName } from "@/lib/board"
import { cardSelect, serializeCard } from "@/lib/card-store"
import { prisma } from "@/lib/prisma"
import { retryWrite, StorageError, uniqueConstraint } from "@/lib/storage-error"

const boardSelect = {
  id: true,
  name: true,
  originalOwnerId: true,
  createdAt: true,
} satisfies Prisma.BoardSelect

function serializeBoard(
  board: Prisma.BoardGetPayload<{ select: typeof boardSelect }>
): BoardRecord {
  return {
    id: board.id,
    name: board.name,
    isOriginal: board.originalOwnerId !== null,
    createdAt: board.createdAt.toISOString(),
  }
}

export async function ensureOriginalBoard(
  ownerId: string
): Promise<BoardRecord> {
  return retryWrite(async () => {
    try {
      const board = await prisma.board.upsert({
        where: { originalOwnerId: ownerId },
        create: {
          id: `b_${randomBytes(16).toString("hex")}`,
          ownerId,
          originalOwnerId: ownerId,
          name: "Dashboard",
          nameKey: "dashboard",
        },
        update: {},
        select: boardSelect,
      })
      return serializeBoard(board)
    } catch (error) {
      if (!uniqueConstraint(error)) throw error
      const board = await prisma.board.findUnique({
        where: { originalOwnerId: ownerId },
        select: boardSelect,
      })
      if (!board) throw error
      return serializeBoard(board)
    }
  })
}

export async function getWorkspaceSnapshot(
  ownerId: string
): Promise<WorkspaceSnapshot> {
  const original = await ensureOriginalBoard(ownerId)
  const boards = await prisma.board.findMany({
    where: { ownerId },
    select: boardSelect,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  })
  return { boards: boards.map(serializeBoard), originalBoardId: original.id }
}

export async function getBoardSnapshot(
  ownerId: string,
  boardId: string
): Promise<BoardSnapshot | null> {
  if (!isBoardId(boardId)) return null
  return prisma.$transaction(async (tx) => {
    const board = await tx.board.findFirst({
      where: { id: boardId, ownerId },
      select: boardSelect,
    })
    if (!board) return null
    const cards = await tx.dashboardCard.findMany({
      where: { ownerId, boardId },
      select: cardSelect,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    })
    return { board: serializeBoard(board), cards: cards.map(serializeCard) }
  })
}

export async function requireBoard(
  tx: Prisma.TransactionClient,
  ownerId: string,
  boardId: string
) {
  const board = isBoardId(boardId)
    ? await tx.board.findFirst({
        where: { id: boardId, ownerId },
        select: boardSelect,
      })
    : null
  if (!board) throw new StorageError(404, "Board not found")
  return board
}

export async function createBoard(
  ownerId: string,
  value: unknown
): Promise<BoardRecord> {
  const name = parseBoardName(value)
  if (!name) throw new StorageError(400, "Invalid board name")
  await ensureOriginalBoard(ownerId)
  try {
    return await retryWrite(() =>
      prisma.$transaction(async (tx) => {
        const latest = await tx.board.findFirst({
          where: { ownerId },
          orderBy: { createdAt: "desc" },
          select: { createdAt: true },
        })
        const createdAt = new Date(Math.max(Date.now(), (latest?.createdAt.getTime() ?? 0) + 1))
        return serializeBoard(
          await tx.board.create({
            data: {
              id: `b_${randomBytes(16).toString("hex")}`,
              ownerId,
              ...name,
              createdAt,
            },
            select: boardSelect,
          })
        )
      })
    )
  } catch (error) {
    if (uniqueConstraint(error))
      throw new StorageError(409, "A board with that name already exists")
    throw error
  }
}

export async function renameBoard(
  ownerId: string,
  boardId: string,
  value: unknown
): Promise<BoardRecord> {
  const name = parseBoardName(value)
  if (!name) throw new StorageError(400, "Invalid board name")
  try {
    return await retryWrite(() =>
      prisma.$transaction(async (tx) => {
        await requireBoard(tx, ownerId, boardId)
        return serializeBoard(
          await tx.board.update({
            where: { ownerId_id: { ownerId, id: boardId } },
            data: name,
            select: boardSelect,
          })
        )
      })
    )
  } catch (error) {
    if (uniqueConstraint(error))
      throw new StorageError(409, "A board with that name already exists")
    throw error
  }
}

export async function deleteBoard(ownerId: string, boardId: string) {
  return retryWrite(() =>
    prisma.$transaction(async (tx) => {
      const board = await requireBoard(tx, ownerId, boardId)
      if (board.originalOwnerId !== null)
        throw new StorageError(409, "The original board cannot be deleted")
      const original = await tx.board.findUniqueOrThrow({
        where: { originalOwnerId: ownerId },
        select: { id: true },
      })
      await tx.board.delete({ where: { ownerId_id: { ownerId, id: boardId } } })
      return { originalBoardId: original.id }
    })
  )
}
