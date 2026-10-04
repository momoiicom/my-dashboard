import { deleteCard, patchCard } from "@/lib/card-store"
import {
  browserRoute,
  isMembershipRevision,
  jsonBody,
  objectBody,
  storageResponse,
} from "@/lib/card-route"
import { parseCardInput } from "@/lib/dashboard-card"
import { StorageError } from "@/lib/storage-error"

export const runtime = "nodejs"
type Context = { params: Promise<{ boardId: string; id: string }> }

export async function PATCH(request: Request, context: Context) {
  return browserRoute(request, async (ownerId, verifiedGoogle) => {
    const body = await jsonBody(request)
    if (
      !objectBody(body, ["patch", "membershipRevision"]) ||
      !isMembershipRevision(body.membershipRevision)
    )
      throw new StorageError(400, "Invalid card mutation")
    const patch = parseCardInput(body.patch, true)
    if (!patch) throw new StorageError(400, "Invalid card patch")
    const { boardId, id } = await context.params
    return storageResponse({
      card: await patchCard(
        ownerId,
        boardId,
        id,
        body.membershipRevision,
        patch,
        verifiedGoogle
      ),
    })
  })
}

export async function DELETE(request: Request, context: Context) {
  return browserRoute(request, async (ownerId) => {
    const body = await jsonBody(request)
    if (
      !objectBody(body, ["membershipRevision"]) ||
      !isMembershipRevision(body.membershipRevision)
    )
      throw new StorageError(400, "Invalid card mutation")
    const { boardId, id } = await context.params
    return storageResponse(
      await deleteCard(ownerId, boardId, id, body.membershipRevision)
    )
  })
}
