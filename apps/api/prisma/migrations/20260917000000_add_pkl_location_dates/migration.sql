-- Tambah tanggal mulai dan selesai periode PKL ke tabel PklLocation
ALTER TABLE "PklLocation" ADD COLUMN IF NOT EXISTS "startDate" TIMESTAMP(3);
ALTER TABLE "PklLocation" ADD COLUMN IF NOT EXISTS "endDate" TIMESTAMP(3);
