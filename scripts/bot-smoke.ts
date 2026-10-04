import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import { once } from "node:events"
import { randomBytes } from "node:crypto"
import { createServer } from "node:net"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3"
import { encode } from "next-auth/jwt"
import { PrismaClient } from "../generated/prisma/client"
import { BOT_EXAMPLE } from "../lib/bot-document"

const directory = await mkdtemp(join(tmpdir(), "dashboard-bot-smoke-"))
const databaseUrl = `file:${join(directory, "bot.db")}`
const secret = randomBytes(32).toString("hex")
const migration = spawnSync("node_modules/.bin/prisma", ["migrate", "deploy"], {
  env: { ...process.env, DATABASE_URL: databaseUrl },
  encoding: "utf8",
})
assert.equal(migration.status, 0, migration.stderr)
const prisma = new PrismaClient({
  adapter: new PrismaBetterSqlite3({ url: databaseUrl }),
})
const user = await prisma.user.create({ data: { name: "Bot smoke owner" } })
const other = await prisma.user.create({ data: { name: "Other owner" } })
const cookie = `next-auth.session-token=${await encode({ token: { sub: user.id }, secret })}`
const otherCookie = `next-auth.session-token=${await encode({ token: { sub: other.id }, secret })}`
let savedToken = ""
let savedKey = ""
try {
  for (const mode of ["session", "wrong-secret", "local"]) {
    const listener = createServer().listen(0, "127.0.0.1")
    await once(listener, "listening")
    const address = listener.address()
    assert(address && typeof address !== "string")
    const port = address.port
    await new Promise<void>((resolve) => listener.close(() => resolve()))
    const base = `http://127.0.0.1:${port}`
    const child = spawn(
      process.execPath,
      [
        "node_modules/next/dist/bin/next",
        ...(process.env.BOT_SMOKE_DEV === "1" || mode === "local"
          ? ["dev", "--webpack"]
          : ["start"]),
        "-H",
        "127.0.0.1",
        "-p",
        String(port),
      ],
      {
        env: {
          ...process.env,
          DATABASE_URL: databaseUrl,
          NEXTAUTH_SECRET: secret,
          BOT_TOKEN_SECRET:
            mode === "wrong-secret" ? "wrong-test-secret" : secret,
          NEXTAUTH_URL: base,
          BOT_PUBLIC_BASE_URL: "",
          LOCAL_UI_MODE: mode === "local" ? "true" : "false",
        },
        stdio: ["ignore", "pipe", "pipe"],
      }
    )
    let output = ""
    child.stdout.on("data", (data) => {
      output += String(data)
    })
    child.stderr.on("data", (data) => {
      output += String(data)
    })
    const call = (
      path: string,
      method = "GET",
      body?: unknown,
      headers: Record<string, string> = {}
    ) =>
      fetch(`${base}${path}`, {
        method,
        redirect: "manual",
        headers: { "content-type": "application/json", ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    const setup = (
      authCookie = cookie,
      extra: Record<string, string> = {},
      body: unknown = {}
    ) =>
      call("/api/bot/connection", "POST", body, {
        cookie: authCookie,
        origin: base,
        ...extra,
      })
    try {
      let ready = false
      for (let i = 0; i < 90; i++) {
        if (child.exitCode !== null) break
        try {
          if ((await call("/api/bot/capabilities")).status === 401) {
            ready = true
            break
          }
        } catch {}
        await new Promise((resolve) => setTimeout(resolve, 250))
      }
      assert(ready, `Server readiness failed: ${output.slice(-3000)}`)
      if (mode === "wrong-secret") {
        assert.equal(
          (await setup()).status,
          503,
          "Encryption failure must not replace the winning token"
        )
        assert.equal(
          (
            await call("/api/bot/capabilities", "GET", undefined, {
              authorization: `Bearer ${savedToken}`,
            })
          ).status,
          200
        )
        assert.equal(
          (
            await prisma.botToken.findUniqueOrThrow({
              where: { ownerId: user.id },
            })
          ).tokenHash,
          savedKey
        )
        console.log("Encryption recovery failure preserves existing credential")
        continue
      }
      assert.equal(
        (await call("/api/bot/capabilities", "GET", undefined, { cookie }))
          .status,
        401,
        "A browser cookie cannot authorize bot operations"
      )
      assert.equal(
        (await setup(cookie, { authorization: "Bearer forged" })).status,
        401
      )
      assert.equal(
        (await setup(cookie, { origin: "https://evil.example" })).status,
        403
      )
      assert.equal((await setup(cookie, {}, { token: "ignored?" })).status, 400)
      if (mode === "session") assert.equal((await setup("")).status, 401)
      const connections = await Promise.all([setup(), setup(), setup()])
      for (const response of connections)
        assert.equal(
          response.status,
          200,
          `Connection failure: ${output.slice(-1200)}`
        )
      const bundles = await Promise.all(connections.map((r) => r.json()))
      const token = bundles[0].token
      assert(
        bundles.every((b) => b.token === token),
        "Concurrent connection calls converge to one recoverable token"
      )
      assert.equal(bundles[0].localOnly, true)
      assert(
        bundles[0].instructions.includes(token) &&
          bundles[0].instructions.includes('"schemaVersion": "1"')
      )
      assert.equal((await (await setup()).json()).token, token)
      const ownerId = mode === "local" ? "local-ui-owner" : user.id
      const stored = await prisma.botToken.findUniqueOrThrow({
        where: { ownerId },
      })
      assert(
        !JSON.stringify(stored).includes(token),
        "Stored credentials never contain plaintext bearer token"
      )
      if (mode === "session") {
        savedToken = token
        savedKey = stored.tokenHash
      }
      const auth = { authorization: `Bearer ${token}` }
      const capabilities = await call(
        "/api/bot/capabilities",
        "GET",
        undefined,
        auth
      )
      assert.equal(capabilities.status, 200)
      assert.equal((await capabilities.json()).components.length, 16)
      const put = (
        key: string,
        document: unknown = BOT_EXAMPLE,
        headers = auth
      ) => call(`/api/bot/cards/${key}`, "PUT", document, headers)
      assert.equal(
        (await put("forged", BOT_EXAMPLE, { authorization: "Bearer forged" }))
          .status,
        401
      )
      assert.equal(
        (await call("/api/bot/cards/cookie", "PUT", BOT_EXAMPLE, { cookie }))
          .status,
        401
      )
      await prisma.dashboardCard.create({
        data: {
          ownerId,
          title: "Tall existing card",
          x: 20,
          y: 700,
          width: 480,
          height: 1000,
        },
      })
      const first = await Promise.all([
        put("stable-key"),
        put("stable-key"),
        put("stable-key"),
      ])
      assert.deepEqual(
        first.map((r) => r.status).sort(),
        [200, 200, 201],
        `Concurrent first writes: ${output.slice(-2500)}`
      )
      const cards = await Promise.all(
        first.map(async (r) => (await r.json()).card)
      )
      assert(
        cards.every((c) => c.id === cards[0].id && c.contentRevision === 1)
      )
      const before = cards[0]
      assert.equal(
        before.y,
        1720,
        "New cards must be placed below existing tall cards"
      )
      assert.equal(
        await prisma.dashboardCard.count({
          where: { ownerId, externalKey: "stable-key" },
        }),
        1
      )
      const patch = await call(
        `/api/cards/${before.id}`,
        "PATCH",
        { x: 400, y: 200, width: 640, height: 480 },
        { cookie, origin: base }
      )
      assert.equal(patch.status, 200)
      assert.equal(
        (
          await call(
            `/api/cards/${before.id}`,
            "PATCH",
            { title: "Owner overwrite" },
            { cookie, origin: base }
          )
        ).status,
        403
      )
      const retry = (
        await (
          await put("stable-key", {
            ...BOT_EXAMPLE,
            layout: { direction: "vertical", gap: "medium" },
          })
        ).json()
      ).card
      assert.equal(retry.acceptedAt, before.acceptedAt)
      assert.equal(retry.contentRevision, 1)
      const changed = (
        await (
          await put("stable-key", { ...BOT_EXAMPLE, title: "Latest" })
        ).json()
      ).card
      assert.equal(changed.id, before.id)
      assert.equal(changed.contentRevision, 2)
      assert.deepEqual(
        [changed.x, changed.y, changed.width, changed.height],
        [400, 200, 640, 480]
      )
      const invalid = await put("stable-key", { ...BOT_EXAMPLE, x: 1 })
      assert.equal(invalid.status, 422)
      assert(Array.isArray((await invalid.json()).issues))
      const expandedRichtext = await put("stable-key", {
        schemaVersion: "1",
        title: "Must not replace the card",
        components: [{ component: "richtext", value: "&".repeat(3000) }],
      })
      assert.equal(expandedRichtext.status, 422)
      assert.deepEqual((await expandedRichtext.json()).issues, [
        {
          path: "components.0.value",
          message: "Sanitized richtext exceeds 12000 characters",
        },
      ])
      assert.equal(
        (
          await fetch(`${base}/api/bot/cards/stable-key`, {
            method: "PUT",
            headers: { ...auth, "content-type": "application/json" },
            body: "{",
          })
        ).status,
        400
      )
      assert.equal(
        (
          await fetch(`${base}/api/bot/cards/stable-key`, {
            method: "PUT",
            headers: { ...auth, "content-type": "text/plain" },
            body: "{}",
          })
        ).status,
        415
      )
      const stream = new ReadableStream({
        start(controller) {
          for (let i = 0; i < 140; i++)
            controller.enqueue(new TextEncoder().encode("x".repeat(1024)))
          controller.close()
        },
      })
      const streamingRequest = new Request(`${base}/api/bot/cards/stable-key`, {
        method: "PUT",
        headers: { ...auth, "content-type": "application/json" },
        body: stream,
        duplex: "half",
      } as RequestInit)
      assert.equal((await fetch(streamingRequest)).status, 413)
      const retained = await prisma.dashboardCard.findUniqueOrThrow({
        where: { id: before.id },
      })
      assert.equal(retained.title, "Latest")
      assert.equal(retained.contentRevision, 2)
      assert.deepEqual(JSON.parse(retained.payload!), changed.payload)
      const rich = (
        await (
          await put("rich", {
            schemaVersion: "1",
            title: "Safe",
            components: [
              {
                component: "richtext",
                value: '<p onclick="evil()">Safe<script>evil()</script></p>',
              },
            ],
          })
        ).json()
      ).card
      assert.equal(rich.payload.components[0].value, "<p>Safe</p>")
      if (mode === "session") {
        const second = await (await setup(otherCookie)).json()
        const theirs = await put("stable-key", BOT_EXAMPLE, {
          authorization: `Bearer ${second.token}`,
        })
        assert.equal(theirs.status, 201)
        assert.notEqual((await theirs.json()).card.id, before.id)
        assert.equal(
          (
            await call(`/api/cards/${before.id}`, "DELETE", undefined, {
              cookie: otherCookie,
              origin: base,
            })
          ).status,
          404
        )
        assert.equal(
          (await call("/api/cards", "GET", undefined, auth)).status,
          401
        )
      }
      await prisma.dashboardCard.create({
        data: {
          ownerId,
          title: "Vertical boundary",
          x: 20,
          y: 9620,
          width: 480,
          height: 360,
        },
      })
      const edge = await put("limit-edge")
      assert.equal(edge.status, 201)
      const edgeCard = (await edge.json()).card
      assert.equal(edgeCard.y, 10000)
      for (const key of ["overflow-one", "overflow-two"]) {
        const overflow = await put(key)
        assert.equal(overflow.status, 409, "Full boards must reject new cards")
        assert.equal(
          await prisma.dashboardCard.count({
            where: { ownerId, externalKey: key },
          }),
          0,
          "Rejected creation must not persist an overlapping card"
        )
      }
      const edgeUpdate = await put("limit-edge", {
        ...BOT_EXAMPLE,
        title: "Updated at capacity",
      })
      assert.equal(edgeUpdate.status, 200)
      const updatedEdge = (await edgeUpdate.json()).card
      assert.equal(updatedEdge.id, edgeCard.id)
      assert.equal(updatedEdge.y, 10000)
      assert.equal(updatedEdge.title, "Updated at capacity")
      assert.equal(updatedEdge.contentRevision, 2)
      console.log(
        `${mode} API passed token convergence/recovery, cookie/bearer isolation, simultaneous first-write idempotency, latest-only geometry-preserving updates, safe markup, rejection retention and streaming limits`
      )
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGTERM")
        await once(child, "exit")
      }
    }
  }
} finally {
  await prisma.$disconnect()
  await rm(directory, { recursive: true, force: true })
}
