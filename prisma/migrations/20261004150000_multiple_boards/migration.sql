CREATE TABLE "Board" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "ownerId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "nameKey" TEXT NOT NULL,
  "originalOwnerId" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "Board_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Board_original_owner_check" CHECK ("originalOwnerId" IS NULL OR "originalOwnerId" = "ownerId")
);
CREATE UNIQUE INDEX "Board_originalOwnerId_key" ON "Board"("originalOwnerId");
CREATE UNIQUE INDEX "Board_ownerId_id_key" ON "Board"("ownerId", "id");
CREATE UNIQUE INDEX "Board_ownerId_nameKey_key" ON "Board"("ownerId", "nameKey");
INSERT INTO "Board" ("id", "ownerId", "name", "nameKey", "originalOwnerId", "updatedAt")
SELECT 'b_' || lower(hex(randomblob(16))), "id", 'Dashboard', 'dashboard', "id", CURRENT_TIMESTAMP FROM "User";

CREATE TABLE "new_DashboardCard" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "ownerId" TEXT NOT NULL,
  "boardId" TEXT NOT NULL,
  "membershipRevision" INTEGER NOT NULL DEFAULT 0,
  "lastMoveSourceBoardId" TEXT,
  "title" TEXT NOT NULL,
  "externalKey" TEXT,
  "payload" TEXT,
  "acceptedAt" DATETIME,
  "contentRevision" INTEGER NOT NULL DEFAULT 0,
  "kind" TEXT NOT NULL DEFAULT 'blank',
  "x" INTEGER NOT NULL,
  "y" INTEGER NOT NULL,
  "width" INTEGER NOT NULL,
  "height" INTEGER NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "DashboardCard_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "DashboardCard_ownerId_boardId_fkey" FOREIGN KEY ("ownerId", "boardId") REFERENCES "Board" ("ownerId", "id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_DashboardCard" ("id", "ownerId", "boardId", "title", "externalKey", "payload", "acceptedAt", "contentRevision", "kind", "x", "y", "width", "height", "createdAt", "updatedAt")
SELECT c."id", c."ownerId", b."id", c."title", c."externalKey", c."payload", c."acceptedAt", c."contentRevision", c."kind", c."x", c."y", c."width", c."height", c."createdAt", c."updatedAt"
FROM "DashboardCard" c JOIN "Board" b ON b."originalOwnerId" = c."ownerId";
DROP TABLE "DashboardCard";
ALTER TABLE "new_DashboardCard" RENAME TO "DashboardCard";
CREATE INDEX "DashboardCard_ownerId_boardId_idx" ON "DashboardCard"("ownerId", "boardId");
CREATE UNIQUE INDEX "DashboardCard_ownerId_externalKey_key" ON "DashboardCard"("ownerId", "externalKey");
