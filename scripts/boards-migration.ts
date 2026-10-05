import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { cp, mkdtemp, readdir, rm, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import Database from "better-sqlite3"

const root = process.cwd()
const fixture = await mkdtemp(join(root, ".boards-migration-"))
const databasePath = join(fixture, "preservation.db")
const databaseUrl = `file:${databasePath}`
const migrations = join(fixture, "migrations")
const config = join(fixture, "prisma.config.ts")
const ownerId = `owner-${randomUUID()}`
const emptyOwnerId = `empty-${randomUUID()}`
const otherOwnerId = `other-${randomUUID()}`
const cardId = `card-${randomUUID()}`
const plainCardId = `plain-${randomUUID()}`
const tokenHash = `hash-${randomUUID()}`
const encryptedToken = `cipher-${randomUUID()}`
const payload = JSON.stringify({
  schemaVersion: "1",
  title: "Historic bot",
  components: [{ component: "paragraph", value: "Exact payload" }],
})
const issued = "2025-05-06 07:08:09"
const accepted = "2025-06-07 08:09:10"
const changed = "2025-07-08 09:10:11"

function deploy() {
  const result = spawnSync(
    "node_modules/.bin/prisma",
    ["migrate", "deploy", "--config", config],
    {
      cwd: root,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      encoding: "utf8",
    }
  )
  assert.equal(
    result.status,
    0,
    `Prisma migrate deploy failed: ${result.stdout}\n${result.stderr}`
  )
}

try {
  await writeFile(databasePath, "")
  await writeFile(
    config,
    `import { defineConfig } from "prisma/config"\nexport default defineConfig({ schema: ${JSON.stringify(resolve(root, "prisma/schema.prisma"))}, migrations: { path: ${JSON.stringify(migrations)} }, datasource: { url: process.env.DATABASE_URL } })\n`
  )
  const source = resolve(root, "prisma/migrations")
  const entries = (await readdir(source))
    .filter((name) => /^\d+_/.test(name))
    .sort()
  const boardMigrationIndex = entries.findIndex(name => name.endsWith("_multiple_boards"))
  assert(boardMigrationIndex >= 0, "Expected the multi-board migration")
  for (const entry of entries.slice(0, boardMigrationIndex))
    await cp(join(source, entry), join(migrations, entry), { recursive: true })
  await cp(
    join(source, "migration_lock.toml"),
    join(migrations, "migration_lock.toml")
  )
  deploy()

  const db = new Database(databasePath)
  try {
    db.pragma("foreign_keys = ON")
    const insertUser = db.prepare(
      'INSERT INTO "User" ("id", "name", "email") VALUES (?, ?, ?)'
    )
    insertUser.run(ownerId, "Historic owner", "historic@example.test")
    insertUser.run(emptyOwnerId, "No cards", "empty@example.test")
    insertUser.run(otherOwnerId, "Other account", "other@example.test")
    db.prepare(
      'INSERT INTO "DashboardCard" ("id", "ownerId", "title", "externalKey", "payload", "acceptedAt", "contentRevision", "kind", "x", "y", "width", "height", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
      cardId,
      ownerId,
      "Historic bot",
      "stable-key",
      payload,
      accepted,
      7,
      "notes",
      123,
      456,
      640,
      420,
      issued,
      changed
    )
    db.prepare(
      'INSERT INTO "DashboardCard" ("id", "ownerId", "title", "kind", "x", "y", "width", "height", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
      plainCardId,
      ownerId,
      "Plain card",
      "blank",
      9,
      12,
      320,
      220,
      issued,
      changed
    )
    db.prepare(
      'INSERT INTO "BotToken" ("ownerId", "tokenHash", "encryptedToken", "createdAt") VALUES (?, ?, ?, ?)'
    ).run(ownerId, tokenHash, encryptedToken, issued)
  } finally {
    db.close()
  }

  const appearanceMigrationIndex = entries.findIndex(name => name.endsWith("_board_appearance"))
  assert(appearanceMigrationIndex > boardMigrationIndex, "Expected the appearance migration after boards")
  for (const entry of entries.slice(boardMigrationIndex, appearanceMigrationIndex))
    await cp(join(source, entry), join(migrations, entry), { recursive: true })
  deploy()
  const retainedTables = ["Board", "DashboardCard", "BotToken", "BoardGrant", "CardLayout"]
  const retainedRows = new Map<string, unknown[]>()
  const migrated = new Database(databasePath)
  try {
    migrated.pragma("foreign_keys = ON")
    const boards = migrated
      .prepare(
        'SELECT "id", "ownerId", "name", "nameKey", "originalOwnerId" FROM "Board" ORDER BY "ownerId"'
      )
      .all() as Array<{
      id: string
      ownerId: string
      name: string
      nameKey: string
      originalOwnerId: string
    }>
    assert.equal(
      boards.length,
      3,
      "Every old user, including one without cards, gets one original board"
    )
    for (const owner of [ownerId, emptyOwnerId, otherOwnerId]) {
      const originals = boards.filter((board) => board.ownerId === owner)
      assert.equal(originals.length, 1)
      assert.match(originals[0].id, /^b_[0-9a-f]{32}$/)
      assert.deepEqual(
        [originals[0].name, originals[0].nameKey, originals[0].originalOwnerId],
        ["Dashboard", "dashboard", owner]
      )
    }
    const original = boards.find((board) => board.ownerId === ownerId)!
    const card = migrated
      .prepare('SELECT * FROM "DashboardCard" WHERE "id" = ?')
      .get(cardId) as Record<string, unknown>
    assert.deepEqual(
      {
        id: card.id,
        ownerId: card.ownerId,
        title: card.title,
        externalKey: card.externalKey,
        payload: card.payload,
        acceptedAt: card.acceptedAt,
        contentRevision: card.contentRevision,
        kind: card.kind,
        x: card.x,
        y: card.y,
        width: card.width,
        height: card.height,
        createdAt: card.createdAt,
        updatedAt: card.updatedAt,
      },
      {
        id: cardId,
        ownerId,
        title: "Historic bot",
        externalKey: "stable-key",
        payload,
        acceptedAt: accepted,
        contentRevision: 7,
        kind: "notes",
        x: 123,
        y: 456,
        width: 640,
        height: 420,
        createdAt: issued,
        updatedAt: changed,
      }
    )
    assert.deepEqual(
      [card.boardId, card.membershipRevision, card.lastMoveSourceBoardId],
      [original.id, 0, null]
    )
    const plain = migrated
      .prepare('SELECT * FROM "DashboardCard" WHERE "id" = ?')
      .get(plainCardId) as Record<string, unknown>
    assert.deepEqual(
      [
        plain.id,
        plain.boardId,
        plain.x,
        plain.y,
        plain.width,
        plain.height,
        plain.membershipRevision,
      ],
      [plainCardId, original.id, 9, 12, 320, 220, 0]
    )
    assert.deepEqual(
      migrated
        .prepare(
          'SELECT "ownerId", "tokenHash", "encryptedToken", "createdAt" FROM "BotToken"'
        )
        .get(),
      { ownerId, tokenHash, encryptedToken, createdAt: issued }
    )
    assert.deepEqual(migrated.pragma("foreign_key_check"), [])
    const legacyUser = migrated.prepare('SELECT "googleVerifiedEmail" FROM "User" WHERE "id" = ?').get(ownerId) as { googleVerifiedEmail: string | null }
    assert.equal(legacyUser.googleVerifiedEmail, null,
      "Legacy adapter emails do not become Google verification proof")
    const accountPlan = migrated.prepare('EXPLAIN QUERY PLAN SELECT "id" FROM "User" WHERE "googleVerifiedEmail" = ? LIMIT 1').all("invite@example.test") as Array<{ detail: string }>
    assert(accountPlan.some(step => /SEARCH User USING (?:COVERING )?INDEX/.test(step.detail)),
      `Verified-email invitation lookup must use an index: ${accountPlan.map(step => step.detail).join("; ")}`)
    assert.equal((migrated.prepare('SELECT COUNT(*) AS count FROM "BoardGrant"').get() as { count: number }).count, 0,
      "Legacy migration grants no shared access")
    assert.equal((migrated.prepare('SELECT COUNT(*) AS count FROM "CardLayout"').get() as { count: number }).count, 0,
      "Legacy geometry remains canonical without viewer overrides")
    const workspacePlan = migrated.prepare('EXPLAIN QUERY PLAN SELECT g."id" FROM "BoardGrant" AS g JOIN "Board" AS b ON b."id" = g."boardId" WHERE g."userId" = ? AND b."ownerId" <> ? ORDER BY g."createdAt", g."id"').all(ownerId, ownerId) as Array<{ detail: string }>
    assert(workspacePlan.some(step => /SEARCH g USING INDEX BoardGrant_userId_createdAt_id_idx/.test(step.detail)),
      `Workspace grant polling must use its user-leading index: ${workspacePlan.map(step => step.detail).join("; ")}`)
    for (const [column, value] of [["cardId", cardId], ["boardId", original.id]]) {
      const cleanupPlan = migrated.prepare(`EXPLAIN QUERY PLAN DELETE FROM "CardLayout" WHERE "${column}" = ?`).all(value) as Array<{ detail: string }>
      assert(cleanupPlan.some(step => /SEARCH CardLayout USING (?:COVERING )?INDEX/.test(step.detail)),
        `Layout cleanup by ${column} must use an index: ${cleanupPlan.map(step => step.detail).join("; ")}`)
    }
    const foreignBoard = boards.find((board) => board.ownerId === otherOwnerId)!
    assert.throws(
      () =>
        migrated
          .prepare('UPDATE "DashboardCard" SET "boardId" = ? WHERE "id" = ?')
          .run(foreignBoard.id, cardId),
      /FOREIGN KEY constraint failed/
    )
    assert.equal(
      (
        migrated
          .prepare('SELECT "boardId" FROM "DashboardCard" WHERE "id" = ?')
          .get(cardId) as { boardId: string }
      ).boardId,
      original.id
    )
    migrated.prepare('INSERT INTO "BoardGrant" ("id", "boardId", "email", "userId", "createdAt") VALUES (?, ?, ?, ?, ?)')
      .run("historic-grant", original.id, "other@example.test", otherOwnerId, issued)
    migrated.prepare('INSERT INTO "CardLayout" ("userId", "boardId", "cardId", "x", "y", "width", "height") VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(otherOwnerId, original.id, cardId, 23, 45, 321, 222)
    for (const table of retainedTables)
      retainedRows.set(table, migrated.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).all())
  } finally {
    migrated.close()
  }

  for (const entry of entries.slice(appearanceMigrationIndex))
    await cp(join(source, entry), join(migrations, entry), { recursive: true })
  deploy()
  const appearance = new Database(databasePath)
  try {
    appearance.pragma("foreign_keys = ON")
    for (const table of retainedTables) {
      const rows = appearance.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).all() as Record<string, unknown>[]
      const expected = retainedRows.get(table)!
      assert.deepEqual(rows.map(row => {
        if (table !== "Board") return row
        const { appearanceKind, appearanceColor, appearanceAssetId, appearanceAccent, appearanceRevision, ...historic } = row
        assert.deepEqual(
          [appearanceKind, appearanceColor, appearanceAssetId, appearanceAccent, appearanceRevision],
          ["default", null, null, "#0c66e4", 0]
        )
        return historic
      }), expected, `Appearance migration preserves ${table} records`)
    }
    assert.deepEqual(appearance.pragma("foreign_key_check"), [])
    appearance.prepare('INSERT INTO "User" ("id") VALUES (?)').run("fresh-owner")
    const insertBoard = appearance.prepare('INSERT INTO "Board" ("id", "ownerId", "name", "nameKey", "originalOwnerId", "updatedAt") VALUES (?, ?, ?, ?, ?, ?)')
    assert.throws(
      () => insertBoard.run("invalid-original", ownerId, "Invalid", "invalid", "fresh-owner", changed),
      /CHECK constraint failed: Board_original_owner_check/,
      "The final migration must reject an original board owned by another user"
    )
    insertBoard.run("fresh-original", "fresh-owner", "Dashboard", "dashboard", "fresh-owner", changed)
    insertBoard.run("fresh-secondary", "fresh-owner", "Secondary", "secondary", null, changed)
    assert.throws(
      () => appearance.prepare('UPDATE "Board" SET "originalOwnerId" = ? WHERE "id" = ?').run("missing-owner", "fresh-secondary"),
      /CHECK constraint failed: Board_original_owner_check/
    )
    assert.throws(
      () => insertBoard.run("duplicate-original", "fresh-owner", "Duplicate", "duplicate", "fresh-owner", changed),
      /UNIQUE constraint failed: Board.originalOwnerId/
    )
    assert.throws(
      () => insertBoard.run("duplicate-name", "fresh-owner", "Secondary", "secondary", null, changed),
      /UNIQUE constraint failed: Board.ownerId, Board.nameKey/
    )
    assert.throws(
      () => insertBoard.run("missing-owner-board", "missing-owner", "Missing", "missing", null, changed),
      /FOREIGN KEY constraint failed/
    )
    assert.throws(
      () => appearance.prepare('UPDATE "Board" SET "appearanceKind" = ? WHERE "id" = ?').run("solid", "fresh-secondary"),
      /CHECK constraint failed: Board_appearance_shape/
    )
    assert.throws(
      () => appearance.prepare('UPDATE "Board" SET "appearanceKind" = ?, "appearanceAssetId" = ? WHERE "id" = ?').run("image", "missing-asset", "fresh-secondary"),
      /FOREIGN KEY constraint failed/
    )
    const indexes = appearance.pragma('index_list("Board")') as Array<{ name: string; unique: number }>
    for (const [name, columns] of [
      ["Board_originalOwnerId_key", ["originalOwnerId"]],
      ["Board_ownerId_id_key", ["ownerId", "id"]],
      ["Board_ownerId_nameKey_key", ["ownerId", "nameKey"]],
    ] as const) {
      assert.equal(indexes.find(index => index.name === name)?.unique, 1)
      assert.deepEqual((appearance.pragma(`index_info("${name}")`) as Array<{ name: string }>).map(column => column.name), columns)
    }
    const foreignKeys = appearance.pragma('foreign_key_list("Board")') as Array<{ from: string; table: string; to: string; on_update: string; on_delete: string }>
    assert.deepEqual(foreignKeys.map(key => [key.from, key.table, key.to, key.on_update, key.on_delete]).sort(), [
      ["appearanceAssetId", "ImageAsset", "id", "CASCADE", "NO ACTION"],
      ["ownerId", "User", "id", "CASCADE", "CASCADE"],
    ])
    assert.deepEqual(appearance.pragma("foreign_key_check"), [])
  } finally {
    appearance.close()
  }
  console.log(
    "Board migrations preserved historic records, grants, and layouts and enforced ownership through appearance migration"
  )
} finally {
  await rm(fixture, { recursive: true, force: true })
}
