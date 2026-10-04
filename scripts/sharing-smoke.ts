import assert from "node:assert/strict"
import { spawn, spawnSync, type ChildProcess } from "node:child_process"
import { randomBytes, randomUUID } from "node:crypto"
import { once } from "node:events"
import { createServer } from "node:net"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { PrismaAdapter } from "@next-auth/prisma-adapter"
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3"
import { encode } from "next-auth/jwt"
import { PrismaClient } from "../generated/prisma/client"

type Card = { id: string; boardId: string; membershipRevision: number; title: string; contentRevision: number; x: number; y: number; width: number; height: number; layoutSource: "author" | "personal"; externalKey?: string | null }
type Snapshot = { board: { role: "author" | "viewer"; author?: { name: string | null; email: string | null } }; role: "author" | "viewer"; cards: Card[]; layoutToken: string }
type Share = { id: string; email: string; name: string | null; status: "pending" | "active" }
type Identity = { id: string; email: string; cookie: string }
const directory = await mkdtemp(join(tmpdir(), "sharing-api-"))
const databaseUrl = `file:${join(directory, "api.db")}`
const secret = randomBytes(32).toString("hex")
const setupEnv = { ...process.env, DATABASE_URL: databaseUrl, NEXTAUTH_SECRET: secret, GOOGLE_CLIENT_ID: "", GOOGLE_CLIENT_SECRET: "", LOCAL_UI_MODE: "false" }
let child: ChildProcess | undefined
let prisma: PrismaClient | undefined
let output = ""
async function freePort() {
  const listener = createServer().listen(0, "127.0.0.1")
  await once(listener, "listening")
  const address = listener.address()
  assert(address && typeof address !== "string")
  await new Promise<void>((resolve) => listener.close(() => resolve()))
  return address.port
}
const geometry = (card: Card) => [card.x, card.y, card.width, card.height]
const body = async <T>(response: Response): Promise<T> => response.json() as Promise<T>
try {
  await writeFile(join(directory, "api.db"), "")
  const migration = spawnSync("node_modules/.bin/prisma", ["migrate", "deploy"], { env: setupEnv, encoding: "utf8" })
  assert.equal(migration.status, 0, `${migration.stdout}\n${migration.stderr}`)
  prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: databaseUrl }) })
  const adapter = PrismaAdapter(prisma)
  async function identity(name: string, verified = true): Promise<Identity> {
    const email = `${name.toLowerCase()}-${randomUUID()}@example.test`
    const user = await adapter.createUser!({ name, email, emailVerified: null, image: null })
    if (verified) await prisma!.user.update({ where: { id: user.id }, data: { googleVerifiedEmail: email } })
    const cookie = `next-auth.session-token=${await encode({ token: { sub: user.id, name, email, googleVerified: verified }, secret })}`
    return { id: user.id, email, cookie }
  }
  const author = await identity("Author")
  const first = await identity("First")
  const second = await identity("Second")
  const unverified = await identity("Unverified", false)
  const outsider = await identity("Outsider")
  const pendingEmail = `future-${randomUUID()}@example.test`
  const port = await freePort()
  const base = `http://127.0.0.1:${port}`
  child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", String(port)], { env: { ...setupEnv, NEXTAUTH_URL: base }, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] })
  child.stdout?.on("data", (chunk) => { output += String(chunk) })
  child.stderr?.on("data", (chunk) => { output += String(chunk) })
  for (let i = 0; i < 90; i++) {
    if (child.exitCode !== null) break
    try { if ((await fetch(`${base}/login`)).status === 200) break } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  assert.equal((await fetch(`${base}/login`)).status, 200, `Server did not start: ${output.slice(-2000)}`)
  const request = (path: string, method = "GET", data?: unknown, who: Identity | null = author, headers: Record<string, string> = {}) => fetch(`${base}${path}`, {
    method, redirect: "manual", headers: { ...(who ? { cookie: who.cookie } : {}), origin: base, "content-type": "application/json", ...headers }, body: data === undefined ? undefined : JSON.stringify(data),
  })
  const workspace = (who: Identity) => request("/api/boards", "GET", undefined, who).then((r) => body<{ boards: Array<{ id: string; name: string }>; originalBoardId: string }>(r))
  const authorBoard = (await workspace(author)).originalBoardId
  const boardPath = `/boards/${authorBoard}`
  const cardsPath = `/api/boards/${authorBoard}/cards`
  const sharesPath = `/api/boards/${authorBoard}/shares`
  const layoutPath = `/api/boards/${authorBoard}/layout`
  const snapshot = async (who: Identity): Promise<Snapshot> => {
    const response = await request(cardsPath, "GET", undefined, who)
    assert.equal(response.status, 200)
    assert.match(response.headers.get("cache-control") ?? "", /no-store/)
    return body<Snapshot>(response)
  }
  const createCard = async (title: string, x: number, y: number) => {
    const response = await request(cardsPath, "POST", { title, x, y, width: 400, height: 260 })
    assert.equal(response.status, 201)
    return (await body<{ card: Card }>(response)).card
  }
  assert.equal((await request(boardPath, "GET", undefined, null)).status, 307)
  const signIn = await request(boardPath, "GET", undefined, null)
  assert.equal(new URL(signIn.headers.get("location")!, base).searchParams.get("callbackUrl"), boardPath)
  assert.equal((await request(boardPath, "GET", undefined, outsider)).status, 404)
  assert.equal((await request(cardsPath, "GET", undefined, outsider)).status, 404)
  assert.equal((await request(cardsPath, "GET", undefined, unverified)).status, 404)
  assert.equal((await request(sharesPath, "GET", undefined, outsider)).status, 404)
  assert.equal((await request(sharesPath, "GET", undefined, null, { authorization: "Bearer fake" })).status, 401)
  assert.equal((await request(sharesPath, "POST", { email: first.email }, author, { origin: "https://evil.example" })).status, 403)
  const grant = async (email: string) => {
    const response = await request(sharesPath, "POST", { email })
    assert([200, 201].includes(response.status), `${response.status}: ${await response.clone().text()}`)
    return (await body<{ share: Share }>(response)).share
  }
  await grant(unverified.email)
  assert.equal((await request(cardsPath, "GET", undefined, unverified)).status, 401, "An invited unverified user must remain locked out")
  const firstGrant = await grant(`  ${first.email.toUpperCase()}  `)
  assert.equal(firstGrant.email, first.email)
  assert.equal((await grant(first.email)).id, firstGrant.id)
  const legacyFirst = { ...first, cookie: `next-auth.session-token=${await encode({ token: { sub: first.id, email: first.email }, secret })}` }
  assert.equal((await request(cardsPath, "GET", undefined, legacyFirst)).status, 401, "A legacy session must reauthenticate even when stored proof exists")
  const reauth = await request(boardPath, "GET", undefined, legacyFirst)
  assert.equal(reauth.status, 307)
  const reauthUrl = new URL(reauth.headers.get("location")!, base)
  assert.equal(reauthUrl.pathname, "/login")
  assert.equal(reauthUrl.searchParams.get("reauth"), "1")
  assert.equal(reauthUrl.searchParams.get("callbackUrl"), boardPath)
  assert.equal((await request(`${reauthUrl.pathname}${reauthUrl.search}`, "GET", undefined, legacyFirst)).status, 200)
  const concurrent = await Promise.all([grant("parallel-grant@example.test"), grant("parallel-grant@example.test")])
  assert.equal(concurrent[0].id, concurrent[1].id, "Concurrent duplicate invitations converge")
  const secondGrant = await grant(second.email)
  const pendingGrant = await grant(pendingEmail)
  assert.equal(pendingGrant.status, "pending")
  assert.equal((await request(sharesPath, "POST", { email: author.email })).status, 409)
  assert.equal((await request(sharesPath, "GET", undefined, first)).status, 404)
  assert.equal((await request(sharesPath, "POST", { email: outsider.email }, first)).status, 404)
  assert.equal((await request(`${sharesPath}/${secondGrant.id}`, "DELETE", {}, first)).status, 404)
  const listed = (await body<{ shares: Share[] }>(await request(sharesPath))).shares
  assert(listed.some((share) => share.id === pendingGrant.id && share.status === "pending"))
  assert.equal((await snapshot(first)).board.role, "viewer")
  assert.equal((await snapshot(second)).role, "viewer")
  const future = await adapter.createUser!({ name: "Future", email: pendingEmail, emailVerified: null, image: null })
  const futureCookie = `next-auth.session-token=${await encode({ token: { sub: future.id, email: pendingEmail, googleVerified: true }, secret })}`
  const futureIdentity = { id: future.id, email: pendingEmail, cookie: futureCookie }
  assert.equal((await request(cardsPath, "GET", undefined, futureIdentity)).status, 401, "JWT claim alone must not bind an invitation")
  await prisma.user.update({ where: { id: future.id }, data: { googleVerifiedEmail: pendingEmail } })
  assert.equal((await snapshot(futureIdentity)).role, "viewer")
  const cardA = await createCard("A", 40, 60)
  const cardB = await createCard("B", 60, 400)
  const original = await snapshot(author)
  assert.equal(original.role, "author")
  assert(original.layoutToken)
  const patch = (who: Identity, card: Card, fields: Record<string, unknown>) => request(`${cardsPath}/${card.id}`, "PATCH", { patch: fields, membershipRevision: card.membershipRevision }, who)
  assert.equal((await patch(first, cardA, { x: 200, y: 220, width: 440, height: 280 })).status, 200)
  assert.equal((await patch(second, cardA, { x: 600, y: 620, width: 460, height: 300 })).status, 200)
  assert.equal((await patch(first, cardA, { title: "Stolen" })).status, 403)
  assert.equal((await request(`${cardsPath}/${cardA.id}`, "DELETE", { membershipRevision: cardA.membershipRevision }, first)).status, 404)
  assert.equal((await request(`/api/cards/${cardA.id}/move`, "POST", { sourceBoardId: authorBoard, destinationBoardId: authorBoard }, first)).status, 404)
  assert.equal((await request(`/api/boards/${authorBoard}`, "PATCH", { name: "Stolen" }, first)).status, 404)
  assert.equal((await request(`/api/bot/connection`, "POST", {}, first)).status, 200, "Viewer may own their own bot connection")
  const firstBot = await body<{ token: string }>(await request("/api/bot/connection", "POST", {}, first))
  const botBoards = await body<{ boards: Array<{ id: string }> }>(await request("/api/bot/boards", "GET", undefined, null, { authorization: `Bearer ${firstBot.token}` }))
  assert(!botBoards.boards.some((board) => board.id === authorBoard))
  assert.equal((await request(sharesPath, "GET", undefined, null, { authorization: `Bearer ${firstBot.token}` })).status, 401)
  const a1 = (await snapshot(first)).cards.find((card) => card.id === cardA.id)!
  const a2 = (await snapshot(second)).cards.find((card) => card.id === cardA.id)!
  const aa = (await snapshot(author)).cards.find((card) => card.id === cardA.id)!
  assert.deepEqual(geometry(a1), [200, 220, 440, 280])
  assert.deepEqual(geometry(a2), [600, 620, 460, 300])
  assert.deepEqual(geometry(aa), geometry(cardA))
  assert.equal(a1.layoutSource, "personal")
  assert.equal((await patch(author, cardA, { x: 100, y: 120, width: 420, height: 270 })).status, 200)
  assert.equal((await patch(author, cardB, { x: 110, y: 500 })).status, 200)
  const afterAuthor = await snapshot(first)
  assert.deepEqual(geometry(afterAuthor.cards.find((card) => card.id === cardA.id)!), [200, 220, 440, 280])
  assert.deepEqual(geometry(afterAuthor.cards.find((card) => card.id === cardB.id)!), [110, 500, 400, 260])
  assert.equal(afterAuthor.cards.find((card) => card.id === cardB.id)!.layoutSource, "author")
  const beforeBatch = await snapshot(first)
  const positions = beforeBatch.cards.map((card, i) => ({ cardId: card.id, x: 20 + i * 440, y: 20 }))
  const save = (who: Identity, expectedLayoutToken: string, proposed = positions) => request(layoutPath, "PUT", { expectedLayoutToken, positions: proposed }, who)
  assert.equal((await save(first, beforeBatch.layoutToken, [positions[0], positions[0]])).status, 400)
  assert.equal((await save(first, beforeBatch.layoutToken, positions.slice(0, 1))).status, 409)
  assert.equal((await save(first, beforeBatch.layoutToken, positions.map((p) => ({ ...p, x: -1 })))).status, 400)
  assert.equal((await snapshot(first)).layoutToken, beforeBatch.layoutToken)
  const saved = await save(first, beforeBatch.layoutToken)
  assert.equal(saved.status, 200)
  assert.equal((await save(first, beforeBatch.layoutToken)).status, 409)
  assert.equal((await snapshot(second)).cards.find((card) => card.id === cardA.id)!.x, 600)
  const beforeManual = await snapshot(first)
  assert.equal((await patch(first, cardA, { x: 260 })).status, 200)
  const afterManual = await snapshot(first)
  assert.notEqual(afterManual.layoutToken, beforeManual.layoutToken)
  assert.equal((await save(first, beforeManual.layoutToken, beforeManual.cards.map((card, i) => ({ cardId: card.id, x: 900 + i * 440, y: 900 })))).status, 409,
    "A manual geometry write invalidates a stale batch")
  assert.deepEqual((await snapshot(first)).cards.map(geometry), afterManual.cards.map(geometry),
    "A rejected stale batch writes no positions")
  const contentToken = (await snapshot(first)).layoutToken
  const connection = await body<{ token: string }>(await request("/api/bot/connection", "POST", {}))
  const botKey = `content-only-${randomUUID()}`
  const botContent = await request(`/api/bot/cards/${botKey}?boardId=${authorBoard}`, "PUT", { schemaVersion: "1", title: "Bot content", components: [{ component: "paragraph", value: "Live" }] }, null, { authorization: `Bearer ${connection.token}` })
  assert.equal(botContent.status, 201)
  const afterContent = await snapshot(first)
  assert.notEqual(afterContent.layoutToken, contentToken, "New card changes card set")
  const botCard = (await body<{ card: Card }>(botContent)).card
  assert.equal((await save(first, contentToken, positions)).status, 409, "Card creation invalidates a stale batch")
  const tokenWithBot = afterContent.layoutToken
  const updateContent = await request(`/api/bot/cards/${botKey}?boardId=${authorBoard}`, "PUT", { schemaVersion: "1", title: "Bot content updated", components: [{ component: "paragraph", value: "New live content" }] }, null, { authorization: `Bearer ${connection.token}` })
  assert.equal(updateContent.status, 200)
  assert.equal((await snapshot(first)).layoutToken, tokenWithBot, "Content-only bot update must keep layout token")
  assert.equal((await snapshot(second)).cards.find((card) => card.id === botCard.id)?.title, "Bot content updated")
  const beforeFailure = await snapshot(second)
  const failurePositions = beforeFailure.cards.map((card, i) => ({ cardId: card.id, x: 2000 + i * 500, y: 1400 }))
  await prisma.$executeRawUnsafe(`CREATE TRIGGER fail_second_layout_insert BEFORE INSERT ON CardLayout WHEN NEW.cardId = '${cardB.id}' BEGIN SELECT RAISE(ABORT, 'synthetic layout failure'); END`)
  try {
    const failed = await save(second, beforeFailure.layoutToken, failurePositions)
    assert(failed.status >= 500, `Expected storage failure, received ${failed.status}`)
    const rolledBack = await snapshot(second)
    assert.equal(rolledBack.layoutToken, beforeFailure.layoutToken)
    assert.deepEqual(rolledBack.cards.map(geometry), beforeFailure.cards.map(geometry),
      "A failed second write must roll back the first position")
  } finally {
    await prisma.$executeRawUnsafe("DROP TRIGGER fail_second_layout_insert")
  }
  const beforeRemoval = await snapshot(first)
  assert.equal((await request(`${cardsPath}/${botCard.id}`, "DELETE", { membershipRevision: botCard.membershipRevision })).status, 200)
  assert.equal((await save(first, beforeRemoval.layoutToken, beforeRemoval.cards.map((card, i) => ({ cardId: card.id, x: 3000 + i * 500, y: 1500 })))).status, 409,
    "Card removal invalidates a stale batch")
  assert.equal((await snapshot(first)).cards.some((card) => card.id === botCard.id), false)
  const beforeReset = await snapshot(first)
  assert.equal((await request(layoutPath, "DELETE", {}, first)).status, 200)
  const reset = await snapshot(first)
  assert(reset.cards.every((card) => card.layoutSource === "author"))
  assert.deepEqual(geometry(reset.cards.find((card) => card.id === cardA.id)!), geometry((await snapshot(author)).cards.find((card) => card.id === cardA.id)!))
  assert.equal((await request(layoutPath, "DELETE", {}, author)).status, 403)
  assert.equal((await save(first, beforeReset.layoutToken, positions)).status, 409)
  const otherBoardResponse = await request("/api/boards", "POST", { name: "Other" })
  assert.equal(otherBoardResponse.status, 201)
  const otherBoard = (await body<{ board: { id: string } }>(otherBoardResponse)).board.id
  assert.equal((await request(`/api/boards/${otherBoard}/shares/${firstGrant.id}`, "DELETE", {})).status, 200)
  assert.equal((await patch(first, cardA, { x: 777, y: 888 })).status, 200)
  const preserved = geometry((await snapshot(first)).cards.find((card) => card.id === cardA.id)!)
  const revoke = await request(`${sharesPath}/${firstGrant.id}`, "DELETE", {})
  assert.equal(revoke.status, 200)
  assert.equal((await request(cardsPath, "GET", undefined, first)).status, 404)
  assert.equal((await request(layoutPath, "PUT", { expectedLayoutToken: reset.layoutToken, positions }, first)).status, 404)
  assert.equal((await request(`${sharesPath}/${firstGrant.id}`, "DELETE", {})).status, 200)
  await grant(first.email)
  assert.equal((await snapshot(first)).role, "viewer")
  assert.deepEqual(geometry((await snapshot(first)).cards.find((card) => card.id === cardA.id)!), preserved, "Re-invite restores surviving personal geometry")
  const otherShares = `/api/boards/${otherBoard}/shares`
  assert.equal((await request(otherShares, "POST", { email: first.email })).status, 200)
  const firstBoards = (await workspace(first)).boards.map((board) => board.id)
  assert.deepEqual(firstBoards.slice(-2), [authorBoard, otherBoard], "Shared boards follow grant order after owned boards")
  assert.equal((await patch(first, cardB, { x: 333, y: 444 })).status, 200)
  assert.equal(await prisma.cardLayout.count({ where: { cardId: cardB.id, boardId: authorBoard, userId: first.id } }), 1)
  const movedResponse = await request(`/api/cards/${cardB.id}/move`, "POST", { sourceBoardId: authorBoard, destinationBoardId: otherBoard })
  assert.equal(movedResponse.status, 200)
  const moved = (await body<{ card: Card }>(movedResponse)).card
  assert.equal(await prisma.cardLayout.count({ where: { cardId: cardB.id } }), 0, "Transfer deletes source overrides")
  assert.equal((await snapshot(first)).cards.some((card) => card.id === cardB.id), false)
  const destination = await body<Snapshot>(await request(`/api/boards/${otherBoard}/cards`, "GET", undefined, first))
  const destinationCard = destination.cards.find((card) => card.id === cardB.id)!
  assert.equal(destinationCard.layoutSource, "author")
  assert.deepEqual(geometry(destinationCard), geometry(moved), "Destination begins at the author's placement")
  const returned = await request(`/api/cards/${cardB.id}/move`, "POST", { sourceBoardId: otherBoard, destinationBoardId: authorBoard })
  assert.equal(returned.status, 200)
  assert.equal((await snapshot(first)).cards.find((card) => card.id === cardB.id)?.layoutSource, "author")
  const deletedCard = await createCard("Delete cleanup", 150, 800)
  assert.equal((await patch(first, deletedCard, { x: 888 })).status, 200)
  assert.equal(await prisma.cardLayout.count({ where: { cardId: deletedCard.id } }), 1)
  assert.equal((await request(`${cardsPath}/${deletedCard.id}`, "DELETE", { membershipRevision: deletedCard.membershipRevision })).status, 200)
  assert.equal(await prisma.cardLayout.count({ where: { cardId: deletedCard.id } }), 0, "Deleting a card cascades viewer overrides")
  const replacementEmail = `changed-${randomUUID()}@example.test`
  await prisma.user.update({ where: { id: first.id }, data: { email: replacementEmail, googleVerifiedEmail: replacementEmail } })
  assert.equal((await snapshot(first)).role, "viewer", "Bound grants authorize stable user ID after email change")
  const replacement = await adapter.createUser!({ name: "Old email claimant", email: first.email, emailVerified: null, image: null })
  await prisma.user.update({ where: { id: replacement.id }, data: { googleVerifiedEmail: first.email } })
  const claimedCookie = `next-auth.session-token=${await encode({ token: { sub: replacement.id, email: first.email, googleVerified: true }, secret })}`
  assert.equal((await request(cardsPath, "GET", undefined, { id: replacement.id, email: first.email, cookie: claimedCookie })).status, 404,
    "Another account cannot inherit a bound grant by presenting the old email")
  const membershipBoard = (await body<{ board: { id: string } }>(await request("/api/boards", "POST", { name: "Membership fence probe" }))).board.id
  const membershipCards = `/api/boards/${membershipBoard}/cards`
  const membershipCard = (await body<{ card: Card }>(await request(membershipCards, "POST", { title: "Returned card", x: 20, y: 20, width: 400, height: 260 }))).card
  assert.equal((await request(`/api/boards/${membershipBoard}/shares`, "POST", { email: replacementEmail })).status, 200)
  const authorBeforeMove = await body<Snapshot>(await request(membershipCards))
  const viewerBeforeMove = await body<Snapshot>(await request(membershipCards, "GET", undefined, first))
  const temporaryDestination = (await body<{ board: { id: string } }>(await request("/api/boards", "POST", { name: "Membership destination" }))).board.id
  for (const [sourceBoardId, destinationBoardId] of [[membershipBoard, temporaryDestination], [temporaryDestination, membershipBoard]])
    assert.equal((await request(`/api/cards/${membershipCard.id}/move`, "POST", { sourceBoardId, destinationBoardId })).status, 200)
  const returnedAuthor = await body<Snapshot>(await request(membershipCards))
  assert.deepEqual(returnedAuthor.cards.map(geometry), authorBeforeMove.cards.map(geometry), "Round-trip membership can return to identical geometry")
  assert.equal(returnedAuthor.cards[0].membershipRevision, membershipCard.membershipRevision + 2)
  for (const [who, prior] of [[author, authorBeforeMove], [first, viewerBeforeMove]] as const) {
    const before = await body<Snapshot>(await request(membershipCards, "GET", undefined, who))
    const stale = await request(`/api/boards/${membershipBoard}/layout`, "PUT", { expectedLayoutToken: prior.layoutToken, positions: [{ cardId: membershipCard.id, x: 40, y: 60 }] }, who)
    assert.equal(stale.status, 409, "A round-trip membership change must reject the old layout token")
    const after = await body<Snapshot>(await request(membershipCards, "GET", undefined, who))
    assert.deepEqual(after.cards.map(geometry), before.cards.map(geometry), "Rejected old-membership batches leave every geometry unchanged")
    assert.deepEqual(after.cards.map(card => card.layoutSource), before.cards.map(card => card.layoutSource))
  }
  console.log("Private sharing, isolation, geometry, layout conflicts, and revocation: passed")
  if (process.argv.includes("--browser")) {
    const compiled = join(process.cwd(), ".e2e/sharing/suite.mjs")
    const compilation = spawnSync("node_modules/.bin/esbuild", ["scripts/sharing-browser.ts", "--platform=node", "--format=esm", "--target=node22", `--outfile=${compiled}`], { encoding: "utf8" })
    assert.equal(compilation.status, 0, compilation.stderr)
    const browser = spawn(process.execPath, [compiled], {
      env: { ...setupEnv, E2E_BASE_URL: base,
        E2E_AUTHOR_SESSION_TOKEN: author.cookie.split("=")[1],
        E2E_FIRST_VIEWER_SESSION_TOKEN: first.cookie.split("=")[1],
        E2E_SECOND_VIEWER_SESSION_TOKEN: second.cookie.split("=")[1],
        E2E_FIRST_VIEWER_EMAIL: replacementEmail, E2E_SECOND_VIEWER_EMAIL: second.email,
      }, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"],
    })
    let browserOutput = ""
    browser.stdout.on("data", data => { browserOutput += String(data) })
    browser.stderr.on("data", data => { browserOutput += String(data) })
    const timeout = setTimeout(() => browser.kill("SIGTERM"), 120_000)
    const [status] = await once(browser, "exit")
    clearTimeout(timeout)
    assert.equal(status, 0, `${browserOutput}\nTrial server exit=${child.exitCode} signal=${child.signalCode}\n${output.slice(0, 3000)}\n${output.slice(-1500)}`)
    console.log(browserOutput)
  }
} finally {
  if (child && child.exitCode === null && child.signalCode === null) { child.kill("SIGTERM"); await once(child, "exit").catch(() => {}) }
  await prisma?.$disconnect()
  await rm(directory, { recursive: true, force: true })
}
