-- CreateTable
CREATE TABLE "QueueEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "socketId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "desiredSize" INTEGER NOT NULL DEFAULT 2,
    "enqueuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QueueEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GameInvite" (
    "id" TEXT NOT NULL,
    "fromUserId" TEXT NOT NULL,
    "toUserId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GameInvite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "QueueEntry_desiredSize_rating_idx" ON "QueueEntry"("desiredSize", "rating");

-- CreateIndex
CREATE INDEX "QueueEntry_enqueuedAt_idx" ON "QueueEntry"("enqueuedAt");

-- CreateIndex
CREATE UNIQUE INDEX "QueueEntry_userId_key" ON "QueueEntry"("userId");

-- CreateIndex
CREATE INDEX "GameInvite_toUserId_status_idx" ON "GameInvite"("toUserId", "status");

-- CreateIndex
CREATE INDEX "GameInvite_expiresAt_idx" ON "GameInvite"("expiresAt");
