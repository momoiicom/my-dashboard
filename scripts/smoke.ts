import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import { once } from "node:events"
import { randomBytes, randomUUID } from "node:crypto"
import { createServer } from "node:net"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { config } from "dotenv"
import { PrismaAdapter } from "@next-auth/prisma-adapter"
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3"
import { encode } from "next-auth/jwt"
import { PrismaClient } from "../generated/prisma/client"

config({ path: ".env.local" })

process.env.NEXTAUTH_SECRET = randomBytes(32).toString("hex")

const temporaryDirectory = await mkdtemp(join(tmpdir(), "my-dashboard-smoke-"))
const databaseUrl = `file:${join(temporaryDirectory, "smoke.db")}`
await writeFile(join(temporaryDirectory, "smoke.db"), "")
const migration = spawnSync("node_modules/.bin/prisma", ["migrate", "deploy"], {
  env: { ...process.env, DATABASE_URL: databaseUrl },
  encoding: "utf8",
})
assert.equal(migration.status, 0, `Migration failed: ${migration.stderr}`)

const prisma = new PrismaClient({
  adapter: new PrismaBetterSqlite3({ url: databaseUrl }),
})
const adapter = PrismaAdapter(prisma)
const email = `smoke-${randomUUID()}@example.test`
const user = await adapter.createUser!({
  name: "Smoke User",
  email,
  emailVerified: null,
  image: null,
})
const other = await adapter.createUser!({
  name: "Other User",
  email: `other-${randomUUID()}@example.test`,
  emailVerified: null,
  image: null,
})

try {
  await adapter.linkAccount!({
    userId: user.id,
    type: "oauth",
    provider: "google",
    providerAccountId: user.id,
  })
  const stored = await prisma.user.findUnique({
    where: { id: user.id },
    include: { accounts: true },
  })
  assert.equal(stored?.email, email)
  assert.equal(stored?.accounts[0]?.provider, "google")
  const linked = await adapter.getUserByAccount!({
    provider: "google",
    providerAccountId: user.id,
  })
  assert.equal(linked?.id, user.id)

  const listener = createServer()
  listener.listen(0, "127.0.0.1")
  await once(listener, "listening")
  const address = listener.address()
  assert(address && typeof address !== "string")
  const port = address.port
  listener.close()

  const base = `http://127.0.0.1:${port}`
  let signedCookie = ""
  const child = spawn(
    process.execPath,
    ["node_modules/next/dist/bin/next", "start", "-p", String(port)],
    {
      env: { ...process.env, DATABASE_URL: databaseUrl, NEXTAUTH_URL: base },
      stdio: ["ignore", "pipe", "pipe"],
    }
  )
  let serverOutput = ""
  child.stdout.on("data", (data) => {
    serverOutput += String(data)
  })
  child.stderr.on("data", (data) => {
    serverOutput += String(data)
  })

  try {
    let ready = false
    for (let i = 0; i < 60; i++) {
      if (child.exitCode !== null) break
      try {
        const response = await fetch(`${base}/login`)
        if (response.status === 200) {
          ready = true
          break
        }
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
    assert(ready, `Server did not start: ${serverOutput.slice(-1000)}`)

    const get = (path: string, cookie?: string) =>
      fetch(`${base}${path}`, {
        redirect: "manual",
        headers: cookie ? { cookie } : undefined,
      })
    const anonymous = await get("/")
    assert.equal(anonymous.status, 307)
    assert.equal(
      new URL(anonymous.headers.get("location")!, base).pathname,
      "/login"
    )
    assert.equal((await get("/api/private")).status, 401)
    assert.equal((await get("/_next/image-private")).status, 307)
    assert.equal((await get("/favicon.ico/private")).status, 307)
    assert.equal((await get("/api/authx")).status, 401)
    assert.equal((await get("/api/auth/providers")).status, 200)
    const csrf = await get("/api/auth/csrf")
    assert.equal(csrf.status, 200)
    assert.equal(typeof (await csrf.json()).csrfToken, "string")

    const forged = await get("/", "next-auth.session-token=forged")
    assert.equal(forged.status, 307)

    const token = await encode({
      token: { sub: user.id, name: user.name, email: user.email },
      secret: process.env.NEXTAUTH_SECRET!,
    })
    const cookie = `next-auth.session-token=${token}`
    signedCookie = cookie
    const authenticated = await get("/", cookie)
    assert.equal(authenticated.status, 307)
    const boardPath = new URL(authenticated.headers.get("location")!, base).pathname
    assert.match(boardPath, /^\/boards\/b_[0-9a-f]{32}$/)
    const boardId = boardPath.split("/").at(-1)!
    const cardsPath = `/api/boards/${boardId}/cards`
    const html = await (await get(boardPath, cookie)).text()
    assert(html.includes("Smoke User"), "Signed-in page must render the account name")
    assert.equal((await get("/login", cookie)).status, 307)

    const otherToken = await encode({
      token: { sub: other.id, name: other.name, email: other.email },
      secret: process.env.NEXTAUTH_SECRET!,
    })
    const otherCookie = `next-auth.session-token=${otherToken}`
    const api = (path: string, method: string, body?: unknown, authCookie = cookie, origin = base) =>
      fetch(`${base}${path}`, {
        method,
        headers: { cookie: authCookie, origin, "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    assert.equal((await get("/api/boards")).status, 401)
    assert.equal((await api(cardsPath, "POST", { title: "x", x: 1, y: 1, width: 320, height: 220 }, "")).status, 401)
    assert.equal((await api(cardsPath, "POST", { title: "x", x: 1, y: 1, width: 320, height: 220 }, cookie, "https://evil.example")).status, 403)
    assert.equal((await api(cardsPath, "POST", { title: " ", x: 1, y: 1, width: 320, height: 220 })).status, 400)
    assert.equal((await api(cardsPath, "POST", { title: "bad", x: -1, y: 1, width: 320, height: 220 })).status, 400)
    assert.equal((await api(cardsPath, "POST", { title: "bad", x: 1.5, y: 1, width: 320, height: 220 })).status, 400)
    assert.equal((await api(cardsPath, "POST", { title: "bad", x: 1, y: 1, width: 320, height: 220, ownerId: other.id })).status, 400)
    const created = await api(cardsPath, "POST", { title: "Test card", x: 12, y: 24, width: 320, height: 220 })
    assert.equal(created.status, 201)
    const card = (await created.json()).card as { id: string }
    assert.equal((await get(cardsPath, otherCookie)).status, 404)
    assert.equal((await api(`/api/boards/${boardId}/cards/${card.id}`, "PATCH", { patch: { title: "Stolen" }, membershipRevision: 0 }, otherCookie)).status, 404)
    assert.equal((await api(`/api/boards/${boardId}/cards/${card.id}`, "DELETE", { membershipRevision: 0 }, otherCookie)).status, 404)
    assert.equal((await api(`/api/boards/${boardId}/cards/${card.id}`, "PATCH", { patch: { width: 239 }, membershipRevision: 0 })).status, 400)
    assert.equal((await api(`/api/boards/${boardId}/cards/${card.id}`, "PATCH", { patch: { ownerId: other.id }, membershipRevision: 0 })).status, 400)
    assert.equal((await api(`/api/boards/${boardId}/cards/${card.id}`, "PATCH", { patch: { x: 144, y: 256, width: 420, height: 300 }, membershipRevision: 0 })).status, 200)
    const persisted = (await (await get(cardsPath, cookie)).json()).cards as Array<{ id: string, x: number, y: number, width: number, height: number }>
    assert.deepEqual(persisted.map(({ id, x, y, width, height }) => ({ id, x, y, width, height })), [{ id: card.id, x: 144, y: 256, width: 420, height: 300 }])
    assert((await (await get(boardPath, cookie)).text()).includes("Test card"), "Saved card must render on reload")
    assert.equal((await api(`/api/boards/${boardId}/cards/${card.id}`, "DELETE", { membershipRevision: 0 })).status, 200)
    assert.equal((await api(`/api/boards/${boardId}/cards/${card.id}`, "PATCH", { patch: { title: "Gone" }, membershipRevision: 0 })).status, 404)
    assert.equal(((await (await get(cardsPath, cookie)).json()).cards as unknown[]).length, 0)

    const tampered = `${token[0] === "x" ? "y" : "x"}${token.slice(1)}`
    assert.equal(
      (await get("/", `next-auth.session-token=${tampered}`)).status,
      307
    )
    const expired = await encode({
      token: { sub: user.id, name: user.name, email: user.email },
      secret: process.env.NEXTAUTH_SECRET!,
      maxAge: -60,
    })
    assert.equal(
      (await get("/", `next-auth.session-token=${expired}`)).status,
      307
    )
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM")
      await once(child, "exit")
    }
  }

  for (const missingConfiguration of ["NEXTAUTH_SECRET", "DATABASE_URL"]) {
    const unconfigured = spawn(
      process.execPath,
      ["node_modules/next/dist/bin/next", "start", "-p", String(port)],
      {
        env: {
          ...process.env,
          DATABASE_URL: databaseUrl,
          NEXTAUTH_URL: base,
          [missingConfiguration]: "",
        },
        stdio: "ignore",
      }
    )
    try {
      let ready = false
      for (let i = 0; i < 60; i++) {
        if (unconfigured.exitCode !== null) break
        try {
          if ((await fetch(`${base}/login`)).status === 200) {
            ready = true
            break
          }
        } catch {}
        await new Promise((resolve) => setTimeout(resolve, 200))
      }
      assert(ready, `Server without ${missingConfiguration} did not start`)
      const login = await fetch(`${base}/login`, {
        redirect: "manual",
        headers: { cookie: signedCookie },
      })
      assert.equal(
        login.status,
        200,
        `Missing ${missingConfiguration} must not cause a login redirect loop`
      )
      const protectedPage = await fetch(base, {
        redirect: "manual",
        headers: { cookie: signedCookie },
      })
      assert.equal(protectedPage.status, 307)
      assert.equal((await fetch(`${base}/api/private`)).status, 401)
    } finally {
      if (unconfigured.exitCode === null && unconfigured.signalCode === null) {
        unconfigured.kill("SIGTERM")
        await once(unconfigured, "exit")
      }
    }
  }
  console.log(
    "Smoke passed: SQLite auth, card CRUD and geometry, owner isolation, origin and input guards, anonymous gate"
  )
} finally {
  await prisma.user.delete({ where: { id: user.id } })
  await prisma.user.delete({ where: { id: other.id } })
  await prisma.$disconnect()
  await rm(temporaryDirectory, { recursive: true, force: true })
}
