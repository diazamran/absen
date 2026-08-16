import { prisma } from '../lib/prisma.js';
import { config } from '../config.js';

export interface AttendanceRules {
  lateAfterHour: number;
  lateAfterMinute: number;
  checkOutAfterHour: number; // jam pulang (jam)
  checkOutAfterMinute: number; // jam pulang (menit)
  duplicatePrevention: boolean;
  locationEnabled: boolean;
  radiusMeters: number;
  schoolLatitude: number;
  schoolLongitude: number;
  checkOutAllowed: boolean;
}

export interface Branding {
  appName: string;
  schoolName: string;
  tagline: string;
  primaryColor: string;
  secondaryColor: string;
  logoUrl: string | null;
  loginBackground: string | null;
}

export async function getAttendanceRules(): Promise<AttendanceRules> {
  const row = await prisma.schoolSetting.findUnique({ where: { key: 'attendanceRules' } });
  const v = (row?.value as Record<string, unknown>) || {};
  const school = await prisma.school.findFirst();
  return {
    lateAfterHour: Number(v.lateAfterHour ?? config.lateAfterHour),
    lateAfterMinute: Number(v.lateAfterMinute ?? config.lateAfterMinute),
    checkOutAfterHour: Number(v.checkOutAfterHour ?? config.checkOutAfterHour),
    checkOutAfterMinute: Number(v.checkOutAfterMinute ?? config.checkOutAfterMinute),
    duplicatePrevention: v.duplicatePrevention !== false,
    locationEnabled: v.locationEnabled === true || (v.locationEnabled === undefined && config.locationEnabled),
    radiusMeters: Number(v.radiusMeters ?? config.locationRadiusMeters),
    schoolLatitude: school?.latitude ?? config.schoolLatitude,
    schoolLongitude: school?.longitude ?? config.schoolLongitude,
    checkOutAllowed: v.checkOutAllowed !== false,
  };
}

export async function getBranding(): Promise<Branding> {
  const row = await prisma.schoolSetting.findUnique({ where: { key: 'branding' } });
  const v = (row?.value as Record<string, unknown>) || {};
  const school = await prisma.school.findFirst();
  return {
    appName: String(v.appName || config.appName),
    schoolName: String(v.schoolName || school?.name || config.schoolName),
    tagline: String(v.tagline || 'Sistem Informasi Absensi Terintegrasi'),
    primaryColor: String(v.primaryColor || '#0d9488'),
    secondaryColor: String(v.secondaryColor || '#14b8a6'),
    logoUrl: v.logoUrl ? String(v.logoUrl) : null,
    loginBackground: v.loginBackground ? String(v.loginBackground) : null,
  };
}
