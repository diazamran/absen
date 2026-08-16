-- Tandai absen pulang yang terjadi sebelum jam pulang sekolah
ALTER TABLE "Attendance" ADD COLUMN "earlyLeave" BOOLEAN NOT NULL DEFAULT false;
