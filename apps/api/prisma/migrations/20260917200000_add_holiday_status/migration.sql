-- Tambah nilai 'HOLIDAY' (Libur) ke enum AttendanceStatus
ALTER TYPE "AttendanceStatus" ADD VALUE IF NOT EXISTS 'HOLIDAY';
