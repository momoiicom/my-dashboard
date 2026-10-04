import { isBoardId } from "@/lib/board"
import { moveCard } from "@/lib/card-store"
import {
  browserRoute,
  jsonBody,
  objectBody,
  storageResponse,
} from "@/lib/card-route"
import { StorageError } from "@/lib/storage-error"

export const runtime = "nodejs"

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  return browserRoute(request, async (ownerId) => {
    const body = await jsonBody(request)
    if (
      !objectBody(body, ["sourceBoardId", "destinationBoardId"]) ||
      !isBoardId(body.sourceBoardId) ||
      !isBoardId(body.destinationBoardId)
    )
      throw new StorageError(400, "Invalid board transfer")
    const { id } = await context.params
    return storageResponse(
      await moveCard(ownerId, id, {
        sourceBoardId: body.sourceBoardId,
        destinationBoardId: body.destinationBoardId,
      })
    )
  })
}
