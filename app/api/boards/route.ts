import { createBoard, getWorkspaceSnapshot } from "@/lib/board-store"
import {
  browserRoute,
  jsonBody,
  objectBody,
  storageResponse,
} from "@/lib/card-route"
import { StorageError } from "@/lib/storage-error"

export const runtime = "nodejs"

export async function GET() {
  return browserRoute(undefined, async (ownerId) =>
    storageResponse(await getWorkspaceSnapshot(ownerId))
  )
}

export async function POST(request: Request) {
  return browserRoute(request, async (ownerId) => {
    const body = await jsonBody(request)
    if (!objectBody(body, ["name"]))
      throw new StorageError(400, "Expected a board name")
    return storageResponse(
      { board: await createBoard(ownerId, body.name) },
      201
    )
  })
}
