import { workspaceCallbackUrl } from "@/lib/board"
import { redirect } from "next/navigation"
import { getServerSession } from "next-auth"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { SignInButton } from "@/components/sign-in-button"
import { authOptions } from "@/lib/auth"
import { localUiMode } from "@/lib/local-ui-mode"

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string | string[] }>
}) {
  const callbackUrl = workspaceCallbackUrl((await searchParams).callbackUrl)
  if (localUiMode()) redirect(callbackUrl)
  if (process.env.NEXTAUTH_SECRET && process.env.DATABASE_URL) {
    const session = await getServerSession(authOptions)
    if (session?.user?.id?.trim()) redirect(callbackUrl)
  }

  const configured = Boolean(
    process.env.NEXTAUTH_SECRET &&
    process.env.GOOGLE_CLIENT_ID &&
    process.env.GOOGLE_CLIENT_SECRET &&
    process.env.DATABASE_URL
  )

  return (
    <main className="login-shell flex min-h-svh items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Sign in</CardTitle>
          <CardDescription>
            Use your Google account to open your private dashboard.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {!configured && (
            <Alert>
              <AlertTitle>Google sign-in is not configured yet</AlertTitle>
              <AlertDescription>
                Contact the site owner to finish setup.
              </AlertDescription>
            </Alert>
          )}
          <SignInButton disabled={!configured} callbackUrl={callbackUrl} />
        </CardContent>
      </Card>
    </main>
  )
}
