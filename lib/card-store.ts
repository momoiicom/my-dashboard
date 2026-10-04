import type { Prisma } from "@/generated/prisma/client"
import { parseBotDocument } from "@/lib/bot-document"
import type { CardRecord } from "@/lib/dashboard-card"

export const cardSelect = {
  id: true,
  title: true,
  kind: true,
  x: true,
  y: true,
  width: true,
  height: true,
  externalKey: true,
  payload: true,
  acceptedAt: true,
  contentRevision: true,
} satisfies Prisma.DashboardCardSelect
export function serializeCard(
  card: Prisma.DashboardCardGetPayload<{ select: typeof cardSelect }>
): CardRecord {
  return {
    ...card,
    payload:
      card.payload === null ? null : parseBotDocument(JSON.parse(card.payload)),
    acceptedAt: card.acceptedAt?.toISOString() ?? null,
  }
}
