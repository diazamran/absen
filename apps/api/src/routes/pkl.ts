import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { validate } from '../utils/validate.js';
import { ApiError } from '../utils/errors.js';
import { audit } from '../lib/audit.js';
import { PERMISSION_KEYS } from '../rbac/permissions.js';
import { localTime, todayStart, todayEnd, dateKey, monthRange, currentMonthKey, localMinutesOf } from '../lib/time.js';
import { getAttendanceRules } from '../services/settings.js';
import { haversineMeters } from '../services/attendance.js';

const locationSchema = z.object({
  name: z.string().min(1),
  address: z.string().optional(),
  city: z.string().optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  radiusMeter: z.number().int().min(10).max(5000).default(100),
  phone: z.string().optional(),
  contactName: z.string().optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
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
        startDate: (r as any).startDate ? (r as any).startDate.toISOString().slice(0, 10) : null,
        endDate: (r as any).endDate ? (r as any).endDate.toISOString().slice(0, 10) : null,
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
    const { startDate, endDate, ...rest } = body;
    const row = await (prisma.pklLocation.create as any)({
      data: {
        ...rest,
        startDate: startDate ? new Date(startDate) : null,
        endDate: endDate ? new Date(endDate) : null,
      },
    });
    await audit({ userId: request.user!.id, action: 'PKL_LOCATION_CREATED', entity: 'PklLocation', entityId: row.id, request });
    return reply.send({ success: true, data: row, message: 'Lokasi PKL ditambahkan.' });
  });

  // Update PKL location
  app.put('/pkl/locations/:id', { preHandler: app.requirePermission(PERMISSION_KEYS.pklManage) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = validate(locationSchema.partial(), request.body);
    const { startDate, endDate, ...rest } = body;
    const row = await (prisma.pklLocation.update as any)({
      where: { id },
      data: {
        ...rest,
        ...(startDate !== undefined ? { startDate: startDate ? new Date(startDate) : null } : {}),
        ...(endDate !== undefined ? { endDate: endDate ? new Date(endDate) : null } : {}),
      },
    });
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
    if (body.latitude != null && body.longitude != null) {
      const locLat = location.latitude;
      const locLng = location.longitude;
      // Validasi koordinat DB dalam rentang valid (cegah koordinat rusak seperti 111963068)
      const dbCoordsValid = locLat != null && locLng != null
        && locLat >= -90 && locLat <= 90
        && locLng >= -180 && locLng <= 180;
      if (dbCoordsValid) {
        const dist = haversineMeters(body.latitude, body.longitude, locLat!, locLng!);
        // Kompensasi akurasi GPS: siswa di dalam gedung sering dapat fix ±50-100m
        const accuracyAllowance = 150;
        locationVerified = dist <= (location.radiusMeter + accuracyAllowance);
      }
    }

    const today = todayStart();
    const todayKey = today.toISOString().slice(0, 10);

    // ===== Jadwal PKL (aturan khusus PKL; yang kosong mengikuti jam sekolah) =====
    const rules = await getAttendanceRules();
    const nowMinutes = localMinutesOf(new Date());
    const lateH = rules.pklLateAfterHour ?? rules.lateAfterHour;
    const lateM = rules.pklLateAfterHour !== null ? (rules.pklLateAfterMinute ?? 0) : rules.lateAfterMinute;
    const inDeadlineH = rules.pklCheckInDeadlineHour ?? rules.checkInDeadlineHour;
    const inDeadlineM = rules.pklCheckInDeadlineHour !== null ? (rules.pklCheckInDeadlineMinute ?? 0) : rules.checkInDeadlineMinute;
    const earlyH = rules.pklEarlyLeaveBeforeHour ?? rules.earlyLeaveBeforeHour;
    const earlyM = rules.pklEarlyLeaveBeforeHour !== null ? (rules.pklEarlyLeaveBeforeMinute ?? 0) : rules.earlyLeaveBeforeMinute;

    if (body.type === 'CHECK_IN') {
      // Cek apakah sudah ada check-in hari ini
      const existing = await prisma.attendance.findFirst({
        where: { userId: student.userId, date: today, type: 'CHECK_IN' },
      });
      if (existing) {
        return reply.send({ success: true, message: 'Sudah absen PKL hari ini.', data: { id: existing.id, alreadyExists: true } });
      }

      // Batas akhir absen datang PKL — setelah jam ini perlu koreksi petugas
      const deadlineMinutes = inDeadlineH * 60 + inDeadlineM;
      if (deadlineMinutes < 23 * 60 + 59 && nowMinutes > deadlineMinutes) {
        throw ApiError.badRequest(
          'CHECK_IN_CLOSED',
          `Absen datang PKL sudah ditutup pukul ${String(inDeadlineH).padStart(2, '0')}:${String(inDeadlineM).padStart(2, '0')} (jadwal PKL). Hubungi guru pembimbing/admin untuk koreksi.`,
        );
      }

      // Terlambat menurut batas terlambat PKL (bukan jam sekolah)
      const pad2n = (n: number) => String(n).padStart(2, '0');
      const lateThreshold = new Date(`${todayKey}T${pad2n(lateH)}:${pad2n(lateM)}:00+07:00`);
      const nowDt = new Date();
      const isLate = nowDt.getTime() > lateThreshold.getTime();
      const lateMinutes = isLate ? Math.max(1, Math.round((nowDt.getTime() - lateThreshold.getTime()) / 60000)) : 0;

      // GPS gagal/radius tidak cocok tetap mencatat kehadiran — status ke Lokasi terlihat
      // di laporan; menandai ABSENT hanya karena GPS membuat laporan rancu.
      const status = isLate ? 'LATE' : 'PRESENT';
      const att = await prisma.attendance.create({
        data: {
          userId: student.userId,
          studentId: student.id,
          date: today,
          type: 'CHECK_IN',
          checkIn: nowDt,
          status: status as never,
          method: body.method as never,
          lateMinutes,
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

      // Absen pulang PKL baru bisa dilakukan mulai jam "Pulang Awal PKL" —
      // jadwal PKL berbeda dari sekolah, jadi tidak ikut blok sekolah.
      const batasPulang = earlyH * 60 + earlyM;
      if (nowMinutes < batasPulang) {
        throw ApiError.badRequest(
          'CHECK_OUT_NOT_OPEN',
          `Absen pulang PKL baru bisa dilakukan mulai pukul ${String(earlyH).padStart(2, '0')}:${String(earlyM).padStart(2, '0')} (jadwal PKL).`,
        );
      }

      const outH = rules.pklCheckOutAfterHour ?? rules.checkOutAfterHour;
      const outM = rules.pklCheckOutAfterHour !== null ? (rules.pklCheckOutAfterMinute ?? 0) : rules.checkOutAfterMinute;
      const pulangAwal = nowMinutes < outH * 60 + outM;

      const att = await prisma.attendance.update({
        where: { id: existing.id },
        data: {
          checkOut: new Date(),
          earlyLeave: pulangAwal,
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
              orderBy: { createdAt: 'asc' },
            },
          },
        },
        pklLocation: true,
      },
    });

    return reply.send({
      success: true,
      data: assignments.map((a) => {
        // Baris datang & pulang adalah catatan TERPISAH (type CHECK_IN / CHECK_OUT) —
        // jangan membaca attendance[0] saja karena bisa jadi baris CHECK_OUT sehingga
        // siswa yang sudah absen datang salah tampil "Belum absen".
        const atts = a.student?.attendance ?? [];
        const inRow = atts.find((x) => x.type === 'CHECK_IN');
        const outTime = atts.find((x) => x.type === 'CHECK_OUT')?.checkOut ?? inRow?.checkOut ?? null;
        return {
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
            checkIn: inRow?.checkIn ? localTime(inRow.checkIn) : null,
            checkOut: outTime ? localTime(outTime) : null,
            status: inRow?.status ?? 'NOT_YET',
            method: inRow?.method ?? null,
            lateMinutes: inRow?.lateMinutes ?? null,
            earlyLeave: (atts.find((x) => x.type === 'CHECK_OUT')?.earlyLeave ?? inRow?.earlyLeave) ?? false,
          },
        };
      }),
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

    const monthKey = month || currentMonthKey();
    const { start: monthStart, end: monthEnd } = monthRange(monthKey);

    const assignments = await prisma.pklAssignment.findMany({
      where: { supervisorId: teacherId, isActive: true },
      include: {
        student: {
          include: {
            user: { select: { fullName: true } },
            class: { select: { name: true } },
            attendance: {
              where: { date: { gte: monthStart, lt: monthEnd }, type: 'CHECK_IN' },
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
          // "Hadir" mencakup yang terlambat — hadir terlambat tetap hadir.
          // Sebelumnya hanya status PRESENT yang dihitung sehingga siswa yang
          // selalu terlambat tampil "Hadir: 0" padahal absen setiap hari.
          present: atts.filter((at) => at.status === 'PRESENT' || at.status === 'LATE').length,
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
    // Kolom @db.Date menyimpan tanggal UTC = tanggal lokal MINUS satu hari (lihat
    // localDateKeyOfStoredDate di lib/time.js — startOfLocalDay(14 Sep WIB) ter-truncate
    // jadi 13 Sep UTC). Filter harus memakai nilai tersimpan itu, sementara label laporan
    // menampilkan tanggal lokal yang diminta (dulu label memakai toISOString → tampil H-1).
    const dateStr = date || dateKey();
    const [yy, mm, dd] = dateStr.split('-').map(Number);
    const dateOnly = new Date(Date.UTC(yy, mm - 1, dd - 1));

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
              where: { date: dateOnly, type: 'CHECK_IN' },
              take: 1,
            },
          },
        },
        pklLocation: true,
        supervisor: { include: { user: { select: { fullName: true } } } },
      },
      orderBy: { student: { user: { fullName: 'asc' } } },
    });

    // Jam pulang disimpan sebagai catatan CHECK_OUT TERPISAH (bukan kolom baris CHECK_IN),
    // jadi harus diambil lewat query kedua lalu dipasangkan per siswa — tanpa ini kolom
    // Pulang di laporan selalu kosong walau siswa sudah absen pulang.
    const outs = await prisma.attendance.findMany({
      where: { type: 'CHECK_OUT', date: dateOnly, studentId: { in: assignments.map((a) => a.studentId) } },
      select: { studentId: true, checkOut: true, earlyLeave: true, latitude: true, longitude: true, locationVerified: true },
      orderBy: { checkOut: 'asc' },
    });
    const outsByStudent = new Map<string, (typeof outs)[number]>();
    for (const o of outs) if (o.studentId) outsByStudent.set(o.studentId, o);

    // Stats
    const present = assignments.filter((a) => a.student?.attendance[0]?.status === 'PRESENT' || a.student?.attendance[0]?.status === 'LATE').length;
    const late = assignments.filter((a) => a.student?.attendance[0]?.status === 'LATE').length;
    const sick = assignments.filter((a) => a.student?.attendance[0]?.status === 'SICK').length;
    const excused = assignments.filter((a) => a.student?.attendance[0]?.status === 'EXCUSED').length;
    const absent = assignments.filter((a) => !a.student?.attendance[0] || a.student.attendance[0].status === 'ABSENT').length;

    return reply.send({
      success: true,
      data: {
        date: dateStr,
        total: assignments.length,
        present,
        late,
        sick,
        excused,
        absent,
        rows: assignments.map((a) => {
          const att = a.student?.attendance[0];
          const out = outsByStudent.get(a.studentId);
          // Dua jalur pulang: alur utama membuat catatan CHECK_OUT terpisah (out),
          // sedangkan /pkl/attendance menulis checkOut di baris CHECK_IN (att).
          const outTime = out?.checkOut ?? att?.checkOut ?? null;

          // Hitung jarak dari titik PKL
          const locLat = a.pklLocation.latitude;
          const locLng = a.pklLocation.longitude;
          const buildLoc = (lat: number | null, lng: number | null, verified: boolean) => {
            if (lat == null || lng == null) return null;
            const dist = (locLat != null && locLng != null)
              ? Math.round(haversineMeters(lat, lng, locLat, locLng))
              : null;
            return {
              latitude: lat,
              longitude: lng,
              distanceMeters: dist,
              locationVerified: verified,
              mapsUrl: `https://maps.google.com/?q=${lat},${lng}`,
            };
          };

          return {
            studentId: a.studentId,
            fullName: a.student?.user?.fullName ?? '-',
            nis: a.student?.nis ?? null,
            className: a.student?.class?.name ?? null,
            locationName: a.pklLocation.name,
            supervisorName: a.supervisor?.user?.fullName ?? null,
            checkIn: att?.checkIn ? localTime(att.checkIn) : null,
            checkOut: outTime ? localTime(outTime) : null,
            earlyLeave: out?.earlyLeave ?? att?.earlyLeave ?? false,
            status: att?.status ?? 'ABSENT',
            method: att?.method ?? null,
            lateMinutes: att?.lateMinutes ?? 0,
            checkInLocation: buildLoc(att?.latitude ?? null, att?.longitude ?? null, att?.locationVerified ?? false),
            checkOutLocation: buildLoc(out?.latitude ?? null, out?.longitude ?? null, out?.locationVerified ?? false),
          };
        }),
      },
    });
  });

  // Laporan PKL bulanan — scoped by supervisor
  app.get('/pkl/report/monthly', { preHandler: app.requirePermission(PERMISSION_KEYS.pklRead) }, async (request, reply) => {
    const { month, locationId, classId, startDate: startDateParam } = request.query as { month?: string; locationId?: string; classId?: string; startDate?: string };
    const monthKey = month || currentMonthKey();
    const { start: monthStart, end: monthEnd } = monthRange(monthKey);
    const [my, mo] = monthKey.split('-').map(Number);
    const daysInMonth = new Date(Date.UTC(my, mo, 0)).getUTCDate();

    const scope = await getPklScope(request.user!.id);
    const whereAssignment: Record<string, unknown> = { isActive: true };
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
              where: { date: { gte: monthStart, lt: monthEnd }, type: 'CHECK_IN' },
              orderBy: { date: 'asc' },
            },
          },
        },
        pklLocation: true,
        supervisor: { include: { user: { select: { fullName: true } } } },
      },
      orderBy: { student: { user: { fullName: 'asc' } } },
    });

    // Tanggal mulai PKL — dari query param bila admin isi manual,
    // fallback ke startDate dari PklLocation, fallback ke startDate assignment, fallback ke awal bulan.
    let pklStart: Date | null = null;
    if (startDateParam) {
      const [sy, sm, sd] = startDateParam.split('-').map(Number);
      if (sy && sm && sd) pklStart = new Date(Date.UTC(sy, sm - 1, sd));
    }
    if (!pklStart && assignments.length > 0) {
      // 1) Coba ambil dari PklLocation startDate
      const locDates = assignments
        .map((a) => (a.pklLocation as any).startDate)
        .filter(Boolean)
        .map((d: any) => new Date(d));
      if (locDates.length > 0) pklStart = new Date(Math.min(...locDates.map((d: Date) => d.getTime())));
    }
    if (!pklStart && assignments.length > 0) {
      // 2) Fallback: startDate dari PklAssignment
      const dates = assignments
        .map((a) => a.startDate)
        .filter(Boolean)
        .map((d) => new Date(d!));
      if (dates.length > 0) pklStart = new Date(Math.min(...dates.map((d) => d.getTime())));
    }

    // Hitung hari kerja (Senin–Jumat) yang sudah berlalu sejak pklStart (atau awal bulan)
    // hingga hari ini, dalam rentang bulan yang dipilih.
    const todayParts = dateKey().split('-').map(Number);
    const todayDate = new Date(Date.UTC(todayParts[0], todayParts[1] - 1, todayParts[2]));

    // Batas bawah: pklStart atau tanggal 1 bulan (ambil yang lebih baru)
    const monthFirstDay = new Date(Date.UTC(my, mo - 1, 1));
    const countFrom = pklStart && pklStart > monthFirstDay ? pklStart : monthFirstDay;

    let elapsedSchoolDays = 0;
    for (let day = 1; day <= daysInMonth; day++) {
      const dayDate = new Date(Date.UTC(my, mo - 1, day));
      if (dayDate < countFrom) continue; // sebelum mulai PKL
      if (dayDate > todayDate) continue; // belum terjadi
      const wd = dayDate.getUTCDay();
      if (wd >= 1 && wd <= 5) elapsedSchoolDays++; // Senin–Jumat
    }

    // Hitung durasi total PKL (hari kerja) dari pklStart sampai HARI INI — lintas bulan.
    // Ini dipakai banner frontend "Durasi s.d. sekarang: X hari kerja".
    let totalPklWorkdays = 0;
    if (pklStart) {
      const cur = new Date(pklStart.getTime());
      while (cur <= todayDate) {
        const wd = cur.getUTCDay();
        if (wd >= 1 && wd <= 5) totalPklWorkdays++;
        cur.setUTCDate(cur.getUTCDate() + 1);
      }
    }

    return reply.send({
      success: true,
      data: {
        month: monthKey,
        schoolDays: elapsedSchoolDays,
        pklStartDate: pklStart ? pklStart.toISOString().slice(0, 10) : null,
        totalPklWorkdays: pklStart ? totalPklWorkdays : null,
        totalStudents: assignments.length,
        rows: assignments.map((a) => {
          const atts = a.student?.attendance ?? [];
          const hasData = atts.length > 0;
          const presentCount = atts.filter((at) => at.status === 'PRESENT' || at.status === 'LATE').length;

          // Hitung absen hanya dari hari SETELAH catatan pertama siswa di bulan ini.
          // Ini mencegah siswa dihukum absen untuk hari sebelum mereka mulai absen digital.
          // Contoh: bulan Sep ada 13 hari kerja, siswa pertama kali absen tgl 17 →
          //   activeSchoolDays = 1 (hanya tgl 17), absent = 1 - 1 = 0
          let activeSchoolDays = elapsedSchoolDays;
          if (hasData) {
            // Tanggal catatan pertama siswa di bulan ini (atts sudah order by date asc)
            // DB menyimpan @db.Date sebagai UTC midnight H-1 WIB, tambah 1 hari untuk
            // mendapat tanggal lokal yang benar lalu normalisasi ke UTC midnight.
            const firstDateRaw = atts[0].date;
            const firstDateLocal = new Date(firstDateRaw.getTime() + 24 * 3600_000);
            const firstDateUTC = new Date(Date.UTC(
              firstDateLocal.getUTCFullYear(),
              firstDateLocal.getUTCMonth(),
              firstDateLocal.getUTCDate(),
            ));
            // Hitung hari kerja dari firstDate sampai hari ini dalam bulan ini
            activeSchoolDays = 0;
            for (let day = 1; day <= daysInMonth; day++) {
              const dayDate = new Date(Date.UTC(my, mo - 1, day));
              if (dayDate < firstDateUTC) continue;
              if (dayDate > todayDate) continue;
              const wd = dayDate.getUTCDay();
              if (wd >= 1 && wd <= 5) activeSchoolDays++;
            }
          }

          const absent = hasData ? Math.max(0, activeSchoolDays - atts.length) : 0;
          const percentage = hasData && activeSchoolDays > 0
            ? Math.round((presentCount / activeSchoolDays) * 100)
            : null;
          return {
            studentId: a.studentId,
            fullName: a.student?.user?.fullName ?? '-',
            nis: a.student?.nis ?? null,
            className: a.student?.class?.name ?? null,
            locationName: a.pklLocation.name,
            supervisorName: a.supervisor?.user?.fullName ?? null,
            // Prioritas: startDate dari Assignment → fallback ke startDate PklLocation
            startDate: a.startDate
              ? a.startDate.toISOString().slice(0, 10)
              : ((a.pklLocation as any).startDate ? new Date((a.pklLocation as any).startDate).toISOString().slice(0, 10) : null),
            endDate: a.endDate
              ? a.endDate.toISOString().slice(0, 10)
              : ((a.pklLocation as any).endDate ? new Date((a.pklLocation as any).endDate).toISOString().slice(0, 10) : null),
            totalDays: atts.length,
            present: atts.filter((at) => at.status === 'PRESENT').length,
            late: atts.filter((at) => at.status === 'LATE').length,
            sick: atts.filter((at) => at.status === 'SICK').length,
            excused: atts.filter((at) => at.status === 'EXCUSED').length,
            absent,
            percentage,
            hasData,
          };
        }),
      },
    });
  });
}
