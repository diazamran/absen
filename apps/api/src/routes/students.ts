import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { hashPassword, sha256, randomNonce } from '../lib/crypto.js';
import { validate } from '../utils/validate.js';
import { ApiError } from '../utils/errors.js';
import { audit } from '../lib/audit.js';
import { PERMISSION_KEYS } from '../rbac/permissions.js';

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
  fullName: z.string().min(1).optional(),
  gender: z.enum(['MALE', 'FEMALE']).optional(),
  birthDate: z.string().optional(),
  address: z.string().optional(),
  classId: z.string().optional(),
  majorId: z.string().optional(),
  academicYearId: z.string().optional(),
  isActive: z.boolean().optional(),
});

export async function studentRoutes(app: FastifyInstance) {
  app.get('/students', { preHandler: app.requirePermission(PERMISSION_KEYS.studentsRead) }, async (request, reply) => {
    const q = request.query as { search?: string; classId?: string; majorId?: string; page?: string; pageSize?: string; faceOnly?: string; cardOnly?: string };
    const page = Math.max(1, Number(q.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(q.pageSize) || 20));
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

    const password = body.password || 'siswa123';
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

  app.put('/students/:id', { preHandler: app.requirePermission(PERMISSION_KEYS.studentsUpdate) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = validate(studentUpdateSchema, request.body);
    const existing = await prisma.student.findUnique({ where: { id } });
    if (!existing) throw ApiError.notFound('Siswa tidak ditemukan.');

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
    if (body.fullName) {
      await prisma.user.update({ where: { id: existing.userId }, data: { fullName: body.fullName } });
    }
    if (body.isActive !== undefined) {
      await prisma.user.update({ where: { id: existing.userId }, data: { isActive: body.isActive } });
      await prisma.student.update({ where: { id }, data: { isActive: body.isActive } });
    }

    await audit({
      userId: request.user!.id,
      action: 'STUDENT_UPDATED',
      entity: 'Student',
      entityId: id,
      oldValue: { classId: existing.classId },
      newValue: { classId: body.classId },
      request,
    });

    return reply.send({ success: true, message: 'Data siswa diperbarui.' });
  });

  app.delete('/students/:id', { preHandler: app.requirePermission(PERMISSION_KEYS.studentsDelete) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = await prisma.student.findUnique({ where: { id } });
    if (!existing) throw ApiError.notFound('Siswa tidak ditemukan.');
    // Soft delete: nonaktifkan akun (aman & auditabel)
    await prisma.user.update({ where: { id: existing.userId }, data: { isActive: false } });
    await prisma.student.update({ where: { id }, data: { isActive: false } });
    await audit({
      userId: request.user!.id,
      action: 'STUDENT_DELETED',
      entity: 'Student',
      entityId: id,
      oldValue: { nis: existing.nis },
      request,
    });
    return reply.send({ success: true, message: 'Siswa dinonaktifkan.' });
  });
}
