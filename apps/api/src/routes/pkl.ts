import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { validate } from '../utils/validate.js';
import { ApiError } from '../utils/errors.js';
import { audit } from '../lib/audit.js';
import { PERMISSION_KEYS } from '../rbac/permissions.js';
import { localTime, todayStart, todayEnd } from '../lib/time.js';

const locationSchema = z.object({
  name: z.string().min(1),
  address: z.string().optional(),
  city: z.string().optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  radiusMeter: z.number().int().min(10).max(1000).default(100),
  phone: z.string().optional(),
  contactName: z.string().optional(),
});

const assignmentSchema = z.object({
  studentId: z.string().min(1),
  pklLocationId: z.string().min(1),
  supervisorId: z.string().optional().nullable(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  notes: z.string().optional(),
});

export async function pklRoutes(app: FastifyInstance) {

  // Helper: get current user's PKL scope (admin or supervisor)
  async function getPklScope(userId: string): Promise<{ isAdmin: boolean; teacherId: string | null }> {
    const user = await prisma.user.findUnique({ where: { id: userId }, include: { role: true, teacher: true } });
    const roles = [user?.role?.key, ...((user?.additionalRoles as string[]) || [])].filter(Boolean);
    const isAdmin = roles.includes('ADMIN') || roles.includes('SUPER_ADMIN') || roles.includes('HEADMASTER');
    return { isAdmin, teacherId: user?.teacher?.id ?? null };
  }

  // ===== CURRENT USER PKL ROLE =====
  app.get('/pkl/me', { preHandler: app.authenticate }, async (request, reply) => {
    const roles = request.user!.roles || [request.user!.roleKey];
    const isPklAdmin = roles.includes('ADMIN') || roles.includes('SUPER_ADMIN') || roles.includes('HEADMASTER');

    const user = await prisma.user.findUnique({
      where: { id: request.user!.id },
      include: { teacher: true },
    });
    if (!user?.teacher) {
      // Admin/SuperAdmin tetap bisa akses PKL management walau tidak punya teacher record
      return reply.send({ success: true, data: { isSupervisor: false, isPklAdmin, teacherId: null } });
    }
    const assignmentCount = await prisma.pklAssignment.count({ where: { supervisorId: user.teacher.id } });
    return reply.send({
      success: true,
      data: {
        isSupervisor: assignmentCount > 0,
        isPklAdmin,
        teacherId: user.teacher.id,
      },
    });
  });

  // ===== LOCATIONS =====

  // List all PKL locations
  app.get('/pkl/locations', { preHandler: app.requirePermission(PERMISSION_KEYS.pklRead) }, async (request, reply) => {
    const { search, includeStats } = request.query as { search?: string; includeStats?: string };
    const where: Record<string, unknown> = {};
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { city: { contains: search, mode: 'insensitive' } },
        { address: { contains: search, mode: 'insensitive' } },
      ];
    }
    const rows = await prisma.pklLocation.findMany({
      where,
      include: {
        assignments: {
          where: { isActive: true },
          include: {
            student: { include: { user: { select: { fullName: true } }, class: { select: { name: true } } } },
            supervisor: { include: { user: { select: { fullName: true } } } },
          },
        },
      },
      orderBy: { name: 'asc' },
    });
    return reply.send({
      success: true,
      data: rows.map((r) => ({
        id: r.id,
        name: r.name,
        address: r.address,
        city: r.city,
        latitude: r.latitude,
        longitude: r.longitude,
        radiusMeter: r.radiusMeter,
        phone: r.phone,
        contactName: r.contactName,
        isActive: r.isActive,
        studentCount: r.assignments.length,
        students: r.assignments.map((a) => ({
          assignmentId: a.id,
          studentId: a.studentId,
          fullName: a.student?.user?.fullName ?? '-',
          nis: a.student?.nis ?? null,
          className: a.student?.class?.name ?? null,
          supervisorId: a.supervisorId,
          supervisorName: a.supervisor?.user?.fullName ?? null,
          startDate: a.startDate,
          endDate: a.endDate,
        })),
      })),
    });
  });

  // Create PKL location
  app.post('/pkl/locations', { preHandler: app.requirePermission(PERMISSION_KEYS.pklManage) }, async (request, reply) => {
    const body = validate(locationSchema, request.body);
    const row = await prisma.pklLocation.create({ data: body });
    await audit({ userId: request.user!.id, action: 'PKL_LOCATION_CREATED', entity: 'PklLocation', entityId: row.id, request });
    return reply.send({ success: true, data: row, message: 'Lokasi PKL ditambahkan.' });
  });

  // Update PKL location
  app.put('/pkl/locations/:id', { preHandler: app.requirePermission(PERMISSION_KEYS.pklManage) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = validate(locationSchema.partial(), request.body);
    const row = await prisma.pklLocation.update({ where: { id }, data: body });
    await audit({ userId: request.user!.id, action: 'PKL_LOCATION_UPDATED', entity: 'PklLocation', entityId: id, request });
    return reply.send({ success: true, data: row, message: 'Lokasi PKL diperbarui.' });
  });

  // Delete PKL location
  app.delete('/pkl/locations/:id', { preHandler: app.requirePermission(PERMISSION_KEYS.pklManage) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    await prisma.pklLocation.delete({ where: { id } });
    await audit({ userId: request.user!.id, action: 'PKL_LOCATION_DELETED', entity: 'PklLocation', entityId: id, request });
    return reply.send({ success: true, message: 'Lokasi PKL dihapus.' });
  });

  // ===== ASSIGNMENTS =====

  // Create assignment (assign siswa ke lokasi + guru pembimbing)
  app.post('/pkl/assignments', { preHandler: app.requirePermission(PERMISSION_KEYS.pklManage) }, async (request, reply) => {
    const body = validate(assignmentSchema, request.body);
    const existing = await prisma.pklAssignment.findFirst({
      where: { studentId: body.studentId, pklLocationId: body.pklLocationId },
    });
    if (existing) throw ApiError.conflict('ALREADY_ASSIGNED', 'Siswa sudah ditugaskan ke lokasi ini.');
    const row = await prisma.pklAssignment.create({
      data: {
        studentId: body.studentId,
        pklLocationId: body.pklLocationId,
        supervisorId: body.supervisorId || null,
        startDate: body.startDate ? new Date(body.startDate) : null,
        endDate: body.endDate ? new Date(body.endDate) : null,
        notes: body.notes,
      },
    });
    await audit({ userId: request.user!.id, action: 'PKL_ASSIGNMENT_CREATED', entity: 'PklAssignment', entityId: row.id, request });
    return reply.send({ success: true, data: row, message: 'Penugasan PKL dibuat.' });
  });

  // Bulk assign (assign banyak siswa sekaligus)
  app.post('/pkl/assignments/bulk', { preHandler: app.requirePermission(PERMISSION_KEYS.pklManage) }, async (request, reply) => {
    const body = validate(z.object({
      studentIds: z.array(z.string()).min(1),
      pklLocationId: z.string().min(1),
      supervisorId: z.string().optional().nullable(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
    }), request.body);
    let created = 0;
    for (const studentId of body.studentIds) {
      const existing = await prisma.pklAssignment.findFirst({
        where: { studentId, pklLocationId: body.pklLocationId },
      });
      if (!existing) {
        await prisma.pklAssignment.create({
          data: {
            studentId,
            pklLocationId: body.pklLocationId,
            supervisorId: body.supervisorId || null,
            startDate: body.startDate ? new Date(body.startDate) : null,
            endDate: body.endDate ? new Date(body.endDate) : null,
          },
        });
        created++;
      }
    }
    if (created > 0) {
      await audit({ userId: request.user!.id, action: 'PKL_BULK_ASSIGNMENT', entity: 'PklAssignment', entityId: body.pklLocationId, request });
    }
    return reply.send({ success: true, message: `${created} siswa ditugaskan ke lokasi PKL.` });
  });

  // Update assignment (ubah guru pembimbing, tanggal, dll)
  app.put('/pkl/assignments/:id', { preHandler: app.requirePermission(PERMISSION_KEYS.pklManage) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = validate(assignmentSchema.partial(), request.body);
    const data: Record<string, unknown> = {};
    if (body.supervisorId !== undefined) data.supervisorId = body.supervisorId || null;
    if (body.startDate !== undefined) data.startDate = body.startDate ? new Date(body.startDate) : null;
    if (body.endDate !== undefined) data.endDate = body.endDate ? new Date(body.endDate) : null;
    if (body.notes !== undefined) data.notes = body.notes;
    if (body.pklLocationId !== undefined) data.pklLocationId = body.pklLocationId;
    const row = await prisma.pklAssignment.update({ where: { id }, data });
    return reply.send({ success: true, data: row, message: 'Penugasan diperbarui.' });
  });

  // Delete assignment
  app.delete('/pkl/assignments/:id', { preHandler: app.requirePermission(PERMISSION_KEYS.pklManage) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    await prisma.pklAssignment.delete({ where: { id } });
    await audit({ userId: request.user!.id, action: 'PKL_ASSIGNMENT_DELETED', entity: 'PklAssignment', entityId: id, request });
    return reply.send({ success: true, message: 'Penugasan dihapus.' });
  });

  // ===== PKL ATTENDANCE =====

  // Absen PKL (check-in / check-out) — siswa atau guru pembimbing
  app.post('/pkl/attendance', { preHandler: app.requirePermission(PERMISSION_KEYS.pklAttendance) }, async (request, reply) => {
    const body = validate(z.object({
      type: z.enum(['CHECK_IN', 'CHECK_OUT']).default('CHECK_IN'),
      pklLocationId: z.string().min(1),
      studentId: z.string().optional(), // jika guru yang input untuk siswa
      method: z.enum(['FACE', 'QR', 'MANUAL']).default('FACE'),
      latitude: z.number().optional(),
      longitude: z.number().optional(),
      descriptor: z.array(z.number()).optional(),
    }), request.body);

    const targetStudentId = body.studentId || request.user!.id;
    // Cari student record
    const student = body.studentId
      ? await prisma.student.findUnique({ where: { id: body.studentId } })
      : await prisma.student.findUnique({ where: { userId: request.user!.id } });
    if (!student) throw ApiError.notFound('Siswa tidak ditemukan.');

    // Supervisor hanya boleh absensi untuk siswa bimbingannya
    if (body.studentId) {
      const scope = await getPklScope(request.user!.id);
      if (!scope.isAdmin && scope.teacherId) {
        const assignment = await prisma.pklAssignment.findFirst({
          where: { studentId: body.studentId, supervisorId: scope.teacherId, isActive: true },
        });
        if (!assignment) throw ApiError.forbidden('FORBIDDEN', 'Anda tidak memiliki akses ke siswa ini.');
      }
    }

    // Verifikasi lokasi
    const location = await prisma.pklLocation.findUnique({ where: { id: body.pklLocationId } });
    if (!location) throw ApiError.notFound('Lokasi PKL tidak ditemukan.');

    let locationVerified = false;
    if (body.latitude && body.longitude && location.latitude && location.longitude) {
      const R = 6371e3;
      const φ1 = (body.latitude * Math.PI) / 180;
      const φ2 = (location.latitude * Math.PI) / 180;
      const Δφ = ((location.latitude - body.latitude) * Math.PI) / 180;
      const Δλ = ((location.longitude - body.longitude) * Math.PI) / 180;
      const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
      const dist = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      locationVerified = dist <= location.radiusMeter;
    }

    const today = todayStart();
    const todayKey = today.toISOString().slice(0, 10);

    if (body.type === 'CHECK_IN') {
      // Cek apakah sudah ada check-in hari ini
      const existing = await prisma.attendance.findFirst({
        where: { userId: student.userId, date: today, type: 'CHECK_IN' },
      });
      if (existing) {
        return reply.send({ success: true, message: 'Sudah absen PKL hari ini.', data: { id: existing.id, alreadyExists: true } });
      }

      const status = locationVerified ? 'PRESENT' : 'ABSENT';
      const att = await prisma.attendance.create({
        data: {
          userId: student.userId,
          studentId: student.id,
          date: today,
          type: 'CHECK_IN',
          checkIn: new Date(),
          status: status as never,
          method: body.method as never,
          pklLocationId: body.pklLocationId,
          latitude: body.latitude,
          longitude: body.longitude,
          locationVerified,
        },
      });

      await audit({ userId: request.user!.id, action: 'PKL_CHECK_IN', entity: 'Attendance', entityId: att.id, request });

      return reply.send({
        success: true,
        message: 'Absen PKL berhasil.',
        data: {
          id: att.id,
          status,
          locationVerified,
          checkIn: localTime(att.checkIn!),
          locationName: location.name,
        },
      });
    } else {
      // CHECK_OUT
      const existing = await prisma.attendance.findFirst({
        where: { userId: student.userId, date: today, type: 'CHECK_IN' },
      });
      if (!existing) throw ApiError.badRequest('NOT_CHECKED_IN', 'Belum absen PKL hari ini.');

      const att = await prisma.attendance.update({
        where: { id: existing.id },
        data: {
          checkOut: new Date(),
          earlyLeave: false,
        },
      });

      return reply.send({
        success: true,
        message: 'Absen pulang PKL berhasil.',
        data: {
          id: att.id,
          checkOut: localTime(att.checkOut!),
        },
      });
    }
  });

  // ===== SUPERVISOR DASHBOARD =====

  // Daftar siswa yang dibimbing + status hari ini
  app.get('/pkl/supervisor/:teacherId', { preHandler: app.requirePermission(PERMISSION_KEYS.pklRead) }, async (request, reply) => {
    const { teacherId } = request.params as { teacherId: string };
    // Supervisor hanya boleh lihat data sendiri
    const scope = await getPklScope(request.user!.id);
    if (!scope.isAdmin && scope.teacherId !== teacherId) {
      throw ApiError.forbidden('FORBIDDEN', 'Anda hanya bisa melihat data siswa bimbingan sendiri.');
    }
    const today = todayStart();

    const assignments = await prisma.pklAssignment.findMany({
      where: { supervisorId: teacherId, isActive: true },
      include: {
        student: {
          include: {
            user: { select: { fullName: true } },
            class: { select: { name: true } },
            attendance: {
              where: { date: today },
              orderBy: { createdAt: 'desc' },
              take: 2,
            },
          },
        },
        pklLocation: true,
      },
    });

    return reply.send({
      success: true,
      data: assignments.map((a) => ({
        assignmentId: a.id,
        studentId: a.studentId,
        fullName: a.student?.user?.fullName ?? '-',
        nis: a.student?.nis ?? null,
        className: a.student?.class?.name ?? null,
        location: {
          id: a.pklLocation.id,
          name: a.pklLocation.name,
          city: a.pklLocation.city,
        },
        todayAttendance: {
          checkIn: a.student?.attendance[0]?.checkIn ? localTime(a.student.attendance[0].checkIn) : null,
          checkOut: a.student?.attendance[0]?.checkOut ? localTime(a.student.attendance[0].checkOut) : null,
          status: a.student?.attendance[0]?.status ?? 'NOT_YET',
          method: a.student?.attendance[0]?.method ?? null,
        },
      })),
    });
  });

  // Rekap PKL per bulan untuk satu guru pembimbing
  app.get('/pkl/supervisor/:teacherId/rekap', { preHandler: app.requirePermission(PERMISSION_KEYS.pklRead) }, async (request, reply) => {
    const { teacherId } = request.params as { teacherId: string };
    // Supervisor hanya boleh lihat rekap sendiri
    const scope = await getPklScope(request.user!.id);
    if (!scope.isAdmin && scope.teacherId !== teacherId) {
      throw ApiError.forbidden('FORBIDDEN', 'Anda hanya bisa melihat rekap siswa bimbingan sendiri.');
    }
    const { month } = request.query as { month?: string };

    const monthStart = month ? new Date(`${month}-01T00:00:00+07:00`) : new Date(`${new Date().toISOString().slice(0, 7)}-01T00:00:00+07:00`);
    const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0, 23, 59, 59);

    const assignments = await prisma.pklAssignment.findMany({
      where: { supervisorId: teacherId, isActive: true },
      include: {
        student: {
          include: {
            user: { select: { fullName: true } },
            class: { select: { name: true } },
            attendance: {
              where: { date: { gte: monthStart, lte: monthEnd }, type: 'CHECK_IN' },
              orderBy: { date: 'asc' },
            },
          },
        },
        pklLocation: true,
      },
    });

    return reply.send({
      success: true,
      data: assignments.map((a) => {
        const atts = a.student?.attendance ?? [];
        return {
          studentId: a.studentId,
          fullName: a.student?.user?.fullName ?? '-',
          nis: a.student?.nis ?? null,
          className: a.student?.class?.name ?? null,
          locationName: a.pklLocation.name,
          totalDays: atts.length,
          present: atts.filter((at) => at.status === 'PRESENT').length,
          late: atts.filter((at) => at.status === 'LATE').length,
          sick: atts.filter((at) => at.status === 'SICK').length,
          excused: atts.filter((at) => at.status === 'EXCUSED').length,
          absent: atts.filter((at) => at.status === 'ABSENT').length,
        };
      }),
    });
  });

  // ===== LIST PKL STUDENTS — scoped by role =====
  app.get('/pkl/students', { preHandler: app.requirePermission(PERMISSION_KEYS.pklRead) }, async (request, reply) => {
    const { search } = request.query as { search?: string };
    const scope = await getPklScope(request.user!.id);
    const where: Record<string, unknown> = { isActive: true };
    // Supervisor hanya lihat siswa bimbingannya
    if (!scope.isAdmin && scope.teacherId) {
      where.supervisorId = scope.teacherId;
    }
    if (search) {
      where.OR = [
        { student: { user: { fullName: { contains: search, mode: 'insensitive' } } } },
        { student: { nis: { contains: search, mode: 'insensitive' } } },
      ];
    }
    const rows = await prisma.pklAssignment.findMany({
      where,
      include: {
        student: {
          include: {
            user: { select: { fullName: true } },
            class: { select: { name: true } },
          },
        },
        pklLocation: { select: { id: true, name: true, city: true } },
        supervisor: { include: { user: { select: { fullName: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return reply.send({
      success: true,
      data: rows.map((r) => ({
        id: r.id,
        studentId: r.studentId,
        fullName: r.student?.user?.fullName ?? '-',
        nis: r.student?.nis ?? null,
        className: r.student?.class?.name ?? null,
        locationId: r.pklLocationId,
        locationName: r.pklLocation.name,
        locationCity: r.pklLocation.city,
        supervisorId: r.supervisorId,
        supervisorName: r.supervisor?.user?.fullName ?? null,
        startDate: r.startDate,
        endDate: r.endDate,
        isActive: r.isActive,
      })),
    });
  });

  // ===== LAPORAN PKL =====

  // Laporan PKL harian — scoped by supervisor
  app.get('/pkl/report/daily', { preHandler: app.requirePermission(PERMISSION_KEYS.pklRead) }, async (request, reply) => {
    const { date, locationId, classId } = request.query as { date?: string; locationId?: string; classId?: string };
    const targetDate = date ? new Date(`${date}T00:00:00+07:00`) : todayStart();
    const dayEnd = new Date(targetDate.getTime() + 24 * 3600_000);

    const scope = await getPklScope(request.user!.id);
    const whereAssignment: Record<string, unknown> = { isActive: true };
    // Supervisor hanya lihat siswanya sendiri
    if (!scope.isAdmin && scope.teacherId) {
      whereAssignment.supervisorId = scope.teacherId;
    }
    if (locationId) whereAssignment.pklLocationId = locationId;
    if (classId) whereAssignment.student = { classId };

    const assignments = await prisma.pklAssignment.findMany({
      where: whereAssignment,
      include: {
        student: {
          include: {
            user: { select: { fullName: true } },
            class: { select: { name: true } },
            attendance: {
              where: { date: targetDate, type: 'CHECK_IN' },
              take: 1,
            },
          },
        },
        pklLocation: true,
        supervisor: { include: { user: { select: { fullName: true } } } },
      },
      orderBy: { student: { user: { fullName: 'asc' } } },
    });

    // Stats
    const present = assignments.filter((a) => a.student?.attendance[0]?.status === 'PRESENT' || a.student?.attendance[0]?.status === 'LATE').length;
    const late = assignments.filter((a) => a.student?.attendance[0]?.status === 'LATE').length;
    const sick = assignments.filter((a) => a.student?.attendance[0]?.status === 'SICK').length;
    const excused = assignments.filter((a) => a.student?.attendance[0]?.status === 'EXCUSED').length;
    const absent = assignments.filter((a) => !a.student?.attendance[0] || a.student.attendance[0].status === 'ABSENT').length;

    return reply.send({
      success: true,
      data: {
        date: targetDate.toISOString().slice(0, 10),
        total: assignments.length,
        present,
        late,
        sick,
        excused,
        absent,
        rows: assignments.map((a) => {
          const att = a.student?.attendance[0];
          return {
            studentId: a.studentId,
            fullName: a.student?.user?.fullName ?? '-',
            nis: a.student?.nis ?? null,
            className: a.student?.class?.name ?? null,
            locationName: a.pklLocation.name,
            supervisorName: a.supervisor?.user?.fullName ?? null,
            checkIn: att?.checkIn ? localTime(att.checkIn) : null,
            checkOut: att?.checkOut ? localTime(att.checkOut) : null,
            status: att?.status ?? 'ABSENT',
            method: att?.method ?? null,
            lateMinutes: att?.lateMinutes ?? 0,
          };
        }),
      },
    });
  });

  // Laporan PKL bulanan — scoped by supervisor
  app.get('/pkl/report/monthly', { preHandler: app.requirePermission(PERMISSION_KEYS.pklRead) }, async (request, reply) => {
    const { month, locationId, classId } = request.query as { month?: string; locationId?: string; classId?: string };
    const monthStart = month ? new Date(`${month}-01T00:00:00+07:00`) : new Date(`${new Date().toISOString().slice(0, 7)}-01T00:00:00+07:00`);
    const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0, 23, 59, 59);

    const scope = await getPklScope(request.user!.id);
    const whereAssignment: Record<string, unknown> = { isActive: true };
    // Supervisor hanya lihat siswanya sendiri
    if (!scope.isAdmin && scope.teacherId) {
      whereAssignment.supervisorId = scope.teacherId;
    }
    if (locationId) whereAssignment.pklLocationId = locationId;
    if (classId) whereAssignment.student = { classId };

    const assignments = await prisma.pklAssignment.findMany({
      where: whereAssignment,
      include: {
        student: {
          include: {
            user: { select: { fullName: true } },
            class: { select: { name: true } },
            attendance: {
              where: { date: { gte: monthStart, lte: monthEnd }, type: 'CHECK_IN' },
              orderBy: { date: 'asc' },
            },
          },
        },
        pklLocation: true,
        supervisor: { include: { user: { select: { fullName: true } } } },
      },
      orderBy: { student: { user: { fullName: 'asc' } } },
    });

    // Hitung hari kerja dalam bulan (Senin-Jumat)
    let schoolDays = 0;
    const d = new Date(monthStart);
    while (d <= monthEnd) {
      const day = d.getDay();
      if (day >= 1 && day <= 5) schoolDays++;
      d.setDate(d.getDate() + 1);
    }

    return reply.send({
      success: true,
      data: {
        month: monthStart.toISOString().slice(0, 7),
        schoolDays,
        totalStudents: assignments.length,
        rows: assignments.map((a) => {
          const atts = a.student?.attendance ?? [];
          return {
            studentId: a.studentId,
            fullName: a.student?.user?.fullName ?? '-',
            nis: a.student?.nis ?? null,
            className: a.student?.class?.name ?? null,
            locationName: a.pklLocation.name,
            supervisorName: a.supervisor?.user?.fullName ?? null,
            totalDays: atts.length,
            present: atts.filter((at) => at.status === 'PRESENT').length,
            late: atts.filter((at) => at.status === 'LATE').length,
            sick: atts.filter((at) => at.status === 'SICK').length,
            excused: atts.filter((at) => at.status === 'EXCUSED').length,
            absent: Math.max(0, schoolDays - atts.length),
            percentage: schoolDays > 0 ? Math.round((atts.filter((at) => at.status === 'PRESENT' || at.status === 'LATE').length / schoolDays) * 100) : 0,
          };
        }),
      },
    });
  });
}
