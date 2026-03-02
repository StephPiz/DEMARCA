-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('open', 'in_progress', 'blocked', 'done');

-- CreateEnum
CREATE TYPE "TaskPriority" AS ENUM ('low', 'medium', 'high');

-- CreateTable
CREATE TABLE "team_tasks" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "TaskStatus" NOT NULL DEFAULT 'open',
    "priority" "TaskPriority" NOT NULL DEFAULT 'medium',
    "dueAt" TIMESTAMP(3),
    "linkedEntityType" TEXT,
    "linkedEntityId" TEXT,
    "assignedToUserId" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "team_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "team_tasks_storeId_status_priority_idx" ON "team_tasks"("storeId", "status", "priority");

-- CreateIndex
CREATE INDEX "team_tasks_storeId_assignedToUserId_status_idx" ON "team_tasks"("storeId", "assignedToUserId", "status");

-- CreateIndex
CREATE INDEX "team_tasks_storeId_dueAt_idx" ON "team_tasks"("storeId", "dueAt");

-- AddForeignKey
ALTER TABLE "team_tasks" ADD CONSTRAINT "team_tasks_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_tasks" ADD CONSTRAINT "team_tasks_assignedToUserId_fkey" FOREIGN KEY ("assignedToUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_tasks" ADD CONSTRAINT "team_tasks_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
