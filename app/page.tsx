import { Dashboard } from "@/components/dashboard"
import { requireSession } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

export default async function HomePage() {
  const session = await requireSession()
  const cards = await prisma.dashboardCard.findMany({
    where: { ownerId: session.user!.id },
    select: { id: true, title: true, x: true, y: true, width: true, height: true },
    orderBy: { createdAt: "asc" },
  })
  return <Dashboard initialCards={cards} name={session.user?.name || "Your account"} image={session.user?.image} />
}
