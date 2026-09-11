-- AlterTable
ALTER TABLE "QuestionResult" ADD COLUMN "lastChangedBy" TEXT;
ALTER TABLE "QuestionResult" ADD COLUMN "lastChangedByName" TEXT;
ALTER TABLE "QuestionResult" ADD COLUMN "lastChangedByRole" TEXT;
ALTER TABLE "QuestionResult" ADD COLUMN "lastChangedAt" TIMESTAMP(3);
ALTER TABLE "QuestionResult" ADD COLUMN "originalAiMark" INTEGER;

-- CreateTable
CREATE TABLE "MarkChangeAudit" (
    "id" TEXT NOT NULL,
    "questionResultId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "questionNumber" TEXT NOT NULL,
    "changedBy" TEXT NOT NULL,
    "changedByName" TEXT NOT NULL,
    "changedByRole" TEXT NOT NULL,
    "previousMark" INTEGER NOT NULL,
    "newMark" INTEGER NOT NULL,
    "marksAvailable" INTEGER NOT NULL,
    "reason" TEXT,
    "changeType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarkChangeAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MarkChangeAudit_questionResultId_idx" ON "MarkChangeAudit"("questionResultId");

-- CreateIndex
CREATE INDEX "MarkChangeAudit_sessionId_idx" ON "MarkChangeAudit"("sessionId");

-- CreateIndex
CREATE INDEX "MarkChangeAudit_studentId_idx" ON "MarkChangeAudit"("studentId");

-- AddForeignKey
ALTER TABLE "MarkChangeAudit" ADD CONSTRAINT "MarkChangeAudit_questionResultId_fkey" FOREIGN KEY ("questionResultId") REFERENCES "QuestionResult"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarkChangeAudit" ADD CONSTRAINT "MarkChangeAudit_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "MarkingSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
