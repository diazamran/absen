import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { recordAttendance, manualAttendance } from '../services/attendance.js';
import { issueQrToken } from '../services/qr.js';
import { validate } from '../utils/validate.js';
import { ApiError } from '../utils/errors.js';
import { todayStart, todayEnd, dateKey, localTime, startOfLocalDay } from '../lib/time.js';
import { PERMISSION_KEYS } from '../rbac/permissions.js';

const proofSchema = z.object({
  image: z.string().optional(),
  prevImage: z.string().optional(),
  action: z.string().optional(),
  token: z.string().optional(),
  cardUid: z.string().optional(),
});

const checkSchema = z.object({
  method: z.enum(['FACE', 'QR', 'NFC', 'RFID', 'GATE']),
  proof: proofSchema.optional(),
  deviceId: z.string().optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  accuracy: z.number().optional(),
  notes: z.string().optional(),
});

const manualSchema = z.object({
  studentId: z.string().min(1),
  status: z.enum(['PRESENT', 'LATE', 'EXCUSED', 'SICK', 'OFFICIAL_DUTY', 'ABSENT', 'LEAVE']),
  type: z.enum(['CHECK_IN', 'CHECK_OUT']).default('CHECK_IN'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  notes: z.string().optional(),
  deviceId: z.string().optional(),
});

export async function attendanceRoutes(app: FastifyInstance) {
  app.post('/attendance/check-in', { preHandler: app.authenticate, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request, reply) => {
    const body = validate(checkSchema, request.body);
    const result = await recordAttendance({
      actor: { id: request.user!.id, roleKey: request.user!.roleKey, request },
      type: 'CHECK_IN',
      method: body.method,
      proof: body.proof,
      deviceId: body.deviceId,
      latitude: body.latitude,
      longitude: body.longitude,
      accuracy: body.accuracy,
      notes: body.notes,
    });
    return reply.send({
      success: true,
      message: 'Absensi berhasil dicatat.',
      data: {
        id: result.attendance.id,
        fullName: result.fullName,
        nis: result.nis,
        className: result.className,
        time: localTime(result.attendance.checkIn ?? new Date()),
        status: result.attendance.status,
        lateMinutes: result.attendance.lateMinutes,
        earlyLeave: result.attendance.earlyLeave,
        method: result.attendance.method,
      },
    });
  });

  app.post('/attendance/check-out', { preHandler: app.authenticate, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request, reply) => {
    const body = validate(checkSchema, request.body);
    const result = await recordAttendance({
      actor: { id: request.user!.id, roleKey: request.user!.roleKey, request },
      type: 'CHECK_OUT',
      method: body.method,
      proof: body.proof,
      deviceId: body.deviceId,
      latitude: body.latitude,
      longitude: body.longitude,
      accuracy: body.accuracy,
    });
    return reply.send({
      success: true,
      message: 'Absensi pulang berhasil dicatat.',
      data: {
        id: result.attendance.id,
        fullName: result.fullName,
        time: localTime(result.attendance.checkOut ?? new Date()),
        status: result.attendance.status,
        earlyLeave: result.attendance.earlyLeave,
      },
    });
  });

  // ===== Alias metode spesifik (spesifikasi API) =====
  app.post('/attendance/face', { preHandler: app.authenticate, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request, reply) => {
    const body = validate(
      z.object({
        type: z.enum(['CHECK_IN', 'CHECK_OUT']).default('CHECK_IN'),
        image: z.string().min(1),
        prevImage: z.string().optional(),
        action: z.string().optional(),
        deviceId: z.string().optional(),
        latitude: z.number().optional(),
        longitude: z.number().optional(),
        accuracy: z.number().optional(),
      }),
      request.body,
    );
    const result = await recordAttendance({
      actor: { id: request.user!.id, roleKey: request.user!.roleKey, request },
      type: body.type,
      method: 'FACE',
      proof: { image: body.image, prevImage: body.prevImage, action: body.action },
      deviceId: body.deviceId,
      latitude: body.latitude,
      longitude: body.longitude,
      accuracy: body.accuracy,
    });
    return reply.send({
      success: true,
      message: 'Absensi wajah berhasil.',
      data: {
        id: result.attendance.id,
        fullName: result.fullName,
        nis: result.nis,
        className: result.className,
        time: localTime(result.attendance.checkIn ?? result.attendance.checkOut ?? new Date()),
        status: result.attendance.status,
        lateMinutes: result.attendance.lateMinutes,
        earlyLeave: result.attendance.earlyLeave,
        faceVerified: true,
        livenessVerified: true,
      },
    });
  });

  app.post('/attendance/qr', { preHandler: app.authenticate, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request, reply) => {
    const body = validate(
      z.object({
        type: z.enum(['CHECK_IN', 'CHECK_OUT']).default('CHECK_IN'),
        token: z.string().min(1),
        deviceId: z.string().optional(),
      }),
      request.body,
    );
    const result = await recordAttendance({
      actor: { id: request.user!.id, roleKey: request.user!.roleKey, request },
      type: body.type,
      method: 'QR',
      proof: { token: body.token },
      deviceId: body.deviceId,
    });
    return reply.send({
      success: true,
      message: 'Absensi QR berhasil.',
      data: {
        id: result.attendance.id,
        fullName: result.fullName,
        nis: result.nis,
        className: result.className,
        time: localTime(result.attendance.checkIn ?? result.attendance.checkOut ?? new Date()),
        status: result.attendance.status,
        earlyLeave: result.attendance.earlyLeave,
        qrVerified: true,
      },
    });
  });

  app.post('/attendance/card', { preHandler: app.authenticate, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request, reply) => {
    // Endpoint untuk RFID reader eksternal / device gate (petugas login sebagai aktor)
    const body = validate(
      z.object({
        cardUid: z.string().min(1),
        deviceId: z.string().optional(),
        type: z.enum(['CHECK_IN', 'CHECK_OUT']).default('CHECK_IN'),
      }),
      request.body,
    );
    const result = await recordAttendance({
      actor: { id: request.user!.id, roleKey: request.user!.roleKey, request },
      type: body.type,
      method: 'RFID',
      proof: { cardUid: body.cardUid },
      deviceId: body.deviceId,
    });
    return reply.send({
      success: true,
      data: {
        id: result.attendance.id,
        fullName: result.fullName,
        nis: result.nis,
        className: result.className,
        time: localTime(result.attendance.checkIn ?? result.attendance.checkOut ?? new Date()),
        status: result.attendance.status,
        earlyLeave: result.attendance.earlyLeave,
        cardVerified: true,
      },
    });
  });

  app.post('/attendance/gate', { preHandler: app.authenticate, config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (request, reply) => {
    // Mode gerbang: identitas dari bukti (wajah/QR/kartu) — petugas gerbang cukup membuka kamera
    const body = validate(checkSchema, request.body);
    const result = await recordAttendance({
      actor: { id: request.user!.id, roleKey: request.user!.roleKey, request },
      type: 'CHECK_IN',
      method: 'GATE',
      proof: body.proof,
      deviceId: body.deviceId,
      latitude: body.latitude,
      longitude: body.longitude,
      accuracy: body.accuracy,
    });
    return reply.send({
      success: true,
      message: 'Absensi gerbang berhasil.',
      data: {
        id: result.attendance.id,
        fullName: result.fullName,
        nis: result.nis,
        className: result.className,
        time: localTime(result.attendance.checkIn ?? new Date()),
        status: result.attendance.status,
        lateMinutes: result.attendance.lateMinutes,
        earlyLeave: result.attendance.earlyLeave,
        method: result.attendance.method,
      },
    });
  });

  // ===== Manual (guru/admin) =====
  app.post('/attendance/manual', { preHandler: app.requirePermission(PERMISSION_KEYS.attendanceManage) }, async (request, reply) => {
    const body = validate(manualSchema, request.body);
    const result = await manualAttendance({
      actor: { id: request.user!.id, request },
      studentId: body.studentId,
      status: body.status,
      type: body.type,
      dateKeyStr: body.date,
      notes: body.notes,
      deviceId: body.deviceId,
    });
    return reply.send({ success: true, message: 'Absensi manual disimpan.', data: result });
  });

  // ===== Daftar absensi hari ini =====
  app.get('/attendance/today', { preHandler: app.requirePermission(PERMISSION_KEYS.attendanceRead) }, async (request, reply) => {
    const { classId, status } = request.query as { classId?: string; status?: string };
    const dayStart = todayStart();
    const rows = await prisma.attendance.findMany({
      where: {
        date: { gte: dayStart, lt: todayEnd() },
        type: 'CHECK_IN',
        ...(classId ? { student: { classId } } : {}),
        ...(status ? { status: status as never } : {}),
      },
      include: {
        user: { select: { fullName: true } },
        student: { include: { class: { select: { name: true } } } },
      },
      orderBy: { checkIn: 'asc' },
    });
    return reply.send({
      success: true,
      data: rows.map((r) => ({
        id: r.id,
        name: r.user?.fullName ?? '-',
        nis: r.student?.nis ?? null,
        className: r.student?.class?.name ?? null,
        time: r.checkIn ? localTime(r.checkIn) : null,
        status: r.status,
        method: r.method,
        lateMinutes: r.lateMinutes,
      })),
    });
  });

  // ===== Riwayat per siswa =====
  app.get('/attendance/student/:id', { preHandler: app.requirePermission(PERMISSION_KEYS.attendanceRead) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { month } = request.query as { month?: string };
    const student = await prisma.student.findUnique({ where: { id } });
    if (!student) throw ApiError.notFound('Siswa tidak ditemukan.');

    const start = month ? new Date(`${month}-01T00:00:00+07:00`) : new Date(`${dateKey().slice(0, 7)}-01T00:00:00+07:00`);
    const rows = await prisma.attendance.findMany({
      where: { userId: student.userId, date: { gte: start } },
      orderBy: { date: 'desc' },
      take: 100,
    });
    return reply.send({
      success: true,
      data: rows.map((r) => ({
        id: r.id,
        date: r.date,
        dayKey: dateKey(r.date),
        checkIn: r.checkIn ? localTime(r.checkIn) : null,
        checkOut: r.checkOut ? localTime(r.checkOut) : null,
        status: r.status,
        method: r.method,
        lateMinutes: r.lateMinutes,
        earlyLeave: r.earlyLeave,
      })),
    });
  });

  // ===== Absensi per kelas (untuk validasi guru) =====
  app.get('/attendance/class/:id', { preHandler: app.requirePermission(PERMISSION_KEYS.attendanceRead) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { date } = request.query as { date?: string };
    const dayStart = date ? startOfLocalDay(date) : todayStart();
    const dayEnd = new Date(dayStart.getTime() + 24 * 3600_000);

    const klass = await prisma.class.findUnique({ where: { id }, include: { students: { where: { isActive: true }, include: { user: true } } } });
    if (!klass) throw ApiError.notFound('Kelas tidak ditemukan.');

    const atts = await prisma.attendance.findMany({
      where: { student: { classId: id }, date: { gte: dayStart, lt: dayEnd } },
      orderBy: { createdAt: 'asc' },
    });
    const attMap = new Map<string, (typeof atts)[number][]>();
    for (const a of atts) {
      const list = attMap.get(a.userId) || [];
      list.push(a);
      attMap.set(a.userId, list);
    }

    return reply.send({
      success: true,
      data: klass.students.map((s) => {
        const list = attMap.get(s.userId) || [];
        const checkIn = list.find((a) => a.type === 'CHECK_IN');
        const checkOut = list.find((a) => a.type === 'CHECK_OUT');
        return {
          studentId: s.id,
          name: s.user?.fullName ?? '-',
          nis: s.nis,
          status: checkIn?.status ?? 'ABSENT',
          checkIn: checkIn?.checkIn ? localTime(checkIn.checkIn) : null,
          checkOut: checkOut?.checkOut ? localTime(checkOut.checkOut) : null,
          lateMinutes: checkIn?.lateMinutes ?? 0,
          method: checkIn?.method ?? null,
        };
      }),
    });
  });
}

