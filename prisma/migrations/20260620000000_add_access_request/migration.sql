-- CreateTable
CREATE TABLE "AccessRequest" (
    "id" TEXT NOT NULL,
    "kakaoId" TEXT NOT NULL,
    "nickname" TEXT,
    "profileImageUrl" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastAttemptAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccessRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AccessRequest_kakaoId_key" ON "AccessRequest"("kakaoId");

-- CreateIndex
CREATE INDEX "AccessRequest_createdAt_idx" ON "AccessRequest"("createdAt");
