/* eslint-disable no-console */
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/lib/crypto.js';
import { seedPermissionEntries, rolePermissionKeys, ROLE_LABELS } from '../src/rbac/permissions.js';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // ===== Roles & Permissions =====
  const roleKeys = [
    'SUPER_ADMIN', 'ADMIN', 'HEADMASTER', 'HOMEROOM_TEACHER',
    'TEACHER', 'STAFF', 'PIKET', 'STUDENT', 'PARENT',
  ] as const;

  const roles = new Map<string, string>();
  for (const key of roleKeys) {
    const r = await prisma.role.upsert({
      where: { key },
      update: { name: ROLE_LABELS[key] },
      create: { key, name: ROLE_LABELS[key] },
    });
    roles.set(key, r.id);
  }

  const perms = new Map<string, string>();
  for (const p of seedPermissionEntries()) {
    const perm = await prisma.permission.upsert({
      where: { key: p.key },
      update: { name: p.name, module: p.module },
      create: p,
    });
    perms.set(p.key, perm.id);
  }

  for (const [roleKey, roleId] of roles) {
    const keys = rolePermissionKeys(roleKey);
    const current = await prisma.rolePermission.findMany({ where: { roleId }, select: { permissionId: true } });
    const currentIds = new Set(current.map((c) => c.permissionId));
    for (const key of keys) {
      const permissionId = perms.get(key)!;
      if (!currentIds.has(permissionId)) {
        await prisma.rolePermission.create({ data: { roleId, permissionId } });
      }
    }
  }

  // ===== Sekolah =====
  await prisma.school.upsert({
    where: { id: 'school_main' },
    update: { name: 'SMK Negeri 1 Kras', npsn: '20565942' },
    create: {
      id: 'school_main', name: 'SMK Negeri 1 Kras', npsn: '20565942',
      address: 'Jl. Raya Kras, Kras, Kabupaten Kediri, Jawa Timur',
      phone: '(0354) 391535', email: 'info@smkn1kras.sch.id',
      timezone: 'Asia/Jakarta', latitude: -7.9659, longitude: 111.9926,
    },
  });

  // ===== Settings (hanya jika belum ada) =====
  const settingsSeed: { key: string; value: unknown }[] = [
    { key: 'branding', value: { appName: 'PresensiKu', schoolName: 'SMK Negeri 1 Kras', tagline: 'Sistem Informasi Absensi Terintegrasi', primaryColor: '#0d9488', secondaryColor: '#14b8a6', logoUrl: null, loginBackground: null } },
    { key: 'attendanceRules', value: { lateAfterHour: 7, lateAfterMinute: 0, duplicatePrevention: true, locationEnabled: false, radiusMeters: 100, checkOutAllowed: true } },
    { key: 'notifications', value: { whatsappEnabled: false, pushEnabled: false, emailEnabled: false } },
  ];
  for (const s of settingsSeed) {
    const existing = await prisma.schoolSetting.findUnique({ where: { key: s.key } });
    if (!existing) {
      await prisma.schoolSetting.create({ data: { key: s.key, value: s.value as object } });
    }
  }

  // ===== Tahun Ajaran =====
  await prisma.academicYear.upsert({ where: { name: '2025/2026' }, update: { isActive: true }, create: { name: '2025/2026', isActive: true } });

  // ===== Jurusan =====
  for (const m of [
    { name: 'TKJ', code: 'TKJ' }, { name: 'TKR', code: 'TKR' },
    { name: 'TPTUP', code: 'TPTUP' }, { name: 'KULINER', code: 'KULINER' },
  ]) {
    const existing = await prisma.major.findFirst({ where: { OR: [{ name: m.name }, { code: m.code }] } });
    if (!existing) await prisma.major.create({ data: m });
  }

  // ===== Admin Users (hanya buat jika belum ada) =====
  async function createAdminUser(params: { username: string; password: string; fullName: string; role: string }) {
    const existing = await prisma.user.findUnique({ where: { username: params.username } });
    if (existing) return;
    await prisma.user.create({
      data: {
        username: params.username,
        passwordHash: await hashPassword(params.password),
        fullName: params.fullName,
        roleId: roles.get(params.role)!,
      },
    });
    console.log(`   user: ${params.username} / ${params.password} (${params.fullName})`);
  }

  await createAdminUser({ username: 'superadmin', password: 'admin123', fullName: 'Admin Utama', role: 'SUPER_ADMIN' });
  await createAdminUser({ username: 'admin', password: 'admin123', fullName: 'Administrator', role: 'ADMIN' });

  // HAPUS siswa demo, kelas demo, jadwal demo, absensi demo
  console.log('   Membersihkan data demo lama...');
  await prisma.attendance.deleteMany({});
  await prisma.leaveRequest.deleteMany({});
  await prisma.studentParent.deleteMany({});
  await prisma.parent.deleteMany({});
  await prisma.student.deleteMany({});
  await prisma.schedule.deleteMany({});
  await prisma.class.deleteMany({});
  await prisma.user.deleteMany({ where: { role: { key: { in: ['STUDENT', 'PARENT'] } } } });

  console.log('');
  console.log('✅ Seed selesai (hanya roles, permissions, school, admin users, jurusan).');
  console.log('   Siswa, kelas, guru akan di-sync dari SDMS.');
  console.log('');
  console.log('Akun login:');
  console.log('   Super Admin : superadmin / admin123');
  console.log('   Admin       : admin / admin123');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
