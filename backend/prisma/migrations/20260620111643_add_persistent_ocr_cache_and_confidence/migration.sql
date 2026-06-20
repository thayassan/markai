-- AlterTable
ALTER TABLE "QuestionResult" ADD COLUMN     "aiConfidence" TEXT,
ADD COLUMN     "consensusNote" TEXT;

-- CreateTable
CREATE TABLE "OcrCache" (
    "id" TEXT NOT NULL,
    "fileHash" TEXT NOT NULL,
    "extractedText" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OcrCache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OcrCache_fileHash_key" ON "OcrCache"("fileHash");
