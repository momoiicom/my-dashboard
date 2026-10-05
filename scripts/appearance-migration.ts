import assert from "node:assert/strict"
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import Database from "better-sqlite3"

const directory = await mkdtemp(join(tmpdir(), "appearance-migration-"))
const database = new Database(join(directory, "fixture.db"))
const migration = "20261005100000_advanced_appearance"
try {
  for (const entry of (await readdir("prisma/migrations")).sort()) {
    if (entry >= migration || entry === "migration_lock.toml") continue
    database.exec(await readFile(join("prisma/migrations", entry, "migration.sql"), "utf8"))
  }
  database.pragma("foreign_keys = ON")
  database.prepare("INSERT INTO User (id, email, name) VALUES (?, ?, ?)").run("author", "author@example.test", "Author")
  database.prepare("INSERT INTO User (id, email, name) VALUES (?, ?, ?)").run("viewer", "viewer@example.test", "Viewer")
  database.prepare("INSERT INTO Board (id, ownerId, name, nameKey, updatedAt, appearanceKind, appearanceColor, appearanceAccent, appearanceRevision) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run("board", "author", "Social Media", "social media", "2026-10-05T00:00:00.000Z", "solid", "#112233", "#abcdef", 7)
  database.prepare("INSERT INTO ViewerAppearance (boardId, userId, backgroundKind, backgroundColor, accent, revision) VALUES (?, ?, ?, ?, ?, ?)").run("board", "viewer", "solid", "#445566", "#123abc", 3)
  const beforeBoard = database.prepare("SELECT * FROM Board").get() as Record<string, unknown>
  const beforeViewer = database.prepare("SELECT * FROM ViewerAppearance").get() as Record<string, unknown>
  database.exec(await readFile(join("prisma/migrations", migration, "migration.sql"), "utf8"))
  const afterBoard = database.prepare("SELECT * FROM Board").get() as Record<string, unknown>
  const afterViewer = database.prepare("SELECT * FROM ViewerAppearance").get() as Record<string, unknown>
  assert.deepEqual(afterBoard, { ...beforeBoard, appearanceMainToolbar: null, appearanceBoardToolbar: null, appearanceCard: null, appearanceButton: null })
  assert.deepEqual(afterViewer, { ...beforeViewer, mainToolbar: null, boardToolbar: null, card: null, button: null })
  for (const field of ["appearanceMainToolbar", "appearanceBoardToolbar", "appearanceCard", "appearanceButton"]) {
    assert.throws(() => database.prepare(`UPDATE Board SET ${field} = 'auto'`).run(), /constraint|check/i)
    assert.throws(() => database.prepare(`UPDATE Board SET ${field} = 'red'`).run(), /constraint|check/i)
    assert.equal(database.prepare(`UPDATE Board SET ${field} = '#abcdef'`).run().changes, 1)
  }
  for (const field of ["mainToolbar", "boardToolbar", "card", "button"]) {
    assert.equal(database.prepare(`UPDATE ViewerAppearance SET ${field} = 'auto'`).run().changes, 1)
    assert.equal(database.prepare(`UPDATE ViewerAppearance SET ${field} = '#123abc'`).run().changes, 1)
    assert.throws(() => database.prepare(`UPDATE ViewerAppearance SET ${field} = 'red'`).run(), /constraint|check/i)
  }
  assert.deepEqual(database.pragma("foreign_key_check"), [])
  console.log("Advanced appearance migration preserves existing defaults, viewer choices, revisions and foreign keys; surface constraints pass")
} finally {
  database.close()
  await rm(directory, { recursive: true, force: true })
}
