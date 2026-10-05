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
import type { AppearanceState, Background } from "../lib/appearance"

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
  console.log("Appearance HTTP access, inheritance, uploads, rollback, revisions, deletion: passed")
  if (process.argv.includes("--browser")) {
    const compiled = join(process.cwd(), ".e2e/appearance/browser.mjs")
    await mkdir(join(process.cwd(), ".e2e/appearance"), { recursive: true })
    const build = spawnSync("node_modules/.bin/esbuild", ["scripts/appearance-browser.ts", "--platform=node", "--format=esm", "--target=node22", `--outfile=${compiled}`], { encoding: "utf8" })
    assert.equal(build.status, 0, build.stderr)
    const browser = spawn(process.execPath, [compiled], { env: { ...setupEnv, E2E_BASE_URL: base, E2E_BOARD_ID: boardId, E2E_OTHER_BOARD_ID: otherBoardId, E2E_IMAGE_PATH: imageFixture, E2E_AUTHOR_SESSION_TOKEN: author.cookie.split("=")[1], E2E_FIRST_VIEWER_SESSION_TOKEN: first.cookie.split("=")[1], E2E_SECOND_VIEWER_SESSION_TOKEN: second.cookie.split("=")[1] }, stdio: ["ignore", "pipe", "pipe"] })
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
