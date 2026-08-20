import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { hashPassword, sha256, randomNonce } from '../lib/crypto.js';
import { validate } from '../utils/validate.js';
import { ApiError } from '../utils/errors.js';
import { audit } from '../lib/audit.js';
import { PERMISSION_KEYS } from '../rbac/permissions.js';
import { config } from '../config.js';

const studentCreateSchema = z.object({
  nis: z.string().min(1, 'NIS wajib diisi.'),
  fullName: z.string().min(1, 'Nama wajib diisi.'),
  gender: z.enum(['MALE', 'FEMALE']).default('MALE'),
  birthDate: z.string().optional(),
  address: z.string().optional(),
  classId: z.string().optional(),
  majorId: z.string().optional(),
  academicYearId: z.string().optional(),
  password: z.string().min(6).optional(),
  parentName: z.string().optional(),
  parentPhone: z.string().optional(),
  cardUid: z.string().optional(),
});

const studentUpdateSchema = z.object({
  nis: z.string().min(1).optional(),
  fullName: z.string().min(1).optional(),
  gender: z.enum(['MALE', 'FEMALE']).optional(),
  birthDate: z.string().optional(),
  address: z.string().optional(),
  classId: z.string().optional(),
  majorId: z.string().optional(),
  academicYearId: z.string().optional(),
  isActive: z.boolean().optional(),
  parentName: z.string().optional(),
  parentPhone: z.string().optional(),
  cardUid: z.string().optional(),
  password: z.string().min(6).optional(),
});

export async function studentRoutes(app: FastifyInstance) {
  app.get('/students', { preHandler: app.requirePermission(PERMISSION_KEYS.studentsRead) }, async (request, reply) => {
    const q = request.query as { search?: string; classId?: string; majorId?: string; page?: string; pageSize?: string; faceOnly?: string; cardOnly?: string };
    const page = Math.max(1, Number(q.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(q.pageSize) || 20));
    const where = {
      isActive: q.cardOnly === 'true' ? true : undefined,
      ...(q.classId ? { classId: q.classId } : {}),
      ...(q.majorId ? { majorId: q.majorId } : {}),
      ...(q.search
        ? {
            OR: [
              { nis: { contains: q.search, mode: 'insensitive' as const } },
              { user: { fullName: { contains: q.search, mode: 'insensitive' as const } } },
            ],
          }
        : {}),
    };
    const [total, rows] = await Promise.all([
      prisma.student.count({ where }),
      prisma.student.findMany({
        where,
        include: {
          user: { select: { id: true, fullName: true, isActive: true } },
          class: { select: { name: true } },
          major: { select: { name: true } },
          parentLinks: { include: { parent: { select: { id: true, name: true, phone: true } } } },
        },
        orderBy: { nis: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return reply.send({
      success: true,
      data: rows.map((s) => ({
        id: s.id,
        userId: s.userId,
        nis: s.nis,
        fullName: s.user?.fullName ?? '-',
        gender: s.gender,
        birthDate: s.birthDate,
        classId: s.classId,
        className: s.class?.name ?? null,
        majorName: s.major?.name ?? null,
        faceRegistered: s.faceRegistered,
        hasCard: !!s.cardUidHash,
        isActive: s.user?.isActive ?? false,
        parents: s.parentLinks.map((l) => ({ id: l.parent.id, name: l.parent.name, phone: l.parent.phone, relation: l.relation })),
      })),
      meta: { total, page, pageSize, pages: Math.ceil(total / pageSize) },
    });
  });

  // Semua ID siswa aktif (untuk checkbox 'pilih semua' di frontend)
  app.get('/students/all-ids', { preHandler: app.requirePermission(PERMISSION_KEYS.studentsRead) }, async (request, reply) => {
    const q = request.query as { search?: string; classId?: string };
    const where = {
      isActive: true,
      ...(q.classId ? { classId: q.classId } : {}),
      ...(q.search
        ? {
            OR: [
              { nis: { contains: q.search, mode: 'insensitive' as const } },
              { user: { fullName: { contains: q.search, mode: 'insensitive' as const } } },
            ],
          }
        : {}),
    };
    const rows = await prisma.student.findMany({ where, select: { id: true }, orderBy: { nis: 'asc' } });
    return reply.send({ success: true, data: rows.map((r) => r.id) });
  });

  app.get('/students/:id', { preHandler: app.requirePermission(PERMISSION_KEYS.studentsRead) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const student = await prisma.student.findUnique({
      where: { id },
      include: {
        user: true,
        class: true,
        major: true,
        academicYear: true,
        parentLinks: { include: { parent: true } },
      },
    });
    if (!student) throw ApiError.notFound('Siswa tidak ditemukan.');
    return reply.send({ success: true, data: student });
  });

  app.post('/students', { preHandler: app.requirePermission(PERMISSION_KEYS.studentsCreate) }, async (request, reply) => {
    const body = validate(studentCreateSchema, request.body);
    const existing = await prisma.student.findUnique({ where: { nis: body.nis } });
    if (existing) throw ApiError.conflict('NIS_EXISTS', `NIS ${body.nis} sudah terdaftar.`);

    const username = `siswa_${body.nis}`;
    if (await prisma.user.findUnique({ where: { username } })) {
      throw ApiError.conflict('USERNAME_EXISTS', 'Username sudah digunakan.');
    }

    const password = body.password || config.defaultStudentPassword;
    const user = await prisma.user.create({
      data: {
        username,
        passwordHash: await hashPassword(password),
        fullName: body.fullName,
        roleId: (await prisma.role.findUnique({ where: { key: 'STUDENT' } }))!.id,
      },
    });

    const student = await prisma.student.create({
      data: {
        userId: user.id,
        nis: body.nis,
        gender: body.gender,
        birthDate: body.birthDate ? new Date(body.birthDate) : null,
        address: body.address,
        classId: body.classId,
        majorId: body.majorId,
        academicYearId: body.academicYearId,
        cardUidHash: body.cardUid ? sha256(body.cardUid.replace(/\s+/g, '').toUpperCase()) : null,
        createdById: request.user!.id,
      },
    });

    await prisma.qrCredential.create({ data: { userId: user.id, nonce: randomNonce() } });

    // Orang tua opsional
    if (body.parentName && body.parentPhone) {
      const phone = body.parentPhone.replace(/[^0-9]/g, '');
      let parent = await prisma.parent.findUnique({ where: { phone } });
      if (!parent) {
        const parentUser = await prisma.user.create({
          data: {
            username: `ortu_${phone}`,
            passwordHash: await hashPassword('ortu123'),
            fullName: body.parentName,
            phone,
            roleId: (await prisma.role.findUnique({ where: { key: 'PARENT' } }))!.id,
          },
        });
        parent = await prisma.parent.create({ data: { userId: parentUser.id, phone, name: body.parentName } });
      }
      await prisma.studentParent.create({ data: { studentId: student.id, parentId: parent.id, relation: 'Orang Tua' } });
    }

    await audit({
      userId: request.user!.id,
      action: 'STUDENT_CREATED',
      entity: 'Student',
      entityId: student.id,
      newValue: { nis: body.nis, fullName: body.fullName, classId: body.classId },
      request,
    });

    return reply.send({ success: true, message: 'Siswa berhasil ditambahkan.', data: { id: student.id } });
  });

  // Reset password siswa (massal atau per siswa) ke password default
  app.post('/students/reset-password', { preHandler: app.requirePermission(PERMISSION_KEYS.studentsUpdate) }, async (request, reply) => {
    const body = validate(z.object({ ids: z.array(z.string()).optional() }), request.body ?? {});
    const students = await prisma.student.findMany({
      where: body.ids && body.ids.length > 0 ? { id: { in: body.ids } } : {},
      select: { id: true, userId: true, nis: true },
    });
    if (students.length === 0) {
      throw ApiError.notFound('Tidak ada siswa yang dipilih.');
    }
    const passwordHash = await hashPassword(config.defaultStudentPassword);
    const updated = await prisma.user.updateMany({
      where: { id: { in: students.map((s) => s.userId) } },
      data: { passwordHash },
    });
    await audit({
      userId: request.user!.id,
      action: 'STUDENT_PASSWORD_RESET',
      entity: 'Student',
      entityId: null,
      newValue: { count: updated.count, defaultPassword: config.defaultStudentPassword },
      request,
    });
    return reply.send({
      success: true,
      message: `${updated.count} password siswa direset ke ${config.defaultStudentPassword}.`,
      data: { count: updated.count },
    });
  });

  app.put('/students/:id', { preHandler: app.requirePermission(PERMISSION_KEYS.studentsUpdate) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = validate(studentUpdateSchema, request.body);
    const existing = await prisma.student.findUnique({ where: { id }, include: { user: true } });
    if (!existing) throw ApiError.notFound('Siswa tidak ditemukan.');

    // Ubah NISN (dan username siswa_xxx mengikuti)
    if (body.nis && body.nis !== existing.nis) {
      const dup = await prisma.student.findUnique({ where: { nis: body.nis } });
      if (dup) throw ApiError.conflict('NIS_EXISTS', `NISN ${body.nis} sudah digunakan.`);
      const username = `siswa_${body.nis}`;
      if (await prisma.user.findUnique({ where: { username } })) {
        throw ApiError.conflict('USERNAME_EXISTS', 'Username untuk NISN baru sudah dipakai.');
      }
      await prisma.student.update({ where: { id }, data: { nis: body.nis } });
      await prisma.user.update({ where: { id: existing.userId }, data: { username } });
    }

    const student = await prisma.student.update({
      where: { id },
      data: {
        gender: body.gender,
        birthDate: body.birthDate ? new Date(body.birthDate) : undefined,
        address: body.address,
        classId: body.classId,
        majorId: body.majorId,
        academicYearId: body.academicYearId,
        updatedById: request.user!.id,
      },
    });

    const userData: Record<string, unknown> = {};
    if (body.fullName) userData.fullName = body.fullName;
    if (body.password) userData.passwordHash = await hashPassword(body.password);
    if (body.isActive !== undefined) userData.isActive = body.isActive;
    if (Object.keys(userData).length) {
      await prisma.user.update({ where: { id: existing.userId }, data: userData });
    }
    if (body.isActive !== undefined) {
      await prisma.student.update({ where: { id }, data: { isActive: body.isActive } });
    }

    // UID kartu
    if (body.cardUid !== undefined) {
      if (body.cardUid) {
        const cardUidHash = sha256(body.cardUid.replace(/\s+/g, '').toUpperCase());
        await prisma.student.update({ where: { id }, data: { cardUidHash } });
        await prisma.cardCredential.upsert({
          where: { userId: existing.userId },
          update: { cardUidHash, isActive: true },
          create: { userId: existing.userId, cardUidHash },
        });
      } else {
        await prisma.student.update({ where: { id }, data: { cardUidHash: null } });
        await prisma.cardCredential.deleteMany({ where: { userId: existing.userId } });
      }
    }

    // Orang tua
    if (body.parentName && body.parentPhone) {
      const phone = body.parentPhone.replace(/[^0-9]/g, '');
      const parentRole = await prisma.role.findUnique({ where: { key: 'PARENT' } });
      let parent = await prisma.parent.findUnique({ where: { phone } });
      if (!parent && parentRole) {
        const pu = await prisma.user.create({
          data: {
            username: `ortu_${phone}`,
            passwordHash: await hashPassword('ortu123'),
            fullName: body.parentName,
            phone,
            roleId: parentRole.id,
          },
        });
        parent = await prisma.parent.create({ data: { userId: pu.id, phone, name: body.parentName } });
      } else if (parent) {
        await prisma.parent.update({ where: { id: parent.id }, data: { name: body.parentName } });
      }
      if (parent) {
        await prisma.studentParent.upsert({
          where: { studentId_parentId: { studentId: id, parentId: parent.id } },
          update: { relation: 'Orang Tua' },
          create: { studentId: id, parentId: parent.id, relation: 'Orang Tua' },
        });
      }
    }

    await audit({
      userId: request.user!.id,
      action: 'STUDENT_UPDATED',
      entity: 'Student',
      entityId: id,
      oldValue: { classId: existing.classId, nis: existing.nis },
      newValue: { classId: body.classId, nis: body.nis, fullName: body.fullName },
      request,
    });

    return reply.send({ success: true, message: 'Data siswa diperbarui.' });
  });

  app.delete('/students/:id', { preHandler: app.requirePermission(PERMISSION_KEYS.studentsDelete) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = await prisma.student.findUnique({
      where: { id },
      include: { user: true, parentLinks: { include: { parent: true } } },
    });
    if (!existing) throw ApiError.notFound('Siswa tidak ditemukan.');
    const parentIds = existing.parentLinks.map((l) => l.parentId);

    // Hapus PERMANEN: bersihkan semua data terkait dalam satu transaksi
    await prisma.$transaction(async (tx) => {
      // riwayat absen & izin
      await tx.attendance.deleteMany({ where: { OR: [{ userId: existing.userId }, { studentId: id }] } });
      await tx.leaveRequest.deleteMany({ where: { userId: existing.userId } });
      // biometrik wajah & kredensial
      await tx.faceEmbedding.deleteMany({ where: { userId: existing.userId } });
      await tx.faceProfile.deleteMany({ where: { userId: existing.userId } });
      await tx.qrCredential.deleteMany({ where: { userId: existing.userId } });
      await tx.cardCredential.deleteMany({ where: { userId: existing.userId } });
      // notifikasi, sesi, token, perangkat
      await tx.notification.deleteMany({ where: { userId: existing.userId } });
      await tx.session.deleteMany({ where: { userId: existing.userId } });
      await tx.refreshToken.deleteMany({ where: { userId: existing.userId } });
      await tx.device.deleteMany({ where: { userId: existing.userId } });
      // data siswa (link orang tua ikut terhapus otomatis via cascade)
      await tx.student.delete({ where: { id } });
      await tx.user.delete({ where: { id: existing.userId } });
      // hapus akun orang tua yang tidak punya anak tersisa lagi
      for (const parentId of parentIds) {
        const links = await tx.studentParent.count({ where: { parentId } });
        if (links > 0) continue;
        const parent = await tx.parent.findUnique({ where: { id: parentId } });
        if (!parent) continue;
        await tx.notification.deleteMany({ where: { userId: parent.userId } });
        await tx.session.deleteMany({ where: { userId: parent.userId } });
        await tx.refreshToken.deleteMany({ where: { userId: parent.userId } });
        await tx.device.deleteMany({ where: { userId: parent.userId } });
        await tx.parent.delete({ where: { id: parentId } });
        await tx.user.delete({ where: { id: parent.userId } });
      }
    });

    await audit({
      userId: request.user!.id,
      action: 'STUDENT_DELETED',
      entity: 'Student',
      entityId: id,
      oldValue: { nis: existing.nis },
      request,
    });
    return reply.send({ success: true, message: 'Siswa dihapus permanen.' });
  });
}
