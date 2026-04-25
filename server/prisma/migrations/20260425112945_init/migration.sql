-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT,
    "passwordHash" TEXT,
    "displayName" TEXT,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "rating" INTEGER NOT NULL DEFAULT 1200,
    "gamesPlayed" INTEGER NOT NULL DEFAULT 0,
    "gamesWon" INTEGER NOT NULL DEFAULT 0,
    "highestScore" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Room" (
    "id" VARCHAR(8) NOT NULL,
    "hostUserId" TEXT,
    "hostSeatId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'waiting',
    "mode" TEXT NOT NULL DEFAULT 'private',
    "gameState" JSONB NOT NULL DEFAULT '{}',
    "currentTurnSeatId" TEXT,
    "turnOrder" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "turnNumber" INTEGER NOT NULL DEFAULT 0,
    "consecutivePasses" INTEGER NOT NULL DEFAULT 0,
    "isFirstMove" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "Room_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Seat" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "userId" TEXT,
    "name" TEXT NOT NULL,
    "rack" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "score" INTEGER NOT NULL DEFAULT 0,
    "position" INTEGER NOT NULL,
    "isBot" BOOLEAN NOT NULL DEFAULT false,
    "socketId" TEXT,
    "connected" BOOLEAN NOT NULL DEFAULT false,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMP(3),

    CONSTRAINT "Seat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Move" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "seatId" TEXT NOT NULL,
    "userId" TEXT,
    "turn" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "placements" JSONB,
    "words" JSONB,
    "score" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Move_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Friendship" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "friendId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMP(3),

    CONSTRAINT "Friendship_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_rating_idx" ON "User"("rating");

-- CreateIndex
CREATE INDEX "Room_status_idx" ON "Room"("status");

-- CreateIndex
CREATE INDEX "Room_lastActivityAt_idx" ON "Room"("lastActivityAt");

-- CreateIndex
CREATE INDEX "Room_mode_status_idx" ON "Room"("mode", "status");

-- CreateIndex
CREATE INDEX "Seat_roomId_idx" ON "Seat"("roomId");

-- CreateIndex
CREATE INDEX "Seat_userId_idx" ON "Seat"("userId");

-- CreateIndex
CREATE INDEX "Move_roomId_turn_idx" ON "Move"("roomId", "turn");

-- CreateIndex
CREATE INDEX "Move_userId_idx" ON "Move"("userId");

-- CreateIndex
CREATE INDEX "Friendship_userId_status_idx" ON "Friendship"("userId", "status");

-- CreateIndex
CREATE INDEX "Friendship_friendId_status_idx" ON "Friendship"("friendId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Friendship_userId_friendId_key" ON "Friendship"("userId", "friendId");

-- AddForeignKey
ALTER TABLE "Room" ADD CONSTRAINT "Room_hostUserId_fkey" FOREIGN KEY ("hostUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Seat" ADD CONSTRAINT "Seat_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Seat" ADD CONSTRAINT "Seat_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Move" ADD CONSTRAINT "Move_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Move" ADD CONSTRAINT "Move_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Friendship" ADD CONSTRAINT "Friendship_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Friendship" ADD CONSTRAINT "Friendship_friendId_fkey" FOREIGN KEY ("friendId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
