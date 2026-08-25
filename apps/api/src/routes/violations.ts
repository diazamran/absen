import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { validate } from '../utils/validate.js';
import { ApiError } from '../utils/errors.js';
import { audit } from '../lib/audit.js';
import { PERMISSION_KEYS } from '../rbac/permissions.js';
import { emitViolation } from '../realtime/emitter.js';

const violationTypeSchema = z.object({
  name: z.string().min(1, 'Nama jenis pelanggaran wajib diisi'),
  description: z.string().optional(),
  points: z.number().int().min(1, 'Bobot poin minimal 1').default(1),
});

const studentViolationSchema = z.object({
  studentId: z.string().min(1, 'Siswa wajib dipilih'),
  violationTypeId: z.string().min(1, 'Jenis pelanggaran wajib dipilih'),
  date: z.string().optional(), // ISO date string
  notes: z.string().optional(),
});

const bulkViolationSchema = z.object({
  studentIds: z.array(z.string()).min(1, 'Minimal 1 siswa dipilih'),
  violationTypeId: z.string().min(1, 'Jenis pelanggaran wajib dipilih'),
  date: z.string().optional(),
  notes: z.string().optional(),
});

export async function violationRoutes(app: FastifyInstance) {
  // ================== JENIS PELANGGARAN ==================

  // List all violation types
  app.get('/violations/types', { preHandler: app.requirePermission(PERMISSION_KEYS.violationsRead) }, async (request, reply) => {
    const { search } = request.query as { search?: string };
    const where: Record<string, unknown> = {};
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    const types = await prisma.violationType.findMany({
      where,
      orderBy: { name: 'asc' },
    });

    return reply.send({ success: true, data: types });
  });

  // Create violation type
  app.post('/violations/types', { preHandler: app.requirePermission(PERMISSION_KEYS.violationsManage) }, async (request, reply) => {
    const body = validate(violationTypeSchema, request.body);
    const existing = await prisma.violationType.findUnique({ where: { name: body.name } });
    if (existing) throw ApiError.badRequest('DUPLICATE', 'Nama jenis pelanggaran sudah ada');

    const type = await prisma.violationType.create({ data: body });
    audit({ userId: request.user!.id, action: 'violation-type.create', entity: 'ViolationType', entityId: type.id, newValue: type });
    return reply.status(201).send({ success: true, data: type });
  });

  // Update violation type
  app.put('/violations/types/:id', { preHandler: app.requirePermission(PERMISSION_KEYS.violationsManage) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = validate(violationTypeSchema.partial(), request.body);
    const existing = await prisma.violationType.findUnique({ where: { id } });
    if (!existing) throw ApiError.notFound('Jenis pelanggaran tidak ditemukan');

    if (body.name && body.name !== existing.name) {
      const dup = await prisma.violationType.findUnique({ where: { name: body.name } });
      if (dup) throw ApiError.badRequest('DUPLICATE', 'Nama jenis pelanggaran sudah ada');
    }

    const type = await prisma.violationType.update({ where: { id }, data: body });
    audit({ userId: request.user!.id, action: 'violation-type.update', entity: 'ViolationType', entityId: id, oldValue: existing, newValue: type });
    return reply.send({ success: true, data: type });
  });

  // Delete violation type
  app.delete('/violations/types/:id', { preHandler: app.requirePermission(PERMISSION_KEYS.violationsManage) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = await prisma.violationType.findUnique({ where: { id }, include: { _count: { select: { violations: true } } } });
    if (!existing) throw ApiError.notFound('Jenis pelanggaran tidak ditemukan');
    if (existing._count.violations > 0) {
      throw ApiError.badRequest('IN_USE', `Jenis pelanggaran "${existing.name}" masih digunakan oleh ${existing._count.violations} data pelanggaran. Nonaktifkan saja.`);
    }

    await prisma.violationType.delete({ where: { id } });
    audit({ userId: request.user!.id, action: 'violation-type.delete', entity: 'ViolationType', entityId: id, oldValue: existing });
    return reply.send({ success: true });
  });

  // ================== PELANGGARAN SISWA ==================

  // List student violations
  app.get('/violations', { preHandler: app.requirePermission(PERMISSION_KEYS.violationsRead) }, async (request, reply) => {
    const { search, classId, studentId, page, pageSize, startDate, endDate } = request.query as {
      search?: string;
      classId?: string;
      studentId?: string;
      page?: string;
      pageSize?: string;
      startDate?: string;
      endDate?: string;
    };
    const pg = Math.max(1, Number(page) || 1);
    const ps = Math.min(200, Math.max(1, Number(pageSize) || 50));

    const where: Record<string, unknown> = {};
    if (classId) where.student = { classId };
    if (studentId) where.studentId = studentId;
    if (startDate || endDate) {
      where.date = {};
      if (startDate) (where.date as Record<string, unknown>).gte = new Date(startDate);
      if (endDate) (where.date as Record<string, unknown>).lte = new Date(endDate + 'T23:59:59.999Z');
    }
    if (search) {
      where.OR = [
        { student: { user: { fullName: { contains: search, mode: 'insensitive' } } } },
        { student: { nis: { contains: search } } },
        { violationType: { name: { contains: search, mode: 'insensitive' } } },
        { notes: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await Promise.all([
      prisma.studentViolation.findMany({
        where,
        include: {
          student: { include: { user: true, class: true, major: true } },
          violationType: true,
          recordedBy: { select: { id: true, fullName: true } },
        },
        orderBy: { date: 'desc' },
        skip: (pg - 1) * ps,
        take: ps,
      }),
      prisma.studentViolation.count({ where }),
    ]);

    return reply.send({ success: true, data: items, total, page: pg, pageSize: ps });
  });

  // Add student violation
  app.post('/violations', { preHandler: app.requirePermission(PERMISSION_KEYS.violationsCreate) }, async (request, reply) => {
    const body = validate(studentViolationSchema, request.body);
    const user = request.user!;

    // Verify student exists
    const student = await prisma.student.findUnique({ where: { id: body.studentId }, include: { user: true } });
    if (!student) throw ApiError.notFound('Siswa tidak ditemukan');

    // Verify violation type exists
    const vType = await prisma.violationType.findUnique({ where: { id: body.violationTypeId } });
    if (!vType) throw ApiError.notFound('Jenis pelanggaran tidak ditemukan');
    if (!vType.isActive) throw ApiError.badRequest('INACTIVE', 'Jenis pelanggaran sudah nonaktif');

    const violation = await prisma.studentViolation.create({
      data: {
        studentId: body.studentId,
        violationTypeId: body.violationTypeId,
        date: body.date ? new Date(body.date) : new Date(),
        notes: body.notes,
        recordedById: user.id,
      },
      include: {
        student: { include: { user: true, class: true } },
        violationType: true,
        recordedBy: { select: { id: true, fullName: true } },
      },
    });

    audit({ userId: request.user!.id, action: 'violation.create', entity: 'StudentViolation', entityId: violation.id, newValue: violation });
    emitViolation({
      studentName: student.user?.fullName ?? student.nis,
      className: student.class?.name ?? '-',
      violationType: vType.name,
      points: vType.points,
      recordedBy: user.fullName ?? user.username,
      date: body.date ?? new Date().toISOString().slice(0, 10),
    });
    return reply.status(201).send({ success: true, data: violation });
  });

  // Bulk add violations
  app.post('/violations/bulk', { preHandler: app.requirePermission(PERMISSION_KEYS.violationsCreate) }, async (request, reply) => {
    const body = validate(bulkViolationSchema, request.body);
    const user = request.user!;

    const vType = await prisma.violationType.findUnique({ where: { id: body.violationTypeId } });
    if (!vType) throw ApiError.notFound('Jenis pelanggaran tidak ditemukan');

    const date = body.date ? new Date(body.date) : new Date();
    const results: string[] = [];

    for (const studentId of body.studentIds) {
      const student = await prisma.student.findUnique({ where: { id: studentId } });
      if (!student) continue;

      const v = await prisma.studentViolation.create({
        data: {
          studentId,
          violationTypeId: body.violationTypeId,
          date,
          notes: body.notes,
          recordedById: user.id,
        },
      });
      results.push(v.id);
    }

    audit({ userId: request.user!.id, action: 'violation.bulk-create', entity: 'StudentViolation', newValue: { count: results.length, violationTypeId: body.violationTypeId } });
    emitViolation({
      type: 'bulk',
      count: results.length,
      violationType: vType.name,
      points: vType.points,
      recordedBy: user.fullName ?? user.username,
    });
    return reply.status(201).send({ success: true, data: { count: results.length } });
  });

  // Delete student violation
  app.delete('/violations/:id', { preHandler: app.requirePermission(PERMISSION_KEYS.violationsManage) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = await prisma.studentViolation.findUnique({ where: { id } });
    if (!existing) throw ApiError.notFound('Data pelanggaran tidak ditemukan');

    await prisma.studentViolation.delete({ where: { id } });
    await audit({ userId: request.user!.id, action: 'violation.delete', entity: 'StudentViolation', entityId: id, oldValue: existing });
    return reply.send({ success: true });
  });

  // ================== REKAP POIN PER SISWA ==================

  // Get violation summary for a student
  app.get('/violations/summary/:studentId', { preHandler: app.requirePermission(PERMISSION_KEYS.violationsRead) }, async (request, reply) => {
    const { studentId } = request.params as { studentId: string };

    const student = await prisma.student.findUnique({
      where: { id: studentId },
      include: { user: true, class: true },
    });
    if (!student) throw ApiError.notFound('Siswa tidak ditemukan');

    const violations = await prisma.studentViolation.findMany({
      where: { studentId },
      include: { violationType: true },
      orderBy: { date: 'desc' },
    });

    const totalPoints = violations.reduce((sum, v) => sum + v.violationType.points, 0);

    // Group by violation type
    const byType = violations.reduce((acc, v) => {
      const key = v.violationType.name;
      if (!acc[key]) acc[key] = { name: key, points: 0, count: 0 };
      acc[key].points += v.violationType.points;
      acc[key].count += 1;
      return acc;
    }, {} as Record<string, { name: string; points: number; count: number }>);

    return reply.send({
      success: true,
      data: {
        student: { id: student.id, name: student.user?.fullName ?? student.nis, nis: student.nis, class: student.class?.name },
        totalPoints,
        totalViolations: violations.length,
        byType: Object.values(byType),
        violations,
      },
    });
  });

  // Get top violators (per class or school-wide)
  app.get('/violations/top', { preHandler: app.requirePermission(PERMISSION_KEYS.violationsRead) }, async (request, reply) => {
    const { classId, startDate, endDate, limit } = request.query as {
      classId?: string;
      startDate?: string;
      endDate?: string;
      limit?: string;
    };
    const topLimit = Math.min(100, Math.max(1, Number(limit) || 20));

    const where: Record<string, unknown> = {};
    if (classId) where.student = { classId };
    if (startDate || endDate) {
      where.date = {};
      if (startDate) (where.date as Record<string, unknown>).gte = new Date(startDate);
      if (endDate) (where.date as Record<string, unknown>).lte = new Date(endDate + 'T23:59:59.999Z');
    }

    // Get all violations grouped by student
    const violations = await prisma.studentViolation.findMany({
      where,
      include: {
        student: { include: { user: true, class: true, major: true } },
        violationType: true,
      },
    });

    // Aggregate points per student
    const studentMap = new Map<string, { studentId: string; name: string; nis: string; className: string; majorName: string; totalPoints: number; totalViolations: number }>();
    for (const v of violations) {
      const sid = v.studentId;
      if (!studentMap.has(sid)) {
        studentMap.set(sid, {
          studentId: sid,
          name: v.student?.user?.fullName ?? v.student?.nis ?? '-',
          nis: v.student?.nis ?? '-',
          className: v.student?.class?.name ?? '-',
          majorName: v.student?.major?.name ?? '-',
          totalPoints: 0,
          totalViolations: 0,
        });
      }
      const entry = studentMap.get(sid)!;
      entry.totalPoints += v.violationType.points;
      entry.totalViolations += 1;
    }

    const topStudents = Array.from(studentMap.values())
      .sort((a, b) => b.totalPoints - a.totalPoints)
      .slice(0, topLimit);

    return reply.send({ success: true, data: topStudents });
  });
}
