-- CreateTable
CREATE TABLE "ViolationType" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "points" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ViolationType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentViolation" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "violationTypeId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudentViolation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ViolationType_name_key" ON "ViolationType"("name");

-- CreateIndex
CREATE INDEX "StudentViolation_studentId_idx" ON "StudentViolation"("studentId");

-- CreateIndex
CREATE INDEX "StudentViolation_violationTypeId_idx" ON "StudentViolation"("violationTypeId");

-- CreateIndex
CREATE INDEX "StudentViolation_date_idx" ON "StudentViolation"("date");

-- CreateIndex
CREATE INDEX "StudentViolation_recordedById_idx" ON "StudentViolation"("recordedById");

-- AddForeignKey
ALTER TABLE "StudentViolation" ADD CONSTRAINT "StudentViolation_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentViolation" ADD CONSTRAINT "StudentViolation_violationTypeId_fkey" FOREIGN KEY ("violationTypeId") REFERENCES "ViolationType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentViolation" ADD CONSTRAINT "StudentViolation_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
