/**
 * MESIN ABSENSI
 * - Waktu selalu dari SERVER (client timestamp tidak pernah dipercaya)
 * - Pencegahan absensi ganda (1 datang + 1 pulang per hari per user)
 * - Status terlambat dihitung dari jam sekolah (pengaturan)
 * - Validasi lokasi (opsional, haversine + radius)
 * - Verifikasi metode: FACE / QR / NFC / RFID / GATE
 * - Emit realtime + audit log + notifikasi orang tua
 */
import type { FastifyRequest } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { ApiError } from '../utils/errors.js';
import { dateKey, startOfLocalDay, localTime, localTimeToUtc } from '../lib/time.js';
import { faceService } from './face.js';
import { verifyQrToken } from './qr.js';
import { verifyCard } from './card.js';
import { getAttendanceRules } from './settings.js';
import { emitAttendance, emitNotification } from '../realtime/emitter.js';
import { sendNotification, notifyParentsOfStudent } from './notify.js';
import { audit } from '../lib/audit.js';
import type { AttendanceMethod, AttendanceStatus, AttendanceType } from '@prisma/client';

export interface AttendanceProof {
  image?: string;
  prevImage?: string;
  action?: string;
  token?: string;
  cardUid?: string;
}

export interface RecordAttendanceInput {
  actor: { id: string; roleKey: string; request: FastifyRequest };
  type: AttendanceType;
  method: AttendanceMethod;
  proof?: AttendanceProof;
  deviceId?: string;
  latitude?: number;
  longitude?: number;
  accuracy?: number;
  notes?: string;
}

/** Hitung jarak haversine (meter) antara dua koordinat. */
export function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Hanya petugas piket (role PIKET) atau admin yang bisa scan absen siswa di gerbang
const GATE_ROLES = new Set(['ADMIN', 'SUPER_ADMIN', 'PIKET']);

export async function recordAttendance(input: RecordAttendanceInput): Promise<{
  attendance: Awaited<ReturnType<typeof prisma.attendance.create>>;
  fullName: string;
  nis?: string | null;
  className?: string | null;
}> {
  const { actor, type, method } = input;
  const rules = await getAttendanceRules();

  const user = await prisma.user.findUnique({
    where: { id: actor.id },
    include: { role: true, student: true, teacher: true, staff: true },
  });
  if (!user || !user.isActive) throw ApiError.unauthorized();

  // ===== Resolusi identitas berdasarkan metode =====
  let targetUserId = user.id;
  let faceVerified = false;
  let livenessVerified = false;
  let qrVerified = false;
  let cardVerified = false;

  const isGateOperator = GATE_ROLES.has(user.role.key);

  const proof = input.proof || {};

  if (method === 'FACE') {
    const image = proof.image;
    if (!image) throw ApiError.badRequest('INVALID_IMAGE', 'Wajah belum terlihat jelas.');
    const result = await faceService.verify(image, {
      action: proof.action,
      prevImage: proof.prevImage,
    });
    if (!result.userId) {
      throw ApiError.badRequest('FACE_NOT_RECOGNIZED', 'Wajah tidak dikenali. Silakan coba lagi.');
    }
    if (!result.liveness) {
      throw ApiError.badRequest('LIVENESS_FAILED', 'Deteksi gerakan gagal. Coba ulangi sesuai instruksi.');
    }
    if (!isGateOperator && result.userId !== user.id) {
      throw ApiError.badRequest('FACE_NOT_RECOGNIZED', 'Wajah tidak dikenali.');
    }
    targetUserId = result.userId;
    faceVerified = true;
    livenessVerified = result.liveness;
  } else if (method === 'QR') {
    const token = proof.token;
    if (!token) throw ApiError.badRequest('INVALID_QR', 'QR Code tidak valid.');
    const res = await verifyQrToken(token);
    if (!isGateOperator && res.userId !== user.id) {
      throw ApiError.forbidden('INVALID_QR', 'QR Code ini bukan milik Anda.');
    }
    targetUserId = res.userId;
    qrVerified = true;
  } else if (method === 'NFC' || method === 'RFID') {
    const cardUid = proof.cardUid;
    if (!cardUid) throw ApiError.badRequest('CARD_NOT_REGISTERED', 'Kartu belum terdaftar.');
    const res = await verifyCard(cardUid);
    if (!isGateOperator && res.userId !== user.id) {
      throw ApiError.forbidden('CARD_NOT_REGISTERED', 'Kartu ini bukan milik Anda.');
    }
    targetUserId = res.userId;
    cardVerified = true;
  } else if (method === 'GATE') {
    // Gate: identitas dari bukti (wajah/QR/kartu) — hanya petugas piket / admin
    if (!isGateOperator) {
      throw ApiError.forbidden('GATE_RESTRICTED', 'Scan gerbang hanya untuk petugas piket.');
    }
    if (proof.token) {
      const res = await verifyQrToken(proof.token);
      targetUserId = res.userId;
      qrVerified = true;
    } else if (proof.cardUid) {
      const res = await verifyCard(proof.cardUid);
      targetUserId = res.userId;
      cardVerified = true;
    } else if (proof.image) {
      const result = await faceService.verify(proof.image, { action: proof.action, prevImage: proof.prevImage });
      if (!result.userId || !result.liveness) {
        throw ApiError.badRequest('FACE_NOT_RECOGNIZED', 'Wajah tidak dikenali.');
      }
      targetUserId = result.userId;
      faceVerified = true;
      livenessVerified = result.liveness;
    } else {
      throw ApiError.badRequest('INVALID_PROOF', 'Metode absen tidak valid.');
    }
  } else if (method === 'MANUAL') {
    // Manual tidak lewat sini (lihat manualAttendance)
    throw ApiError.badRequest('INVALID_METHOD', 'Metode absen tidak valid.');
  }

  // ===== Waktu server + pencegahan duplikat =====
  const now = new Date();
  const today = dateKey(now);
  const dayStart = startOfLocalDay(today);

  const existing = await prisma.attendance.findUnique({
    where: { userId_date_type: { userId: targetUserId, date: dayStart, type } },
  });
  if (existing) {
    const timeStr = type === 'CHECK_IN' ? localTime(existing.checkIn ?? now) : localTime(existing.checkOut ?? now);
    const prefix = type === 'CHECK_IN' ? 'Anda sudah melakukan absensi datang hari ini' : 'Anda sudah melakukan absensi pulang hari ini';
    throw ApiError.conflict('ALREADY_ATTENDANCE', `${prefix} pada ${timeStr}.`);
  }

  if (type === 'CHECK_OUT' && rules.checkOutAllowed === false) {
    throw ApiError.badRequest('CHECK_OUT_DISABLED', 'Absensi pulang dinonaktifkan oleh sekolah.');
  }
  if (type === 'CHECK_OUT') {
    const checkIn = await prisma.attendance.findUnique({
      where: { userId_date_type: { userId: targetUserId, date: dayStart, type: 'CHECK_IN' } },
    });
    if (!checkIn) {
      throw ApiError.badRequest('NO_CHECK_IN', 'Absensi pulang hanya bisa dilakukan setelah absensi datang.');
    }
  }

  // ===== Validasi lokasi (opsional) =====
  let locationVerified = false;
  if (rules.locationEnabled) {
    if (input.latitude === undefined || input.longitude === undefined) {
      throw ApiError.badRequest('LOCATION_REQUIRED', 'Lokasi belum akurat. Aktifkan GPS dan tunggu beberapa detik.');
    }
    const dist = haversineMeters(input.latitude, input.longitude, rules.schoolLatitude, rules.schoolLongitude);
    if (dist > rules.radiusMeters) {
      throw ApiError.badRequest('OUTSIDE_LOCATION', `Anda berada di luar area absensi sekolah (${Math.round(dist)} m dari sekolah).`);
    }
    if (input.accuracy !== undefined && input.accuracy > 200) {
      throw ApiError.badRequest('LOCATION_INACCURATE', 'Lokasi belum akurat. Aktifkan GPS dan tunggu beberapa detik.');
    }
    locationVerified = true;
  }

  // ===== Status & keterlambatan (hanya untuk check-in) =====
  let status: AttendanceStatus = 'PRESENT';
  let lateMinutes = 0;
  if (type === 'CHECK_IN') {
    const threshold = localTimeToUtc(today, `${String(rules.lateAfterHour).padStart(2, '0')}:${String(rules.lateAfterMinute).padStart(2, '0')}`);
    if (now.getTime() > threshold.getTime()) {
      status = 'LATE';
      lateMinutes = Math.max(1, Math.round((now.getTime() - threshold.getTime()) / 60000));
    }
  } else {
    // status pulang mengikuti status datang hari itu
    const checkIn = await prisma.attendance.findUnique({
      where: { userId_date_type: { userId: targetUserId, date: dayStart, type: 'CHECK_IN' } },
    });
    if (checkIn) status = checkIn.status;
  }

  const target = await prisma.user.findUnique({
    where: { id: targetUserId },
    include: { student: true, teacher: true, staff: true },
  });
  if (!target || !target.isActive) throw ApiError.unauthorized('Akun tidak aktif.');

  const attendance = await prisma.attendance.create({
    data: {
      userId: targetUserId,
      studentId: target.student?.id,
      teacherId: target.teacher?.id,
      staffId: target.staff?.id,
      date: dayStart,
      type,
      checkIn: type === 'CHECK_IN' ? now : null,
      checkOut: type === 'CHECK_OUT' ? now : null,
      status,
      method,
      deviceId: input.deviceId,
      latitude: input.latitude,
      longitude: input.longitude,
      accuracy: input.accuracy,
      locationVerified,
      faceVerified,
      livenessVerified,
      qrVerified,
      cardVerified,
      lateMinutes,
      notes: input.notes,
    },
  });

  // ===== Realtime + notifikasi + audit =====
  const className = target.student?.classId ? (await prisma.class.findUnique({ where: { id: target.student.classId }, select: { name: true } }))?.name : null;

  emitAttendance({
    id: attendance.id,
    type,
    userId: targetUserId,
    fullName: target.fullName,
    nis: target.student?.nis ?? null,
    className: className ?? null,
    time: localTime(now),
    status,
    method,
    lateMinutes,
  });

  if (target.student) {
    const label = type === 'CHECK_IN' ? 'datang' : 'pulang';
    await notifyParentsOfStudent(
      target.student.id,
      'Info Absensi',
      `Anak Anda, ${target.fullName}, telah melakukan absensi ${label} pada ${localTime(now)}.`,
      { type: 'attendance', attendanceId: attendance.id },
    );
    if (status === 'LATE' && type === 'CHECK_IN') {
      await notifyParentsOfStudent(
        target.student.id,
        'Keterlambatan',
        `${target.fullName} hari ini terlambat ${lateMinutes} menit.`,
        { type: 'late', attendanceId: attendance.id },
      );
    }
  }

  await audit({
    userId: actor.id,
    action: 'ATTENDANCE_CREATED',
    entity: 'Attendance',
    entityId: attendance.id,
    newValue: { type, method, status, lateMinutes, userId: targetUserId },
    request: actor.request,
  });

  return { attendance, fullName: target.fullName, nis: target.student?.nis ?? null, className };
}

/**
 * Absensi manual oleh guru/admin — wajib audit, dengan konfirmasi status.
 */
export async function manualAttendance(input: {
  actor: { id: string; request: FastifyRequest };
  studentId: string;
  status: AttendanceStatus;
  type: AttendanceType;
  dateKeyStr?: string;
  notes?: string;
  deviceId?: string;
}): Promise<unknown> {
  const student = await prisma.student.findUnique({
    where: { id: input.studentId },
    include: { user: { include: { role: true } } },
  });
  if (!student || !student.user) throw ApiError.notFound('Siswa tidak ditemukan.');

  const dateStr = input.dateKeyStr || dateKey();
  const dayStart = startOfLocalDay(dateStr);

  const existing = await prisma.attendance.findUnique({
    where: { userId_date_type: { userId: student.userId, date: dayStart, type: input.type } },
  });
  if (existing) {
    throw ApiError.conflict('ALREADY_ATTENDANCE', 'Siswa sudah memiliki catatan absensi pada tanggal tersebut.');
  }

  const now = new Date();
  const attendance = await prisma.attendance.create({
    data: {
      userId: student.userId,
      studentId: student.id,
      date: dayStart,
      type: input.type,
      checkIn: input.type === 'CHECK_IN' ? now : null,
      checkOut: input.type === 'CHECK_OUT' ? now : null,
      status: input.status,
      method: 'MANUAL',
      createdById: input.actor.id,
      deviceId: input.deviceId,
      notes: input.notes,
    },
  });

  const className = student.classId ? (await prisma.class.findUnique({ where: { id: student.classId }, select: { name: true } }))?.name : null;
  emitAttendance({
    id: attendance.id,
    type: input.type,
    userId: student.userId,
    fullName: student.user.fullName,
    nis: student.nis,
    className,
    time: localTime(now),
    status: input.status,
    method: 'MANUAL',
    lateMinutes: 0,
  });

  await audit({
    userId: input.actor.id,
    action: 'ATTENDANCE_MANUAL_CHANGED',
    entity: 'Attendance',
    entityId: attendance.id,
    newValue: { studentId: student.id, status: input.status, type: input.type, notes: input.notes },
    request: input.actor.request,
  });

  return attendance;
}
