import assert from "node:assert/strict"
import { spawn, spawnSync, type ChildProcess } from "node:child_process"
import { randomBytes, randomUUID } from "node:crypto"
import { once } from "node:events"
import { createServer } from "node:net"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { PrismaAdapter } from "@next-auth/prisma-adapter"
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3"
import { encode } from "next-auth/jwt"

type TrialMode = "deterministic" | "agent" | "boards"
type TrialRequest = Readonly<{ mode: TrialMode; repetition: 1 | 2 }>
type TrialEnvironment = Readonly<{
  directory: string
  databaseUrl: string
  baseUrl: string
  authSecret: string
  sessionToken: string
  userId: string
}>

const mode = process.argv[2]
assert(mode === "deterministic" || mode === "agent" || mode === "boards", "Expected deterministic, agent, or boards mode")
const outputRoot = join(process.cwd(), ".e2e")
const authSecret = randomBytes(32).toString("base64url")
const activeChildren = new Set<ChildProcess>()
let interrupted = false
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    interrupted = true
    for (const child of activeChildren) terminate(child, "SIGTERM")
  })
}

function terminate(child: ChildProcess, signal: NodeJS.Signals) {
  if (!child.pid) return
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" })
    return
  }
  try {
    process.kill(-child.pid, signal)
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ESRCH") throw error
  }
}

async function terminateAfterExit(child: ChildProcess, signal: NodeJS.Signals) {
  for (let attempt = 0; ; attempt++) {
    try { terminate(child, signal); return } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "EPERM" || attempt === 8) throw error
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
  }
}

function start(command: string, args: string[], env: NodeJS.ProcessEnv) {
  let log = ""
  const child = spawn(command, args, { env, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] })
  activeChildren.add(child)
  child.once("exit", () => activeChildren.delete(child))
  child.stdout?.on("data", (chunk) => { log += String(chunk) })
  child.stderr?.on("data", (chunk) => { log += String(chunk) })
  return { child, output: () => log }
}

async function stop(child: ChildProcess | undefined) {
  if (!child) return
  if (child.exitCode !== null || child.signalCode !== null) {
    await terminateAfterExit(child, "SIGKILL")
    return
  }
  terminate(child, "SIGTERM")
  const timer = setTimeout(() => terminate(child, "SIGKILL"), 5_000)
  try { await once(child, "exit") } finally {
    clearTimeout(timer)
    await terminateAfterExit(child, "SIGKILL")
  }
}

async function run(command: string, args: string[], env: NodeJS.ProcessEnv, limitMs: number) {
  const process = start(command, args, env)
  let escalationTimer: ReturnType<typeof setTimeout> | undefined
  const timer = setTimeout(() => {
    terminate(process.child, "SIGTERM")
    escalationTimer = setTimeout(() => terminate(process.child, "SIGKILL"), 5_000)
    escalationTimer.unref()
  }, limitMs)
  try {
    const [code] = await once(process.child, "exit")
    assert.equal(code, 0, `${command} ${args[0]} failed: ${process.output().slice(-3000)}`)
    assert(!interrupted, "E2E trial interrupted")
    console.log(process.output())
    return process.output()
  } finally {
    clearTimeout(timer)
    clearTimeout(escalationTimer)
    await stop(process.child)
  }
}

async function freePort() {
  const listener = createServer()
  listener.listen(0, "127.0.0.1")
  await once(listener, "listening")
  const address = listener.address()
  assert(address && typeof address !== "string")
  const port = address.port
  listener.close()
  await once(listener, "close")
  return port
}

async function runTrial(request: TrialRequest, buildEnv: NodeJS.ProcessEnv) {
  const directory = await mkdtemp(join(tmpdir(), "my-dashboard-e2e-"))
  let server: ChildProcess | undefined
  let serverOutput = () => ""
  let prisma: { $disconnect(): Promise<void> } | undefined
  try {
    const databaseUrl = `file:${join(directory, "trial.db")}`
    const env = { ...buildEnv, DATABASE_URL: databaseUrl }
    await writeFile(join(directory, "trial.db"), "")
    await run("node_modules/.bin/prisma", ["migrate", "deploy"], env, 60_000)
    const { PrismaClient } = await import("../generated/prisma/client")
    const client = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: databaseUrl }) })
    prisma = client
    const adapter = PrismaAdapter(client)
    const user = await adapter.createUser!({ name: "E2E User", email: `e2e-${randomUUID()}@example.test`, emailVerified: null, image: null })
    const sessionToken = await encode({ token: { sub: user.id, name: user.name, email: user.email }, secret: authSecret })
    let baseUrl = ""
    let started = false
    for (let attempt = 0; attempt < 3 && !started; attempt++) {
      const port = await freePort()
      baseUrl = `http://127.0.0.1:${port}`
      const next = start(process.execPath, ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", String(port)], { ...env, NEXTAUTH_URL: baseUrl })
      server = next.child
      serverOutput = next.output
      for (let poll = 0; poll < 60; poll++) {
        if (server.exitCode !== null || server.signalCode !== null) break
        try { if ((await fetch(`${baseUrl}/login`)).status === 200) { started = true; break } } catch {}
        await new Promise((resolve) => setTimeout(resolve, 200))
      }
      if (!started) {
        await stop(server)
        if (!next.output().includes("EADDRINUSE")) throw new Error(`Server failed: ${next.output().slice(-2000)}`)
      }
    }
    assert(started, "Server could not bind a free loopback port")
    const trial: TrialEnvironment = Object.freeze({ directory, databaseUrl, baseUrl, authSecret, sessionToken, userId: user.id })
    const label = request.mode === "agent" ? `agent-${request.repetition === 1 ? "first" : "replay"}` : request.mode
    const output = join(outputRoot, label)
    await mkdir(output, { recursive: true })
    const suiteEnv = { ...env, E2E_BASE_URL: trial.baseUrl, E2E_SESSION_TOKEN: trial.sessionToken }
    if (request.mode === "boards") {
      const compiled = join(output, "suite.mjs")
      await run("node_modules/.bin/esbuild", ["scripts/boards-browser.ts", "--platform=node", "--format=esm", "--target=node22", `--outfile=${compiled}`], suiteEnv, 30_000)
      await run(process.execPath, [compiled], suiteEnv, 240_000)
    } else {
      await run(process.execPath, ["node_modules/e2e/dist/cli/bin.js", "run", request.mode === "agent" ? "tests/dashboard-agent.e2e.ts" : "tests/dashboard.e2e.ts", "--output", output], suiteEnv, 240_000)
    }
    console.log(request.mode === "boards" ? `${label} passed. Screenshots: ${output}` : `${label} passed. Report: ${output}/report.json`)
  } catch (error) {
    console.error(`Trial server exit=${server?.exitCode} signal=${server?.signalCode}: ${serverOutput().slice(-2000)}`)
    throw error
  } finally {
    await stop(server)
    await prisma?.$disconnect()
    await rm(directory, { recursive: true, force: true })
  }
}

const buildDirectory = await mkdtemp(join(tmpdir(), "my-dashboard-e2e-build-"))
const buildEnv = { ...process.env, DATABASE_URL: `file:${join(buildDirectory, "build.db")}`, NEXTAUTH_SECRET: authSecret, GOOGLE_CLIENT_ID: "", GOOGLE_CLIENT_SECRET: "" }
try {
  await writeFile(join(buildDirectory, "build.db"), "")
  await run("npm", ["run", "build"], buildEnv, 180_000)
  if (mode === "agent") {
    await runTrial({ mode, repetition: 1 }, buildEnv)
    await runTrial({ mode, repetition: 2 }, buildEnv)
  } else {
    await runTrial({ mode, repetition: 1 }, buildEnv)
  }
} finally {
  await rm(buildDirectory, { recursive: true, force: true })
}
