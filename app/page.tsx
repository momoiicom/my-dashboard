import { cardSelect, serializeCard } from "@/lib/card-store"
import { Dashboard } from "@/components/dashboard"
import { requireSession } from "@/lib/auth"
import { localUiMode } from "@/lib/local-ui-mode"
import { prisma } from "@/lib/prisma"

export default async function HomePage() {
  const session = await requireSession()
  const cards = await prisma.dashboardCard.findMany({
    where: { ownerId: session.user!.id },
    select: cardSelect,
    orderBy: { createdAt: "asc" },
  })
  return <Dashboard initialCards={cards.map(serializeCard)} name={session.user?.name || "Your account"} image={session.user?.image} localUiMode={localUiMode()} />
}
