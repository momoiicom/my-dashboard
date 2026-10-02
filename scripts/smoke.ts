import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import { once } from "node:events"
import { randomUUID } from "node:crypto"
import { createServer } from "node:net"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { config } from "dotenv"
import { PrismaAdapter } from "@next-auth/prisma-adapter"
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3"
import { encode } from "next-auth/jwt"
import { PrismaClient } from "../generated/prisma/client"

config({ path: ".env.local" })

assert(process.env.NEXTAUTH_SECRET, "NEXTAUTH_SECRET is required")

const temporaryDirectory = await mkdtemp(join(tmpdir(), "my-dashboard-smoke-"))
const databaseUrl = `file:${join(temporaryDirectory, "smoke.db")}`
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
    assert.equal(authenticated.status, 200)
    const html = await authenticated.text()
    assert(html.includes(email), "Signed-in page must render the account email")
    assert.equal((await get("/login", cookie)).status, 307)

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
    "Smoke passed: SQLite account persistence, anonymous gate, invalid tokens, authenticated render, missing-secret fail-closed"
  )
} finally {
  await prisma.user.delete({ where: { id: user.id } })
  await prisma.$disconnect()
  await rm(temporaryDirectory, { recursive: true, force: true })
}
