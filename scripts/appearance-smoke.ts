import assert from "node:assert/strict"
import { spawn, spawnSync, type ChildProcess } from "node:child_process"
import { randomBytes, randomUUID } from "node:crypto"
import { once } from "node:events"
import { createServer } from "node:net"
import { mkdir, mkdtemp, rm, writeFile, readdir, stat, utimes } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { PrismaAdapter } from "@next-auth/prisma-adapter"
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3"
import { encode } from "next-auth/jwt"
import { PrismaClient } from "../generated/prisma/client"
import sharp from "sharp"
import { parseBotDocument } from "../lib/bot-document"
import type { AppearanceState, AppearanceTarget, AppearanceChoice, Background } from "../lib/appearance"

type Identity = { id: string; email: string; cookie: string }
const directory = await mkdtemp(join(tmpdir(), "appearance-api-"))
const databaseUrl = `file:${join(directory, "api.db")}`
const storage = join(directory, "uploads")
const secret = randomBytes(32).toString("hex")
const setupEnv = { ...process.env, DATABASE_URL: databaseUrl, APPEARANCE_STORAGE_DIR: storage, NEXTAUTH_SECRET: secret, GOOGLE_CLIENT_ID: "", GOOGLE_CLIENT_SECRET: "", LOCAL_UI_MODE: "false" }
let child: ChildProcess | undefined
let prisma: PrismaClient | undefined
let output = ""
async function freePort() {
  const listener = createServer().listen(0, "127.0.0.1")
  await once(listener, "listening")
  const address = listener.address()
  assert(address && typeof address !== "string")
  await new Promise<void>(resolve => listener.close(() => resolve()))
  return address.port
}
function crc32(bytes: Buffer) {
  let crc = -1
  for (const value of bytes) { crc ^= value; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (-(crc & 1) & 0xedb88320) }
  return (crc ^ -1) >>> 0
}
function apng(png: Buffer) {
  const chunk = (kind: string, data: Buffer) => {
    const length = Buffer.alloc(4); length.writeUInt32BE(data.length)
    const content = Buffer.concat([Buffer.from(kind), data])
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(content))
    return Buffer.concat([length, content, crc])
  }
  const frames = Buffer.alloc(8); frames.writeUInt32BE(2, 0)
  const frame = (sequence: number) => {
    const data = Buffer.alloc(26)
    data.writeUInt32BE(sequence, 0)
    data.writeUInt32BE(png.readUInt32BE(16), 4)
    data.writeUInt32BE(png.readUInt32BE(20), 8)
    data.writeUInt16BE(1, 20); data.writeUInt16BE(10, 22)
    return chunk("fcTL", data)
  }
  const pieces = [png.subarray(0, 8)]
  const idat: Buffer[] = []
  let started = false
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset)
    const kind = png.toString("ascii", offset + 4, offset + 8)
    const original = png.subarray(offset, offset + length + 12)
    if (kind === "IDAT") {
      if (!started) { pieces.push(chunk("acTL", frames), frame(0)); started = true }
      idat.push(png.subarray(offset + 8, offset + 8 + length))
    }
    if (kind === "IEND") {
      const second = Buffer.alloc(4); second.writeUInt32BE(2)
      pieces.push(frame(1), chunk("fdAT", Buffer.concat([second, ...idat])))
    }
    pieces.push(original)
    offset += original.length
  }
  return Buffer.concat(pieces)
}
const body = async <T>(response: Response): Promise<T> => response.json() as Promise<T>
try {
  await writeFile(join(directory, "api.db"), "")
  const migration = spawnSync("node_modules/.bin/prisma", ["migrate", "deploy"], { env: setupEnv, encoding: "utf8" })
  assert.equal(migration.status, 0, `${migration.stdout}\n${migration.stderr}`)
  prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: databaseUrl }) })
  const adapter = PrismaAdapter(prisma)
  async function identity(name: string): Promise<Identity> {
    const email = `${name.toLowerCase()}-${randomUUID()}@example.test`
    const user = await adapter.createUser!({ name, email, emailVerified: null, image: null })
    await prisma!.user.update({ where: { id: user.id }, data: { googleVerifiedEmail: email } })
    const cookie = `next-auth.session-token=${await encode({ token: { sub: user.id, name, email, googleVerified: true }, secret })}`
    return { id: user.id, email, cookie }
  }
  const author = await identity("Author"), first = await identity("First"), second = await identity("Second"), outsider = await identity("Outsider")
  const port = await freePort(), base = `http://127.0.0.1:${port}`
  child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", String(port)], { env: { ...setupEnv, NEXTAUTH_URL: base }, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] })
  child.stdout?.on("data", chunk => { output += String(chunk) })
  child.stderr?.on("data", chunk => { output += String(chunk) })
  for (let i = 0; i < 90; i++) { try { if ((await fetch(`${base}/login`)).status === 200) break } catch {} await new Promise(resolve => setTimeout(resolve, 200)) }
  assert.equal((await fetch(`${base}/login`)).status, 200, output.slice(-2000))
  const request = (path: string, who: Identity | null = author, method = "GET", data?: unknown) => fetch(`${base}${path}`, { method, headers: { ...(who ? { cookie: who.cookie } : {}), origin: base, ...(data === undefined ? {} : { "content-type": "application/json" }) }, body: data === undefined ? undefined : JSON.stringify(data), redirect: "manual" })
  const workspace = async (who: Identity) => body<{ originalBoardId: string }>(await request("/api/boards", who))
  const boardId = (await workspace(author)).originalBoardId
  const path = `/api/boards/${boardId}/appearance`
  const cardsPath = `/api/boards/${boardId}/cards`
  const sharesPath = `/api/boards/${boardId}/shares`
  const appearance = async (who: Identity) => { const response = await request(path, who); assert.equal(response.status, 200); return body<AppearanceState>(response) }
  const save = async (who: Identity, expectedToken: string, background: Background | { kind: "upload" } | null, accent: string | null, file?: Buffer, filename = "image.png") => {
    const form = new FormData()
    form.set("preferences", JSON.stringify({ expectedToken, preferences: who.id === author.id ? { role: "author", background, accent } : { role: "viewer", background, accent } }))
    if (file) form.set("image", new File([new Uint8Array(file)], filename))
    return fetch(`${base}${path}`, { method: "PUT", headers: { cookie: who.cookie, origin: base }, body: form })
  }
  for (const viewer of [first, second]) assert([200, 201].includes((await request(sharesPath, author, "POST", { email: viewer.email })).status))
  const initialAuthor = await appearance(author), initialFirst = await appearance(first)
  assert.equal(initialAuthor.token, "0:0")
  assert.deepEqual(initialFirst.effective, initialAuthor.effective)
  assert.equal((await request(path, outsider)).status, 404)
  const cardResponse = await request(cardsPath, author, "POST", { title: "Revenue", x: 40, y: 60, width: 400, height: 260 })
  assert.equal(cardResponse.status, 201)
  const card = (await body<{ card: { id: string; membershipRevision: number } }>(cardResponse)).card
  assert.equal((await request(cardsPath, author, "POST", { title: "Orders", x: 480, y: 60, width: 400, height: 260 })).status, 201)
  assert.equal((await request(`${cardsPath}/${card.id}`, first, "PATCH", { membershipRevision: card.membershipRevision, patch: { x: 140, y: 160 } })).status, 200)
  const layoutBefore = (await body<{ layoutToken: string; cards: unknown[] }>(await request(cardsPath, author)))
  const viewerLayoutBefore = (await body<{ layoutToken: string; cards: unknown[] }>(await request(cardsPath, first)))
  const solid: Background = { kind: "solid", color: "#fefefe" }
  assert.equal((await save(author, initialAuthor.token, solid, "#ffffff")).status, 200)
  const afterSolid = await appearance(first)
  assert.deepEqual(afterSolid.effective.background, solid)
  assert.equal(afterSolid.effective.accent, "#ffffff")
  assert.equal(afterSolid.source.background, "author")
  assert.equal((await save(first, afterSolid.token, null, "#123abc")).status, 200)
  const firstAccent = await appearance(first)
  assert.deepEqual(firstAccent.effective.background, solid)
  assert.equal(firstAccent.effective.accent, "#123abc")
  assert.equal((await appearance(second)).effective.accent, "#ffffff")
  assert.equal((await save(author, (await appearance(author)).token, { kind: "solid", color: "#112233" }, "#000000")).status, 200)
  assert.equal((await appearance(first)).effective.background.kind, "solid")
  assert.equal((await appearance(first)).effective.accent, "#123abc")
  assert.equal((await save(first, firstAccent.token, null, null)).status, 409)
  assert.equal((await save(first, (await appearance(first)).token, null, null)).status, 200)
  assert.equal((await appearance(first)).effective.accent, "#000000")
  assert.equal((await save(first, firstAccent.token, null, null)).status, 409, "Reset revision must prevent ABA")
  const png = await sharp({ create: { width: 120, height: 80, channels: 3, background: "#88aacc" } }).png().toBuffer()
  const imageFixture = join(directory, "image.png")
  await writeFile(imageFixture, png)
  const upload = await save(author, (await appearance(author)).token, { kind: "upload" }, "#eeeeee", png)
  assert.equal(upload.status, 200, await upload.clone().text())
  const authorImage = (await body<AppearanceState>(upload)).effective.background
  assert.equal(authorImage.kind, "image")
  if (authorImage.kind !== "image") throw new Error("Expected image")
  const imageUrl = `/api/boards/${boardId}/appearance/assets/${authorImage.assetId}`
  const imageResponse = await request(imageUrl, first)
  assert.equal(imageResponse.status, 200)
  assert.equal(imageResponse.headers.get("content-type"), "image/webp")
  assert.match(imageResponse.headers.get("cache-control") ?? "", /private.*no-store/)
  assert.match(imageResponse.headers.get("vary") ?? "", /(?:^|,\s*)Cookie(?:,|$)/)
  assert.equal(imageResponse.headers.get("x-content-type-options"), "nosniff")
  assert.equal((await sharp(Buffer.from(await imageResponse.arrayBuffer())).metadata()).format, "webp")
  assert.equal((await request(imageUrl, outsider)).status, 404)
  const firstUpload = await save(first, (await appearance(first)).token, { kind: "upload" }, null, png)
  assert.equal(firstUpload.status, 200, await firstUpload.clone().text())
  const personalImage = (await body<AppearanceState>(firstUpload)).effective.background
  if (personalImage.kind !== "image") throw new Error("Expected personal image")
  const personalUrl = `/api/boards/${boardId}/appearance/assets/${personalImage.assetId}`
  assert.equal((await request(personalUrl, first)).status, 200)
  assert.equal((await request(personalUrl, second)).status, 404)
  assert.equal((await save(second, (await appearance(second)).token, { kind: "image", assetId: personalImage.assetId }, null)).status, 403)
  assert.equal((await save(first, (await appearance(first)).token, { kind: "image", assetId: authorImage.assetId }, null)).status, 403)
  const otherBoardResponse = await request("/api/boards", author, "POST", { name: "Other" })
  assert.equal(otherBoardResponse.status, 201)
  const otherBoardId = (await body<{ board: { id: string } }>(otherBoardResponse)).board.id
  assert.equal((await request(`/api/boards/${otherBoardId}/appearance/assets/${authorImage.assetId}`)).status, 404)
  const animated = apng(png)
  assert.equal((await sharp(animated).metadata()).format, "png", "APNG fixture must retain a decodable PNG frame")
  const invalid = [Buffer.from("<svg></svg>"), Buffer.from("not image"), animated]
  for (const bytes of invalid) assert.equal((await save(author, (await appearance(author)).token, { kind: "upload" }, "#eeeeee", bytes)).status, 400)
  const overSize = await save(author, (await appearance(author)).token, { kind: "upload" }, "#eeeeee", Buffer.alloc(10 * 1024 * 1024 + 1))
  assert.equal(overSize.status, 413, await overSize.clone().text())
  const badForm = new FormData(); badForm.set("preferences", "{}")
  assert.equal((await fetch(`${base}${path}`, { method: "PUT", headers: { cookie: author.cookie, origin: "https://evil.example" }, body: badForm })).status, 403)
  const tooLarge = new ReadableStream({ start(controller) { for (let i = 0; i < 12; i++) controller.enqueue(new Uint8Array(1024 * 1024)); controller.close() } })
  const oversizedChunked = await fetch(`${base}${path}`, { method: "PUT", headers: { cookie: author.cookie, origin: base, "content-type": "multipart/form-data; boundary=x" }, body: tooLarge, duplex: "half" } as RequestInit)
  assert.equal(oversizedChunked.status, 413, await oversizedChunked.clone().text())
  await prisma.$executeRawUnsafe(`CREATE TRIGGER appearance_failure BEFORE UPDATE OF appearanceAccent ON Board BEGIN SELECT RAISE(ABORT, 'synthetic appearance failure'); END`)
  const fileCount = (await readdir(storage)).length
  try { assert.equal((await save(author, (await appearance(author)).token, { kind: "upload" }, "#abcabc", png)).status, 503); assert.equal((await readdir(storage)).length, fileCount) }
  finally { await prisma.$executeRawUnsafe("DROP TRIGGER appearance_failure") }
  assert.equal((await appearance(author)).effective.accent, "#eeeeee")
  const layoutAfter = await body<{ layoutToken: string; cards: unknown[] }>(await request(cardsPath, author))
  assert.equal(layoutAfter.layoutToken, layoutBefore.layoutToken)
  assert.deepEqual(layoutAfter.cards, layoutBefore.cards)
  const viewerLayoutAfter = await body<{ layoutToken: string; cards: unknown[] }>(await request(cardsPath, first))
  assert.equal(viewerLayoutAfter.layoutToken, viewerLayoutBefore.layoutToken)
  assert.deepEqual(viewerLayoutAfter.cards, viewerLayoutBefore.cards)
  const grants = (await body<{ shares: Array<{ id: string; email: string }> }>(await request(sharesPath))).shares
  const firstGrant = grants.find(grant => grant.email === first.email)!
  assert.equal((await request(`${sharesPath}/${firstGrant.id}`, author, "DELETE", {})).status, 200)
  assert.equal((await request(personalUrl, first)).status, 404)
  assert.equal((await request(imageUrl, first)).status, 404)
  assert.equal((await request(path, first)).status, 404)
  const otherPath = `/api/boards/${otherBoardId}/appearance`
  const otherState = await body<AppearanceState>(await request(otherPath))
  const otherForm = new FormData()
  otherForm.set("preferences", JSON.stringify({ expectedToken: otherState.token, preferences: { role: "author", background: { kind: "solid", color: "#f1d3a1" }, accent: "#000000" } }))
  assert.equal((await fetch(`${base}${otherPath}`, { method: "PUT", headers: { cookie: author.cookie, origin: base }, body: otherForm })).status, 200)
  const deleteBoard = await request("/api/boards", author, "POST", { name: "Delete with images" })
  const doomed = (await body<{ board: { id: string } }>(deleteBoard)).board.id
  await request(`/api/boards/${doomed}/shares`, author, "POST", { email: second.email })
  const doomedPath = `/api/boards/${doomed}/appearance`
  const doomedSave = async (who: Identity) => { const state = await body<AppearanceState>(await request(doomedPath, who)); const form = new FormData(); form.set("preferences", JSON.stringify({ expectedToken: state.token, preferences: { role: who.id === author.id ? "author" : "viewer", background: { kind: "upload" }, accent: who.id === author.id ? "#123456" : null } })); form.set("image", new File([new Uint8Array(png)], "image.png")); return fetch(`${base}${doomedPath}`, { method: "PUT", headers: { cookie: who.cookie, origin: base }, body: form }) }
  const doomedAuthorSave = await doomedSave(author)
  const doomedViewerSave = await doomedSave(second)
  assert.equal(doomedAuthorSave.status, 200)
  assert.equal(doomedViewerSave.status, 200)
  const doomedAssets = [(await body<AppearanceState>(doomedAuthorSave)).effective.background, (await body<AppearanceState>(doomedViewerSave)).effective.background].map(value => value.kind === "image" ? value.assetId : "")
  assert(doomedAssets.every(Boolean))
  assert.equal((await request(`/api/boards/${doomed}`, author, "DELETE", {})).status, 200, "Board deletion must cascade image references")
  assert.equal(await prisma.imageAsset.count({ where: { boardId: doomed } }), 0)
  assert.equal(await prisma.viewerAppearance.count({ where: { boardId: doomed } }), 0)
  const old = new Date(Date.now() - 48 * 60 * 60 * 1000)
  const staleId = `a_${randomBytes(16).toString("hex")}`
  await prisma.imageAsset.create({ data: { id: staleId, boardId: otherBoardId, uploaderId: author.id, scope: "author", byteSize: png.length, width: 120, height: 80, createdAt: old } })
  await writeFile(join(storage, `${staleId}.webp`), png)
  for (const id of [...doomedAssets, authorImage.assetId, personalImage.assetId, staleId]) await utimes(join(storage, `${id}.webp`), old, old)
  const cleanup = spawnSync(process.execPath, ["--import", "tsx", "scripts/appearance-cleanup.ts"], { env: setupEnv, encoding: "utf8" })
  assert.equal(cleanup.status, 0, `${cleanup.stdout}\n${cleanup.stderr}`)
  for (const id of doomedAssets) await assert.rejects(stat(join(storage, `${id}.webp`)), { code: "ENOENT" })
  assert.equal(await prisma.imageAsset.count({ where: { id: staleId } }), 0)
  await assert.rejects(stat(join(storage, `${staleId}.webp`)), { code: "ENOENT" })
  for (const id of [authorImage.assetId, personalImage.assetId]) assert((await stat(join(storage, `${id}.webp`))).isFile(), "Cleanup keeps referenced images")
  assert([200, 201].includes((await request(sharesPath, author, "POST", { email: first.email })).status))
  const bulkUser = await identity("Bulk")
  const bulkBoard = (await workspace(bulkUser)).originalBoardId
  const bulkOther = (await body<{ board: { id: string } }>(await request("/api/boards", bulkUser, "POST", { name: "Bulk second" }))).board.id
  await request(`/api/boards/${otherBoardId}/shares`, author, "POST", { email: bulkUser.email })
  await request(`/api/boards/${bulkOther}/shares`, bulkUser, "POST", { email: outsider.email })
  const bulkState = async (id: string, who = bulkUser) => body<AppearanceState>(await request(`/api/boards/${id}/appearance`, who))
  const targetScope = async (id = bulkBoard) => {
    const response = await request(`/api/boards/${id}/appearance?all=true`, bulkUser)
    assert.equal(response.status, 200)
    return (await body<{ targets: AppearanceTarget[] }>(response)).targets
  }
  const bulkSave = async (targets: AppearanceTarget[], background: AppearanceChoice | null, accent: string | null, image?: Buffer, source = bulkBoard) => {
    const form = new FormData()
    form.set("preferences", JSON.stringify({ expectedToken: targets.find(target => target.boardId === source)!.token, targets, preferences: { role: source === otherBoardId ? "viewer" : "author", background, accent } }))
    if (image) form.set("image", new File([new Uint8Array(image)], "bulk.png"))
    return fetch(`${base}/api/boards/${source}/appearance`, { method: "PUT", headers: { cookie: bulkUser.cookie, origin: base }, body: form })
  }
  const remoteDefaults = await bulkState(otherBoardId, author)
  const bulkSolid: Background = { kind: "solid", color: "#654321" }
  let scope = await targetScope()
  assert.deepEqual(scope.map(target => target.boardId).sort(), [bulkBoard, bulkOther, otherBoardId].sort(), "All includes owned and verified shared boards only")
  assert.equal((await request(`/api/boards/${bulkBoard}/appearance?all=true`, outsider)).status, 404)
  assert.equal((await bulkSave(scope, bulkSolid, "#abcdef")).status, 200)
  for (const id of [bulkBoard, bulkOther, otherBoardId]) assert.deepEqual((await bulkState(id)).effective, { background: bulkSolid, accent: "#abcdef" })
  assert.deepEqual((await bulkState(otherBoardId, author)), remoteDefaults, "Apply all never changes another author's defaults")
  assert.equal((await bulkState(bulkOther, outsider)).effective.accent, "#abcdef", "Owned-board defaults reach invited viewers")
  scope = await targetScope()
  const change = new FormData()
  change.set("preferences", JSON.stringify({ expectedToken: (await bulkState(bulkOther)).token, preferences: { role: "author", background: bulkSolid, accent: "#010203" } }))
  assert.equal((await fetch(`${base}/api/boards/${bulkOther}/appearance`, { method: "PUT", headers: { cookie: bulkUser.cookie, origin: base }, body: change })).status, 200)
  const beforeConflict = await Promise.all([bulkBoard, bulkOther, otherBoardId].map(id => bulkState(id)))
  const beforeConflictFiles = (await readdir(storage)).length
  assert.equal((await bulkSave(scope, { kind: "upload" }, "#111111", png)).status, 409)
  assert.deepEqual(await Promise.all([bulkBoard, bulkOther, otherBoardId].map(id => bulkState(id))), beforeConflict, "One stale board rejects the whole batch")
  assert.equal((await readdir(storage)).length, beforeConflictFiles)
  scope = await targetScope()
  scope = [bulkBoard, otherBoardId, bulkOther].map(id => scope.find(target => target.boardId === id)!)
  await prisma.$executeRawUnsafe(`CREATE TRIGGER bulk_appearance_failure BEFORE UPDATE OF appearanceAccent ON Board WHEN NEW.id = '${bulkOther}' BEGIN SELECT RAISE(ABORT, 'synthetic bulk failure'); END`)
  const beforeFailure = await Promise.all([bulkBoard, bulkOther, otherBoardId].map(id => bulkState(id)))
  const beforeFailureFiles = (await readdir(storage)).length
  const beforeFailureAssets = await prisma.imageAsset.count()
  try {
    assert.equal((await bulkSave(scope, { kind: "upload" }, "#998877", png)).status, 503)
    assert.deepEqual(await Promise.all([bulkBoard, bulkOther, otherBoardId].map(id => bulkState(id))), beforeFailure)
    assert.equal((await readdir(storage)).length, beforeFailureFiles, "Failed batch removes every staged image")
    assert.equal(await prisma.imageAsset.count(), beforeFailureAssets)
  } finally { await prisma.$executeRawUnsafe("DROP TRIGGER bulk_appearance_failure") }
  assert.equal((await bulkSave(await targetScope(), { kind: "upload" }, "#abc123", png)).status, 200)
  const images = await Promise.all([bulkBoard, bulkOther, otherBoardId].map(id => bulkState(id)))
  const assetIds = images.map(item => item.effective.background.kind === "image" ? item.effective.background.assetId : "")
  assert.equal(new Set(assetIds).size, 3, "Images are scoped separately to each board")
  for (const [index, id] of [bulkBoard, bulkOther, otherBoardId].entries()) assert.equal((await request(`/api/boards/${id}/appearance/assets/${assetIds[index]}`, bulkUser)).status, 200)
  assert.equal((await request(`/api/boards/${otherBoardId}/appearance/assets/${assetIds[2]}`, author)).status, 404, "Shared-board personal image is private even from its author")
  assert.equal((await request(`/api/boards/${bulkOther}/appearance/assets/${assetIds[0]}`, bulkUser)).status, 404)
  assert.equal((await bulkSave(await targetScope(), { kind: "image", assetId: assetIds[0] }, "#cba321")).status, 200, "An existing selected image can be applied without uploading again")
  const sourceBytes = Buffer.from(await (await request(`/api/boards/${bulkBoard}/appearance/assets/${assetIds[0]}`, bulkUser)).arrayBuffer())
  for (const [index, id] of [bulkOther, otherBoardId].entries()) {
    const copied = (await bulkState(id)).effective.background
    assert.equal(copied.kind, "image")
    if (copied.kind !== "image") throw new Error("Expected copied image")
    assert.notEqual(copied.assetId, assetIds[index + 1], "Existing-image apply creates a fresh board-scoped copy")
    assert.deepEqual(Buffer.from(await (await request(`/api/boards/${id}/appearance/assets/${copied.assetId}`, bulkUser)).arrayBuffer()), sourceBytes)
  }
  const ownedBeforeInheritance = await Promise.all([bulkBoard, bulkOther].map(id => bulkState(id)))
  assert.equal((await bulkSave(await targetScope(otherBoardId), null, null, undefined, otherBoardId)).status, 200)
  assert.deepEqual(await Promise.all([bulkBoard, bulkOther].map(id => bulkState(id))), ownedBeforeInheritance, "Inherited fields leave owned defaults untouched")
  assert.deepEqual((await bulkState(otherBoardId)).effective, remoteDefaults.effective)
  scope = await targetScope()
  const bulkGrants = await body<{ shares: Array<{ id: string; email: string }> }>(await request(`/api/boards/${otherBoardId}/shares`))
  const bulkGrant = bulkGrants.shares.find(item => item.email === bulkUser.email)!
  assert.equal((await request(`/api/boards/${otherBoardId}/shares/${bulkGrant.id}`, author, "DELETE", {})).status, 200)
  assert.equal((await bulkSave(scope, bulkSolid, "#101010")).status, 409, "Revocation rejects a captured all-board batch")
  assert.deepEqual(await Promise.all([bulkBoard, bulkOther].map(id => bulkState(id))), ownedBeforeInheritance)
  scope = await targetScope()
  const newBulkBoard = (await body<{ board: { id: string } }>(await request("/api/boards", bulkUser, "POST", { name: "New during bulk preview" }))).board.id
  assert.equal((await bulkSave(scope, bulkSolid, "#202020")).status, 409, "A changed board set requires a fresh preview scope")
  assert.equal((await request(`/api/boards/${newBulkBoard}`, bulkUser, "DELETE", {})).status, 200)
  const colorsUser = await identity("Colors"), colorsHost = await identity("ColorsHost"), colorsViewer = await identity("ColorsViewer")
  const colorsBoard = (await workspace(colorsUser)).originalBoardId
  const colorsOther = (await body<{ board: { id: string } }>(await request("/api/boards", colorsUser, "POST", { name: "Colors second" }))).board.id
  const colorsShared = (await workspace(colorsHost)).originalBoardId
  assert([200, 201].includes((await request(`/api/boards/${colorsBoard}/shares`, colorsUser, "POST", { email: colorsViewer.email })).status))
  assert([200, 201].includes((await request(`/api/boards/${colorsShared}/shares`, colorsHost, "POST", { email: colorsUser.email })).status))
  const colorsState = async (id: string, who: Identity) => body<AppearanceState>(await request(`/api/boards/${id}/appearance`, who))
  const colorsScope = async (id: string) => (await body<{ targets: AppearanceTarget[] }>(await request(`/api/boards/${id}/appearance?all=true`, colorsUser))).targets
  const writeColors = async (id: string, who: Identity, colors: unknown, targets?: AppearanceTarget[], accent?: string) => {
    const state = await colorsState(id, who)
    const form = new FormData()
    form.set("preferences", JSON.stringify({ expectedToken: targets?.find(item => item.boardId === id)?.token ?? state.token, ...(targets ? { targets } : {}), preferences: { role: state.preferences.role, background: state.preferences.value.background, accent: accent ?? state.preferences.value.accent, ...(colors === undefined ? {} : { colors }) } }))
    return fetch(`${base}/api/boards/${id}/appearance`, { method: "PUT", headers: { cookie: who.cookie, origin: base }, body: form })
  }
  const manualColors = { mainToolbar: "#ffffff", boardToolbar: "#10243b", card: "#fefefe", button: "#000000" }
  assert.equal((await writeColors(colorsBoard, colorsUser, manualColors)).status, 200)
  assert.deepEqual((await colorsState(colorsBoard, colorsUser)).effective.colors, manualColors)
  assert.deepEqual((await colorsState(colorsBoard, colorsViewer)).effective.colors, manualColors, "Viewers inherit manual author colors")
  const privateColors = { mainToolbar: "auto", card: "#112233" }
  assert.equal((await writeColors(colorsBoard, colorsViewer, privateColors)).status, 200)
  assert.deepEqual((await colorsState(colorsBoard, colorsViewer)).effective.colors, { boardToolbar: "#10243b", card: "#112233", button: "#000000" }, "Personal automatic mode bypasses the author's manual toolbar")
  assert.deepEqual((await colorsState(colorsBoard, colorsUser)).effective.colors, manualColors)
  assert.equal((await writeColors(colorsBoard, colorsUser, { ...manualColors, mainToolbar: "#334455" })).status, 200)
  const beforeLegacy = await colorsState(colorsBoard, colorsViewer)
  assert.equal((await writeColors(colorsBoard, colorsViewer, undefined, undefined, "#abcdef")).status, 200)
  const afterLegacy = await colorsState(colorsBoard, colorsViewer)
  assert.deepEqual(afterLegacy.preferences.value.colors, beforeLegacy.preferences.value.colors, "A legacy accent-only write preserves advanced choices")
  assert.deepEqual(afterLegacy.effective.colors, beforeLegacy.effective.colors)
  const beforeInvalidColors = await colorsState(colorsBoard, colorsUser)
  for (const invalid of [null, [], { unknown: "#ffffff" }, { card: "red" }, { card: null }, { card: "auto" }]) assert.equal((await writeColors(colorsBoard, colorsUser, invalid)).status, 400)
  assert.deepEqual(await colorsState(colorsBoard, colorsUser), beforeInvalidColors)
  await assert.rejects(prisma.$executeRawUnsafe(`UPDATE Board SET appearanceCard = 'red' WHERE id = '${colorsBoard}'`), /constraint|check/i)
  assert.equal((await writeColors(colorsBoard, colorsViewer, {})).status, 200)
  assert.equal((await colorsState(colorsBoard, colorsViewer)).preferences.value.colors, undefined)
  assert.deepEqual((await colorsState(colorsBoard, colorsViewer)).effective.colors, beforeInvalidColors.author.colors, "Reset restores current author manual defaults")
  assert.equal((await writeColors(colorsBoard, colorsUser, {})).status, 200)
  assert.equal((await colorsState(colorsBoard, colorsUser)).effective.colors, undefined)
  assert.equal((await writeColors(colorsShared, colorsHost, { mainToolbar: "#aabbcc", boardToolbar: "#ffeedd", button: "#ffffff" })).status, 200)
  const hostColors = await colorsState(colorsShared, colorsHost)
  assert.equal((await writeColors(colorsBoard, colorsUser, { mainToolbar: "#445566" }, await colorsScope(colorsBoard))).status, 200)
  for (const id of [colorsBoard, colorsOther, colorsShared]) assert.deepEqual((await colorsState(id, colorsUser)).effective.colors, { mainToolbar: "#445566" }, "Author bulk Automatic bypasses destination author custom defaults on shared boards")
  assert.deepEqual(await colorsState(colorsShared, colorsHost), hostColors)
  assert.equal((await writeColors(colorsBoard, colorsUser, { mainToolbar: "#101010", boardToolbar: "#232323", button: "#eeeeee" })).status, 200)
  assert.equal((await writeColors(colorsOther, colorsUser, { boardToolbar: "#cccccc", card: "#dddddd", button: "#000000" })).status, 200)
  assert.equal((await writeColors(colorsShared, colorsUser, { mainToolbar: "auto", card: "#112233" }, await colorsScope(colorsShared))).status, 200)
  assert.deepEqual((await colorsState(colorsBoard, colorsUser)).effective.colors, { boardToolbar: "#232323", card: "#112233", button: "#eeeeee" })
  assert.deepEqual((await colorsState(colorsOther, colorsUser)).effective.colors, { boardToolbar: "#cccccc", card: "#112233", button: "#000000" }, "Inherited viewer fields preserve each owned board's manual defaults")
  assert.deepEqual((await colorsState(colorsShared, colorsUser)).preferences.value.colors, { mainToolbar: "auto", card: "#112233" })
  assert.deepEqual(await colorsState(colorsShared, colorsHost), hostColors)
  const staleColorsScope = await colorsScope(colorsBoard)
  assert.equal((await writeColors(colorsOther, colorsUser, undefined, undefined, "#fedcba")).status, 200)
  const colorsBeforeConflict = await Promise.all([colorsBoard, colorsOther, colorsShared].map(id => colorsState(id, colorsUser)))
  assert.equal((await writeColors(colorsBoard, colorsUser, { card: "#abcdef" }, staleColorsScope)).status, 409)
  assert.deepEqual(await Promise.all([colorsBoard, colorsOther, colorsShared].map(id => colorsState(id, colorsUser))), colorsBeforeConflict)
  const colorsFailureScope = await colorsScope(colorsBoard)
  await prisma.$executeRawUnsafe(`CREATE TRIGGER colors_failure BEFORE UPDATE OF appearanceCard ON Board WHEN NEW.id = '${colorsOther}' BEGIN SELECT RAISE(ABORT, 'synthetic colors failure'); END`)
  try {
    assert.equal((await writeColors(colorsBoard, colorsUser, { card: "#abcdef" }, colorsFailureScope)).status, 503)
    assert.deepEqual(await Promise.all([colorsBoard, colorsOther, colorsShared].map(id => colorsState(id, colorsUser))), colorsBeforeConflict, "Advanced bulk writes roll back every target and revision on database failure")
  } finally { await prisma.$executeRawUnsafe("DROP TRIGGER colors_failure") }
  console.log("Advanced colors persistence, inheritance, automatic overrides, validation, legacy compatibility and mixed-role atomic bulk saves: passed")
  console.log("Appearance all-board atomic saves, private overrides, image copies, conflicts, revocation and rollback: passed")
  console.log("Appearance HTTP access, inheritance, uploads, rollback, revisions, deletion: passed")
  if (process.argv.includes("--browser")) {
    await prisma.dashboardCard.update({ where: { id: card.id }, data: { payload: JSON.stringify(parseBotDocument({ schemaVersion: "1", title: "Revenue", layout: { direction: "vertical", gap: "small" }, components: [{ component: "paragraph", value: "Readable card content" }, { component: "richtext", value: "<pre><code>revenue = 42</code></pre><a href=\"https://example.test\">Report source</a>" }, { component: "status", value: { label: "Connected", tone: "success", description: "Current data" } }, { component: "status", value: { label: "Review", tone: "warning" } }, { component: "table", value: { columns: [{ key: "metric", label: "Metric" }, { key: "value", label: "Value" }], rows: [{ metric: "Revenue", value: 42 }] } }] })), acceptedAt: new Date() } })
    const largeImageFixture = join(directory, "large.png")
    const large = await sharp(randomBytes(4800 * 3200 * 3), { raw: { width: 4800, height: 3200, channels: 3 } }).png().toBuffer()
    assert(large.length > 10 * 1024 * 1024 && large.length < 50 * 1024 * 1024, "Large fixture exceeds the old upload cap but fits browser source admission")
    await writeFile(largeImageFixture, large)
    const rotatedImageFixture = join(directory, "rotated.jpg")
    const red = await sharp({ create: { width: 600, height: 800, channels: 3, background: "#ff0000" } }).png().toBuffer()
    await sharp({ create: { width: 1200, height: 800, channels: 3, background: "#0000ff" } }).composite([{ input: red, left: 0, top: 0 }]).withMetadata({ orientation: 6 }).jpeg().toFile(rotatedImageFixture)
    const animatedImageFixture = join(directory, "animated.png")
    await writeFile(animatedImageFixture, animated)
    const animatedWebpFixture = join(directory, "animated.webp")
    const frames = Buffer.alloc(120 * 160 * 3, 180)
    frames.fill(30, 120 * 80 * 3)
    const animatedWebp = await sharp(frames, { raw: { width: 120, height: 160, channels: 3, pageHeight: 80 } }).webp({ loop: 0, delay: [100, 100] }).toBuffer()
    assert.equal((await sharp(animatedWebp, { animated: true }).metadata()).pages, 2)
    await writeFile(animatedWebpFixture, animatedWebp)
    const compiled = join(process.cwd(), ".e2e/appearance/browser.mjs")
    await mkdir(join(process.cwd(), ".e2e/appearance"), { recursive: true })
    const build = spawnSync("node_modules/.bin/esbuild", ["scripts/appearance-browser.ts", "--platform=node", "--format=esm", "--target=node22", `--outfile=${compiled}`], { encoding: "utf8" })
    assert.equal(build.status, 0, build.stderr)
    const browser = spawn(process.execPath, [compiled], { env: { ...setupEnv, E2E_BASE_URL: base, E2E_BOARD_ID: boardId, E2E_OTHER_BOARD_ID: otherBoardId, E2E_IMAGE_PATH: imageFixture, E2E_LARGE_IMAGE_PATH: largeImageFixture, E2E_ROTATED_IMAGE_PATH: rotatedImageFixture, E2E_ANIMATED_IMAGE_PATH: animatedImageFixture, E2E_ANIMATED_WEBP_PATH: animatedWebpFixture, E2E_AUTHOR_SESSION_TOKEN: author.cookie.split("=")[1], E2E_FIRST_VIEWER_SESSION_TOKEN: first.cookie.split("=")[1], E2E_SECOND_VIEWER_SESSION_TOKEN: second.cookie.split("=")[1] }, stdio: ["ignore", "pipe", "pipe"] })
    let browserOutput = ""; browser.stdout.on("data", data => { browserOutput += String(data) }); browser.stderr.on("data", data => { browserOutput += String(data) })
    const timer = setTimeout(() => browser.kill("SIGTERM"), 150_000)
    const [status] = await once(browser, "exit")
    clearTimeout(timer)
    assert.equal(status, 0, `${browserOutput}\n${output.slice(-2000)}`)
    console.log(browserOutput)
  }
  assert.equal((await request(`/api/boards/${otherBoardId}`, author, "DELETE", {})).status, 200)
} finally {
  if (child && child.exitCode === null && child.signalCode === null) { child.kill("SIGTERM"); await once(child, "exit").catch(() => {}) }
  await prisma?.$disconnect()
  await rm(directory, { recursive: true, force: true })
}
