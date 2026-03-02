-- CreateEnum
CREATE TYPE "PresenceStatus" AS ENUM ('online', 'away', 'offline');

-- CreateTable
CREATE TABLE "user_presences" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "PresenceStatus" NOT NULL DEFAULT 'online',
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastEvent" TEXT,
    "lastPath" TEXT,
    "sessionStarted" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_presences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_presences_storeId_userId_key" ON "user_presences"("storeId", "userId");

-- CreateIndex
CREATE INDEX "user_presences_storeId_lastSeenAt_idx" ON "user_presences"("storeId", "lastSeenAt");

-- CreateIndex
CREATE INDEX "user_presences_storeId_status_idx" ON "user_presences"("storeId", "status");

-- AddForeignKey
ALTER TABLE "user_presences" ADD CONSTRAINT "user_presences_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_presences" ADD CONSTRAINT "user_presences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
