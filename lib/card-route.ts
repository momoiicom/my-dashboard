import "server-only"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

export async function cardOwnerId() {
  if (!process.env.NEXTAUTH_SECRET || !process.env.DATABASE_URL) return null
  const session = await getServerSession(authOptions)
  const id = session?.user?.id?.trim()
  if (!id) return null
  const owner = await prisma.user.findUnique({ where: { id }, select: { id: true } })
  return owner?.id || null
}

export function mutationError(request: Request) {
  const expectedOrigin = new URL(process.env.NEXTAUTH_URL || request.url).origin
  if (request.headers.get("origin") !== expectedOrigin) {
    return Response.json({ error: "Forbidden origin" }, { status: 403 })
  }
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    return Response.json({ error: "Expected application/json" }, { status: 400 })
  }
  return null
}

export async function jsonBody(request: Request) {
  try {
    return await request.json() as unknown
  } catch {
    return null
  }
}
