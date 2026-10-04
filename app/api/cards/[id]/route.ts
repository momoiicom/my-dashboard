import { cardSelect, serializeCard } from "@/lib/card-store"
import { cardOwnerId, jsonBody, mutationError } from "@/lib/card-route"
import { parseCardInput } from "@/lib/dashboard-card"
import { prisma } from "@/lib/prisma"

export const runtime = "nodejs"

type Context = { params: Promise<{ id: string }> }

export async function PATCH(request: Request, context: Context) {
  const ownerId = await cardOwnerId()
  if (!ownerId) return Response.json({ error: "Unauthorized" }, { status: 401 })
  const guard = mutationError(request)
  if (guard) return guard
  const input = parseCardInput(await jsonBody(request), true)
  if (!input) return Response.json({ error: "Invalid card" }, { status: 400 })
  const { id } = await context.params
  if ("title" in input) {
    const botCard = await prisma.dashboardCard.findFirst({ where: { id, ownerId, externalKey: { not: null } }, select: { id: true } })
    if (botCard) return Response.json({ error: "Bot card content is read-only" }, { status: 403 })
  }
  const updated = await prisma.dashboardCard.updateMany({ where: { id, ownerId, ...("title" in input ? { externalKey: null } : {}) }, data: input })
  if (!updated.count) return Response.json({ error: "Card not found" }, { status: 404 })
  const card = await prisma.dashboardCard.findFirst({
    where: { id, ownerId },
    select: cardSelect,
  })
  return Response.json({ card: card ? serializeCard(card) : null })
}

export async function DELETE(request: Request, context: Context) {
  const ownerId = await cardOwnerId()
  if (!ownerId) return Response.json({ error: "Unauthorized" }, { status: 401 })
  const guard = mutationError(request)
  if (guard) return guard
  const { id } = await context.params
  const deleted = await prisma.dashboardCard.deleteMany({ where: { id, ownerId } })
  if (!deleted.count) return Response.json({ error: "Card not found" }, { status: 404 })
  return Response.json({ deleted: true })
}
