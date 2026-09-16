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
  // ===== Jadwal khusus PKL =====
  // Siswa PKL bekerja dengan jam berbeda dari sekolah biasa. Semua nilai opsional —
  // yang tidak diisi otomatis mengikuti jadwal sekolah supaya tidak rancu.
  pklLateAfterHour: number | null; // batas terlambat PKL
  pklLateAfterMinute: number | null;
  pklCheckInDeadlineHour: number | null; // batas akhir absen datang PKL
  pklCheckInDeadlineMinute: number | null;
  pklCheckOutAfterHour: number | null; // jam selesai kerja PKL
  pklCheckOutAfterMinute: number | null;
  pklEarlyLeaveBeforeHour: number | null; // pulang sebelum jam ini = Pulang Awal PKL
  pklEarlyLeaveBeforeMinute: number | null;
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

/** Normalisasi jam/menit opsional: null / kosong / tidak valid → null (ikut jadwal sekolah). */
function normOptTime(v: unknown, max: number): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n <= max ? n : null;
}

let _rulesCache: AttendanceRules | null = null;
let _rulesCacheTime = 0;

export function invalidateRulesCache() { _rulesCache = null; }

export async function getAttendanceRules(): Promise<AttendanceRules> {
  const now = Date.now();
  if (_rulesCache && now - _rulesCacheTime < 60_000) return _rulesCache;
  const row = await prisma.schoolSetting.findUnique({ where: { key: 'attendanceRules' } });
  const v = (row?.value as Record<string, unknown>) || {};
  const school = await prisma.school.findFirst();
  const rules: AttendanceRules = {
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
    // Koordinat sekolah: prioritas attendanceRules JSON (disimpan admin via form)
    // → fallback School table → fallback env var / config default.
    // parseFloat() dipakai (bukan Number()) supaya string seperti "111.957" tetap
    // diparsing dengan benar. Validasi rentang membuang nilai rusak (mis. integer
    // raksasa tanpa titik desimal yang masuk dari versi lama).
    schoolLatitude: (() => {
      const v2 = parseFloat(String(v.schoolLatitude ?? ''));
      // Latitude valid: -90 s.d. 90
      if (Number.isFinite(v2) && v2 >= -90 && v2 <= 90 && v2 !== 0) return v2;
      const db = school?.latitude;
      if (db != null && db >= -90 && db <= 90 && db !== 0) return db;
      return config.schoolLatitude;
    })(),
    schoolLongitude: (() => {
      const v2 = parseFloat(String(v.schoolLongitude ?? ''));
      // Longitude valid: -180 s.d. 180
      if (Number.isFinite(v2) && v2 >= -180 && v2 <= 180 && v2 !== 0) return v2;
      const db = school?.longitude;
      if (db != null && db >= -180 && db <= 180 && db !== 0) return db;
      return config.schoolLongitude;
    })(),
    checkOutAllowed: v.checkOutAllowed !== false,
    // Jadwal PKL — kosong = ikut jadwal sekolah (fallback ditentukan pemakai aturan)
    pklLateAfterHour: normOptTime(v.pklLateAfterHour, 23),
    pklLateAfterMinute: normOptTime(v.pklLateAfterMinute, 59),
    pklCheckInDeadlineHour: normOptTime(v.pklCheckInDeadlineHour, 23),
    pklCheckInDeadlineMinute: normOptTime(v.pklCheckInDeadlineMinute, 59),
    pklCheckOutAfterHour: normOptTime(v.pklCheckOutAfterHour, 23),
    pklCheckOutAfterMinute: normOptTime(v.pklCheckOutAfterMinute, 59),
    pklEarlyLeaveBeforeHour: normOptTime(v.pklEarlyLeaveBeforeHour, 23),
    pklEarlyLeaveBeforeMinute: normOptTime(v.pklEarlyLeaveBeforeMinute, 59),
  };
  _rulesCache = rules;
  _rulesCacheTime = Date.now();
  return rules;
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
