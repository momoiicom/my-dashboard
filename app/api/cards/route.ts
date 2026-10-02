import { cardOwnerId, jsonBody, mutationError } from "@/lib/card-route"
import { parseCardInput } from "@/lib/dashboard-card"
import { prisma } from "@/lib/prisma"

export const runtime = "nodejs"

export async function GET() {
  const ownerId = await cardOwnerId()
  if (!ownerId) return Response.json({ error: "Unauthorized" }, { status: 401 })
  const cards = await prisma.dashboardCard.findMany({
    where: { ownerId },
    select: { id: true, title: true, x: true, y: true, width: true, height: true },
    orderBy: { createdAt: "asc" },
  })
  return Response.json({ cards })
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
    select: { id: true, title: true, x: true, y: true, width: true, height: true },
  })
  return Response.json({ card }, { status: 201 })
}
