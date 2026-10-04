import { deleteBoard, renameBoard } from "@/lib/board-store"
import {
  browserRoute,
  jsonBody,
  objectBody,
  storageResponse,
} from "@/lib/card-route"
import { StorageError } from "@/lib/storage-error"

export const runtime = "nodejs"
type Context = { params: Promise<{ boardId: string }> }

export async function PATCH(request: Request, context: Context) {
  return browserRoute(request, async (ownerId) => {
    const body = await jsonBody(request)
    if (!objectBody(body, ["name"]))
      throw new StorageError(400, "Expected a board name")
    const { boardId } = await context.params
    return storageResponse({
      board: await renameBoard(ownerId, boardId, body.name),
    })
  })
}

export async function DELETE(request: Request, context: Context) {
  return browserRoute(request, async (ownerId) => {
    if (!objectBody(await jsonBody(request), []))
      throw new StorageError(400, "Expected an empty object")
    const { boardId } = await context.params
    return storageResponse(await deleteBoard(ownerId, boardId))
  })
}
