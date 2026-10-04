import { browserRoute, jsonBody, objectBody, storageResponse } from "@/lib/card-route"
import { addShare, listShares } from "@/lib/board-sharing"
import { StorageError } from "@/lib/storage-error"

export const runtime = "nodejs"
type Context = { params: Promise<{ boardId: string }> }
export async function GET(request: Request, context: Context) {
  return browserRoute(request, async userId => storageResponse({ shares: await listShares(userId, (await context.params).boardId) }))
}
export async function POST(request: Request, context: Context) {
  return browserRoute(request, async userId => {
    const body = await jsonBody(request)
    if (!objectBody(body, ["email"])) throw new StorageError(400, "Invalid invitation")
    return storageResponse({ share: await addShare(userId, (await context.params).boardId, body.email) })
  })
}
