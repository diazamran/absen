/**
 * Helper pengujian:
 * - Mengarahkan DATABASE_URL ke database test (presensiku_test)
 * - Mereset skema dengan migrate deploy (dari folder migrations)
 * - Menyediakan fixture: role, permission, user, siswa, kelas
 */
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgresql://presensiku:presensiku123@localhost:5432/presensiku_test';
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
process.env.OTP_DEV_PREVIEW = 'true';

import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { hashPassword, sha256, randomNonce } from '../src/lib/crypto.js';
import { seedPermissionEntries, rolePermissionKeys, ROLE_LABELS } from '../src/rbac/permissions.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Terapkan migrasi ke database test. */
export async function resetSchema(): Promise<void> {
  execSync('npx prisma migrate deploy', {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
    stdio: 'pipe',
  });
}

export async function resetData(): Promise<void> {
  // Hapus semua data (urutan aman karena FK)
  await prisma.$transaction([
    prisma.auditLog.deleteMany(),
    prisma.notification.deleteMany(),
    prisma.leaveApproval.deleteMany(),
    prisma.leaveRequest.deleteMany(),
    prisma.teachingJournal.deleteMany(),
    prisma.attendance.deleteMany(),
    prisma.schedule.deleteMany(),
    prisma.session.deleteMany(),
    prisma.refreshToken.deleteMany(),
    prisma.otpCode.deleteMany(),
    prisma.device.deleteMany(),
    prisma.studentParent.deleteMany(),
    prisma.parent.deleteMany(),
    prisma.student.deleteMany(),
    prisma.teacher.deleteMany(),
    prisma.staff.deleteMany(),
    prisma.cardCredential.deleteMany(),
    prisma.qrCredential.deleteMany(),
    prisma.faceEmbedding.deleteMany(),
    prisma.faceProfile.deleteMany(),
    prisma.user.deleteMany(),
    prisma.rolePermission.deleteMany(),
    prisma.permission.deleteMany(),
    prisma.schoolSetting.deleteMany(),
    prisma.class.deleteMany(),
    prisma.subject.deleteMany(),
    prisma.major.deleteMany(),
    prisma.academicYear.deleteMany(),
    prisma.school.deleteMany(),
    prisma.role.deleteMany(),
  ]);
}

export interface Fixture {
  adminToken: string;
  studentToken: string;
  teacherToken: string;
  studentId: string;
  studentUserId: string;
  adminUserId: string;
  classId: string;
}

/** Seed data dasar untuk pengujian. */
export async function seedFixture(): Promise<Fixture> {
  await resetData();

  // Roles + permissions
  const roles = new Map<string, string>();
  for (const key of ['SUPER_ADMIN', 'ADMIN', 'HEADMASTER', 'HOMEROOM_TEACHER', 'TEACHER', 'STAFF', 'PIKET', 'STUDENT', 'PARENT'] as const) {
    const r = await prisma.role.create({ data: { key, name: ROLE_LABELS[key] } });
    roles.set(key, r.id);
  }
  for (const p of seedPermissionEntries()) {
    const perm = await prisma.permission.create({ data: p });
    for (const roleKey of Object.keys(ROLE_LABELS)) {
      const perms = rolePermissionKeys(roleKey);
      if (perms.includes(p.key as never)) {
        await prisma.rolePermission.create({ data: { roleId: roles.get(roleKey)!, permissionId: perm.id } });
      }
    }
  }

  await prisma.school.create({
    data: { id: 'school_test', name: 'SMA Test', timezone: 'Asia/Jakarta', latitude: -6.2088, longitude: 106.8456 },
  });
  await prisma.schoolSetting.create({
    data: { key: 'attendanceRules', value: { lateAfterHour: 7, lateAfterMinute: 0, duplicatePrevention: true, locationEnabled: false, radiusMeters: 100 } },
  });
  await prisma.schoolSetting.create({
    data: { key: 'branding', value: { appName: 'PresensiKu', schoolName: 'SMA Test' } },
  });

  const ay = await prisma.academicYear.create({ data: { name: '2025/2026', isActive: true } });
  const major = await prisma.major.create({ data: { name: 'IPA', code: 'IPA' } });

  const adminUser = await prisma.user.create({
    data: {
      username: 'admin_test',
      passwordHash: await hashPassword('admin123'),
      fullName: 'Admin Test',
      roleId: roles.get('ADMIN')!,
    },
  });
  const teacherUser = await prisma.user.create({
    data: {
      username: 'guru_test',
      passwordHash: await hashPassword('guru123'),
      fullName: 'Guru Test',
      roleId: roles.get('TEACHER')!,
    },
  });
  const teacher = await prisma.teacher.create({ data: { userId: teacherUser.id, nip: '19900101' } });
  const studentUser = await prisma.user.create({
    data: {
      username: 'siswa_test',
      passwordHash: await hashPassword('siswa123'),
      fullName: 'Siswa Test',
      roleId: roles.get('STUDENT')!,
    },
  });
  const klass = await prisma.class.create({
    data: { name: 'X-Test', grade: 'X', majorId: major.id, academicYearId: ay.id, homeroomTeacherId: teacher.id },
  });
  const student = await prisma.student.create({
    data: { userId: studentUser.id, nis: '999001', birthDate: new Date('2010-01-01'), classId: klass.id, majorId: major.id, academicYearId: ay.id, cardUidHash: sha256('CARD-TEST-001') },
  });
  await prisma.qrCredential.create({ data: { userId: studentUser.id, nonce: randomNonce() } });
  await prisma.cardCredential.create({ data: { userId: studentUser.id, cardUidHash: sha256('CARD-TEST-001') } });

  // Token admin + siswa
  const { buildApp } = await import('../src/app.js');
  const app = await buildApp();
  const loginAdmin = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin_test', password: 'admin123' } });
  const loginStudent = await app.inject({ method: 'POST', url: '/api/auth/login-student', payload: { nis: '999001', birthDate: '2010-01-01' } });
  const loginTeacher = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'guru_test', password: 'guru123' } });
  await app.close();

  return {
    adminToken: JSON.parse(loginAdmin.body).data.accessToken,
    studentToken: JSON.parse(loginStudent.body).data.accessToken,
    teacherToken: JSON.parse(loginTeacher.body).data.accessToken,
    studentId: student.id,
    studentUserId: studentUser.id,
    adminUserId: adminUser.id,
    classId: klass.id,
  };
}

beforeAll(async () => {
  await resetSchema();
}, 60_000);
