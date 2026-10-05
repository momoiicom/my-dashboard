import "server-only"
import { randomBytes } from "node:crypto"
import { mkdir, open, readFile, unlink } from "node:fs/promises"
import path from "node:path"
import sharp from "sharp"
import type { Prisma } from "@/generated/prisma/client"
import { prisma } from "@/lib/prisma"
import { bindBoardGrants, requireBoardAccess } from "@/lib/board-access"
import { retryWrite, StorageError } from "@/lib/storage-error"
import { APPEARANCE_SURFACES, resolveAppearance, type Appearance, type AppearanceChoice, type AppearanceColors, type AppearanceState, type AppearanceTarget, type Background, type SaveAppearance, type ViewerColors, type ViewerPreferences } from "@/lib/appearance"

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

function presentColors(values: AppearanceColors | ViewerColors) {
  return Object.keys(values).length ? { colors: values } : {}
}

function authorColors(board: Access["board"]): AppearanceColors {
  const values = { mainToolbar: board.appearanceMainToolbar, boardToolbar: board.appearanceBoardToolbar, card: board.appearanceCard, button: board.appearanceButton }
  return Object.fromEntries(APPEARANCE_SURFACES.filter(key => values[key] !== null).map(key => [key, values[key]])) as AppearanceColors
}

function viewerColors(row: { mainToolbar: string | null; boardToolbar: string | null; card: string | null; button: string | null } | null): ViewerColors {
  if (!row) return {}
  return Object.fromEntries(APPEARANCE_SURFACES.filter(key => row[key] !== null).map(key => [key, row[key]])) as ViewerColors
}

function boardColorData(colors: AppearanceColors) {
  return { appearanceMainToolbar: colors.mainToolbar ?? null, appearanceBoardToolbar: colors.boardToolbar ?? null, appearanceCard: colors.card ?? null, appearanceButton: colors.button ?? null }
}

function viewerColorData(colors: ViewerColors) {
  return { mainToolbar: colors.mainToolbar ?? null, boardToolbar: colors.boardToolbar ?? null, card: colors.card ?? null, button: colors.button ?? null }
}

function targetColors(input: SaveAppearance["preferences"], targetRole: Access["role"], current: AppearanceState): AppearanceColors | ViewerColors {
  const existing = targetRole === "author" ? current.author.colors : (current.preferences.value as ViewerPreferences).colors
  if (input.colors === undefined) return existing ?? {}
  if (targetRole === "author") {
    const colors: AppearanceColors = {}
    for (const key of APPEARANCE_SURFACES) {
      const selected = input.colors[key]
      if (selected === undefined && input.role === "viewer") {
        if (current.author.colors?.[key]) colors[key] = current.author.colors[key]
      } else if (selected && selected !== "auto") colors[key] = selected
    }
    return colors
  }
  const colors: ViewerColors = {}
  for (const key of APPEARANCE_SURFACES) {
    const selected = input.colors[key]
    if (selected !== undefined) colors[key] = selected
    else if (input.role === "author") colors[key] = "auto"
  }
  return colors
}

export async function readAppearance(tx: Prisma.TransactionClient, access: Access): Promise<AppearanceState> {
  const board = access.board
  const author: Appearance = { background: background(board.appearanceKind, board.appearanceColor, board.appearanceAssetId), accent: board.appearanceAccent, ...presentColors(authorColors(board)) }
  if (access.role === "author") return { author, effective: author, preferences: { role: "author", value: author }, source: { background: "author", accent: "author" }, token: `${board.appearanceRevision}:0` }
  const row = await tx.viewerAppearance.findUnique({ where: { boardId_userId: { boardId: board.id, userId: access.userId } } })
  const personal: ViewerPreferences = { background: row?.backgroundKind ? background(row.backgroundKind, row.backgroundColor, row.backgroundAssetId) : null, accent: row?.accent ?? null, ...presentColors(viewerColors(row)) }
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

type Identity = { id: string; verifiedGoogle: boolean }

async function appearanceTargets(tx: Prisma.TransactionClient, identity: Identity): Promise<AppearanceTarget[]> {
  const user = identity.verifiedGoogle ? await tx.user.findUnique({ where: { id: identity.id }, select: { googleVerifiedEmail: true } }) : null
  const shared = Boolean(user?.googleVerifiedEmail)
  if (shared) await bindBoardGrants(tx, identity.id, identity.verifiedGoogle)
  const boards = await tx.board.findMany({ where: { OR: [{ ownerId: identity.id }, ...(shared ? [{ grants: { some: { userId: identity.id } } }] : [])] }, select: { id: true }, orderBy: { id: "asc" } })
  if (boards.length > 200) throw new StorageError(400, "Apply to all supports up to 200 boards")
  const targets: AppearanceTarget[] = []
  for (const board of boards) {
    const access = await requireBoardAccess(tx, identity.id, board.id, identity.verifiedGoogle)
    targets.push({ boardId: board.id, token: (await readAppearance(tx, access)).token })
  }
  return targets
}

export async function getAppearanceTargets(identity: Identity, boardId: string) {
  return retryWrite(() => prisma.$transaction(async tx => {
    await requireBoardAccess(tx, identity.id, boardId, identity.verifiedGoogle)
    return appearanceTargets(tx, identity)
  }))
}

async function checkedTargets(tx: Prisma.TransactionClient, identity: Identity, boardId: string, input: SaveAppearance) {
  const source = await requireBoardAccess(tx, identity.id, boardId, identity.verifiedGoogle)
  if (source.role !== input.preferences.role) throw new StorageError(403, "Appearance role changed")
  const sourceState = await readAppearance(tx, source)
  if (sourceState.token !== input.expectedToken) throw new StorageError(409, "Appearance changed on another device")
  const expected = input.targets ?? [{ boardId, token: input.expectedToken }]
  if (!expected.some(target => target.boardId === boardId && target.token === input.expectedToken)) throw new StorageError(400, "Selected board must be included")
  if (input.targets) {
    const actual = await appearanceTargets(tx, identity)
    if (actual.length !== expected.length || actual.some(target => !expected.some(item => item.boardId === target.boardId && item.token === target.token))) throw new StorageError(409, "Board access or appearance changed. Reload or reapply your choices.")
  }
  const targets = []
  for (const target of expected) {
    const access = target.boardId === boardId ? source : await requireBoardAccess(tx, identity.id, target.boardId, identity.verifiedGoogle)
    const current = target.boardId === boardId ? sourceState : await readAppearance(tx, access)
    if (current.token !== target.token) throw new StorageError(409, "Appearance changed on another device")
    targets.push({ access, current })
  }
  await checkedBackground(tx, source, input.preferences.background?.kind === "upload" ? null : input.preferences.background, null)
  return targets
}

async function persistAppearance(tx: Prisma.TransactionClient, access: Access, current: AppearanceState, chosen: Background | null, accent: string | null, colors: AppearanceColors | ViewerColors) {
  const boardId = access.board.id
  if (access.role === "author") {
    const old = current.author
    const value = chosen ?? old.background
    const color = accent ?? old.accent
    if (JSON.stringify(old.background) !== JSON.stringify(value) || old.accent !== color || JSON.stringify(boardColorData(old.colors ?? {})) !== JSON.stringify(boardColorData(colors as AppearanceColors))) {
      const fields = backgroundData(value)
      await tx.board.update({ where: { id: boardId }, data: { appearanceKind: fields.backgroundKind!, appearanceColor: fields.backgroundColor, appearanceAssetId: fields.backgroundAssetId, appearanceAccent: color, ...boardColorData(colors as AppearanceColors), appearanceRevision: { increment: 1 } } })
    }
  } else {
    const old = current.preferences.value as ViewerPreferences
    if (JSON.stringify(old.background) !== JSON.stringify(chosen) || old.accent !== accent || JSON.stringify(viewerColorData(old.colors ?? {})) !== JSON.stringify(viewerColorData(colors as ViewerColors))) {
      await tx.viewerAppearance.upsert({ where: { boardId_userId: { boardId, userId: access.userId } }, create: { boardId, userId: access.userId, ...backgroundData(chosen), accent, ...viewerColorData(colors as ViewerColors), revision: 1 }, update: { ...backgroundData(chosen), accent, ...viewerColorData(colors as ViewerColors), revision: { increment: 1 } } })
    }
  }
}

export async function saveAppearance(identity: Identity, boardId: string, input: SaveAppearance, file: File | null) {
  const choice = input.preferences.background
  if (Boolean(file) !== (choice?.kind === "upload")) throw new StorageError(400, "Image file and selection must match")
  const prepared = await retryWrite(() => prisma.$transaction(async tx => {
    const targets = await checkedTargets(tx, identity, boardId, input)
    const asset = input.targets && choice?.kind === "image" ? await tx.imageAsset.findUnique({ where: { id: choice.assetId } }) : null
    return { targets, asset }
  }))
  let normalized = file ? await normalizeImage(file) : null
  if (prepared.asset) {
    try { normalized = { bytes: await readFile(assetPath(prepared.asset.id)), width: prepared.asset.width, height: prepared.asset.height } }
    catch { throw new StorageError(503, "Image storage unavailable") }
  }
  const staged = new Map<string, string>()
  try {
    if (normalized) {
      for (const { access } of prepared.targets) {
        if (choice?.kind === "image" && access.board.id === boardId) continue
        staged.set(access.board.id, await writeAsset(normalized.bytes))
      }
    }
    return await retryWrite(() => prisma.$transaction(async tx => {
      const targets = await checkedTargets(tx, identity, boardId, input)
      for (const { access, current } of targets) {
        const id = staged.get(access.board.id)
        const chosen = id ? { kind: "image" as const, assetId: id } : choice?.kind === "upload" ? null : choice
        if (normalized && id) await tx.imageAsset.create({ data: { id, boardId: access.board.id, uploaderId: identity.id, scope: access.role === "author" ? "author" : "personal", byteSize: normalized.bytes.length, width: normalized.width, height: normalized.height } })
        await persistAppearance(tx, access, current, chosen, input.preferences.accent, targetColors(input.preferences, access.role, current))
      }
      return readAppearance(tx, await requireBoardAccess(tx, identity.id, boardId, identity.verifiedGoogle))
    }))
  } catch (error) {
    await Promise.all([...staged.values()].map(id => unlink(assetPath(id)).catch(() => {})))
    throw error
  }
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
