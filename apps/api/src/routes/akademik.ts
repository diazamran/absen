import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { validate } from '../utils/validate.js';
import { ApiError } from '../utils/errors.js';
import { audit } from '../lib/audit.js';
import { PERMISSION_KEYS } from '../rbac/permissions.js';

export async function akademikRoutes(app: FastifyInstance) {
  // ===== Kelas =====
  app.get('/classes', { preHandler: app.requirePermission(PERMISSION_KEYS.scheduleRead) }, async (request, reply) => {
    // Wali kelas hanya melihat kelas yang diwalikannya
    const user = await prisma.user.findUnique({ where: { id: request.user!.id }, include: { role: true, teacher: true } });
    const isHomeroom = user?.role.key === 'HOMEROOM_TEACHER' && !!user.teacher;
    const rows = await prisma.class.findMany({
      where: {
        isActive: true,
        ...(isHomeroom ? { homeroomTeacherId: user.teacher!.id } : {}),
      },
      include: {
        major: true,
        academicYear: true,
        homeroomTeacher: { include: { user: { select: { fullName: true } } } },
        _count: { select: { students: { where: { isActive: true } } } },
      },
      orderBy: [{ grade: 'asc' }, { name: 'asc' }],
    });
    return reply.send({
      success: true,
      data: rows.map((c) => ({
        id: c.id,
        name: c.name,
        grade: c.grade,
        majorName: c.major?.name ?? null,
        academicYear: c.academicYear?.name ?? null,
        homeroomTeacher: c.homeroomTeacher?.user?.fullName ?? null,
        homeroomTeacherId: c.homeroomTeacherId ?? null,
        room: c.room,
        studentCount: c._count.students,
      })),
    });
  });

  app.post('/classes', { preHandler: app.requirePermission(PERMISSION_KEYS.classesManage) }, async (request, reply) => {
    const body = validate(
      z.object({
        name: z.string().min(1),
        grade: z.string().min(1),
        majorId: z.string().optional(),
        academicYearId: z.string().optional(),
        homeroomTeacherId: z.string().optional(),
        room: z.string().optional(),
      }),
      request.body,
    );
    const ay = body.academicYearId
      ? await prisma.academicYear.findUnique({ where: { id: body.academicYearId } })
      : await prisma.academicYear.findFirst({ where: { isActive: true } });
    const klass = await prisma.class.create({
      data: { ...body, academicYearId: ay?.id },
    });
    await audit({ userId: request.user!.id, action: 'CLASS_CREATED', entity: 'Class', entityId: klass.id, newValue: body, request });
    return reply.send({ success: true, data: klass });
  });

  app.put('/classes/:id', { preHandler: app.requirePermission(PERMISSION_KEYS.classesManage) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = validate(
      z.object({
        name: z.string().min(1).optional(),
        grade: z.string().min(1).optional(),
        majorId: z.string().optional(),
        homeroomTeacherId: z.string().optional(),
        room: z.string().optional(),
        isActive: z.boolean().optional(),
      }),
      request.body,
    );
    const klass = await prisma.class.update({ where: { id }, data: body });
    await audit({ userId: request.user!.id, action: 'CLASS_UPDATED', entity: 'Class', entityId: id, newValue: body, request });
    return reply.send({ success: true, message: 'Kelas diperbarui.', data: klass });
  });

  app.delete('/classes/:id', { preHandler: app.requirePermission(PERMISSION_KEYS.classesManage) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    // Hapus PERMANEN: jadwal & jurnal terkait ikut dihapus, siswa di kelas otomatis lepas kelas
    await prisma.$transaction(async (tx) => {
      await tx.teachingJournal.deleteMany({ where: { classId: id } });
      await tx.schedule.deleteMany({ where: { classId: id } });
      await tx.class.delete({ where: { id } });
    });
    await audit({ userId: request.user!.id, action: 'CLASS_DELETED', entity: 'Class', entityId: id, request });
    return reply.send({ success: true, message: 'Kelas dihapus permanen.' });
  });

  // ===== Jurusan =====
  app.get('/majors', { preHandler: app.requirePermission(PERMISSION_KEYS.scheduleRead) }, async (_request, reply) => {
    const rows = await prisma.major.findMany({ orderBy: { name: 'asc' } });
    return reply.send({ success: true, data: rows });
  });

  app.post('/majors', { preHandler: app.requirePermission(PERMISSION_KEYS.classesManage) }, async (request, reply) => {
    const body = validate(z.object({ name: z.string().min(1), code: z.string().optional() }), request.body);
    const major = await prisma.major.create({ data: body });
    await audit({ userId: request.user!.id, action: 'MAJOR_CREATED', entity: 'Major', entityId: major.id, request });
    return reply.send({ success: true, data: major });
  });

  app.put('/majors/:id', { preHandler: app.requirePermission(PERMISSION_KEYS.classesManage) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = validate(z.object({ name: z.string().min(1).optional(), code: z.string().optional() }), request.body);
    await prisma.major.update({ where: { id }, data: body });
    await audit({ userId: request.user!.id, action: 'MAJOR_UPDATED', entity: 'Major', entityId: id, newValue: body, request });
    return reply.send({ success: true, message: 'Jurusan diperbarui.' });
  });

  app.delete('/majors/:id', { preHandler: app.requirePermission(PERMISSION_KEYS.classesManage) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    // Hapus PERMANEN: kelas & siswa yang memakai jurusan ini dikosongkan jurusannya
    await prisma.$transaction(async (tx) => {
      await tx.class.updateMany({ where: { majorId: id }, data: { majorId: null } });
      await tx.student.updateMany({ where: { majorId: id }, data: { majorId: null } });
      await tx.major.delete({ where: { id } });
    });
    await audit({ userId: request.user!.id, action: 'MAJOR_DELETED', entity: 'Major', entityId: id, request });
    return reply.send({ success: true, message: 'Jurusan dihapus permanen.' });
  });

  // ===== Mata Pelajaran =====
  app.get('/subjects', { preHandler: app.requirePermission(PERMISSION_KEYS.scheduleRead) }, async (_request, reply) => {
    const rows = await prisma.subject.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } });
    return reply.send({ success: true, data: rows });
  });

  app.post('/subjects', { preHandler: app.requirePermission(PERMISSION_KEYS.classesManage) }, async (request, reply) => {
    const body = validate(z.object({ name: z.string().min(1), code: z.string().optional(), color: z.string().optional() }), request.body);
    const subject = await prisma.subject.create({ data: body });
    await audit({ userId: request.user!.id, action: 'SUBJECT_CREATED', entity: 'Subject', entityId: subject.id, request });
    return reply.send({ success: true, data: subject });
  });

  app.put('/subjects/:id', { preHandler: app.requirePermission(PERMISSION_KEYS.classesManage) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = validate(z.object({ name: z.string().min(1).optional(), code: z.string().optional(), color: z.string().optional() }), request.body);
    await prisma.subject.update({ where: { id }, data: body });
    await audit({ userId: request.user!.id, action: 'SUBJECT_UPDATED', entity: 'Subject', entityId: id, newValue: body, request });
    return reply.send({ success: true, message: 'Mapel diperbarui.' });
  });

  app.delete('/subjects/:id', { preHandler: app.requirePermission(PERMISSION_KEYS.classesManage) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    // Hapus PERMANEN: jadwal & jurnal terkait ikut dihapus
    await prisma.$transaction(async (tx) => {
      await tx.schedule.deleteMany({ where: { subjectId: id } });
      await tx.teachingJournal.deleteMany({ where: { subjectId: id } });
      await tx.subject.delete({ where: { id } });
    });
    await audit({ userId: request.user!.id, action: 'SUBJECT_DELETED', entity: 'Subject', entityId: id, request });
    return reply.send({ success: true, message: 'Mapel dihapus permanen.' });
  });

  // ===== Tahun Ajaran =====
  app.get('/academic-years', { preHandler: app.requirePermission(PERMISSION_KEYS.scheduleRead) }, async (_request, reply) => {
    const rows = await prisma.academicYear.findMany({ orderBy: { name: 'desc' } });
    return reply.send({ success: true, data: rows });
  });

  // ===== Jadwal =====
  app.get('/schedules', { preHandler: app.requirePermission(PERMISSION_KEYS.scheduleRead) }, async (request, reply) => {
    const q = request.query as { classId?: string; teacherId?: string; day?: string };
    const rows = await prisma.schedule.findMany({
      where: {
        isActive: true,
        ...(q.classId ? { classId: q.classId } : {}),
        ...(q.teacherId ? { teacherId: q.teacherId } : {}),
        ...(q.day ? { day: q.day as never } : {}),
      },
      include: {
        class: true,
        subject: true,
        teacher: { include: { user: { select: { fullName: true } } } },
      },
      orderBy: [{ day: 'asc' }, { startTime: 'asc' }],
    });
    return reply.send({
      success: true,
      data: rows.map((s) => ({
        id: s.id,
        day: s.day,
        startTime: s.startTime,
        endTime: s.endTime,
        room: s.room,
        classId: s.classId,
        className: s.class.name,
        subjectId: s.subjectId,
        subjectName: s.subject.name,
        teacherId: s.teacherId,
        teacherName: s.teacher?.user?.fullName ?? '-',
      })),
    });
  });

  app.post('/schedules', { preHandler: app.requirePermission(PERMISSION_KEYS.scheduleManage) }, async (request, reply) => {
    const body = validate(
      z.object({
        classId: z.string().min(1),
        subjectId: z.string().min(1),
        teacherId: z.string().min(1),
        day: z.enum(['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY']),
        startTime: z.string().regex(/^\d{2}:\d{2}$/),
        endTime: z.string().regex(/^\d{2}:\d{2}$/),
        room: z.string().optional(),
      }),
      request.body,
    );
    const schedule = await prisma.schedule.create({ data: body });
    await audit({ userId: request.user!.id, action: 'SCHEDULE_CREATED', entity: 'Schedule', entityId: schedule.id, request });
    return reply.send({ success: true, data: schedule });
  });

  app.put('/schedules/:id', { preHandler: app.requirePermission(PERMISSION_KEYS.scheduleManage) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = validate(
      z.object({
        classId: z.string().min(1),
        subjectId: z.string().min(1),
        teacherId: z.string().min(1),
        day: z.enum(['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY']),
        startTime: z.string().regex(/^\d{2}:\d{2}$/),
        endTime: z.string().regex(/^\d{2}:\d{2}$/),
        room: z.string().optional(),
      }),
      request.body,
    );
    await prisma.schedule.update({ where: { id }, data: body });
    await audit({ userId: request.user!.id, action: 'SCHEDULE_UPDATED', entity: 'Schedule', entityId: id, newValue: body, request });
    return reply.send({ success: true, message: 'Jadwal diperbarui.' });
  });

  app.delete('/schedules/:id', { preHandler: app.requirePermission(PERMISSION_KEYS.scheduleManage) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    await prisma.schedule.delete({ where: { id } });
    await audit({ userId: request.user!.id, action: 'SCHEDULE_DELETED', entity: 'Schedule', entityId: id, request });
    return reply.send({ success: true, message: 'Jadwal dihapus.' });
  });

  // Daftar guru (untuk dropdown)
  app.get('/teachers', { preHandler: app.requirePermission(PERMISSION_KEYS.scheduleRead) }, async (_request, reply) => {
    const rows = await prisma.teacher.findMany({
      where: { isActive: true },
      include: { user: { select: { id: true, fullName: true } }, subject: true },
      orderBy: { user: { fullName: 'asc' } },
    });
    return reply.send({
      success: true,
      data: rows.map((t) => ({
        id: t.id,
        userId: t.userId,
        fullName: t.user?.fullName ?? '-',
        nip: t.nip,
        subjectName: t.subject?.name ?? null,
        position: t.position,
      })),
    });
  });
}
