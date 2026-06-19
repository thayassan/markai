-- CreateTable
CREATE TABLE "UploadJob" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "filename" TEXT NOT NULL,
    "extractedText" TEXT,
    "method" TEXT,
    "fileUrl" TEXT,
    "textUrl" TEXT,
    "fileType" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "UploadJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UploadJob_status_idx" ON "UploadJob"("status");
