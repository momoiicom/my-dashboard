import "server-only"
import { StorageError } from "@/lib/storage-error"
import { getServerSession } from "next-auth"
import { authOptions, localUiUser } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

export async function cardIdentity() {
  const localUser = await localUiUser()
  if (localUser) return { id: localUser.id, verifiedGoogle: false }
  if (!process.env.NEXTAUTH_SECRET || !process.env.DATABASE_URL) return null
  const session = await getServerSession(authOptions)
  const id = session?.user?.id?.trim()
  if (!id) return null
  const owner = await prisma.user.findUnique({
    where: { id },
    select: { id: true },
  })
  return owner ? { id: owner.id, verifiedGoogle: session?.user?.googleVerified === true } : null
}

export async function cardOwnerId() { return (await cardIdentity())?.id ?? null }

export function mutationError(request: Request) {
  const expectedOrigin = new URL(process.env.NEXTAUTH_URL || request.url).origin
  if (request.headers.get("origin") !== expectedOrigin) {
    return Response.json({ error: "Forbidden origin" }, { status: 403 })
  }
  if (
    request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !==
    "application/json"
  ) {
    return Response.json(
      { error: "Expected application/json" },
      { status: 400 }
    )
  }
  return null
}

export async function jsonBody(request: Request) {
  try {
    return (await request.json()) as unknown
  } catch {
    return null
  }
}

export function storageResponse(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  })
}

export function storageError(error: unknown) {
  if (error instanceof StorageError)
    return storageResponse({ error: error.message }, error.status)
  return storageResponse({ error: "Storage unavailable; retry later" }, 503)
}

export async function browserRoute(
  request: Request | undefined,
  handle: (ownerId: string, verifiedGoogle: boolean) => Promise<Response>
) {
  try {
    const identity = await cardIdentity()
    if (!identity) return storageResponse({ error: "Unauthorized" }, 401)
    if (request && request.method !== "GET") {
      const guard = mutationError(request)
      if (guard) return guard
    }
    return await handle(identity.id, identity.verifiedGoogle)
  } catch (error) {
    return storageError(error)
  }
}

export function objectBody(
  value: unknown,
  keys: string[]
): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => key in value)
  )
}

export function isMembershipRevision(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
}
