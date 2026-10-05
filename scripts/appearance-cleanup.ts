import { config } from "dotenv"
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3"
import { PrismaClient } from "../generated/prisma/client"
import { readdir, stat, unlink } from "node:fs/promises"
import path from "node:path"

config({ path: ".env.local" })
const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error("DATABASE_URL is required")
const configured = process.env.APPEARANCE_STORAGE_DIR ?? path.join(process.cwd(), "data", "uploads")
if (!path.isAbsolute(configured)) throw new Error("APPEARANCE_STORAGE_DIR must be absolute")
const directory = path.resolve(configured)
if (["public", ".next"].some(name => directory === path.join(process.cwd(), name) || directory.startsWith(`${path.join(process.cwd(), name)}${path.sep}`))) throw new Error("Invalid appearance storage path")
const prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: databaseUrl }) })
const cutoff = Date.now() - 24 * 60 * 60 * 1000
let removedRows = 0
let removedFiles = 0
try {
  const assets = await prisma.imageAsset.findMany({ where: { createdAt: { lt: new Date(cutoff) } }, select: { id: true } })
  for (const asset of assets) {
    const referenced = await prisma.board.count({ where: { appearanceAssetId: asset.id } }) + await prisma.viewerAppearance.count({ where: { backgroundAssetId: asset.id } })
    if (referenced) continue
    await prisma.imageAsset.deleteMany({ where: { id: asset.id, createdAt: { lt: new Date(cutoff) }, authorReferences: { none: {} }, personalReferences: { none: {} } } }).then(result => { removedRows += result.count })
  }
  for (const file of await readdir(directory).catch(error => error?.code === "ENOENT" ? [] : Promise.reject(error))) {
    if (!/^a_[a-f0-9]{32}\.webp$/.test(file)) continue
    const id = file.slice(0, -5)
    const filename = path.join(directory, file)
    const details = await stat(filename).catch(error => error?.code === "ENOENT" ? null : Promise.reject(error))
    if (!details || details.mtimeMs >= cutoff) continue
    if (await prisma.imageAsset.count({ where: { id } })) continue
    try { await unlink(filename); removedFiles++ } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error }
  }
  console.log(JSON.stringify({ removedRows, removedFiles }))
} finally { await prisma.$disconnect() }
