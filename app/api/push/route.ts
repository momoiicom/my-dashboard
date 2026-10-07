import { localUiMode } from "@/lib/local-ui-mode"
import { browserRoute, storageResponse } from "@/lib/card-route"
import { pushStatus, registerPush, removePush, PushInputError } from "@/lib/push-service"

export const runtime = "nodejs"

function rejectBearer(request: Request) {
  return localUiMode() || request.headers.has("authorization")
    ? storageResponse({ error: "Browser session required" }, 401)
    : null
}

async function boundedJson(request: Request) {
  const length = Number(request.headers.get("content-length"))
  if (length > 8192) throw new PushInputError(413, "Subscription body too large")
  const reader = request.body?.getReader()
  if (!reader) throw new PushInputError(400, "Expected JSON body")
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > 8192) { await reader.cancel(); throw new PushInputError(413, "Subscription body too large") }
      chunks.push(value)
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))) as unknown
  } catch (error) {
    if (error instanceof PushInputError) throw error
    throw new PushInputError(400, "Malformed JSON body")
  } finally { reader.releaseLock() }
}

function handleError(error: unknown) {
  if (error instanceof PushInputError) return storageResponse({ error: error.message }, error.status)
  return storageResponse({ error: "Notifications unavailable; retry later" }, 503)
}

export async function GET(request: Request) {
  const blocked = rejectBearer(request)
  if (blocked) return blocked
  return browserRoute(undefined, async ownerId => {
    try { return storageResponse(await pushStatus(ownerId)) }
    catch (error) { return handleError(error) }
  })
}

async function mutate(request: Request, action: "register" | "remove") {
  const blocked = rejectBearer(request)
  if (blocked) return blocked
  return browserRoute(request, async ownerId => {
    try {
      const body = await boundedJson(request)
      if (action === "register") await registerPush(ownerId, body)
      else await removePush(ownerId, body)
      return storageResponse({ ok: true })
    } catch (error) { return handleError(error) }
  })
}

export function POST(request: Request) { return mutate(request, "register") }
export function DELETE(request: Request) { return mutate(request, "remove") }
