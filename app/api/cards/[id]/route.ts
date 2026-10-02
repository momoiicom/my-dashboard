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
  const updated = await prisma.dashboardCard.updateMany({ where: { id, ownerId }, data: input })
  if (!updated.count) return Response.json({ error: "Card not found" }, { status: 404 })
  const card = await prisma.dashboardCard.findFirst({
    where: { id, ownerId },
    select: { id: true, title: true, x: true, y: true, width: true, height: true },
  })
  return Response.json({ card })
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
