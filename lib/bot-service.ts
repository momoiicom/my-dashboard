import "server-only"
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto"
import { prisma } from "@/lib/prisma"
import {
  BOT_LIMITS,
  BotDocumentError,
  parseBotDocument,
  type BotDocument,
} from "@/lib/bot-document"
import { cardSelect, serializeCard } from "@/lib/card-store"
import { buildBotConnection } from "@/lib/bot-connection"

export class BotHttpError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message)
  }
}
function encryptionKey() {
  const secret = process.env.BOT_TOKEN_SECRET || process.env.NEXTAUTH_SECRET
  if (!secret)
    throw new BotHttpError(
      503,
      "Set BOT_TOKEN_SECRET or NEXTAUTH_SECRET to enable bot connections"
    )
  return createHash("sha256")
    .update("my-dashboard/bot-token/v1\0")
    .update(secret)
    .digest()
}
function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex")
}
function encryptToken(token: string, ownerId: string) {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv)
  cipher.setAAD(Buffer.from(ownerId))
  const ciphertext = Buffer.concat([
    cipher.update(token, "utf8"),
    cipher.final(),
  ])
  return [
    "v1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".")
}
function decryptToken(envelope: string, ownerId: string) {
  const key = encryptionKey()
  try {
    const [version, iv, tag, ciphertext, extra] = envelope.split(".")
    if (version !== "v1" || !iv || !tag || !ciphertext || extra)
      throw new Error("Invalid envelope")
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(iv, "base64url")
    )
    decipher.setAAD(Buffer.from(ownerId))
    decipher.setAuthTag(Buffer.from(tag, "base64url"))
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, "base64url")),
      decipher.final(),
    ]).toString("utf8")
  } catch {
    throw new BotHttpError(
      503,
      "Cannot recover bot token. Restore the configured token encryption secret."
    )
  }
}
export async function requireBotOwner(request: Request) {
  const match = /^Bearer (bot_[A-Za-z0-9_-]{43})$/i.exec(
    request.headers.get("authorization") || ""
  )
  if (!match)
    throw new BotHttpError(401, "A valid Bearer bot token is required")
  const record = await prisma.botToken.findUnique({
    where: { tokenHash: hashToken(match[1]) },
    select: { ownerId: true },
  })
  if (!record)
    throw new BotHttpError(401, "A valid Bearer bot token is required")
  return record.ownerId
}
export async function connectionForOwner(ownerId: string, request: Request) {
  const configured =
    process.env.BOT_PUBLIC_BASE_URL ||
    process.env.NEXTAUTH_URL ||
    new URL(request.url).origin
  let baseUrl: string
  try {
    const parsed = new URL(configured)
    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash ||
      parsed.pathname !== "/"
    )
      throw new Error("Invalid base URL")
    baseUrl = parsed.origin
  } catch {
    throw new BotHttpError(
      503,
      "BOT_PUBLIC_BASE_URL/NEXTAUTH_URL must be an HTTP(S) origin without credentials, path, query or fragment"
    )
  }
  const proposed = `bot_${randomBytes(32).toString("base64url")}`
  const encryptedToken = encryptToken(proposed, ownerId)
  const stored = await prisma.botToken.upsert({
    where: { ownerId },
    create: { ownerId, tokenHash: hashToken(proposed), encryptedToken },
    update: {},
  })
  const token = decryptToken(stored.encryptedToken, ownerId)
  if (hashToken(token) !== stored.tokenHash)
    throw new BotHttpError(503, "Stored bot token is inconsistent")
  return buildBotConnection(baseUrl, token)
}
export async function readBotJson(request: Request): Promise<unknown> {
  if (
    request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !==
    "application/json"
  )
    throw new BotHttpError(415, "Expected application/json")
  const length = request.headers.get("content-length")
  if (length && Number(length) > BOT_LIMITS.requestBytes)
    throw new BotHttpError(413, "Request exceeds 128 KiB")
  const reader = request.body?.getReader()
  if (!reader) throw new BotHttpError(400, "Expected a JSON body")
  let size = 0
  const chunks: Uint8Array[] = []
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > BOT_LIMITS.requestBytes) {
        await reader.cancel()
        throw new BotHttpError(413, "Request exceeds 128 KiB")
      }
      chunks.push(value)
    }
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))
    )
  } catch (error) {
    if (error instanceof BotHttpError) throw error
    throw new BotHttpError(400, "Malformed JSON body")
  } finally {
    reader.releaseLock()
  }
}
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`)
      .join(",")}}`
  return JSON.stringify(value)
}
export async function putBotCard(
  ownerId: string,
  externalKey: string,
  document: BotDocument
) {
  const payload = stableJson(document)
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        const previous = await tx.dashboardCard.findUnique({
          where: { ownerId_externalKey: { ownerId, externalKey } },
          select: cardSelect,
        })
        if (previous?.payload === payload)
          return { card: serializeCard(previous), created: false }
        if (previous) {
          const card = await tx.dashboardCard.update({
            where: { id: previous.id },
            data: {
              title: document.title,
              payload,
              acceptedAt: new Date(),
              contentRevision: { increment: 1 },
            },
            select: cardSelect,
          })
          return { card: serializeCard(card), created: false }
        }
        const geometry = await tx.dashboardCard.findMany({
          where: { ownerId },
          select: { y: true, height: true },
        })
        const nextY = Math.min(
          10000,
          geometry.reduce(
            (bottom, card) => Math.max(bottom, card.y + card.height + 20),
            20
          )
        )
        const card = await tx.dashboardCard.create({
          data: {
            ownerId,
            externalKey,
            title: document.title,
            payload,
            acceptedAt: new Date(),
            contentRevision: 1,
            kind: "blank",
            x: 20,
            y: nextY,
            width: 480,
            height: 360,
          },
          select: cardSelect,
        })
        return { card: serializeCard(card), created: true }
      })
    } catch (error) {
      const retryable =
        error instanceof Error &&
        /P2002|P2034|P2028|SQLITE_BUSY|locked|write conflict|Unique constraint/.test(
          error.message
        )
      if (!retryable || attempt === 5) throw error
      await new Promise((resolve) => setTimeout(resolve, 15 * (attempt + 1)))
    }
  }
  throw new BotHttpError(503, "Card storage is busy; retry the same key")
}
export function botResponse(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "no-store" },
  })
}
export function botError(error: unknown) {
  if (error instanceof BotDocumentError)
    return botResponse({ error: error.message, issues: error.issues }, 422)
  if (error instanceof BotHttpError)
    return botResponse({ error: error.message }, error.status)
  return botResponse({ error: "Bot service unavailable; retry later" }, 503)
}
export { parseBotDocument }
