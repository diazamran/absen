import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { hashPassword } from '../lib/crypto.js';
import { validate } from '../utils/validate.js';
import { ApiError } from '../utils/errors.js';
import { audit } from '../lib/audit.js';
import { PERMISSION_KEYS, ROLE_LABELS } from '../rbac/permissions.js';

const userCreateSchema = z.object({
  username: z.string().min(3),
  password: z.string().min(6),
  fullName: z.string().min(1),
  roleKey: z.enum(['ADMIN', 'HEADMASTER', 'HOMEROOM_TEACHER', 'TEACHER', 'STAFF', 'PIKET']),
  nip: z.string().optional(),
  position: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  subjectId: z.string().optional(),
  isPiket: z.boolean().optional(),
});

export async function userRoutes(app: FastifyInstance) {
  app.get('/users', { preHandler: app.requirePermission(PERMISSION_KEYS.usersRead) }, async (request, reply) => {
    const q = request.query as { role?: string; search?: string };
    const rows = await prisma.user.findMany({
      where: {
        role: { key: { notIn: ['STUDENT', 'PARENT'] } },
        ...(q.role ? { role: { key: q.role as never } } : {}),
        ...(q.search
          ? {
              OR: [
                { fullName: { contains: q.search, mode: 'insensitive' as const } },
                { username: { contains: q.search, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      },
      include: {
        role: true,
        teacher: { include: { subject: true } },
        staff: true,
      },
      orderBy: { createdAt: 'asc' },
    });
    return reply.send({
      success: true,
      data: rows.map((u) => ({
        id: u.id,
        username: u.username,
        fullName: u.fullName,
        roleKey: u.role.key,
        roleName: ROLE_LABELS[u.role.key] || u.role.name,
        nip: u.teacher?.nip ?? u.staff?.nip ?? null,
        position: u.teacher?.position ?? u.staff?.position ?? null,
        isPiket: u.teacher?.isPiket ?? false,
        subjectId: u.teacher?.subjectId ?? null,
        subjectName: u.teacher?.subject?.name ?? null,
        phone: u.phone,
        email: u.email,
        isActive: u.isActive,
        lastLoginAt: u.lastLoginAt,
      })),
    });
  });

  app.post('/users', { preHandler: app.requirePermission(PERMISSION_KEYS.usersCreate) }, async (request, reply) => {
    const body = validate(userCreateSchema, request.body);
    if (await prisma.user.findUnique({ where: { username: body.username } })) {
      throw ApiError.conflict('USERNAME_EXISTS', 'Username sudah digunakan.');
    }
    const role = await prisma.role.findUnique({ where: { key: body.roleKey } });
    if (!role) throw ApiError.badRequest('INVALID_ROLE', 'Role tidak valid.');

    const user = await prisma.user.create({
      data: {
        username: body.username,
        passwordHash: await hashPassword(body.password),
        fullName: body.fullName,
        phone: body.phone,
        email: body.email,
        roleId: role.id,
      },
    });

    if (body.roleKey === 'TEACHER' || body.roleKey === 'HOMEROOM_TEACHER') {
      await prisma.teacher.create({
        data: { userId: user.id, nip: body.nip, position: body.position, subjectId: body.subjectId, isPiket: body.isPiket },
      });
    } else if (body.roleKey === 'STAFF') {
      await prisma.staff.create({ data: { userId: user.id, nip: body.nip, position: body.position } });
    }
    // PIKET: cukup akun dengan role Petugas Piket (tanpa data guru/staff)

    await audit({
      userId: request.user!.id,
      action: 'USER_CREATED',
      entity: 'User',
      entityId: user.id,
      newValue: { username: body.username, roleKey: body.roleKey, fullName: body.fullName },
      request,
    });

    return reply.send({ success: true, message: 'Akun berhasil dibuat.', data: { id: user.id } });
  });

  app.put('/users/:id', { preHandler: app.requirePermission(PERMISSION_KEYS.usersUpdate) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = validate(
      z.object({
        username: z.string().min(3).optional(),
        fullName: z.string().min(1).optional(),
        phone: z.string().optional(),
        email: z.string().optional(),
        isActive: z.boolean().optional(),
        nip: z.string().optional(),
        position: z.string().optional(),
        subjectId: z.string().optional(),
        isPiket: z.boolean().optional(),
        password: z.string().min(6).optional(),
        roleKey: z.enum(['ADMIN', 'HEADMASTER', 'HOMEROOM_TEACHER', 'TEACHER', 'STAFF', 'PIKET']).optional(),
      }),
      request.body,
    );

    const existing = await prisma.user.findUnique({ where: { id }, include: { teacher: true, staff: true } });
    if (!existing) throw ApiError.notFound('Akun tidak ditemukan.');

    const data: Record<string, unknown> = {};
    if (body.username && body.username !== existing.username) {
      const dup = await prisma.user.findUnique({ where: { username: body.username } });
      if (dup) throw ApiError.conflict('USERNAME_EXISTS', 'Username sudah digunakan.');
      data.username = body.username;
    }
    if (body.fullName) data.fullName = body.fullName;
    if (body.phone !== undefined) data.phone = body.phone;
    if (body.email !== undefined) data.email = body.email;
    if (body.isActive !== undefined) data.isActive = body.isActive;
    if (body.password) data.passwordHash = await hashPassword(body.password);
    if (body.roleKey) {
      const role = await prisma.role.findUnique({ where: { key: body.roleKey } });
      if (role) data.roleId = role.id;
    }

    await prisma.user.update({ where: { id }, data });

    if (existing.teacher && (body.nip !== undefined || body.position !== undefined || body.subjectId !== undefined || body.isPiket !== undefined)) {
      await prisma.teacher.update({
        where: { userId: id },
        data: { nip: body.nip, position: body.position, subjectId: body.subjectId, isPiket: body.isPiket },
      });
    }
    if (existing.staff && (body.nip !== undefined || body.position !== undefined)) {
      await prisma.staff.update({
        where: { userId: id },
        data: { nip: body.nip, position: body.position },
      });
    }

    // PIKET: role khusus petugas piket — lepas relasi guru/staff agar tidak "menyatu" dengan rule guru
    if (body.roleKey === 'PIKET') {
      if (existing.teacher) await prisma.teacher.delete({ where: { userId: id } });
      if (existing.staff) await prisma.staff.delete({ where: { userId: id } });
    }

    await audit({
      userId: request.user!.id,
      action: 'USER_UPDATED',
      entity: 'User',
      entityId: id,
      newValue: data,
      request,
    });

    return reply.send({ success: true, message: 'Akun diperbarui.' });
  });

  app.delete('/users/:id', { preHandler: app.requirePermission(PERMISSION_KEYS.usersDelete) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    await prisma.user.update({ where: { id }, data: { isActive: false } });
    await audit({
      userId: request.user!.id,
      action: 'USER_DEACTIVATED',
      entity: 'User',
      entityId: id,
      request,
    });
    return reply.send({ success: true, message: 'Akun dinonaktifkan.' });
  });
}
