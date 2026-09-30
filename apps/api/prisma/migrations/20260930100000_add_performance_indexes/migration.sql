-- Migrasi: tambah index performa untuk query yang sering dipakai
-- Semua index menggunakan CREATE INDEX IF NOT EXISTS agar aman dijalankan ulang.

-- Attendance: query by userId (dashboard siswa/ortu, absensi)
CREATE INDEX IF NOT EXISTS "Attendance_userId_idx" ON "Attendance"("userId");

-- Attendance: range query per user per tanggal (history, laporan)
CREATE INDEX IF NOT EXISTS "Attendance_userId_date_idx" ON "Attendance"("userId", "date");

-- Attendance: filter laporan PKL by lokasi
CREATE INDEX IF NOT EXISTS "Attendance_pklLocationId_idx" ON "Attendance"("pklLocationId");

-- Attendance: filter CHECK_IN / CHECK_OUT
CREATE INDEX IF NOT EXISTS "Attendance_type_idx" ON "Attendance"("type");

-- LeaveApproval: lookup approval per surat izin
CREATE INDEX IF NOT EXISTS "LeaveApproval_leaveRequestId_idx" ON "LeaveApproval"("leaveRequestId");

-- LeaveApproval: riwayat approval per user
CREATE INDEX IF NOT EXISTS "LeaveApproval_approverId_idx" ON "LeaveApproval"("approverId");

-- TeachingJournal: query jurnal per guru
CREATE INDEX IF NOT EXISTS "TeachingJournal_teacherId_idx" ON "TeachingJournal"("teacherId");

-- TeachingJournal: query jurnal guru + range tanggal
CREATE INDEX IF NOT EXISTS "TeachingJournal_teacherId_date_idx" ON "TeachingJournal"("teacherId", "date");
