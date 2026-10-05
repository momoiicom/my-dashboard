"use client"

import { useRef, useState } from "react"
import { signOut } from "next-auth/react"
import { ChevronDown, LogOut, Settings, Share2 } from "lucide-react"
import { DropdownMenu } from "radix-ui"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { appearanceTokens } from "@/components/appearance-surface"
import type { Appearance } from "@/lib/appearance"

type AccountMenuProps = {
  name: string
  image?: string | null
  localUiMode: boolean
  beforeSignOut: () => Promise<void>
  onPendingChange: (pending: boolean) => void
  onSettings: () => void
  onSharing?: () => void
  appearance: Appearance
  boardId: string
}

export function AccountMenu({ name, image, localUiMode, beforeSignOut, onPendingChange, onSettings, onSharing, appearance, boardId }: AccountMenuProps) {
  const [pending, setPending] = useState(false)
  const signingOut = useRef(false)

  const handleSignOut = () => {
    if (signingOut.current) return
    signingOut.current = true
    setPending(true)
    onPendingChange(true)
    void Promise.resolve().then(beforeSignOut).then(() => signOut({ callbackUrl: "/login" })).catch(() => {
      signingOut.current = false
      setPending(false)
      onPendingChange(false)
    })
  }

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button variant="ghost" className="dashboard-account-trigger" aria-label={`Account menu for ${name}`}>
          <Avatar size="sm" className="dashboard-avatar">
            {image && <AvatarImage src={image} alt="" referrerPolicy="no-referrer" />}
            <AvatarFallback>{name.slice(0, 1).toUpperCase()}</AvatarFallback>
          </Avatar>
          <span className="dashboard-account-name">{name}</span>
          <ChevronDown data-icon="inline-end" aria-hidden="true" />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="dashboard-account-menu" style={appearanceTokens(appearance, boardId)} align="end" sideOffset={6}>
          <DropdownMenu.Group>
            {onSharing && <DropdownMenu.Item className="dashboard-account-menu-item" onSelect={onSharing}>
              <Share2 aria-hidden="true" />
              <span>Shares</span>
            </DropdownMenu.Item>}
            <DropdownMenu.Item className="dashboard-account-menu-item" onSelect={onSettings}>
              <Settings aria-hidden="true" />
              <span>Settings</span>
            </DropdownMenu.Item>
          </DropdownMenu.Group>
          {!localUiMode && (
            <>
              <DropdownMenu.Separator className="dashboard-account-menu-separator" />
              <DropdownMenu.Group>
                <DropdownMenu.Item
                  className="dashboard-account-menu-item"
                  disabled={pending}
                  onSelect={(event) => {
                    event.preventDefault()
                    handleSignOut()
                  }}
                >
                  <LogOut aria-hidden="true" />
                  <span>{pending ? "Signing out…" : "Sign out"}</span>
                </DropdownMenu.Item>
              </DropdownMenu.Group>
            </>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
