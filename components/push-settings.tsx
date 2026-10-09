"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"

type PushState =
  | { kind: "checking" }
  | { kind: "unsupported" }
  | { kind: "unavailable" }
  | { kind: "denied" }
  | { kind: "promptDismissed"; publicKey: string }
  | { kind: "disabled"; publicKey: string }
  | { kind: "enabled"; publicKey: string }
  | { kind: "busy"; action: "enable" | "disable" }
  | { kind: "error"; message: string; publicKey: string | null; previous: "enabled" | "disabled" | "unknown" }

type PushStatus = { ownerId: string; available: boolean; publicKey: string | null; endpointHashes: string[] }

function supported() {
  return typeof window !== "undefined" && window.isSecureContext &&
    "serviceWorker" in navigator && "PushManager" in window && "Notification" in window
}

function bytes(key: string) {
  const value = atob(key.replace(/-/g, "+").replace(/_/g, "/"))
  return Uint8Array.from(value, character => character.charCodeAt(0))
}

async function endpointHash(endpoint: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(endpoint))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("")
}

async function status(): Promise<PushStatus> {
  const response = await fetch("/api/push", { cache: "no-store", credentials: "same-origin", signal: AbortSignal.timeout(3000) })
  if (!response.ok) throw new Error("Could not check notification settings.")
  return response.json() as Promise<PushStatus>
}

async function currentSubscription() {
  const registration = await navigator.serviceWorker.getRegistration("/")
  return registration?.pushManager.getSubscription() ?? null
}

async function mutation(method: "POST" | "DELETE", body: unknown) {
  const response = await fetch("/api/push", {
    method,
    signal: AbortSignal.timeout(3000),
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    const result = await response.json().catch(() => null) as { error?: string } | null
    throw new Error(result?.error || "Could not update notifications. Please try again.")
  }
}

export async function disableCurrentPush() {
  if (!supported()) return
  const subscription = await currentSubscription()
  if (!subscription) return
  await mutation("DELETE", { endpoint: subscription.endpoint })
  if (!await subscription.unsubscribe()) throw new Error("Could not remove this browser subscription. Please try again.")
}

export async function cleanupPushOnSignOut() {
  if (!supported()) return
  const subscription = await currentSubscription()
  if (!subscription) return
  await mutation("DELETE", { endpoint: subscription.endpoint }).catch(() => undefined)
  await subscription.unsubscribe().catch(() => undefined)
}

export function PushSettings({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [state, setState] = useState<PushState>({ kind: "checking" })

  useEffect(() => {
    if (!open) return
    let live = true
    void (async () => {
      setState({ kind: "checking" })
      if (!supported()) { setState({ kind: "unsupported" }); return }
      try {
        const config = await status()
        if (!live) return
        if (!config.available || !config.publicKey) { setState({ kind: "unavailable" }); return }
        if (Notification.permission === "denied") { setState({ kind: "denied" }); return }
        const subscription = await currentSubscription()
        const owned = subscription && config.endpointHashes.includes(await endpointHash(subscription.endpoint))
        if (subscription && !owned && !await subscription.unsubscribe()) throw new Error("Could not clear previous notification settings.")
        if (live) setState({ kind: owned ? "enabled" : "disabled", publicKey: config.publicKey })
      } catch {
        if (live) setState({ kind: "error", message: "Could not check notification settings.", publicKey: null, previous: "unknown" })
      }
    })()
    return () => { live = false }
  }, [open])

  async function enable(publicKey: string) {
    setState({ kind: "busy", action: "enable" })
    try {
      const permission = await Notification.requestPermission()
      if (permission === "denied") { setState({ kind: "denied" }); return }
      if (permission !== "granted") { setState({ kind: "promptDismissed", publicKey }); return }
      const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" })
      await navigator.serviceWorker.ready
      const existing = await registration.pushManager.getSubscription()
      const subscription = existing ?? await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: bytes(publicKey),
      })
      const serialized = subscription.toJSON()
      try { await mutation("POST", { endpoint: subscription.endpoint, keys: serialized.keys }) }
      catch (error) {
        if (!existing) await subscription.unsubscribe()
        throw error
      }
      setState({ kind: "enabled", publicKey })
    } catch (error) {
      setState({ kind: "error", message: error instanceof Error ? error.message : "Could not enable notifications.", publicKey, previous: "disabled" })
    }
  }

  async function disable(publicKey: string) {
    setState({ kind: "busy", action: "disable" })
    try {
      await disableCurrentPush()
      setState({ kind: "disabled", publicKey })
    } catch (error) {
      setState({ kind: "error", message: error instanceof Error ? error.message : "Could not disable notifications.", publicKey, previous: "enabled" })
    }
  }

  const canEnable = state.kind === "disabled" || state.kind === "promptDismissed" ||
    (state.kind === "error" && state.previous === "disabled" && Boolean(state.publicKey))
  const canDisable = state.kind === "enabled" ||
    (state.kind === "error" && state.previous === "enabled" && Boolean(state.publicKey))
  return (
    <Dialog open={open} onOpenChange={nextOpen => { if (state.kind !== "busy") onOpenChange(nextOpen) }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Notifications</DialogTitle>
          <DialogDescription>
            Get a notification on this browser when your bot marks an existing card update as important. Your card content stays private.
          </DialogDescription>
        </DialogHeader>
        <p role="status" className="text-sm text-muted-foreground">
          {state.kind === "checking" && "Checking this browser…"}
          {state.kind === "unsupported" && "This browser cannot receive push notifications here. Use a supported browser on a secure connection."}
          {state.kind === "unavailable" && "Notifications are not configured on this dashboard."}
          {state.kind === "denied" && "Notifications are blocked in your browser settings."}
          {state.kind === "promptDismissed" && "Permission was not granted. You can try again."}
          {state.kind === "disabled" && "Notifications are off for this browser."}
          {state.kind === "enabled" && "Notifications are on for this browser."}
          {state.kind === "busy" && (state.action === "enable" ? "Enabling notifications…" : "Disabling notifications…")}
          {state.kind === "error" && state.message}
        </p>
        <DialogFooter>
          {canEnable && <Button onClick={() => void enable(state.publicKey!)}>Enable notifications</Button>}
          {canDisable && <Button variant="outline" onClick={() => void disable(state.publicKey!)}>Disable notifications</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
