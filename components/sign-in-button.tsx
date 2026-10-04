"use client"

import { useState } from "react"
import { signIn } from "next-auth/react"
import { Button } from "@/components/ui/button"

export function SignInButton({
  disabled,
  callbackUrl,
}: {
  disabled: boolean
  callbackUrl: string
}) {
  const [pending, setPending] = useState(false)

  return (
    <Button
      className="w-full"
      disabled={disabled || pending}
      onClick={() => {
        setPending(true)
        void signIn("google", { callbackUrl }).catch(() => setPending(false))
      }}
    >
      {pending ? "Opening Google…" : "Continue with Google"}
    </Button>
  )
}
