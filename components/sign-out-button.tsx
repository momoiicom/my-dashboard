"use client"

import { useState } from "react"
import { signOut } from "next-auth/react"
import { Button } from "@/components/ui/button"

export function SignOutButton() {
  const [pending, setPending] = useState(false)

  return (
    <Button
      variant="outline"
      disabled={pending}
      onClick={() => {
        setPending(true)
        void signOut({ callbackUrl: "/login" }).catch(() => setPending(false))
      }}
    >
      {pending ? "Signing out…" : "Sign out"}
    </Button>
  )
}
