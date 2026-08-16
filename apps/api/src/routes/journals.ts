import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { validate } from '../utils/validate.js';
import { ApiError } from '../utils/errors.js';
import { audit } from '../lib/audit.js';
import { PERMISSION_KEYS } from '../rbac/permissions.js';
import { startOfLocalDay, dateKey } from '../lib/time.js';

const journalSchema = z.object({
  scheduleId: z.string().optional(),
  classId: z.string().min(1),
  subjectId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  period: z.string().optional(),
  material: z.string().min(1, 'Materi wajib diisi.'),
  notes: z.string().optional(),
});

export async function journalRoutes(app: FastifyInstance) {
  app.post('/journals', { preHandler: app.requirePermission(PERMISSION_KEYS.journalCreate) }, async (request, reply) => {
    const body = validate(journalSchema, request.body);
    const teacher = await prisma.teacher.findUnique({ where: { userId: request.user!.id } });
    if (!teacher) throw ApiError.forbidden('Hanya guru yang dapat mengisi jurnal.');

    const dayStart = startOfLocalDay(body.date || dateKey());
    const existing = await prisma.teachingJournal.findUnique({
      where: { teacherId_classId_date: { teacherId: teacher.id, classId: body.classId, date: dayStart } },
    });

    const journal = existing
      ? await prisma.teachingJournal.update({
          where: { id: existing.id },
          data: {
            subjectId: body.subjectId,
            scheduleId: body.scheduleId,
            period: body.period,
            material: body.material,
            notes: body.notes,
          },
        })
      : await prisma.teachingJournal.create({
          data: {
            teacherId: teacher.id,
            classId: body.classId,
            subjectId: body.subjectId,
            scheduleId: body.scheduleId,
            date: dayStart,
            period: body.period,
            material: body.material,
            notes: body.notes,
          },
        });

    await audit({ userId: request.user!.id, action: 'JOURNAL_CREATED', entity: 'TeachingJournal', entityId: journal.id, request });
    return reply.send({ success: true, message: 'Jurnal tersimpan.', data: journal });
  });

  app.get('/journals', { preHandler: app.requirePermission(PERMISSION_KEYS.journalRead) }, async (request, reply) => {
    const q = request.query as { classId?: string; month?: string };
    const teacher = await prisma.teacher.findUnique({ where: { userId: request.user!.id } });
    const rows = await prisma.teachingJournal.findMany({
      where: {
        ...(teacher ? { teacherId: teacher.id } : {}),
        ...(q.classId ? { classId: q.classId } : {}),
        ...(q.month ? { date: { gte: new Date(`${q.month}-01T00:00:00+07:00`) } } : {}),
      },
      include: {
        class: true,
        subject: true,
        teacher: { include: { user: { select: { fullName: true } } } },
      },
      orderBy: { date: 'desc' },
      take: 50,
    });
    return reply.send({
      success: true,
      data: rows.map((j) => ({
        id: j.id,
        className: j.class.name,
        subjectName: j.subject.name,
        teacherName: j.teacher?.user?.fullName ?? '-',
        date: j.date,
        period: j.period,
        material: j.material,
        notes: j.notes,
      })),
    });
  });
}
