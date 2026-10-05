import { cardIdentity, storageError, storageResponse } from "@/lib/card-route"
import { getBoardSnapshot } from "@/lib/board-store"
import { parseSaveAppearance } from "@/lib/appearance"
import { getAppearanceTargets, saveAppearance } from "@/lib/appearance-store"
import { StorageError } from "@/lib/storage-error"

export const runtime = "nodejs"
type Context = { params: Promise<{ boardId: string }> }
const MAX_BODY = 10 * 1024 * 1024 + 64 * 1024

export async function GET(request: Request, context: Context) {
  try {
    const identity = await cardIdentity()
    if (!identity) throw new StorageError(401, "Unauthorized")
    const { boardId } = await context.params
    if (new URL(request.url).searchParams.get("all") === "true") return storageResponse({ targets: await getAppearanceTargets(identity, boardId) })
    const snapshot = await getBoardSnapshot(identity.id, boardId, identity.verifiedGoogle)
    if (!snapshot) throw new StorageError(404, "Board not found")
    return storageResponse(snapshot.appearance)
  } catch (error) { return storageError(error) }
}

async function boundedForm(request: Request) {
  const length = request.headers.get("content-length")
  if (length && (!/^\d+$/.test(length) || Number(length) > MAX_BODY)) throw new StorageError(413, "Appearance request is too large")
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("multipart/form-data;")) throw new StorageError(400, "Expected multipart form")
  const reader = request.body?.getReader()
  if (!reader) throw new StorageError(400, "Missing request body")
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_BODY) { await reader.cancel().catch(() => {}); throw new StorageError(413, "Appearance request is too large") }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  const bounded = new Request(request.url, { method: "POST", headers: { "content-type": request.headers.get("content-type")! }, body: Buffer.concat(chunks.map(chunk => Buffer.from(chunk))) })
  try { return await bounded.formData() } catch { throw new StorageError(400, "Invalid multipart form") }
}

export async function PUT(request: Request, context: Context) {
  try {
    const identity = await cardIdentity()
    if (!identity) throw new StorageError(401, "Unauthorized")
    const expectedOrigin = new URL(process.env.NEXTAUTH_URL || request.url).origin
    if (request.headers.get("origin") !== expectedOrigin) throw new StorageError(403, "Forbidden origin")
    const form = await boundedForm(request)
    if ([...form.keys()].some(key => key !== "preferences" && key !== "image") || form.getAll("preferences").length !== 1 || form.getAll("image").length > 1) throw new StorageError(400, "Invalid appearance fields")
    const envelope = form.get("preferences")
    if (typeof envelope !== "string" || Buffer.byteLength(envelope) > 64 * 1024) throw new StorageError(400, "Invalid appearance preferences")
    let decoded: unknown
    try { decoded = JSON.parse(envelope) } catch { throw new StorageError(400, "Invalid appearance preferences") }
    const input = parseSaveAppearance(decoded)
    if (!input) throw new StorageError(400, "Invalid appearance preferences")
    const image = form.get("image")
    if (image !== null && !(image instanceof File)) throw new StorageError(400, "Invalid image field")
    const { boardId } = await context.params
    return storageResponse(await saveAppearance(identity, boardId, input, image))
  } catch (error) { return storageError(error) }
}
