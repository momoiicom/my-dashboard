"use client"

import { useState } from "react"
import { signOut } from "next-auth/react"
import { Button } from "@/components/ui/button"

export function SignOutButton({ beforeSignOut, onPendingChange }: {
  beforeSignOut?: () => Promise<void>
  onPendingChange?: (pending: boolean) => void
}) {
  const [pending, setPending] = useState(false)

  return (
    <Button
      variant="outline"
      disabled={pending}
      onClick={() => {
        setPending(true)
        onPendingChange?.(true)
        void Promise.resolve().then(() => beforeSignOut?.()).then(() => signOut({ callbackUrl: "/login" })).catch(() => {
          setPending(false)
          onPendingChange?.(false)
        })
      }}
    >
      {pending ? "Signing out…" : "Sign out"}
    </Button>
  )
}
