ALTER TABLE "DashboardCard" ADD COLUMN "externalKey" TEXT;
ALTER TABLE "DashboardCard" ADD COLUMN "payload" TEXT;
ALTER TABLE "DashboardCard" ADD COLUMN "acceptedAt" DATETIME;
ALTER TABLE "DashboardCard" ADD COLUMN "contentRevision" INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX "DashboardCard_ownerId_externalKey_key" ON "DashboardCard"("ownerId", "externalKey");
CREATE TABLE "BotToken" (
  "ownerId" TEXT NOT NULL PRIMARY KEY,
  "tokenHash" TEXT NOT NULL,
  "encryptedToken" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BotToken_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "BotToken_tokenHash_key" ON "BotToken"("tokenHash");
