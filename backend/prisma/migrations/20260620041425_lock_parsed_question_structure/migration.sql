-- AlterTable
ALTER TABLE "MarkingSession" ADD COLUMN     "parsedMarkScheme" JSONB,
ADD COLUMN     "parsedQuestions" JSONB,
ADD COLUMN     "parsingVerified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "totalMaxMarks" INTEGER;
