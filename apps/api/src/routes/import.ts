import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { hashPassword, sha256, randomNonce } from '../lib/crypto.js';
import { validate } from '../utils/validate.js';
import { ApiError } from '../utils/errors.js';
import { audit } from '../lib/audit.js';
import { PERMISSION_KEYS } from '../rbac/permissions.js';

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = false;
      } else cur += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); cur = '';
      if (row.some((v) => v.trim() !== '')) rows.push(row);
      row = [];
    } else cur += c;
  }
  row.push(cur);
  if (row.some((v) => v.trim() !== '')) rows.push(row);
  return rows;
}

export async function importRoutes(app: FastifyInstance) {
  // Preview: upload CSV → hasil parse + validasi per baris (tanpa menyimpan)
  app.post('/import/students/preview', { preHandler: app.requirePermission(PERMISSION_KEYS.studentsImport) }, async (request, reply) => {
    const data = await request.file();
    if (!data) throw ApiError.badRequest('FILE_REQUIRED', 'Pilih file CSV terlebih dahulu.');
    const text = (await data.toBuffer()).toString('utf8').replace(/^\uFEFF/, '');
    const rows = parseCsv(text);
    if (rows.length < 2) throw ApiError.badRequest('EMPTY_CSV', 'File CSV kosong atau tidak memiliki data.');

    const headers = rows[0].map((h) => h.trim().toLowerCase());
    const required = ['nis', 'nama'];
    for (const r of required) {
      if (!headers.includes(r)) {
        throw ApiError.badRequest('INVALID_HEADERS', `Kolom "${r}" wajib ada di CSV. Kolom yang didukung: NIS, Nama, Kelas, Jurusan, Jenis Kelamin, Tanggal Lahir, No HP, Nama Orang Tua, No WhatsApp Orang Tua, Card UID.`);
      }
    }
    const idx = (name: string) => headers.indexOf(name);

    const existingNis = new Set((await prisma.student.findMany({ select: { nis: true } })).map((s) => s.nis));
    const classes = await prisma.class.findMany({ select: { id: true, name: true } });
    const classMap = new Map(classes.map((c) => [c.name.toLowerCase(), c.id]));
    const majors = await prisma.major.findMany({ select: { id: true, name: true } });
    const majorMap = new Map(majors.map((m) => [m.name.toLowerCase(), m.id]));
    const ay = await prisma.academicYear.findFirst({ where: { isActive: true } });
    const studentRole = await prisma.role.findUnique({ where: { key: 'STUDENT' } });
    const parentRole = await prisma.role.findUnique({ where: { key: 'PARENT' } });
    if (!studentRole || !parentRole || !ay) throw ApiError.badRequest('SETUP_INCOMPLETE', 'Tahun ajaran aktif belum disiapkan.');

    const preview = rows.slice(1).map((r, i) => {
      const get = (name: string) => (idx(name) >= 0 ? (r[idx(name)] || '').trim() : '');
      const nis = get('nis');
      const nama = get('nama');
      const errors: string[] = [];
      if (!nis) errors.push('NIS kosong');
      if (!nama) errors.push('Nama kosong');
      if (existingNis.has(nis)) errors.push(`NIS ${nis} sudah terdaftar`);
      const className = get('kelas');
      if (className && !classMap.has(className.toLowerCase())) errors.push(`Kelas "${className}" tidak ditemukan`);
      return {
        line: i + 2,
        nis,
        nama,
        kelas: className,
        jurusan: get('jurusan'),
        gender: get('jenis kelamin').toUpperCase().startsWith('P') ? 'FEMALE' : get('jenis kelamin').toUpperCase().startsWith('L') ? 'MALE' : 'MALE',
        birthDate: get('tanggal lahir'),
        phone: get('no hp'),
        parentName: get('nama orang tua'),
        parentPhone: get('no whatsapp orang tua'),
        cardUid: get('card uid'),
        errors,
        valid: errors.length === 0,
      };
    });

    return reply.send({
      success: true,
      data: {
        total: preview.length,
        valid: preview.filter((p) => p.valid).length,
        invalid: preview.filter((p) => !p.valid).length,
        rows: preview,
      },
    });
  });

  // Konfirmasi import (hanya baris valid)
  app.post('/import/students/confirm', { preHandler: app.requirePermission(PERMISSION_KEYS.studentsImport) }, async (request, reply) => {
    const body = validate(
      z.object({
        rows: z.array(
          z.object({
            nis: z.string().min(1),
            nama: z.string().min(1),
            kelas: z.string().optional(),
            jurusan: z.string().optional(),
            gender: z.enum(['MALE', 'FEMALE']).default('MALE'),
            birthDate: z.string().optional(),
            phone: z.string().optional(),
            parentName: z.string().optional(),
            parentPhone: z.string().optional(),
            cardUid: z.string().optional(),
          }),
        ),
      }),
      request.body,
    );

    const studentRole = await prisma.role.findUnique({ where: { key: 'STUDENT' } });
    const parentRole = await prisma.role.findUnique({ where: { key: 'PARENT' } });
    if (!studentRole || !parentRole) throw ApiError.badRequest('SETUP_INCOMPLETE', 'Role belum disiapkan.');

    const classes = await prisma.class.findMany({ select: { id: true, name: true } });
    const classMap = new Map(classes.map((c) => [c.name.toLowerCase(), c.id]));
    const majors = await prisma.major.findMany({ select: { id: true, name: true } });
    const majorMap = new Map(majors.map((m) => [m.name.toLowerCase(), m.id]));
    const ay = await prisma.academicYear.findFirst({ where: { isActive: true } });

    let created = 0;
    const errors: { nis: string; error: string }[] = [];

    for (const row of body.rows) {
      try {
        if (await prisma.student.findUnique({ where: { nis: row.nis } })) {
          errors.push({ nis: row.nis, error: 'NIS sudah terdaftar' });
          continue;
        }
        const username = `siswa_${row.nis}`;
        if (await prisma.user.findUnique({ where: { username } })) {
          errors.push({ nis: row.nis, error: 'Username sudah dipakai' });
          continue;
        }
        const user = await prisma.user.create({
          data: {
            username,
            passwordHash: await hashPassword('siswa123'),
            fullName: row.nama,
            phone: row.phone || undefined,
            roleId: studentRole.id,
          },
        });
        const classId = row.kelas ? classMap.get(row.kelas.toLowerCase()) : undefined;
        const majorId = row.jurusan ? majorMap.get(row.jurusan.toLowerCase()) : undefined;
        await prisma.student.create({
          data: {
            userId: user.id,
            nis: row.nis,
            gender: row.gender,
            birthDate: row.birthDate ? new Date(row.birthDate) : null,
            classId,
            majorId,
            academicYearId: ay?.id,
            cardUidHash: row.cardUid ? sha256(row.cardUid.replace(/\s+/g, '').toUpperCase()) : null,
            createdById: request.user!.id,
          },
        });
        await prisma.qrCredential.create({ data: { userId: user.id, nonce: randomNonce() } });

        if (row.parentName && row.parentPhone) {
          const phone = row.parentPhone.replace(/[^0-9]/g, '');
          let parent = await prisma.parent.findUnique({ where: { phone } });
          if (!parent) {
            const pu = await prisma.user.create({
              data: {
                username: `ortu_${phone}`,
                passwordHash: await hashPassword('ortu123'),
                fullName: row.parentName,
                phone,
                roleId: parentRole.id,
              },
            });
            parent = await prisma.parent.create({ data: { userId: pu.id, phone, name: row.parentName } });
          }
          const student = await prisma.student.findUnique({ where: { nis: row.nis } });
          if (student) {
            await prisma.studentParent.upsert({
              where: { studentId_parentId: { studentId: student.id, parentId: parent.id } },
              update: {},
              create: { studentId: student.id, parentId: parent.id, relation: 'Orang Tua' },
            });
          }
        }
        created++;
      } catch (e) {
        errors.push({ nis: row.nis, error: (e as Error).message });
      }
    }

    await audit({
      userId: request.user!.id,
      action: 'STUDENT_IMPORTED',
      entity: 'Student',
      newValue: { created, failed: errors.length },
      request,
    });

    return reply.send({
      success: true,
      message: `${created} siswa berhasil diimpor.`,
      data: { created, errors },
    });
  });

  // ===== Import massal Guru & Staff =====
  const ROLE_BY_LABEL: Record<string, string> = {
    guru: 'TEACHER',
    'wali kelas': 'HOMEROOM_TEACHER',
    wali: 'HOMEROOM_TEACHER',
    staff: 'STAFF',
    'admin': 'ADMIN',
    tu: 'ADMIN',
    'admin tu': 'ADMIN',
    'kepala sekolah': 'HEADMASTER',
    kepsek: 'HEADMASTER',
  };

  app.post('/import/users/preview', { preHandler: app.requirePermission(PERMISSION_KEYS.usersCreate) }, async (request, reply) => {
    const data = await request.file();
    if (!data) throw ApiError.badRequest('FILE_REQUIRED', 'Pilih file CSV terlebih dahulu.');
    const text = (await data.toBuffer()).toString('utf8').replace(/^\uFEFF/, '');
    const rows = parseCsv(text);
    if (rows.length < 2) throw ApiError.badRequest('EMPTY_CSV', 'File CSV kosong atau tidak memiliki data.');

    const headers = rows[0].map((h) => h.trim().toLowerCase());
    for (const r of ['nama', 'username']) {
      if (!headers.includes(r)) {
        throw ApiError.badRequest('INVALID_HEADERS', `Kolom "${r}" wajib ada. Kolom yang didukung: Nama, Username, Role, Password, NIP, Jabatan, Mata Pelajaran, No HP.`);
      }
    }
    const idx = (name: string) => headers.indexOf(name);

    const existingUsers = new Set((await prisma.user.findMany({ select: { username: true } })).map((u) => u.username.toLowerCase()));
    const subjects = await prisma.subject.findMany({ select: { id: true, name: true } });
    const subjectMap = new Map(subjects.map((s) => [s.name.toLowerCase(), s.id]));

    const preview = rows.slice(1).map((r, i) => {
      const get = (name: string) => (idx(name) >= 0 ? (r[idx(name)] || '').trim() : '');
      const nama = get('nama');
      const username = get('username');
      const roleLabel = (get('role') || 'guru').toLowerCase();
      const roleKey = ROLE_BY_LABEL[roleLabel] || '';
      const errors: string[] = [];
      if (!nama) errors.push('Nama kosong');
      if (!username) errors.push('Username kosong');
      else if (existingUsers.has(username.toLowerCase())) errors.push(`Username "${username}" sudah dipakai`);
      if (!roleKey) errors.push(`Role "${get('role')}" tidak dikenal (Guru/Wali Kelas/Staff/Admin/Kepala Sekolah)`);
      const mapel = get('mata pelajaran');
      if (mapel && !subjectMap.has(mapel.toLowerCase())) errors.push(`Mapel "${mapel}" tidak ditemukan`);
      const password = get('password') || 'guru123';
      if (password.length < 6) errors.push('Password minimal 6 karakter');
      return {
        line: i + 2,
        nama,
        username,
        roleKey,
        roleLabel: get('role') || 'Guru',
        password,
        nip: get('nip'),
        position: get('jabatan'),
        subjectName: mapel,
        phone: get('no hp'),
        errors,
        valid: errors.length === 0,
      };
    });

    return reply.send({
      success: true,
      data: {
        total: preview.length,
        valid: preview.filter((p) => p.valid).length,
        invalid: preview.filter((p) => !p.valid).length,
        rows: preview,
      },
    });
  });

  app.post('/import/users/confirm', { preHandler: app.requirePermission(PERMISSION_KEYS.usersCreate) }, async (request, reply) => {
    const body = validate(
      z.object({
        rows: z.array(
          z.object({
            nama: z.string().min(1),
            username: z.string().min(3),
            roleKey: z.enum(['ADMIN', 'HEADMASTER', 'HOMEROOM_TEACHER', 'TEACHER', 'STAFF']),
            password: z.string().min(6),
            nip: z.string().optional(),
            position: z.string().optional(),
            subjectName: z.string().optional(),
            phone: z.string().optional(),
          }),
        ),
      }),
      request.body,
    );

    const subjects = await prisma.subject.findMany({ select: { id: true, name: true } });
    const subjectMap = new Map(subjects.map((s) => [s.name.toLowerCase(), s.id]));

    let created = 0;
    const errors: { username: string; error: string }[] = [];

    for (const row of body.rows) {
      try {
        if (await prisma.user.findUnique({ where: { username: row.username } })) {
          errors.push({ username: row.username, error: 'Username sudah dipakai' });
          continue;
        }
        const role = await prisma.role.findUnique({ where: { key: row.roleKey } });
        if (!role) {
          errors.push({ username: row.username, error: 'Role tidak valid' });
          continue;
        }
        const user = await prisma.user.create({
          data: {
            username: row.username,
            passwordHash: await hashPassword(row.password),
            fullName: row.nama,
            phone: row.phone || undefined,
            roleId: role.id,
          },
        });
        if (row.roleKey === 'TEACHER' || row.roleKey === 'HOMEROOM_TEACHER') {
          await prisma.teacher.create({
            data: {
              userId: user.id,
              nip: row.nip,
              position: row.position,
              subjectId: row.subjectName ? subjectMap.get(row.subjectName.toLowerCase()) : undefined,
            },
          });
        } else if (row.roleKey === 'STAFF') {
          await prisma.staff.create({ data: { userId: user.id, nip: row.nip, position: row.position } });
        }
        created++;
      } catch (e) {
        errors.push({ username: row.username, error: (e as Error).message });
      }
    }

    await audit({
      userId: request.user!.id,
      action: 'USERS_IMPORTED',
      entity: 'User',
      newValue: { created, failed: errors.length },
      request,
    });

    return reply.send({
      success: true,
      message: `${created} akun berhasil diimpor.`,
      data: { created, errors },
    });
  });
}
