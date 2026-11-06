-- AlterTable: tambah sdmsManaged untuk membedakan akun SDMS vs manual
-- Student: sdmsManaged = true jika dibuat/dikelola oleh sync SDMS
ALTER TABLE "Student" ADD COLUMN "sdmsManaged" BOOLEAN NOT NULL DEFAULT false;

-- Teacher: sdmsManaged = true jika dibuat/dikelola oleh sync SDMS
ALTER TABLE "Teacher" ADD COLUMN "sdmsManaged" BOOLEAN NOT NULL DEFAULT false;

-- Index untuk query deaktivasi yang efisien
CREATE INDEX "Student_sdmsManaged_idx" ON "Student"("sdmsManaged");
CREATE INDEX "Teacher_sdmsManaged_idx" ON "Teacher"("sdmsManaged");
