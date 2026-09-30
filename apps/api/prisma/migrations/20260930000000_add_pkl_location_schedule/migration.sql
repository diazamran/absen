-- AlterTable: tambah kolom schedule (JSON) ke PklLocation
-- Menyimpan jadwal absensi khusus per-lokasi PKL (override jadwal global di settings).
ALTER TABLE "PklLocation" ADD COLUMN "schedule" JSONB;
