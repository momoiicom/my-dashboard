import { cardIdentity, storageError } from "@/lib/card-route"
import { readAsset } from "@/lib/appearance-store"
import { StorageError } from "@/lib/storage-error"

export const runtime = "nodejs"
type Context = { params: Promise<{ boardId: string; assetId: string }> }
export async function GET(_request: Request, context: Context) {
  try {
    const identity = await cardIdentity()
    if (!identity) throw new StorageError(401, "Unauthorized")
    const { boardId, assetId } = await context.params
    const bytes = await readAsset(identity, boardId, assetId)
    return new Response(new Uint8Array(bytes), { headers: { "Content-Type": "image/webp", "Cache-Control": "private, no-store", "Vary": "Cookie", "X-Content-Type-Options": "nosniff" } })
  } catch (error) {
    const response = storageError(error)
    response.headers.set("Vary", "Cookie")
    response.headers.set("X-Content-Type-Options", "nosniff")
    return response
  }
}
