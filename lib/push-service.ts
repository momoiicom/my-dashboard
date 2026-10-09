import "server-only"

import { createECDH, createHash } from "node:crypto"
import webPush from "web-push"
import { prisma } from "@/lib/prisma"
import { uniqueConstraint } from "@/lib/storage-error"

export class PushInputError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

const MAX_SUBSCRIPTIONS = 10
const MAX_ENDPOINT = 2048
const PROVIDERS = new Set([
  "fcm.googleapis.com",
  "updates.push.services.mozilla.com",
  "web.push.apple.com",
])

function base64Bytes(value: unknown, size: number): value is string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+={0,2}$/.test(value)) return false
  const bytes = Buffer.from(value, "base64url")
  return bytes.length === size && bytes.toString("base64url") === value.replace(/=+$/, "")
}

function endpointUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > MAX_ENDPOINT) throw new PushInputError(400, "Invalid push endpoint")
  let url: URL
  try { url = new URL(value) } catch { throw new PushInputError(400, "Invalid push endpoint") }
  const hostname = url.hostname.toLowerCase()
  if (url.protocol !== "https:" || url.username || url.password || url.hash || url.port ||
      !(PROVIDERS.has(hostname) || hostname.endsWith(".push.apple.com")) || url.toString() !== value)
    throw new PushInputError(400, "Unsupported push endpoint")
  return value
}

function parseSubscription(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new PushInputError(400, "Invalid subscription")
  const value = input as Record<string, unknown>
  if (Object.keys(value).sort().join(",") !== "endpoint,keys") throw new PushInputError(400, "Invalid subscription")
  const keys = value.keys
  if (!keys || typeof keys !== "object" || Array.isArray(keys)) throw new PushInputError(400, "Invalid subscription keys")
  const keyObject = keys as Record<string, unknown>
  if (Object.keys(keyObject).sort().join(",") !== "auth,p256dh" ||
      !base64Bytes(keyObject.p256dh, 65) || !base64Bytes(keyObject.auth, 16))
    throw new PushInputError(400, "Invalid subscription keys")
  try {
    const probe = createECDH("prime256v1")
    probe.generateKeys()
    probe.computeSecret(Buffer.from(keyObject.p256dh, "base64url"))
  }
  catch { throw new PushInputError(400, "Invalid subscription keys") }
  return { endpoint: endpointUrl(value.endpoint), p256dh: keyObject.p256dh, auth: keyObject.auth }
}

function vapid() {
  const publicKey = process.env.PUSH_VAPID_PUBLIC_KEY
  const privateKey = process.env.PUSH_VAPID_PRIVATE_KEY
  const subject = process.env.PUSH_VAPID_SUBJECT
  if (!base64Bytes(publicKey, 65) || !base64Bytes(privateKey, 32) ||
      !subject || !(/^(mailto:[^\s@]+@[^\s@]+|https:\/\/[^\s]+)$/.test(subject))) return null
  try {
    const contact = new URL(subject)
    if (contact.protocol === "https:" && (!contact.hostname || contact.username || contact.password)) return null
    const pair = createECDH("prime256v1")
    pair.setPrivateKey(Buffer.from(privateKey, "base64url"))
    if (!pair.getPublicKey().equals(Buffer.from(publicKey, "base64url"))) return null
  } catch { return null }
  return { publicKey, privateKey, subject }
}

function endpointHash(endpoint: string) {
  return createHash("sha256").update(endpoint).digest("hex")
}

export async function pushStatus(ownerId: string) {
  const rows = await prisma.pushSubscription.findMany({ where: { ownerId }, select: { endpoint: true } })
  const config = vapid()
  return {
    ownerId,
    available: Boolean(config),
    publicKey: config?.publicKey ?? null,
    endpointHashes: rows.map(row => endpointHash(row.endpoint)),
  }
}

export async function registerPush(ownerId: string, input: unknown) {
  if (!vapid()) throw new PushInputError(503, "Notifications are not configured")
  const subscription = parseSubscription(input)
  try {
    await prisma.$transaction(async tx => {
      const existing = await tx.pushSubscription.findUnique({ where: { endpoint: subscription.endpoint } })
      if (existing?.ownerId !== undefined && existing.ownerId !== ownerId)
        throw new PushInputError(409, "This browser subscription belongs to another account")
      if (!existing) {
        const count = await tx.pushSubscription.count({ where: { ownerId } })
        if (count >= MAX_SUBSCRIPTIONS) throw new PushInputError(409, "Maximum browser subscriptions reached")
      }
      await tx.pushSubscription.upsert({
        where: { endpoint: subscription.endpoint },
        create: { ownerId, ...subscription },
        update: { p256dh: subscription.p256dh, auth: subscription.auth },
      })
    })
  } catch (error) {
    if (uniqueConstraint(error)) throw new PushInputError(409, "Subscription conflict; retry")
    throw error
  }
}

export async function removePush(ownerId: string, input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input) ||
      Object.keys(input).join(",") !== "endpoint") throw new PushInputError(400, "Invalid subscription")
  const endpoint = endpointUrl((input as { endpoint: unknown }).endpoint)
  await prisma.pushSubscription.deleteMany({ where: { ownerId, endpoint } })
}

export type PushReceipt =
  | { status: "skipped"; reason: "created" | "unchanged" | "no_subscriptions" | "not_configured" }
  | { status: "attempted"; accepted: number; failed: number }
  | { status: "failed"; reason: "subscription_lookup_failed" | "delivery_unavailable" }

type UpdatedCard = {
  change: "created" | "updated" | "unchanged"
  card: { id: string; boardId: string; contentRevision: number }
}

export async function notifyCardUpdate(ownerId: string, result: UpdatedCard): Promise<PushReceipt> {
  if (result.change !== "updated") return { status: "skipped", reason: result.change }
  const config = vapid()
  if (!config) return { status: "skipped", reason: "not_configured" }
  try {
    const subscriptions = await prisma.pushSubscription.findMany({ where: { ownerId }, take: MAX_SUBSCRIPTIONS })
    if (!subscriptions.length) return { status: "skipped", reason: "no_subscriptions" }
    const body = JSON.stringify({
      ownerId,
      url: `/boards/${encodeURIComponent(result.card.boardId)}`,
      cardId: result.card.id,
      revision: result.card.contentRevision,
    })
    let accepted = 0
    let failed = 0
    await Promise.all(subscriptions.map(async subscription => {
      try {
        const details = webPush.generateRequestDetails(
          { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
          body,
          { vapidDetails: config, TTL: 300, urgency: "normal" }
        )
        const response = await fetch(details.endpoint, {
          method: "POST", headers: details.headers,
          body: details.body ? new Uint8Array(details.body) : undefined,
          redirect: "manual", signal: AbortSignal.timeout(3000),
        })
        await response.body?.cancel()
        if (response.status >= 200 && response.status < 300) accepted++
        else {
          failed++
          if (response.status === 404 || response.status === 410)
            await prisma.pushSubscription.deleteMany({
              where: { id: subscription.id, updatedAt: subscription.updatedAt },
            }).catch(() => undefined)
        }
      } catch { failed++ }
    }))
    return { status: "attempted", accepted, failed }
  } catch { return { status: "failed", reason: "subscription_lookup_failed" } }
}
