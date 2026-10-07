import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import { once } from "node:events"
import { createECDH, randomBytes } from "node:crypto"
import { createServer } from "node:net"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3"
import { encode } from "next-auth/jwt"
import webPush from "web-push"
import { PrismaClient } from "../generated/prisma/client"
import { BOT_EXAMPLE } from "../lib/bot-document"

const directory = await mkdtemp(join(tmpdir(), "dashboard-push-"))
const databaseUrl = `file:${join(directory, "push.db")}`
const secret = randomBytes(32).toString("hex")
const vapid = webPush.generateVAPIDKeys()
const ecdh = createECDH("prime256v1"); ecdh.generateKeys()
const keys = { p256dh: ecdh.getPublicKey().toString("base64url"), auth: randomBytes(16).toString("base64url") }
await writeFile(join(directory, "push.db"), "")
const migration = spawnSync("node_modules/.bin/prisma", ["migrate", "deploy"], { env: { ...process.env, DATABASE_URL: databaseUrl }, encoding: "utf8" })
assert.equal(migration.status, 0, migration.stderr)
const prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: databaseUrl }) })
const owner = await prisma.user.create({ data: { name: "Push owner" } })
const other = await prisma.user.create({ data: { name: "Other owner" } })
const cookie = `next-auth.session-token=${await encode({ token: { sub: owner.id, name: owner.name }, secret })}`
const otherCookie = `next-auth.session-token=${await encode({ token: { sub: other.id, name: other.name }, secret })}`
const listener = createServer().listen(0, "127.0.0.1"); await once(listener, "listening")
const address = listener.address(); assert(address && typeof address !== "string")
await new Promise<void>(resolve => listener.close(() => resolve()))
const base = `http://127.0.0.1:${address.port}`
const deliveryLog = join(directory, "delivery.log")
await writeFile(deliveryLog, "")
const deliveryCount = async () => (await readFile(deliveryLog, "utf8")).split("\n").filter(Boolean).length
const preload = join(directory, "provider.cjs")
await writeFile(preload, `const original = globalThis.fetch; globalThis.fetch = async (input, options) => {
 const url = String(input); if (!url.startsWith('https://fcm.googleapis.com/')) return original(input, options);
 if (!options.body?.byteLength || !options.headers.Authorization || options.redirect !== 'manual') throw new Error('Invalid encrypted delivery');
 require("node:fs").appendFileSync(${JSON.stringify(deliveryLog)}, url + "\\n");
 const status = Number(new URL(url).pathname.split('/').pop()); return new Response(null, { status });
};`)
const child = spawn(process.execPath, ["--require", preload, "node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", String(address.port)], {
 env: { ...process.env, DATABASE_URL: databaseUrl, NEXTAUTH_SECRET: secret, BOT_TOKEN_SECRET: secret, NEXTAUTH_URL: base, LOCAL_UI_MODE: "false", PUSH_VAPID_PUBLIC_KEY: vapid.publicKey, PUSH_VAPID_PRIVATE_KEY: vapid.privateKey, PUSH_VAPID_SUBJECT: "mailto:push@example.com" }, stdio: ["ignore", "pipe", "pipe"],
})
let output = ""; child.stdout.on("data", d => output += d); child.stderr.on("data", d => output += d)
const call = (path: string, method = "GET", body?: unknown, headers: Record<string, string> = { cookie, origin: base }) => fetch(base + path, { method, headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual" })
try {
 let ready = false
 for (let i = 0; i < 60; i++) { try { if ((await call("/api/push")).status === 200) { ready = true; break } } catch {} await new Promise(r => setTimeout(r, 500)) }
 assert(ready, output)
 const worker = await call("/sw.js", "GET", undefined, {})
 assert.equal(worker.status, 200, "Anonymous clients must be able to install and update the service worker")
 assert.match(worker.headers.get("content-type") ?? "", /^(?:application|text)\/javascript(?:;|$)/)
 assert.equal(await worker.text(), await readFile(join(process.cwd(), "public/sw.js"), "utf8"))
 const manifest = await call("/manifest.webmanifest", "GET", undefined, {})
 assert.equal(manifest.status, 200, "Anonymous clients must be able to load installation metadata")
 assert.match(manifest.headers.get("content-type") ?? "", /^application\/manifest\+json(?:;|$)/)
 const metadata = await manifest.json()
 assert.equal(metadata.name, "My dashboard")
 assert.equal(metadata.short_name, "Dashboard")
 assert.equal(metadata.start_url, "/")
 assert.equal(metadata.display, "standalone")
 assert.deepEqual(metadata.icons, [{ src: "/favicon.ico", sizes: "any", type: "image/x-icon" }])
 assert.equal((await call("/api/push", "GET", undefined, {})).status, 401)
 assert.equal((await call("/api/push", "GET", undefined, { cookie, authorization: "Bearer fake" })).status, 401)
 const sub = (id: string) => ({ endpoint: `https://fcm.googleapis.com/${id}`, keys })
 assert.equal((await call("/api/push", "POST", sub("201"), { cookie })).status, 403)
 assert.equal((await call("/api/push", "POST", { endpoint: "https://evil.example/push", keys })).status, 400)
 assert.equal((await call("/api/push", "POST", { ...sub("201"), keys: { ...keys, p256dh: Buffer.alloc(65).toString("base64url") } })).status, 400)
 assert.equal((await call("/api/push", "POST", { padding: "x".repeat(9000) })).status, 413)
 assert.equal((await call("/api/push", "POST", sub("201"))).status, 200)
 assert.equal((await call("/api/push", "POST", sub("201"))).status, 200)
 assert.equal((await call("/api/push", "POST", sub("201"), { cookie: otherCookie, origin: base })).status, 409)
 await call("/api/push", "DELETE", { endpoint: sub("201").endpoint }, { cookie: otherCookie, origin: base })
 assert.equal(await prisma.pushSubscription.count({ where: { ownerId: owner.id } }), 1)
 const status = await (await call("/api/push")).json(); assert.equal(status.available, true); assert.equal(status.endpointHashes.length, 1); assert(!JSON.stringify(status).includes("fcm.googleapis.com"))
 assert.equal((await call("/api/bot/cards/push-card?notify=bad", "PUT", BOT_EXAMPLE, {})).status, 401)
 const connection = await (await call("/api/bot/connection", "POST", {})).json()
 const auth = { authorization: `Bearer ${connection.token}` }
 const put = (suffix: string, title: string) => call(`/api/bot/cards/push-card${suffix}`, "PUT", { ...BOT_EXAMPLE, title }, auth)
 for (const suffix of ["?notify=yes", "?notify=true&notify=false"]) assert.equal((await put(suffix, "Invalid")).status, 400)
 assert.equal(await prisma.dashboardCard.count({ where: { externalKey: "push-card" } }), 0)
 assert.deepEqual((await (await put("?notify=true", "One")).json()).notification, { status: "skipped", reason: "created" })
 assert.deepEqual((await (await put("?notify=true", "One")).json()).notification, { status: "skipped", reason: "unchanged" })
 assert.equal((await (await put("", "Two")).json()).notification, undefined)
 assert.equal((await (await put("?notify=false", "Three")).json()).notification, undefined)
 assert.equal(await deliveryCount(), 0, "Creation, replay and silent updates must not contact a provider")
 const accepted = await (await put("?notify=true", "Four")).json()
 assert.deepEqual(accepted.notification, { status: "attempted", accepted: 1, failed: 0 })
 assert.equal(await deliveryCount(), 1)
 for (const code of [404, 410, 500, 302]) assert.equal((await call("/api/push", "POST", sub(String(code)))).status, 200)
 assert.deepEqual((await (await put("?notify=true", "Five")).json()).notification, { status: "attempted", accepted: 1, failed: 4 })
 assert.equal(await prisma.pushSubscription.count({ where: { ownerId: owner.id } }), 3)
 assert.equal((await prisma.dashboardCard.findFirstOrThrow({ where: { externalKey: "push-card" } })).title, "Five")
 assert.deepEqual((await (await put("?notify=true", "Five")).json()).notification, { status: "skipped", reason: "unchanged" })
 assert.equal(await deliveryCount(), 6, "Replay does not resend")
 for (let i = 0; i < 7; i++) assert.equal((await call("/api/push", "POST", sub(`extra-${i}/201`))).status, 200)
 assert.equal((await call("/api/push", "POST", sub("overflow/201"))).status, 409)
 if (process.argv.includes("--browser")) {
  const { verifyPushBrowser } = await import("./push-browser")
  await verifyPushBrowser({ base, cookie, otherCookie, ownerId: owner.id, endpoint: sub("browser/201").endpoint, keys, prisma })
 }
 console.log("Push HTTP verification passed: anonymous worker/manifest, auth, origin, endpoint/key/body validation, isolation, cap, explicit update-only delivery, encrypted provider fixture acceptance/errors, expiry cleanup, committed update and silent replay.")
} finally {
 child.kill("SIGTERM"); await once(child, "exit")
 await prisma.$disconnect(); await rm(directory, { recursive: true, force: true })
}
