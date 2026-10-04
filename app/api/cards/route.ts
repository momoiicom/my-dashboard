import { cardSelect, serializeCard } from "@/lib/card-store"
import { cardOwnerId, jsonBody, mutationError } from "@/lib/card-route"
import { parseCardInput } from "@/lib/dashboard-card"
import { prisma } from "@/lib/prisma"

export const runtime = "nodejs"

export async function GET() {
  const ownerId = await cardOwnerId()
  if (!ownerId) return Response.json({ error: "Unauthorized" }, { status: 401 })
  const cards = await prisma.dashboardCard.findMany({
    where: { ownerId },
    select: cardSelect,
    orderBy: { createdAt: "asc" },
  })
  return Response.json({ cards: cards.map(serializeCard) }, { headers: { "Cache-Control": "no-store" } })
}

export async function POST(request: Request) {
  const ownerId = await cardOwnerId()
  if (!ownerId) return Response.json({ error: "Unauthorized" }, { status: 401 })
  const guard = mutationError(request)
  if (guard) return guard
  const input = parseCardInput(await jsonBody(request))
  if (!input) return Response.json({ error: "Invalid card" }, { status: 400 })
  const card = await prisma.dashboardCard.create({
    data: { ...input, ownerId },
    select: cardSelect,
  })
  return Response.json({ card: serializeCard(card) }, { status: 201 })
}
