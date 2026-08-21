-- CreateTable
CREATE TABLE "PklLocation" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "city" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "radiusMeter" INTEGER NOT NULL DEFAULT 100,
    "phone" TEXT,
    "contactName" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PklLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PklAssignment" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "pklLocationId" TEXT NOT NULL,
    "supervisorId" TEXT,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PklAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PklAssignment_studentId_pklLocationId_key" ON "PklAssignment"("studentId", "pklLocationId");

-- CreateIndex
CREATE INDEX "PklAssignment_pklLocationId_idx" ON "PklAssignment"("pklLocationId");

-- CreateIndex
CREATE INDEX "PklAssignment_supervisorId_idx" ON "PklAssignment"("supervisorId");

-- CreateIndex
CREATE INDEX "PklAssignment_isActive_idx" ON "PklAssignment"("isActive");

-- CreateIndex
CREATE INDEX "PklLocation_isActive_idx" ON "PklLocation"("isActive");

-- AlterTable: add pklLocationId to Attendance
ALTER TABLE "Attendance" ADD COLUMN "pklLocationId" TEXT;

-- AddForeignKey
ALTER TABLE "PklAssignment" ADD CONSTRAINT "PklAssignment_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PklAssignment" ADD CONSTRAINT "PklAssignment_pklLocationId_fkey" FOREIGN KEY ("pklLocationId") REFERENCES "PklLocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PklAssignment" ADD CONSTRAINT "PklAssignment_supervisorId_fkey" FOREIGN KEY ("supervisorId") REFERENCES "Teacher"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_pklLocationId_fkey" FOREIGN KEY ("pklLocationId") REFERENCES "PklLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
