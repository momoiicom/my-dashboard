import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { SignOutButton } from "@/components/sign-out-button"
import { requireSession } from "@/lib/auth"

export default async function HomePage() {
  const session = await requireSession()

  return (
    <main className="flex min-h-svh items-center justify-center bg-muted/30 p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>My dashboard</CardTitle>
          <CardDescription>You are signed in with Google.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div className="flex flex-col gap-1 text-sm">
            <span className="font-medium">
              {session.user?.name || "Your account"}
            </span>
            <span className="text-muted-foreground">{session.user?.email}</span>
          </div>
          <SignOutButton />
        </CardContent>
      </Card>
    </main>
  )
}
