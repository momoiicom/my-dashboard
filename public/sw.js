self.addEventListener("install", event => { event.waitUntil(self.skipWaiting()) })
self.addEventListener("activate", event => { event.waitUntil(self.clients.claim()) })

function boardPath(value) {
  return typeof value === "string" && /^\/boards\/b_[a-f0-9]{32}$/.test(value) ? value : null
}

self.addEventListener("push", event => {
  event.waitUntil((async () => {
    let payload
    try { payload = event.data?.json() } catch { payload = null }
    const path = boardPath(payload?.url)
    let target = "/"
    try {
      const subscription = await self.registration.pushManager.getSubscription()
      if (!subscription || !path || typeof payload.ownerId !== "string") throw new Error("No matching subscription")
      const response = await fetch("/api/push", {
        credentials: "include", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(3000),
      })
      if (!response.ok) throw new Error("Session unavailable")
      const status = await response.json()
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(subscription.endpoint))
      const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("")
      if (status.ownerId === payload.ownerId && status.endpointHashes?.includes(hash)) target = path
    } catch { /* Delivery still requires a visible, generic notification. */ }
    const tag = target !== "/" && /^c[a-z0-9]{20,30}$/.test(payload?.cardId) &&
      Number.isSafeInteger(payload?.revision) && payload.revision > 0
      ? `card-${payload.cardId}-${payload.revision}` : "dashboard-update"
    await self.registration.showNotification("Dashboard updated", {
      body: "Open your dashboard to check for updates.", tag, data: { path: target },
    })
  })())
})

self.addEventListener("notificationclick", event => {
  event.notification.close()
  const path = boardPath(event.notification.data?.path) ?? "/"
  event.waitUntil((async () => {
    const url = new URL(path, self.location.origin).href
    const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true })
    const existing = clients.find(client => new URL(client.url).origin === self.location.origin)
    if (existing) { await existing.navigate(url); await existing.focus() }
    else await self.clients.openWindow(url)
  })())
})
