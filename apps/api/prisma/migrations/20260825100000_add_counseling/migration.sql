-- CreateTable
CREATE TABLE "Counseling" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "action" TEXT,
    "followUp" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Counseling_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Counseling_studentId_idx" ON "Counseling"("studentId");

-- CreateIndex
CREATE INDEX "Counseling_createdById_idx" ON "Counseling"("createdById");

-- CreateIndex
CREATE INDEX "Counseling_type_idx" ON "Counseling"("type");

-- CreateIndex
CREATE INDEX "Counseling_createdAt_idx" ON "Counseling"("createdAt");

-- AddForeignKey
ALTER TABLE "Counseling" ADD CONSTRAINT "Counseling_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Counseling" ADD CONSTRAINT "Counseling_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
