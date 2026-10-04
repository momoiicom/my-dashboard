import { browserRoute, storageResponse } from "@/lib/card-route"
import { revokeShare } from "@/lib/board-sharing"

export const runtime = "nodejs"
type Context = { params: Promise<{ boardId: string; shareId: string }> }
export async function DELETE(request: Request, context: Context) {
  return browserRoute(request, async userId => {
    const { boardId, shareId } = await context.params
    return storageResponse(await revokeShare(userId, boardId, shareId))
  })
}
