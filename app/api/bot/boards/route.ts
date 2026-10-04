import { isBoardId, parseBoardName } from "@/lib/board"
import { getWorkspaceSnapshot } from "@/lib/board-store"
import {
  BotHttpError,
  botError,
  botResponse,
  requireBotOwner,
} from "@/lib/bot-service"

export const runtime = "nodejs"

export async function GET(request: Request) {
  try {
    const ownerId = await requireBotOwner(request)
    const query = new URL(request.url).searchParams
    const id = query.get("id")
    const name = query.get("name")
    if (
      (id !== null && name !== null) ||
      query.getAll("id").length > 1 ||
      query.getAll("name").length > 1
    )
      throw new BotHttpError(400, "Filter by either name or id")
    if (id !== null && !isBoardId(id))
      throw new BotHttpError(400, "Invalid board ID")
    const normalized = name === null ? null : parseBoardName(name)
    if (name !== null && !normalized)
      throw new BotHttpError(400, "Invalid board name")
    const workspace = await getWorkspaceSnapshot(ownerId, false)
    return botResponse({
      ...workspace,
      boards: workspace.boards.filter(
        (board) =>
          (id === null || board.id === id) &&
          (!normalized || board.name.toLowerCase() === normalized.nameKey)
      ),
    })
  } catch (error) {
    return botError(error)
  }
}
