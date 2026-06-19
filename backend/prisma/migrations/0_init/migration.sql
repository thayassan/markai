-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "userType" TEXT NOT NULL,
    "studentCode" TEXT,
    "universityId" TEXT,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "avatarUrl" TEXT,
    "phoneNumber" TEXT,
    "location" TEXT,
    "bio" TEXT,
    "twoFactorAuth" BOOLEAN NOT NULL DEFAULT false,
    "emailAlerts" BOOLEAN NOT NULL DEFAULT true,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "proPlan" BOOLEAN NOT NULL DEFAULT false,
    "department" TEXT,
    "role" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PasswordReset" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "otp" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordReset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "University" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "University_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Class" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "universityId" TEXT NOT NULL,
    "lecturerId" TEXT NOT NULL,

    CONSTRAINT "Class_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClassEnrollment" (
    "id" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClassEnrollment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarkingSession" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "classId" TEXT,
    "lecturerId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "sessionType" TEXT NOT NULL,
    "examBoard" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "paperType" TEXT NOT NULL DEFAULT 'Theory',
    "questionPdfUrl" TEXT NOT NULL,
    "markSchemePdfUrl" TEXT NOT NULL,
    "questionTextUrl" TEXT,
    "markSchemeTextUrl" TEXT,
    "markingStrictness" TEXT NOT NULL DEFAULT 'Standard',
    "feedbackDetail" TEXT NOT NULL DEFAULT 'Detailed',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarkingSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentAnswerSheet" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "studentName" TEXT,
    "pdfUrl" TEXT NOT NULL,
    "textUrl" TEXT,
    "extractedText" TEXT NOT NULL,
    "extractMethod" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudentAnswerSheet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentResult" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "studentName" TEXT,
    "studentCode" TEXT,
    "answerPdfUrl" TEXT NOT NULL,
    "totalMarks" INTEGER NOT NULL,
    "maxMarks" INTEGER NOT NULL,
    "percentage" DOUBLE PRECISION NOT NULL,
    "grade" TEXT NOT NULL,
    "reviewed" BOOLEAN NOT NULL DEFAULT false,
    "aiData" JSONB NOT NULL,
    "reportPdfUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudentResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestionResult" (
    "id" TEXT NOT NULL,
    "studentResultId" TEXT NOT NULL,
    "questionNumber" TEXT NOT NULL,
    "questionText" TEXT,
    "topic" TEXT NOT NULL,
    "marksAwarded" INTEGER NOT NULL,
    "marksAvailable" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "studentAnswer" TEXT,
    "expectedAnswer" TEXT,
    "aiFeedback" TEXT NOT NULL,
    "lostMarksReason" TEXT,
    "improvementSuggestion" TEXT NOT NULL,
    "lecturerOverride" INTEGER,
    "lecturerNote" TEXT,

    CONSTRAINT "QuestionResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invitation" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "userType" TEXT NOT NULL DEFAULT 'LECTURER',
    "used" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,

    CONSTRAINT "Invitation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_studentCode_key" ON "User"("studentCode");

-- CreateIndex
CREATE INDEX "User_universityId_idx" ON "User"("universityId");

-- CreateIndex
CREATE INDEX "Class_universityId_idx" ON "Class"("universityId");

-- CreateIndex
CREATE INDEX "Class_lecturerId_idx" ON "Class"("lecturerId");

-- CreateIndex
CREATE INDEX "ClassEnrollment_classId_idx" ON "ClassEnrollment"("classId");

-- CreateIndex
CREATE INDEX "MarkingSession_lecturerId_idx" ON "MarkingSession"("lecturerId");

-- CreateIndex
CREATE INDEX "MarkingSession_classId_idx" ON "MarkingSession"("classId");

-- CreateIndex
CREATE INDEX "StudentAnswerSheet_sessionId_idx" ON "StudentAnswerSheet"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "StudentAnswerSheet_sessionId_studentId_key" ON "StudentAnswerSheet"("sessionId", "studentId");

-- CreateIndex
CREATE INDEX "StudentResult_sessionId_idx" ON "StudentResult"("sessionId");

-- CreateIndex
CREATE INDEX "StudentResult_studentId_idx" ON "StudentResult"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "StudentResult_sessionId_studentId_key" ON "StudentResult"("sessionId", "studentId");

-- CreateIndex
CREATE INDEX "QuestionResult_studentResultId_idx" ON "QuestionResult"("studentResultId");

-- CreateIndex
CREATE UNIQUE INDEX "Invitation_email_key" ON "Invitation"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Invitation_code_key" ON "Invitation"("code");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_universityId_fkey" FOREIGN KEY ("universityId") REFERENCES "University"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PasswordReset" ADD CONSTRAINT "PasswordReset_email_fkey" FOREIGN KEY ("email") REFERENCES "User"("email") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Class" ADD CONSTRAINT "Class_universityId_fkey" FOREIGN KEY ("universityId") REFERENCES "University"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Class" ADD CONSTRAINT "Class_lecturerId_fkey" FOREIGN KEY ("lecturerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassEnrollment" ADD CONSTRAINT "ClassEnrollment_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarkingSession" ADD CONSTRAINT "MarkingSession_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarkingSession" ADD CONSTRAINT "MarkingSession_lecturerId_fkey" FOREIGN KEY ("lecturerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentAnswerSheet" ADD CONSTRAINT "StudentAnswerSheet_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "MarkingSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentResult" ADD CONSTRAINT "StudentResult_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "MarkingSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionResult" ADD CONSTRAINT "QuestionResult_studentResultId_fkey" FOREIGN KEY ("studentResultId") REFERENCES "StudentResult"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

