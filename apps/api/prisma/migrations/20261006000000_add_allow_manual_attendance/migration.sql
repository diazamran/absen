-- Migration: tambah kolom allowManualAttendance di Student
-- Siswa yang HP-nya tidak support absen wajah bisa diizinkan absen manual oleh admin.
ALTER TABLE "Student" ADD COLUMN IF NOT EXISTS "allowManualAttendance" BOOLEAN NOT NULL DEFAULT false;
