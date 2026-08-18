import { prisma } from '../lib/prisma.js';
import { config } from '../config.js';

export interface AttendanceRules {
  lateAfterHour: number;
  lateAfterMinute: number;
  checkOutAfterHour: number; // jam pulang (jam)
  checkOutAfterMinute: number; // jam pulang (menit)
  checkInDeadlineHour: number; // batas akhir absen datang (jam) — 23 = tidak dibatasi
  checkInDeadlineMinute: number; // batas akhir absen datang (menit) — 59 = tidak dibatasi
  earlyLeaveBeforeHour: number; // mulai dihitung pulang awal (jam)
  earlyLeaveBeforeMinute: number; // mulai dihitung pulang awal (menit)
  duplicatePrevention: boolean;
  locationEnabled: boolean;
  radiusMeters: number;
  schoolLatitude: number;
  schoolLongitude: number;
  checkOutAllowed: boolean;
}

export interface LoginTexts {
  headline: string;
  description: string;
  loginHeading: string;
  loginSubtitle: string;
  features: string[];
}

export interface Branding {
  appName: string;
  schoolName: string;
  tagline: string;
  primaryColor: string;
  secondaryColor: string;
  logoUrl: string | null;
  loginBackground: string | null;
  loginTexts: LoginTexts;
}

/** Normalisasi nilai jam (0-23) / menit (0-59) — nilai tak valid (mis. "7.1"/"10.1") jatuh ke default. */
function normTimePart(v: unknown, fallback: number, max: number): number {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n <= max ? n : fallback;
}

function normHour(v: unknown, fallback: number): number {
  return normTimePart(v, fallback, 23);
}

function normMinute(v: unknown, fallback: number): number {
  return normTimePart(v, fallback, 59);
}

export async function getAttendanceRules(): Promise<AttendanceRules> {
  const row = await prisma.schoolSetting.findUnique({ where: { key: 'attendanceRules' } });
  const v = (row?.value as Record<string, unknown>) || {};
  const school = await prisma.school.findFirst();
  return {
    lateAfterHour: normHour(v.lateAfterHour, config.lateAfterHour),
    lateAfterMinute: normMinute(v.lateAfterMinute, config.lateAfterMinute),
    checkOutAfterHour: normHour(v.checkOutAfterHour, config.checkOutAfterHour),
    checkOutAfterMinute: normMinute(v.checkOutAfterMinute, config.checkOutAfterMinute),
    checkInDeadlineHour: normHour(v.checkInDeadlineHour, config.checkInDeadlineHour),
    checkInDeadlineMinute: normMinute(v.checkInDeadlineMinute, config.checkInDeadlineMinute),
    // Pulang awal: default ikut jam pulang sekolah kalau belum diatur terpisah
    earlyLeaveBeforeHour: normHour(v.earlyLeaveBeforeHour ?? v.checkOutAfterHour, config.checkOutAfterHour),
    earlyLeaveBeforeMinute: normMinute(v.earlyLeaveBeforeMinute ?? v.checkOutAfterMinute, config.checkOutAfterMinute),
    duplicatePrevention: v.duplicatePrevention !== false,
    locationEnabled: v.locationEnabled === true || (v.locationEnabled === undefined && config.locationEnabled),
    radiusMeters: Number(v.radiusMeters ?? config.locationRadiusMeters),
    schoolLatitude: school?.latitude ?? config.schoolLatitude,
    schoolLongitude: school?.longitude ?? config.schoolLongitude,
    checkOutAllowed: v.checkOutAllowed !== false,
  };
}

const DEFAULT_LOGIN_TEXTS: LoginTexts = {
  headline: 'Satu aplikasi untuk semua peran.',
  description: 'Setiap pengguna hanya melihat data dan menu sesuai wewenangnya — dari kepala sekolah, admin, guru, wali kelas, petugas piket, hingga siswa dan orang tua.',
  loginHeading: 'Masuk ke Panel',
  loginSubtitle: 'Masuk dengan akun Anda — hak akses menyesuaikan peran secara otomatis.',
  features: [
    'Akses berbasis peran (RBAC) untuk setiap akun',
    'Absensi QR, wajah, kartu & gerbang secara realtime',
    'Laporan per kelas & rekap otomatis (PDF / Excel)',
    'Sesi terenkripsi & audit log setiap aktivitas',
  ],
};

export async function getBranding(): Promise<Branding> {
  const row = await prisma.schoolSetting.findUnique({ where: { key: 'branding' } });
  const v = (row?.value as Record<string, unknown>) || {};
  const school = await prisma.school.findFirst();
  const lt = (v.loginTexts as Record<string, unknown>) || {};
  return {
    appName: String(v.appName || config.appName),
    schoolName: String(v.schoolName || school?.name || config.schoolName),
    tagline: String(v.tagline || 'Sistem Informasi Absensi Terintegrasi'),
    primaryColor: String(v.primaryColor || '#0d9488'),
    secondaryColor: String(v.secondaryColor || '#14b8a6'),
    logoUrl: v.logoUrl ? String(v.logoUrl) : null,
    loginBackground: v.loginBackground ? String(v.loginBackground) : null,
    loginTexts: {
      headline: String(lt.headline || DEFAULT_LOGIN_TEXTS.headline),
      description: String(lt.description || DEFAULT_LOGIN_TEXTS.description),
      loginHeading: String(lt.loginHeading || DEFAULT_LOGIN_TEXTS.loginHeading),
      loginSubtitle: String(lt.loginSubtitle || DEFAULT_LOGIN_TEXTS.loginSubtitle),
      features: Array.isArray(lt.features) && lt.features.length > 0 ? lt.features.map(String) : DEFAULT_LOGIN_TEXTS.features,
    },
  };
}
