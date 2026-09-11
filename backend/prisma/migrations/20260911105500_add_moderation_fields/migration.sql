-- AlterTable
ALTER TABLE "MarkingSession" ADD COLUMN "moderationStatus" TEXT;
ALTER TABLE "MarkingSession" ADD COLUMN "moderatorEmail" TEXT;
ALTER TABLE "MarkingSession" ADD COLUMN "moderatorToken" TEXT;
ALTER TABLE "MarkingSession" ADD COLUMN "moderatorTokenExp" TIMESTAMP(3);
ALTER TABLE "MarkingSession" ADD COLUMN "moderatorNote" TEXT;
ALTER TABLE "MarkingSession" ADD COLUMN "moderationFeedback" TEXT;
ALTER TABLE "MarkingSession" ADD COLUMN "submittedAt" TIMESTAMP(3);
ALTER TABLE "MarkingSession" ADD COLUMN "moderatedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ModerationOverride" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "questionResultId" TEXT NOT NULL,
    "originalMark" INTEGER NOT NULL,
    "moderatorMark" INTEGER NOT NULL,
    "moderatorNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModerationOverride_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MarkingSession_moderatorToken_key" ON "MarkingSession"("moderatorToken");

-- CreateIndex
CREATE INDEX "ModerationOverride_sessionId_idx" ON "ModerationOverride"("sessionId");

-- CreateIndex
CREATE INDEX "ModerationOverride_questionResultId_idx" ON "ModerationOverride"("questionResultId");

-- AddForeignKey
ALTER TABLE "ModerationOverride" ADD CONSTRAINT "ModerationOverride_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "MarkingSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModerationOverride" ADD CONSTRAINT "ModerationOverride_questionResultId_fkey" FOREIGN KEY ("questionResultId") REFERENCES "QuestionResult"("id") ON DELETE CASCADE ON UPDATE CASCADE;
