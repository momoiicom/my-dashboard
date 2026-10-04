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

const directory = await mkdtemp(join(tmpdir(), "boards-api-"))
const databaseUrl = `file:${join(directory, "api.db")}`
const secret = randomBytes(32).toString("hex")
const setupEnv = {
  ...process.env,
  DATABASE_URL: databaseUrl,
  NEXTAUTH_SECRET: secret,
  GOOGLE_CLIENT_ID: "",
  GOOGLE_CLIENT_SECRET: "",
  LOCAL_UI_MODE: "false",
}
let child: ChildProcess | undefined
let prisma: PrismaClient | undefined

async function freePort() {
  const listener = createServer().listen(0, "127.0.0.1")
  await once(listener, "listening")
  const address = listener.address()
  assert(address && typeof address !== "string")
  await new Promise<void>((resolve) => listener.close(() => resolve()))
  return address.port
}

try {
  await writeFile(join(directory, "api.db"), "")
  const migration = spawnSync(
    "node_modules/.bin/prisma",
    ["migrate", "deploy"],
    { env: setupEnv, encoding: "utf8" }
  )
  assert.equal(migration.status, 0, `${migration.stdout}\n${migration.stderr}`)
  prisma = new PrismaClient({
    adapter: new PrismaBetterSqlite3({ url: databaseUrl }),
  })
  const adapter = PrismaAdapter(prisma)
  const owner = await adapter.createUser!({
    name: "Board owner",
    email: `board-${randomUUID()}@example.test`,
    emailVerified: null,
    image: null,
  })
  const stranger = await adapter.createUser!({
    name: "Another owner",
    email: `board-${randomUUID()}@example.test`,
    emailVerified: null,
    image: null,
  })
  const cookie = `next-auth.session-token=${await encode({ token: { sub: owner.id, name: owner.name, email: owner.email }, secret })}`
  const foreignCookie = `next-auth.session-token=${await encode({ token: { sub: stranger.id, name: stranger.name, email: stranger.email }, secret })}`
  const port = await freePort()
  const base = `http://127.0.0.1:${port}`
  let output = ""
  child = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "start",
      "-H",
      "127.0.0.1",
      "-p",
      String(port),
    ],
    {
      env: { ...setupEnv, NEXTAUTH_URL: base },
      stdio: ["ignore", "pipe", "pipe"],
    }
  )
  child.stdout?.on("data", (data) => {
    output += String(data)
  })
  child.stderr?.on("data", (data) => {
    output += String(data)
  })
  for (let i = 0; i < 90; i++) {
    if (child.exitCode !== null) break
    try {
      if ((await fetch(`${base}/login`)).status === 200) break
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  assert.equal(
    (await fetch(`${base}/login`)).status,
    200,
    `Server did not start: ${output.slice(-2000)}`
  )
  const request = (
    path: string,
    method = "GET",
    body?: unknown,
    auth = cookie,
    extra: Record<string, string> = {}
  ) =>
    fetch(`${base}${path}`, {
      method,
      redirect: "manual",
      headers: {
        cookie: auth,
        origin: base,
        "content-type": "application/json",
        ...extra,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  const json = async <T>(response: Response): Promise<T> =>
    response.json() as Promise<T>
  type Board = {
    id: string
    name: string
    isOriginal: boolean
    createdAt: string
  }
  type Card = {
    id: string
    boardId: string
    membershipRevision: number
    title: string
    x: number
    y: number
    width: number
    height: number
    externalKey: string | null
    contentRevision: number
    payload: unknown
  }
  const initialWorkspaces = await Promise.all(Array.from({ length: 3 }, async () =>
    json<{ boards: Board[]; originalBoardId: string }>(await request("/api/boards"))
  ))
  const workspace = initialWorkspaces[0]
  assert.equal(new Set(initialWorkspaces.map((value) => value.originalBoardId)).size, 1,
    "Concurrent first workspace reads converge to one original board")
  assert(initialWorkspaces.every((value) => value.boards.length === 1))
  assert.equal(workspace.boards.length, 1)
  assert.match(workspace.originalBoardId, /^b_[0-9a-f]{32}$/)
  assert.deepEqual(
    {
      id: workspace.boards[0].id,
      name: workspace.boards[0].name,
      isOriginal: workspace.boards[0].isOriginal,
    },
    { id: workspace.originalBoardId, name: "Dashboard", isOriginal: true }
  )
  assert(Number.isFinite(Date.parse(workspace.boards[0].createdAt)))
  const original = workspace.originalBoardId
  const ownerPath = `/boards/${original}`
  const root = await request("/")
  assert.equal(root.status, 307)
  assert.equal(new URL(root.headers.get("location")!, base).pathname, ownerPath)
  assert.equal((await request(ownerPath)).status, 200)
  assert.equal((await request(ownerPath, "GET", undefined, "")).status, 307)
  const anonymousLogin = await request(ownerPath, "GET", undefined, "")
  const loginUrl = new URL(anonymousLogin.headers.get("location")!, base)
  assert.equal(loginUrl.pathname, "/login")
  assert.equal(loginUrl.searchParams.get("callbackUrl"), ownerPath)
  const signedLogin = await request(
    `/login?callbackUrl=${encodeURIComponent(ownerPath)}`
  )
  assert.equal(signedLogin.status, 307)
  assert.equal(
    new URL(signedLogin.headers.get("location")!, base).pathname,
    ownerPath
  )

  const createBoard = (name: string, auth = cookie) =>
    request("/api/boards", "POST", { name }, auth)
  assert.equal((await createBoard("  DAsHboard  ")).status, 409)
  assert.equal((await createBoard(" ")).status, 400)
  const reportsResponse = await createBoard(" Reports ")
  assert.equal(reportsResponse.status, 201)
  const reports = (await json<{ board: Board }>(reportsResponse)).board
  assert.equal(reports.name, "Reports")
  assert.match(reports.id, /^b_[0-9a-f]{32}$/)
  const archiveResponse = await createBoard("Archive")
  assert.equal(archiveResponse.status, 201)
  const archive = (await json<{ board: Board }>(archiveResponse)).board
  assert.deepEqual(
    (await json<{ boards: Board[] }>(await request("/api/boards"))).boards.map(
      (board) => board.id
    ),
    [original, reports.id, archive.id]
  )
  const future = new Date("2100-01-01T00:00:00.000Z")
  await prisma.board.update({
    where: { id: archive.id },
    data: { createdAt: future },
  })
  const orderedFirstResponse = await createBoard("Ordered first")
  const orderedSecondResponse = await createBoard("Ordered second")
  assert.deepEqual(
    [orderedFirstResponse.status, orderedSecondResponse.status],
    [201, 201]
  )
  const orderedFirst = (await json<{ board: Board }>(orderedFirstResponse))
    .board
  const orderedSecond = (await json<{ board: Board }>(orderedSecondResponse))
    .board
  assert(
    Date.parse(orderedFirst.createdAt) > future.getTime(),
    "A new board must sort after an existing future timestamp"
  )
  assert(
    Date.parse(orderedSecond.createdAt) > Date.parse(orderedFirst.createdAt),
    "Sequential creations need distinct increasing timestamps"
  )
  const creationOrder = (
    await json<{ boards: Board[] }>(await request("/api/boards"))
  ).boards.map((board) => board.id)
  assert.deepEqual(
    creationOrder.slice(-3),
    [archive.id, orderedFirst.id, orderedSecond.id],
    "Tabs and slideshow need creation order even when timestamps would tie"
  )
  assert.equal((await createBoard(" reports ")).status, 409)
  assert.equal(
    (
      await request(`/api/boards/${reports.id}`, "PATCH", {
        name: " DASHBOARD ",
      })
    ).status,
    409
  )
  const renamed = await request(`/api/boards/${reports.id}`, "PATCH", {
    name: "Renamed reports",
  })
  assert.equal(renamed.status, 200)
  assert.equal((await json<{ board: Board }>(renamed)).board.id, reports.id)
  assert.equal((await request(`/boards/${reports.id}`)).status, 200)
  assert.equal(
    (await request(`/api/boards/${original}`, "PATCH", { name: "Home" }))
      .status,
    200
  )
  assert.equal(
    (await request(`/api/boards/${original}`, "DELETE", {})).status,
    409
  )
  assert.equal(
    (await request(`/boards/${reports.id}`, "GET", undefined, foreignCookie))
      .status,
    404
  )
  assert.equal(
    (
      await request(
        `/api/boards/${reports.id}/cards`,
        "GET",
        undefined,
        foreignCookie
      )
    ).status,
    404
  )
  assert.equal(
    (
      await request(
        `/api/boards/${reports.id}`,
        "PATCH",
        { name: "Stolen" },
        foreignCookie
      )
    ).status,
    404
  )
  assert.equal(
    (await request(`/api/boards/${reports.id}`, "DELETE", {}, foreignCookie))
      .status,
    404
  )
  assert.equal(
    (await request("/api/boards", "POST", { name: "Invalid" }, "")).status,
    401
  )
  assert.equal(
    (
      await request("/api/boards", "POST", { name: "Invalid" }, cookie, {
        origin: "https://evil.example",
      })
    ).status,
    403
  )
  assert.equal(
    (await request(`/api/boards/${reports.id}/cards`, "GET")).headers
      .get("cache-control")
      ?.includes("no-store"),
    true
  )

  const createCard = (boardId: string, title: string, y = 20) =>
    request(`/api/boards/${boardId}/cards`, "POST", {
      title,
      x: 40,
      y,
      width: 400,
      height: 260,
    })
  const sourceResponse = await createCard(original, "Transfer me")
  assert.equal(sourceResponse.status, 201)
  const source = (await json<{ card: Card }>(sourceResponse)).card
  assert.deepEqual([source.boardId, source.membershipRevision], [original, 0])
  const destinationResponse = await createCard(
    reports.id,
    "Existing destination",
    720
  )
  assert.equal(destinationResponse.status, 201)
  const destination = (await json<{ card: Card }>(destinationResponse)).card
  assert.equal((await createCard(reports.id, "Foreign", 12)).status, 201)
  assert.equal(
    (
      await request(`/api/boards/${reports.id}/cards/${source.id}`, "PATCH", {
        patch: { x: 50 },
        membershipRevision: 0,
      })
    ).status,
    409
  )
  assert.equal(
    (
      await request(
        `/api/boards/${original}/cards/${source.id}`,
        "PATCH",
        { patch: { x: 44, width: 440 }, membershipRevision: 0 },
        foreignCookie
      )
    ).status,
    404
  )
  assert.equal(
    (
      await request(`/api/boards/${original}/cards/${source.id}`, "PATCH", {
        patch: { x: 44 },
        membershipRevision: 99,
      })
    ).status,
    409
  )
  const moveBody = { sourceBoardId: original, destinationBoardId: reports.id }
  const movedResponse = await request(
    `/api/cards/${source.id}/move`,
    "POST",
    moveBody
  )
  assert.equal(movedResponse.status, 200)
  const moved = await json<{ card: Card; moved: boolean }>(movedResponse)
  assert.equal(moved.moved, true)
  assert.equal(moved.card.boardId, reports.id)
  assert.equal(moved.card.membershipRevision, 1)
  assert.deepEqual(
    [
      moved.card.id,
      moved.card.title,
      moved.card.width,
      moved.card.height,
      moved.card.externalKey,
    ],
    [source.id, source.title, source.width, source.height, source.externalKey]
  )
  assert(
    moved.card.y >= destination.y + destination.height,
    "Transfer must place below destination cards"
  )
  assert.equal(
    (
      await json<{ cards: Card[] }>(
        await request(`/api/boards/${original}/cards`)
      )
    ).cards.some((card) => card.id === source.id),
    false
  )
  const retry = await json<{ card: Card; moved: boolean }>(
    await request(`/api/cards/${source.id}/move`, "POST", moveBody)
  )
  assert.deepEqual(
    [retry.moved, retry.card.id, retry.card.y, retry.card.membershipRevision],
    [false, source.id, moved.card.y, 1]
  )
  assert.equal(
    (
      await request(`/api/boards/${original}/cards/${source.id}`, "PATCH", {
        patch: { x: 200 },
        membershipRevision: 0,
      })
    ).status,
    409
  )
  assert.equal(
    (
      await request(`/api/boards/${original}/cards/${source.id}`, "DELETE", {
        membershipRevision: 0,
      })
    ).status,
    409
  )
  assert.equal(
    (
      await request(`/api/cards/${source.id}/move`, "POST", {
        sourceBoardId: original,
        destinationBoardId: archive.id,
      })
    ).status,
    409
  )
  assert.equal(
    (
      await request(
        `/api/cards/${source.id}/move`,
        "POST",
        { sourceBoardId: reports.id, destinationBoardId: original },
        foreignCookie
      )
    ).status,
    404
  )
  const back = await json<{ card: Card }>(
    await request(`/api/cards/${source.id}/move`, "POST", {
      sourceBoardId: reports.id,
      destinationBoardId: original,
    })
  )
  assert.equal(back.card.membershipRevision, 2)
  assert.equal(
    (
      await request(`/api/boards/${original}/cards/${source.id}`, "PATCH", {
        patch: { x: 300 },
        membershipRevision: 0,
      })
    ).status,
    409,
    "A stale A-to-B-to-A mutation cannot succeed"
  )
  assert.equal(
    (
      await request(`/api/boards/${original}/cards/${source.id}`, "DELETE", {
        membershipRevision: 0,
      })
    ).status,
    409
  )
  assert.equal(
    (
      await request(`/api/boards/${original}/cards/${source.id}`, "PATCH", {
        patch: { x: 300 },
        membershipRevision: 2,
      })
    ).status,
    200
  )
  const competing = await Promise.all([
    request(`/api/cards/${source.id}/move`, "POST", {
      sourceBoardId: original,
      destinationBoardId: reports.id,
    }),
    request(`/api/cards/${source.id}/move`, "POST", {
      sourceBoardId: original,
      destinationBoardId: archive.id,
    }),
  ])
  assert.deepEqual(
    competing.map((response) => response.status).sort(),
    [200, 409]
  )
  const competingCard = await prisma.dashboardCard.findUniqueOrThrow({
    where: { id: source.id },
  })
  assert([reports.id, archive.id].includes(competingCard.boardId))
  assert.equal(competingCard.membershipRevision, 3)

  const connection = await json<{ token: string }>(
    await request("/api/bot/connection", "POST", {})
  )
  const bearer = { authorization: `Bearer ${connection.token}` }
  const bot = (path: string, method = "GET", body?: unknown) =>
    request(path, method, body, "", bearer)
  assert.equal((await bot("/api/bot/boards")).status, 200)
  const foundByName = await json<{ boards: Board[]; originalBoardId: string }>(
    await bot("/api/bot/boards?name=+rEnAmEd+RePoRtS+")
  )
  assert.deepEqual(
    foundByName.boards.map((board) => board.id),
    [reports.id]
  )
  assert.equal(foundByName.originalBoardId, original)
  const foundById = await json<{ boards: Board[] }>(
    await bot(`/api/bot/boards?id=${reports.id}`)
  )
  assert.deepEqual(
    foundById.boards.map((board) => board.id),
    [reports.id]
  )
  assert.equal(
    (await json<{ boards: Board[] }>(await bot("/api/bot/boards?name=missing")))
      .boards.length,
    0
  )
  assert.equal((await request("/api/bot/boards")).status, 401)
  const document = (title: string) => ({
    schemaVersion: "1",
    title,
    components: [{ component: "paragraph", value: "Owner-wide key" }],
  })
  const put = (key: string, boardId: string | undefined, title: string) =>
    bot(
      `/api/bot/cards/${key}${boardId ? `?boardId=${boardId}` : ""}`,
      "PUT",
      document(title)
    )
  assert.equal(
    (
      await put(
        "missing-name",
        "b_00000000000000000000000000000000",
        "No fallback"
      )
    ).status,
    404
  )
  const concurrentNew = await Promise.all([
    put("concurrent-new", reports.id, "Created once"),
    put("concurrent-new", reports.id, "Created once"),
    put("concurrent-new", reports.id, "Created once"),
  ])
  assert.deepEqual(
    concurrentNew.map((response) => response.status).sort(),
    [200, 200, 201]
  )
  const concurrentIds = await Promise.all(
    concurrentNew.map(
      async (response) => (await json<{ card: Card }>(response)).card.id
    )
  )
  assert.equal(new Set(concurrentIds).size, 1)
  assert.equal(
    await prisma.dashboardCard.count({
      where: { ownerId: owner.id, externalKey: "concurrent-new" },
    }),
    1
  )
  const botCreated = await put("named-key", reports.id, "Named card")
  assert.equal(botCreated.status, 201)
  const botCard = (await json<{ card: Card; boardId: string }>(botCreated)).card
  assert.equal(botCard.boardId, reports.id)
  assert.equal(
    (await put("default-key", undefined, "Default card")).status,
    201
  )
  const defaultCard = (
    await json<{ card: Card }>(
      await put("default-key", undefined, "Default card")
    )
  ).card
  assert.equal(defaultCard.boardId, original)
  const botMove = await json<{ card: Card }>(
    await request(`/api/cards/${botCard.id}/move`, "POST", {
      sourceBoardId: reports.id,
      destinationBoardId: archive.id,
    })
  )
  assert.equal(botMove.card.boardId, archive.id)
  const oldHintUpdate = await put("named-key", reports.id, "Updated after move")
  assert.equal(oldHintUpdate.status, 200)
  const updated = (await json<{ card: Card; boardId: string }>(oldHintUpdate))
    .card
  assert.deepEqual(
    [updated.id, updated.boardId, updated.title],
    [botCard.id, archive.id, "Updated after move"]
  )
  const deletion = await request(`/api/boards/${reports.id}`, "DELETE", {})
  assert.equal(deletion.status, 200)
  assert.equal(
    (await json<{ originalBoardId: string }>(deletion)).originalBoardId,
    original
  )
  assert.equal(
    await prisma.dashboardCard.count({ where: { boardId: reports.id } }),
    0,
    "Deleting a board removes its remaining cards"
  )
  const afterDeletedHint = await put(
    "named-key",
    reports.id,
    "Updated after source deletion"
  )
  assert.equal(afterDeletedHint.status, 200)
  const afterDeleted = (await json<{ card: Card }>(afterDeletedHint)).card
  assert.deepEqual(
    [afterDeleted.id, afterDeleted.boardId, afterDeleted.title],
    [botCard.id, archive.id, "Updated after source deletion"]
  )
  const afterDeletedRetry = await json<{ card: Card; moved: boolean }>(
    await request(`/api/cards/${botCard.id}/move`, "POST", {
      sourceBoardId: reports.id,
      destinationBoardId: archive.id,
    })
  )
  assert.deepEqual(
    [
      afterDeletedRetry.moved,
      afterDeletedRetry.card.y,
      afterDeletedRetry.card.membershipRevision,
    ],
    [false, botMove.card.y, botMove.card.membershipRevision]
  )
  assert.equal(
    (await put("new-after-delete", reports.id, "Must clarify missing board"))
      .status,
    404
  )
  assert.equal(
    await prisma.dashboardCard.count({
      where: { ownerId: owner.id, externalKey: "named-key" },
    }),
    1
  )

  const edge = await createCard(archive.id, "Near capacity", 10000)
  assert.equal(edge.status, 201)
  const capacitySource = await createCard(original, "Cannot move")
  assert.equal(capacitySource.status, 201)
  const capacityCard = (await json<{ card: Card }>(capacitySource)).card
  const capacityMove = await request(
    `/api/cards/${capacityCard.id}/move`,
    "POST",
    { sourceBoardId: original, destinationBoardId: archive.id }
  )
  assert.equal(capacityMove.status, 409)
  const stillSource = await prisma.dashboardCard.findUniqueOrThrow({
    where: { id: capacityCard.id },
  })
  assert.deepEqual(
    [
      stillSource.boardId,
      stillSource.membershipRevision,
      stillSource.x,
      stillSource.y,
    ],
    [original, 0, capacityCard.x, capacityCard.y]
  )
  const concurrent = await Promise.all([
    put("named-key", archive.id, "Concurrent content"),
    request(`/api/boards/${archive.id}/cards/${botCard.id}`, "PATCH", {
      patch: { x: 200 },
      membershipRevision: botMove.card.membershipRevision,
    }),
  ])
  assert.deepEqual(
    concurrent.map((response) => response.status).sort(),
    [200, 200]
  )
  const concurrentCard = await prisma.dashboardCard.findUniqueOrThrow({
    where: { id: botCard.id },
  })
  assert.deepEqual(
    [concurrentCard.title, concurrentCard.x, concurrentCard.boardId],
    ["Concurrent content", 200, archive.id]
  )
  const moveAndBot = await Promise.all([
    request(`/api/cards/${botCard.id}/move`, "POST", {
      sourceBoardId: archive.id,
      destinationBoardId: original,
    }),
    put("named-key", reports.id, "Updated during transfer"),
  ])
  assert.deepEqual(
    moveAndBot.map((response) => response.status).sort(),
    [200, 200]
  )
  const raceResult = await prisma.dashboardCard.findUniqueOrThrow({
    where: { id: botCard.id },
  })
  assert.deepEqual(
    [raceResult.boardId, raceResult.title, raceResult.membershipRevision],
    [original, "Updated during transfer", 2]
  )
  assert.equal(
    (
      await request(`/api/boards/${archive.id}/cards/${botCard.id}`, "DELETE", {
        membershipRevision: 1,
      })
    ).status,
    409
  )
  console.log(
    "Board API passed authentication, CRUD, stable links, isolation, revision fences, transfers, retries, capacity and bot targeting"
  )
} finally {
  if (child && child.exitCode === null && child.signalCode === null) {
    child.kill("SIGTERM")
    await once(child, "exit")
  }
  await prisma?.$disconnect()
  await rm(directory, { recursive: true, force: true })
}
