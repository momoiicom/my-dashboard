ALTER TABLE "User" ADD COLUMN "googleVerifiedEmail" TEXT;
CREATE INDEX "User_googleVerifiedEmail_idx" ON "User"("googleVerifiedEmail");

CREATE TABLE "BoardGrant" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "boardId" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "userId" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BoardGrant_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "BoardGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "BoardGrant_boardId_email_key" ON "BoardGrant"("boardId", "email");
CREATE UNIQUE INDEX "BoardGrant_boardId_userId_key" ON "BoardGrant"("boardId", "userId");
CREATE INDEX "BoardGrant_email_idx" ON "BoardGrant"("email");
CREATE INDEX "BoardGrant_userId_createdAt_id_idx" ON "BoardGrant"("userId", "createdAt", "id");

CREATE TABLE "CardLayout" (
  "userId" TEXT NOT NULL,
  "boardId" TEXT NOT NULL,
  "cardId" TEXT NOT NULL,
  "x" INTEGER NOT NULL,
  "y" INTEGER NOT NULL,
  "width" INTEGER NOT NULL,
  "height" INTEGER NOT NULL,
  PRIMARY KEY ("userId", "boardId", "cardId"),
  CONSTRAINT "CardLayout_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CardLayout_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CardLayout_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "DashboardCard" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "CardLayout_cardId_idx" ON "CardLayout"("cardId");
CREATE INDEX "CardLayout_boardId_idx" ON "CardLayout"("boardId");
