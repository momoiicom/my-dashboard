-- CreateTable
CREATE TABLE "ViewerAppearance" (
    "boardId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "backgroundKind" TEXT,
    "backgroundColor" TEXT,
    "backgroundAssetId" TEXT,
    "accent" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "ViewerAppearance_background_shape" CHECK (
      ("backgroundKind" IS NULL AND "backgroundColor" IS NULL AND "backgroundAssetId" IS NULL) OR
      ("backgroundKind" = 'default' AND "backgroundColor" IS NULL AND "backgroundAssetId" IS NULL) OR
      ("backgroundKind" = 'solid' AND "backgroundColor" IS NOT NULL AND "backgroundAssetId" IS NULL) OR
      ("backgroundKind" = 'image' AND "backgroundColor" IS NULL AND "backgroundAssetId" IS NOT NULL)
    ),

    PRIMARY KEY ("boardId", "userId"),
    CONSTRAINT "ViewerAppearance_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ViewerAppearance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ViewerAppearance_backgroundAssetId_fkey" FOREIGN KEY ("backgroundAssetId") REFERENCES "ImageAsset" ("id") ON DELETE NO ACTION ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ImageAsset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "boardId" TEXT NOT NULL,
    "uploaderId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ImageAsset_scope" CHECK ("scope" IN ('author', 'personal')),
    CONSTRAINT "ImageAsset_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ImageAsset_uploaderId_fkey" FOREIGN KEY ("uploaderId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Board" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "originalOwnerId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "appearanceKind" TEXT NOT NULL DEFAULT 'default',
    "appearanceColor" TEXT,
    "appearanceAssetId" TEXT,
    "appearanceAccent" TEXT NOT NULL DEFAULT '#0c66e4',
    "appearanceRevision" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "Board_original_owner_check" CHECK ("originalOwnerId" IS NULL OR "originalOwnerId" = "ownerId"),
    CONSTRAINT "Board_appearance_shape" CHECK (
      ("appearanceKind" = 'default' AND "appearanceColor" IS NULL AND "appearanceAssetId" IS NULL) OR
      ("appearanceKind" = 'solid' AND "appearanceColor" IS NOT NULL AND "appearanceAssetId" IS NULL) OR
      ("appearanceKind" = 'image' AND "appearanceColor" IS NULL AND "appearanceAssetId" IS NOT NULL)
    ),
    CONSTRAINT "Board_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Board_appearanceAssetId_fkey" FOREIGN KEY ("appearanceAssetId") REFERENCES "ImageAsset" ("id") ON DELETE NO ACTION ON UPDATE CASCADE
);
INSERT INTO "new_Board" ("createdAt", "id", "name", "nameKey", "originalOwnerId", "ownerId", "updatedAt") SELECT "createdAt", "id", "name", "nameKey", "originalOwnerId", "ownerId", "updatedAt" FROM "Board";
DROP TABLE "Board";
ALTER TABLE "new_Board" RENAME TO "Board";
CREATE UNIQUE INDEX "Board_originalOwnerId_key" ON "Board"("originalOwnerId");
CREATE UNIQUE INDEX "Board_ownerId_id_key" ON "Board"("ownerId", "id");
CREATE UNIQUE INDEX "Board_ownerId_nameKey_key" ON "Board"("ownerId", "nameKey");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "ImageAsset_boardId_idx" ON "ImageAsset"("boardId");

-- CreateIndex
CREATE INDEX "ImageAsset_createdAt_idx" ON "ImageAsset"("createdAt");
