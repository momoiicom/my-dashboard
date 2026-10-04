import { getBoardSnapshot } from "@/lib/board-store"
import { createCard } from "@/lib/card-store"
import { browserRoute, jsonBody, storageResponse } from "@/lib/card-route"
import { parseCardInput } from "@/lib/dashboard-card"
import { StorageError } from "@/lib/storage-error"

export const runtime = "nodejs"
type Context = { params: Promise<{ boardId: string }> }

export async function GET(request: Request, context: Context) {
  return browserRoute(request, async (ownerId, verifiedGoogle) => {
    const { boardId } = await context.params
    const snapshot = await getBoardSnapshot(ownerId, boardId, verifiedGoogle)
    if (!snapshot) throw new StorageError(404, "Board not found")
    return storageResponse(snapshot)
  })
}

export async function POST(request: Request, context: Context) {
  return browserRoute(request, async (ownerId) => {
    const input = parseCardInput(await jsonBody(request))
    if (!input) throw new StorageError(400, "Invalid card")
    const { boardId } = await context.params
    return storageResponse(
      { card: await createCard(ownerId, boardId, input) },
      201
    )
  })
}
