import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { validate } from '../utils/validate.js';
import { ApiError } from '../utils/errors.js';
import { audit } from '../lib/audit.js';
import { PERMISSION_KEYS } from '../rbac/permissions.js';

const counselingSchema = z.object({
  studentId: z.string().min(1),
  type: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  action: z.string().optional(),
  followUp: z.string().optional(),
});

export async function bkRoutes(app: FastifyInstance) {
  // List all counseling records (BK teachers can see all, others only their own)
  app.get('/bk/counseling', { preHandler: app.requirePermission(PERMISSION_KEYS.reportsRead) }, async (request, reply) => {
    const { search, page, pageSize } = request.query as { search?: string; page?: string; pageSize?: string };
    const pg = Math.max(1, Number(page) || 1);
    const ps = Math.min(200, Math.max(1, Number(pageSize) || 50));

    const where: Record<string, unknown> = {};
    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { student: { user: { fullName: { contains: search, mode: 'insensitive' } } } },
        { student: { nis: { contains: search } } },
      ];
    }

    const [data, total] = await Promise.all([
      prisma.counseling.findMany({
        where,
        include: {
          student: { include: { user: true, class: true } },
          creator: true,
        },
        orderBy: { createdAt: 'desc' },
        skip: (pg - 1) * ps,
        take: ps,
      }),
      prisma.counseling.count({ where }),
    ]);

    return reply.send({
      success: true,
      data: data.map((c) => ({
        id: c.id,
        studentId: c.studentId,
        studentName: c.student.user?.fullName ?? '-',
        nis: c.student.nis,
        className: c.student.class?.name ?? null,
        type: c.type,
        title: c.title,
        description: c.description,
        action: c.action,
        followUp: c.followUp,
        createdBy: c.creator.fullName,
        createdAt: c.createdAt.toISOString(),
      })),
      total,
      page: pg,
      pageSize: ps,
    });
  });

  // Create counseling record
  app.post('/bk/counseling', { preHandler: app.requirePermission(PERMISSION_KEYS.journalCreate) }, async (request, reply) => {
    const body = validate(counselingSchema, request.body);

    const student = await prisma.student.findUnique({ where: { id: body.studentId } });
    if (!student) throw ApiError.notFound('Siswa tidak ditemukan.');

    const counseling = await prisma.counseling.create({
      data: {
        studentId: body.studentId,
        type: body.type,
        title: body.title,
        description: body.description || null,
        action: body.action || null,
        followUp: body.followUp || null,
        createdById: request.user!.id,
      },
    });

    await audit({ userId: request.user!.id, action: 'COUNSELING_CREATE', entity: 'Counseling', entityId: counseling.id, request });

    return reply.send({ success: true, data: { id: counseling.id } });
  });

  // Update counseling record
  app.put('/bk/counseling/:id', { preHandler: app.requirePermission(PERMISSION_KEYS.journalCreate) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = validate(counselingSchema, request.body);

    const existing = await prisma.counseling.findUnique({ where: { id } });
    if (!existing) throw ApiError.notFound('Catatan konseling tidak ditemukan.');

    await prisma.counseling.update({
      where: { id },
      data: {
        studentId: body.studentId,
        type: body.type,
        title: body.title,
        description: body.description || null,
        action: body.action || null,
        followUp: body.followUp || null,
      },
    });

    await audit({ userId: request.user!.id, action: 'COUNSELING_UPDATE', entity: 'Counseling', entityId: id, request });

    return reply.send({ success: true, message: 'Berhasil diupdate.' });
  });

  // Delete counseling record (SUPER_ADMIN only)
  app.delete('/bk/counseling/:id', { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!(request.user!.roles || []).includes('SUPER_ADMIN')) {
      throw ApiError.forbidden('FORBIDDEN', 'Hanya Super Admin yang bisa menghapus catatan konseling.');
    }

    const existing = await prisma.counseling.findUnique({ where: { id } });
    if (!existing) throw ApiError.notFound('Catatan konseling tidak ditemukan.');

    await prisma.counseling.delete({ where: { id } });
    await audit({ userId: request.user!.id, action: 'COUNSELING_DELETE', entity: 'Counseling', entityId: id, request });

    return reply.send({ success: true, message: 'Berhasil dihapus.' });
  });
}
