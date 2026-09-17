-- Tambah kolom hari kerja PKL per lokasi
-- workDays: JSON array angka 1-7 (1=Sen,2=Sel,...,6=Sab,7=Min)
-- NULL = default Senin-Jumat saja
ALTER TABLE "PklLocation" ADD COLUMN IF NOT EXISTS "workDays" JSONB;
