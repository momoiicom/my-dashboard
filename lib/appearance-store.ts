import "server-only"
import { randomBytes } from "node:crypto"
import { mkdir, open, readFile, unlink } from "node:fs/promises"
import path from "node:path"
import sharp from "sharp"
import type { Prisma } from "@/generated/prisma/client"
import { prisma } from "@/lib/prisma"
import { requireBoardAccess } from "@/lib/board-access"
import { retryWrite, StorageError } from "@/lib/storage-error"
import { resolveAppearance, type Appearance, type AppearanceChoice, type AppearanceState, type Background, type SaveAppearance, type ViewerPreferences } from "@/lib/appearance"

const MAX_UPLOAD = 10 * 1024 * 1024
const MAX_PIXELS = 25_000_000
const MAX_EDGE = 10_000
const MAX_OUTPUT = 10 * 1024 * 1024

type Access = Awaited<ReturnType<typeof requireBoardAccess>>

function background(kind: string | null, color: string | null, assetId: string | null): Background {
  if (kind === "solid" && color) return { kind: "solid", color }
  if (kind === "image" && assetId) return { kind: "image", assetId }
  return { kind: "default" }
}

export async function readAppearance(tx: Prisma.TransactionClient, access: Access): Promise<AppearanceState> {
  const board = access.board
  const author: Appearance = { background: background(board.appearanceKind, board.appearanceColor, board.appearanceAssetId), accent: board.appearanceAccent }
  if (access.role === "author") return { author, effective: author, preferences: { role: "author", value: author }, source: { background: "author", accent: "author" }, token: `${board.appearanceRevision}:0` }
  const row = await tx.viewerAppearance.findUnique({ where: { boardId_userId: { boardId: board.id, userId: access.userId } } })
  const personal: ViewerPreferences = { background: row?.backgroundKind ? background(row.backgroundKind, row.backgroundColor, row.backgroundAssetId) : null, accent: row?.accent ?? null }
  return { author, effective: resolveAppearance(author, personal), preferences: { role: "viewer", value: personal }, source: { background: personal.background ? "personal" : "author", accent: personal.accent ? "personal" : "author" }, token: `${board.appearanceRevision}:${row?.revision ?? 0}` }
}

function storageDir() {
  const configured = process.env.APPEARANCE_STORAGE_DIR ?? path.join(process.cwd(), "data", "uploads")
  if (!path.isAbsolute(configured)) throw new StorageError(503, "Appearance storage path must be absolute")
  const directory = path.resolve(configured)
  const app = process.cwd()
  if ([path.join(app, "public"), path.join(app, ".next")].some(root => directory === root || directory.startsWith(`${root}${path.sep}`))) throw new StorageError(503, "Appearance storage cannot use public or build directories")
  return directory
}

function assetPath(id: string) {
  if (!/^a_[a-f0-9]{32}$/.test(id)) throw new StorageError(404, "Image not found")
  return path.join(storageDir(), `${id}.webp`)
}

function isAnimatedPng(bytes: Buffer) {
  if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return false
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const length = bytes.readUInt32BE(offset)
    if (length > bytes.length - offset - 12) return false
    const type = bytes.toString("ascii", offset + 4, offset + 8)
    if (type === "acTL") return true
    if (type === "IDAT" || type === "IEND") return false
    offset += length + 12
  }
  return false
}

async function normalizeImage(file: File) {
  if (file.size === 0 || file.size > MAX_UPLOAD) throw new StorageError(413, "Image must be at most 10 MiB")
  const bytes = Buffer.from(await file.arrayBuffer())
  try {
    if (isAnimatedPng(bytes)) throw new Error("Animated PNG")
    const image = sharp(bytes, { limitInputPixels: MAX_PIXELS, failOn: "error", animated: false })
    const metadata = await image.metadata()
    if (!metadata.width || !metadata.height || !["jpeg", "png", "webp"].includes(metadata.format ?? "") || (metadata.pages ?? 1) !== 1 || metadata.width > MAX_EDGE || metadata.height > MAX_EDGE || metadata.width * metadata.height > MAX_PIXELS) throw new Error("Invalid image")
    const result = await image.rotate().resize({ width: 4096, height: 4096, fit: "inside", withoutEnlargement: true }).webp({ quality: 82 }).toBuffer({ resolveWithObject: true })
    if (result.data.length > MAX_OUTPUT) throw new Error("Normalized image too large")
    return { bytes: result.data, width: result.info.width, height: result.info.height }
  } catch { throw new StorageError(400, "Upload a valid, still JPEG, PNG, or WebP image") }
}

async function writeAsset(bytes: Buffer) {
  const id = `a_${randomBytes(16).toString("hex")}`
  const destination = assetPath(id)
  await mkdir(storageDir(), { recursive: true, mode: 0o700 })
  const handle = await open(destination, "wx", 0o600)
  try { await handle.writeFile(bytes); await handle.sync() } catch (error) { await unlink(destination).catch(() => {}); throw error } finally { await handle.close() }
  return id
}

async function checkedBackground(tx: Prisma.TransactionClient, access: Access, choice: AppearanceChoice | null, uploadedId: string | null): Promise<Background | null> {
  if (!choice) return null
  if (choice.kind === "upload") {
    if (!uploadedId) throw new StorageError(400, "Image file required")
    return { kind: "image", assetId: uploadedId }
  }
  if (choice.kind === "image") {
    const asset = await tx.imageAsset.findUnique({ where: { id: choice.assetId } })
    if (!asset || asset.boardId !== access.board.id || (access.role === "author" ? asset.scope !== "author" || asset.uploaderId !== access.userId : asset.scope !== "personal" || asset.uploaderId !== access.userId)) throw new StorageError(403, "Image is not available to this account")
  }
  return choice
}

function backgroundData(value: Background | null) {
  return { backgroundKind: value?.kind ?? null, backgroundColor: value?.kind === "solid" ? value.color : null, backgroundAssetId: value?.kind === "image" ? value.assetId : null }
}

export async function saveAppearance(identity: { id: string; verifiedGoogle: boolean }, boardId: string, input: SaveAppearance, file: File | null) {
  const wantsUpload = input.preferences.background?.kind === "upload"
  if (Boolean(file) !== wantsUpload) throw new StorageError(400, "Image file and selection must match")
  await retryWrite(() => prisma.$transaction(async tx => {
    const access = await requireBoardAccess(tx, identity.id, boardId, identity.verifiedGoogle)
    if (access.role !== input.preferences.role) throw new StorageError(403, "Appearance role changed")
    if ((await readAppearance(tx, access)).token !== input.expectedToken) throw new StorageError(409, "Appearance changed on another device")
  }))
  const normalized = file ? await normalizeImage(file) : null
  let uploadedId: string | null = null
  try {
    if (normalized) uploadedId = await writeAsset(normalized.bytes)
    return await retryWrite(() => prisma.$transaction(async tx => {
      const access = await requireBoardAccess(tx, identity.id, boardId, identity.verifiedGoogle)
      if (access.role !== input.preferences.role) throw new StorageError(403, "Appearance role changed")
      const current = await readAppearance(tx, access)
      if (current.token !== input.expectedToken) throw new StorageError(409, "Appearance changed on another device")
      const chosen = await checkedBackground(tx, access, input.preferences.background, uploadedId)
      if (normalized && uploadedId) await tx.imageAsset.create({ data: { id: uploadedId, boardId, uploaderId: identity.id, scope: access.role === "author" ? "author" : "personal", byteSize: normalized.bytes.length, width: normalized.width, height: normalized.height } })
      if (access.role === "author" && input.preferences.role === "author") {
        const old = current.author
        if (JSON.stringify(old.background) !== JSON.stringify(chosen) || old.accent !== input.preferences.accent) {
          const fields = backgroundData(chosen)
          await tx.board.update({ where: { id: boardId }, data: { appearanceKind: fields.backgroundKind!, appearanceColor: fields.backgroundColor, appearanceAssetId: fields.backgroundAssetId, appearanceAccent: input.preferences.accent, appearanceRevision: { increment: 1 } } })
        }
      } else if (access.role === "viewer" && input.preferences.role === "viewer") {
        const old = current.preferences.value as ViewerPreferences
        if (JSON.stringify(old.background) !== JSON.stringify(chosen) || old.accent !== input.preferences.accent) {
          await tx.viewerAppearance.upsert({ where: { boardId_userId: { boardId, userId: identity.id } }, create: { boardId, userId: identity.id, ...backgroundData(chosen), accent: input.preferences.accent, revision: 1 }, update: { ...backgroundData(chosen), accent: input.preferences.accent, revision: { increment: 1 } } })
        }
      }
      const refreshed = await requireBoardAccess(tx, identity.id, boardId, identity.verifiedGoogle)
      return readAppearance(tx, refreshed)
    }))
  } catch (error) { if (uploadedId) await unlink(assetPath(uploadedId)).catch(() => {}); throw error }
}

export async function readAsset(identity: { id: string; verifiedGoogle: boolean }, boardId: string, assetId: string) {
  const asset = await retryWrite(() => prisma.$transaction(async tx => {
    const access = await requireBoardAccess(tx, identity.id, boardId, identity.verifiedGoogle)
    const record = await tx.imageAsset.findUnique({ where: { id: assetId } })
    if (!record || record.boardId !== boardId) throw new StorageError(404, "Image not found")
    if (record.scope === "author") {
      if (access.board.appearanceAssetId !== assetId) throw new StorageError(404, "Image not found")
    } else {
      if (record.uploaderId !== identity.id) throw new StorageError(404, "Image not found")
      const personal = await tx.viewerAppearance.findUnique({ where: { boardId_userId: { boardId, userId: identity.id } } })
      if (personal?.backgroundAssetId !== assetId) throw new StorageError(404, "Image not found")
    }
    return record
  }))
  try { return await readFile(assetPath(asset.id)) } catch { throw new StorageError(503, "Image storage unavailable") }
}
