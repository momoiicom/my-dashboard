import { browserRoute, jsonBody, storageResponse } from "@/lib/card-route"
import { resetBoardLayout, saveBoardLayout } from "@/lib/board-sharing"

export const runtime = "nodejs"
type Context = { params: Promise<{ boardId: string }> }
export async function DELETE(request: Request, context: Context) {
  return browserRoute(request, async (userId, verifiedGoogle) => storageResponse(await resetBoardLayout(userId, (await context.params).boardId, verifiedGoogle)))
}
export async function PUT(request: Request, context: Context) {
  return browserRoute(request, async (userId, verifiedGoogle) => storageResponse(await saveBoardLayout(userId, (await context.params).boardId, verifiedGoogle, await jsonBody(request))))
}
