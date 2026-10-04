import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { randomBytes } from "node:crypto"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3"
import { PrismaClient } from "../generated/prisma/client"

const directory = await mkdtemp(join(tmpdir(), "sharing-auth-"))
const databaseUrl = `file:${join(directory, "auth.db")}`
process.env.DATABASE_URL = databaseUrl
process.env.NEXTAUTH_SECRET = randomBytes(32).toString("hex")
let prisma: PrismaClient | undefined
try {
  await writeFile(join(directory, "auth.db"), "")
  const migration = spawnSync("node_modules/.bin/prisma", ["migrate", "deploy"], { env: process.env, encoding: "utf8" })
  assert.equal(migration.status, 0, `${migration.stdout}\n${migration.stderr}`)
  prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: databaseUrl }) })
  const user = await prisma.user.create({ data: { name: "OAuth probe", email: "probe@example.test" } })
  const { authOptions } = await import("../lib/auth")
  const jwt = authOptions.callbacks?.jwt
  assert(jwt)
  const google = { provider: "google", type: "oauth", providerAccountId: "probe" }
  const call = (profile: Record<string, unknown>, token: Record<string, unknown> = {}) =>
    jwt({ token, user, account: google, profile } as Parameters<typeof jwt>[0])
  const unverified = await call({ email: " Probe@Example.Test ", email_verified: false })
  assert.equal(unverified.googleVerified, false)
  assert.equal((await prisma!.user.findUniqueOrThrow({ where: { id: user.id } })).googleVerifiedEmail, null)
  const verified = await call({ email: " Probe@Example.Test ", email_verified: true })
  assert.equal(verified.googleVerified, true)
  assert.equal(verified.sub, user.id)
  assert.equal((await prisma!.user.findUniqueOrThrow({ where: { id: user.id } })).googleVerifiedEmail, "probe@example.test")
  const missingProof = await call({ email: "probe@example.test" })
  assert.equal(missingProof.googleVerified, false)
  assert.equal((await prisma!.user.findUniqueOrThrow({ where: { id: user.id } })).googleVerifiedEmail, null)
  const session = authOptions.callbacks?.session
  assert(session)
  const projected = await session({ session: { user: { name: user.name, email: user.email }, expires: "2100-01-01" }, token: verified } as Parameters<typeof session>[0])
  const projectedUser = projected.user as { id?: string; googleVerified?: boolean } | undefined
  assert.equal(projectedUser?.googleVerified, true)
  assert.equal(projectedUser?.id, user.id)
  console.log("Google verified-email callback and session projection: passed")
} finally {
  await prisma?.$disconnect()
  await rm(directory, { recursive: true, force: true })
}
