/* eslint-disable no-console */
import { PrismaClient, type ScheduleDay } from '@prisma/client';
import { hashPassword, sha256, randomNonce } from '../src/lib/crypto.js';
import { seedPermissionEntries, rolePermissionKeys, ROLE_LABELS } from '../src/rbac/permissions.js';
import { dateKey, startOfLocalDay, localTimeToUtc } from '../src/lib/time.js';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // ===== Roles & Permissions =====
  const roleKeys = [
    'SUPER_ADMIN',
    'ADMIN',
    'HEADMASTER',
    'HOMEROOM_TEACHER',
    'TEACHER',
    'STAFF',
    'PIKET',
    'STUDENT',
    'PARENT',
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

  // Relasi Role-Permission
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
  const school = await prisma.school.upsert({
    where: { id: 'school_main' },
    update: {
      name: 'SMK Negeri 1 Kras',
      npsn: '20565942',
      address: 'Jl. Raya Kras, Kras, Kabupaten Kediri, Jawa Timur',
      phone: '(0354) 391535',
      email: 'info@smkn1kras.sch.id',
    },
    create: {
      id: 'school_main',
      name: 'SMK Negeri 1 Kras',
      npsn: '20565942',
      address: 'Jl. Raya Kras, Kras, Kabupaten Kediri, Jawa Timur',
      phone: '(0354) 391535',
      email: 'info@smkn1kras.sch.id',
      timezone: 'Asia/Jakarta',
      latitude: -7.9659,
      longitude: 111.9926,
    },
  });
  console.log('   sekolah:', school.name);

  const settingsSeed: { key: string; value: unknown }[] = [
    {
      key: 'branding',
      value: {
        appName: 'PresensiKu',
        schoolName: school.name,
        tagline: 'Sistem Informasi Absensi Terintegrasi',
        primaryColor: '#0d9488',
        secondaryColor: '#14b8a6',
        logoUrl: null,
        loginBackground: null,
      },
    },
    {
      key: 'attendanceRules',
      value: {
        lateAfterHour: 7,
        lateAfterMinute: 0,
        duplicatePrevention: true,
        locationEnabled: false,
        radiusMeters: 100,
        checkOutAllowed: true,
      },
    },
    {
      key: 'notifications',
      value: {
        whatsappEnabled: false,
        pushEnabled: false,
        emailEnabled: false,
      },
    },
  ];
  for (const s of settingsSeed) {
    await prisma.schoolSetting.upsert({
      where: { key: s.key },
      update: { value: s.value as object },
      create: { key: s.key, value: s.value as object },
    });
  }

  // ===== Tahun Ajaran, Jurusan, Mapel =====
  const ay = await prisma.academicYear.upsert({
    where: { name: '2025/2026' },
    update: { isActive: true },
    create: { name: '2025/2026', isActive: true },
  });
  await prisma.academicYear.upsert({
    where: { name: '2024/2025' },
    update: {},
    create: { name: '2024/2025', isActive: false },
  });

  const majors: Record<string, string> = {};
  // Jurusan SMK Negeri 1 Kras
  for (const m of [
    { name: 'TKJ', code: 'TKJ' }, // Teknik Komputer dan Jaringan
    { name: 'TKR', code: 'TKR' }, // Teknik Kendaraan Ringan
    { name: 'TPTUP', code: 'TPTUP' }, // Teknik Pendingin dan Tata Udara Penerbangan
    { name: 'KULINER', code: 'KULINER' }, // Tata Boga / Kuliner
  ]) {
    const major = await prisma.major.upsert({ where: { name: m.name }, update: {}, create: m });
    majors[m.name] = major.id;
  }

  const subjects: Record<string, string> = {};
  for (const s of [
    { name: 'Matematika', code: 'MTK', color: '#0d9488' },
    { name: 'Bahasa Indonesia', code: 'BIN', color: '#2563eb' },
    { name: 'Ilmu Pengetahuan Alam', code: 'IPA', color: '#7c3aed' },
  ]) {
    const subj = await prisma.subject.upsert({
      where: { name: s.name },
      update: {},
      create: { name: s.name, code: s.code, color: s.color },
    });
    subjects[s.name] = subj.id;
  }

  // ===== Pengguna =====
  async function createUser(params: {
    key: string;
    username: string;
    password: string;
    fullName: string;
    role: string;
    phone?: string;
    email?: string;
  }) {
    const existing = await prisma.user.findUnique({ where: { username: params.username } });
    if (existing) return existing;
    const user = await prisma.user.create({
      data: {
        username: params.username,
        passwordHash: await hashPassword(params.password),
        fullName: params.fullName,
        phone: params.phone,
        email: params.email,
        roleId: roles.get(params.role)!,
      },
    });
    // eslint-disable-next-line no-console
    console.log(`   user ${params.key}: ${params.username} / ${params.password} (${params.fullName})`);
    return user;
  }

  const superAdmin = await createUser({
    key: 'super-admin',
    username: 'superadmin',
    password: 'admin123',
    fullName: 'Admin Utama',
    role: 'SUPER_ADMIN',
    email: 'superadmin@sman1nusantara.sch.id',
  });

  const admin = await createUser({
    key: 'admin',
    username: 'admin',
    password: 'admin123',
    fullName: 'Rina Kartika, S.Pd.',
    role: 'ADMIN',
    email: 'tu@sman1nusantara.sch.id',
  });

  const headmaster = await createUser({
    key: 'kepsek',
    username: 'kepsek',
    password: 'kepsek123',
    fullName: 'Dr. H. Bambang Sutrisno, M.Pd.',
    role: 'HEADMASTER',
  });

  const wali = await createUser({
    key: 'wali',
    username: 'wali',
    password: 'guru123',
    fullName: 'Siti Rahma, S.Pd.',
    role: 'HOMEROOM_TEACHER',
    phone: '081234567801',
  });

  const guru = await createUser({
    key: 'guru',
    username: 'guru',
    password: 'guru123',
    fullName: 'Budi Santoso, S.Pd.',
    role: 'TEACHER',
    phone: '081234567802',
  });

  const staff = await createUser({
    key: 'staff',
    username: 'staff',
    password: 'staff123',
    fullName: 'Agus Salim',
    role: 'STAFF',
    phone: '081234567803',
  });

  // ===== Guru & Staff detail =====
  const teacherWali = await prisma.teacher.upsert({
    where: { userId: wali.id },
    update: {},
    create: { userId: wali.id, nip: '198001012010012001', position: 'Guru Matematika', subjectId: subjects['Matematika'] },
  });
  const teacherGuru = await prisma.teacher.upsert({
    where: { userId: guru.id },
    update: {},
    create: { userId: guru.id, nip: '198505052012012002', position: 'Guru Bahasa Indonesia', subjectId: subjects['Bahasa Indonesia'] },
  });
  await prisma.staff.upsert({
    where: { userId: staff.id },
    update: {},
    create: { userId: staff.id, nip: '199001012015013001', position: 'Staf Tata Usaha' },
  });

  // ===== Kelas (satu kelas per jurusan SMKN 1 Kras) =====
  const classXA = await prisma.class.upsert({
    where: { name_academicYearId: { name: 'X-TKJ-1', academicYearId: ay.id } },
    update: {},
    create: {
      name: 'X-TKJ-1',
      grade: 'X',
      majorId: majors['TKJ'],
      academicYearId: ay.id,
      homeroomTeacherId: teacherWali.id,
      room: 'Labkom 1',
    },
  });
  const classXB = await prisma.class.upsert({
    where: { name_academicYearId: { name: 'X-TKR-1', academicYearId: ay.id } },
    update: {},
    create: { name: 'X-TKR-1', grade: 'X', majorId: majors['TKR'], academicYearId: ay.id, room: 'Bengkel TKR' },
  });
  await prisma.class.upsert({
    where: { name_academicYearId: { name: 'X-TPTUP-1', academicYearId: ay.id } },
    update: {},
    create: { name: 'X-TPTUP-1', grade: 'X', majorId: majors['TPTUP'], academicYearId: ay.id, room: 'Lab Pendingin' },
  });
  await prisma.class.upsert({
    where: { name_academicYearId: { name: 'X-KULINER-1', academicYearId: ay.id } },
    update: {},
    create: { name: 'X-KULINER-1', grade: 'X', majorId: majors['KULINER'], academicYearId: ay.id, room: 'Dapur Praktik' },
  });

  // ===== Jadwal =====
  const schedulesSeed = [
    { classId: classXA.id, subjectId: subjects['Matematika'], teacherId: teacherWali.id, day: 'MONDAY' as ScheduleDay, startTime: '07:00', endTime: '08:30', room: 'Labkom 1' },
    { classId: classXA.id, subjectId: subjects['Bahasa Indonesia'], teacherId: teacherGuru.id, day: 'MONDAY' as ScheduleDay, startTime: '08:30', endTime: '10:00', room: 'Ruang 2' },
    { classId: classXB.id, subjectId: subjects['Ilmu Pengetahuan Alam'], teacherId: teacherWali.id, day: 'TUESDAY' as ScheduleDay, startTime: '07:00', endTime: '08:30', room: 'Lab IPA' },
  ];
  for (const s of schedulesSeed) {
    await prisma.schedule.upsert({
      where: {
        classId_subjectId_day_startTime: {
          classId: s.classId,
          subjectId: s.subjectId,
          day: s.day,
          startTime: s.startTime,
        },
      },
      update: {},
      create: s,
    });
  }

  // ===== Siswa =====
  const studentsSeed = [
    { nis: '121212', fullName: 'ANWAR', gender: 'MALE' as const, className: 'X-TKJ-1', parentPhone: '081234567890' },
    { nis: '121213', fullName: 'ANNAYA YUSMA KHAIRIN', gender: 'FEMALE' as const, className: 'X-TKJ-1', parentPhone: '081234567891' },
    { nis: '121214', fullName: 'FAHRISNA HILMI', gender: 'MALE' as const, className: 'X-TKJ-1', parentPhone: '081234567890' },
    { nis: '121215', fullName: 'BUNGA CITRA LESTARI', gender: 'FEMALE' as const, className: 'X-TKR-1', parentPhone: '081234567892' },
    { nis: '121216', fullName: 'DIAN PRASTYO', gender: 'MALE' as const, className: 'X-TKR-1', parentPhone: '081234567892' },
  ];

  const parents = new Map<string, string>(); // phone -> parentId
  const students: { id: string; nis: string; fullName: string; className: string }[] = [];

  for (const s of studentsSeed) {
    const username = `siswa_${s.nis}`;
    const user = await createUser({
      key: `siswa-${s.nis}`,
      username,
      password: 'smkn1kras',
      fullName: s.fullName,
      role: 'STUDENT',
    });
    const classId = s.className === 'X-TKJ-1' ? classXA.id : classXB.id;
    const student = await prisma.student.upsert({
      where: { nis: s.nis },
      update: { classId, majorId: s.className === 'X-TKJ-1' ? majors['TKJ'] : majors['TKR'] },
      create: {
        userId: user.id,
        nis: s.nis,
        gender: s.gender,
        birthDate: new Date('2009-01-15'),
        address: 'Kras, Kediri',
        classId,
        majorId: s.className === 'X-TKJ-1' ? majors['TKJ'] : majors['TKR'],
        academicYearId: ay.id,
        cardUidHash: sha256(`CARD-${s.nis}`),
      },
    });
    await prisma.qrCredential.upsert({
      where: { userId: user.id },
      update: {},
      create: { userId: user.id, nonce: randomNonce() },
    });
    students.push({ id: student.id, nis: s.nis, fullName: s.fullName, className: s.className });

    if (!parents.has(s.parentPhone)) {
      const parentUser = await prisma.user.findUnique({ where: { username: `ortu_${s.parentPhone}` } });
      if (!parentUser) {
        const pu = await prisma.user.create({
          data: {
            username: `ortu_${s.parentPhone}`,
            passwordHash: await hashPassword('ortu123'),
            fullName: s.parentPhone === '081234567890' ? 'Ibu Fatimah' : 'Bapak Joko',
            phone: s.parentPhone,
            roleId: roles.get('PARENT')!,
          },
        });
        const parent = await prisma.parent.create({
          data: { userId: pu.id, phone: s.parentPhone, name: pu.fullName },
        });
        parents.set(s.parentPhone, parent.id);
      } else {
        const p = await prisma.parent.findUnique({ where: { userId: parentUser.id } });
        if (p) parents.set(s.parentPhone, p.id);
      }
    }
    await prisma.studentParent.upsert({
      where: { studentId_parentId: { studentId: student.id, parentId: parents.get(s.parentPhone)! } },
      update: {},
      create: { studentId: student.id, parentId: parents.get(s.parentPhone)!, relation: 'Orang Tua' },
    });
  }

  // Bersihkan data demo lama dari seed versi sebelumnya (hanya nama demo yang diketahui & aman dihapus)
  await prisma.class.deleteMany({
    where: { name: { in: ['X-A', 'X-B', 'X-Test'] }, students: { none: {} } },
  });
  for (const m of ['IPA', 'IPS', 'RPL']) {
    const legacy = await prisma.major.findUnique({
      where: { name: m },
      include: { _count: { select: { students: true, classes: true } } },
    });
    if (legacy && legacy._count.students === 0 && legacy._count.classes === 0) {
      await prisma.major.delete({ where: { id: legacy.id } });
    }
  }

  // ===== Absensi hari ini (contoh) =====
  const today = dateKey();
  const todayStart = startOfLocalDay(today);
  const demoCheckIns: { nis: string; time: string; status: 'PRESENT' | 'LATE'; method: 'FACE' | 'QR' }[] = [
    { nis: '121212', time: '06:58', status: 'PRESENT', method: 'FACE' },
    { nis: '121213', time: '07:02', status: 'PRESENT', method: 'QR' },
    { nis: '121214', time: '07:21', status: 'LATE', method: 'FACE' },
    { nis: '121216', time: '06:45', status: 'PRESENT', method: 'QR' },
  ];
  for (const d of demoCheckIns) {
    const student = students.find((s) => s.nis === d.nis);
    if (!student) continue;
    const user = await prisma.user.findUnique({ where: { username: `siswa_${d.nis}` } });
    if (!user) continue;
    const exists = await prisma.attendance.findUnique({
      where: { userId_date_type: { userId: user.id, date: todayStart, type: 'CHECK_IN' } },
    });
    if (exists) continue;
    const checkIn = localTimeToUtc(today, d.time);
    const lateMinutes = d.status === 'LATE' ? 21 : 0;
    await prisma.attendance.create({
      data: {
        userId: user.id,
        studentId: student.id,
        date: todayStart,
        type: 'CHECK_IN',
        checkIn,
        status: d.status,
        method: d.method,
        faceVerified: d.method === 'FACE',
        qrVerified: d.method === 'QR',
        lateMinutes,
      },
    });
  }

  // ===== Contoh izin =====
  const anwarya = await prisma.user.findUnique({ where: { username: 'siswa_121213' } });
  if (anwarya) {
    const pending = await prisma.leaveRequest.findFirst({ where: { userId: anwarya.id, status: 'PENDING' } });
    if (!pending) {
      await prisma.leaveRequest.create({
        data: {
          userId: anwarya.id,
          studentId: students.find((s) => s.nis === '121213')?.id,
          type: 'SICK',
          startDate: startOfLocalDay(dateKey(new Date(Date.now() + 86400000))),
          endDate: startOfLocalDay(dateKey(new Date(Date.now() + 86400000))),
          reason: 'Demam, tidak dapat hadir ke sekolah.',
        },
      });
    }
  }

  console.log('');
  console.log('✅ Seed selesai.');
  console.log('');
  console.log('Akun login (development saja!):');
  console.log('   Super Admin : superadmin / admin123');
  console.log('   Admin       : admin / admin123');
  console.log('   Kepala Sek  : kepsek / kepsek123');
  console.log('   Wali Kelas  : wali / guru123');
  console.log('   Guru        : guru / guru123');
  console.log('   Staff       : staff / staff123');
  console.log('   Siswa       : login NISN + password (mis. NISN 121212 / smkn1kras)');
  console.log('   Orang Tua   : login via WhatsApp 081234567890 + OTP (lihat log server)');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
