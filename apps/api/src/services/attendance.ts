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
import { dateKey, startOfLocalDay, localTime, localTimeToUtc, localDateKeyOfStoredDate, localMinutesOf } from '../lib/time.js';
import { faceService } from './face.js';
import { verifyQrToken } from './qr.js';
import { verifyCard } from './card.js';
import { getAttendanceRules } from './settings.js';
import { emitAttendance, emitNotification } from '../realtime/emitter.js';
import { sendNotification, notifyParentsOfStudent } from './notify.js';
import { audit } from '../lib/audit.js';
import { Prisma, type Attendance, type AttendanceMethod, type AttendanceStatus, type AttendanceType } from '@prisma/client';

export interface AttendanceProof {
  /** Descriptor wajah 128-d hasil deteksi di HP (face-api.js). */
  descriptor?: number[];
  /** Liveness ringan (deteksi gerakan 2 frame) diperiksa di HP. */
  liveness?: boolean;
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
  alreadyExists?: boolean;
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

  const userRoles = [user.role.key, ...((user.additionalRoles as string[]) || [])];
  const isGateOperator = userRoles.some((r) => GATE_ROLES.has(r));

  const proof = input.proof || {};

  if (method === 'FACE') {
    const descriptor = proof.descriptor;
    if (!descriptor) throw ApiError.badRequest('INVALID_DESCRIPTOR', 'Wajah belum terdeteksi. Posisikan wajah di tengah dan coba lagi.');
    // Liveness ringan diperiksa di HP (2 frame berjarak sebentar); server menolak bila tidak lolos
    if (proof.liveness === false) {
      throw ApiError.badRequest('LIVENESS_FAILED', 'Deteksi gerakan gagal. Coba ulangi sesuai instruksi.');
    }
    const result = await faceService.verify(descriptor);
    if (!result.userId) {
      throw ApiError.badRequest('FACE_NOT_RECOGNIZED', 'Wajah tidak dikenali. Silakan coba lagi.');
    }
    if (!isGateOperator && result.userId !== user.id) {
      throw ApiError.badRequest('FACE_NOT_RECOGNIZED', 'Wajah tidak dikenali.');
    }
    targetUserId = result.userId;
    faceVerified = true;
    livenessVerified = true;
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
    } else if (proof.descriptor) {
      if (proof.liveness === false) {
        throw ApiError.badRequest('LIVENESS_FAILED', 'Deteksi gerakan gagal. Coba ulangi sesuai instruksi.');
      }
      const result = await faceService.verify(proof.descriptor);
      if (!result.userId) {
        throw ApiError.badRequest('FACE_NOT_RECOGNIZED', 'Wajah tidak dikenali.');
      }
      targetUserId = result.userId;
      faceVerified = true;
      livenessVerified = true;
    } else {
      throw ApiError.badRequest('INVALID_PROOF', 'Metode absen tidak valid.');
    }
  } else if (method === 'MANUAL') {
    // Manual tidak lewat sini (lihat manualAttendance)
    throw ApiError.badRequest('INVALID_METHOD', 'Metode absen tidak valid.');
  }

  // ===== Waktu server =====
  const now = new Date();
  const today = dateKey(now);
  const dayStart = startOfLocalDay(today);

  // ===== Aturan jam pulang & pulang awal (berlaku juga saat memperbarui pulang terbaru) =====
  let earlyLeave = false;
  if (type === 'CHECK_OUT' && rules.checkOutAllowed === false) {
    throw ApiError.badRequest('CHECK_OUT_DISABLED', 'Absensi pulang dinonaktifkan oleh sekolah.');
  }
  const nowMinutes = localMinutesOf(now);

  // ===== Blokir CHECK_IN setelah batas akhir datang =====
  if (type === 'CHECK_IN') {
    const deadlineMinutes = rules.checkInDeadlineHour * 60 + rules.checkInDeadlineMinute;
    if (deadlineMinutes < 23 * 60 + 59 && nowMinutes > deadlineMinutes) {
      throw ApiError.badRequest(
        'CHECK_IN_CLOSED',
        `Absen datang sudah ditutup pukul ${String(rules.checkInDeadlineHour).padStart(2, '0')}:${String(rules.checkInDeadlineMinute).padStart(2, '0')}. Hubungi petugas piket/administrator untuk koreksi.`,
      );
    }
  }

  if (type === 'CHECK_OUT') {
    const checkIn = await prisma.attendance.findUnique({
      where: { userId_date_type: { userId: targetUserId, date: dayStart, type: 'CHECK_IN' } },
    });
    if (!checkIn) {
      throw ApiError.badRequest('NO_CHECK_IN', 'Absensi pulang hanya bisa dilakukan setelah absensi datang.');
    }
    // ===== Blokir CHECK_OUT sebelum jam "Mulai dihitung Pulang Awal" =====
    const batasPulangAwal = rules.earlyLeaveBeforeHour * 60 + rules.earlyLeaveBeforeMinute;
    if (nowMinutes < batasPulangAwal) {
      throw ApiError.badRequest(
        'CHECK_OUT_NOT_OPEN',
        `Absen pulang baru bisa dilakukan mulai pukul ${String(rules.earlyLeaveBeforeHour).padStart(2, '0')}:${String(rules.earlyLeaveBeforeMinute).padStart(2, '0')}.`,
      );
    }
    // Pulang setelah jam pulang sekolah tapi sebelum batas → ditandai "pulang awal"
    const batasPulangSekolah = rules.checkOutAfterHour * 60 + rules.checkOutAfterMinute;
    if (nowMinutes < batasPulangSekolah) {
      earlyLeave = true;
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

  // ===== Target user + kelas (dipakai juga untuk catatan yang sudah ada) =====
  const target = await prisma.user.findUnique({
    where: { id: targetUserId },
    include: { student: true, teacher: true, staff: true },
  });
  if (!target || !target.isActive) throw ApiError.unauthorized('Akun tidak aktif.');
  const className = target.student?.classId
    ? (await prisma.class.findUnique({ where: { id: target.student.classId }, select: { name: true } }))?.name
    : null;

  /**
   * Aturan "datang pertama menang, pulang terakhir menang":
   * - Scan DANGAT berulang TIDAK menimpa catatan — jam datang PALING AWAL yang tercatat.
   * - Scan PULANG berulang MENGGANTI catatan lama — jam pulang TERBARU yang tercatat.
   */
  const resolveDuplicate = async (existing: Attendance): Promise<{
    attendance: Attendance;
    fullName: string;
    nis?: string | null;
    className?: string | null;
    alreadyExists: true;
  }> => {
    if (type === 'CHECK_IN') {
      return {
        attendance: existing,
        alreadyExists: true,
        fullName: target.fullName,
        nis: target.student?.nis ?? null,
        className,
      };
    }
    // CHECK_OUT — timpa catatan lama dengan jam pulang terbaru
    const updated = await prisma.attendance.update({
      where: { id: existing.id },
      data: {
        checkOut: now,
        earlyLeave,
        method,
        ...(input.deviceId ? { deviceId: input.deviceId } : {}),
        ...(input.latitude !== undefined ? { latitude: input.latitude } : {}),
        ...(input.longitude !== undefined ? { longitude: input.longitude } : {}),
        ...(input.accuracy !== undefined ? { accuracy: input.accuracy } : {}),
        locationVerified: locationVerified || existing.locationVerified,
        faceVerified: faceVerified || existing.faceVerified,
        livenessVerified: livenessVerified || existing.livenessVerified,
        qrVerified: qrVerified || existing.qrVerified,
        cardVerified: cardVerified || existing.cardVerified,
      },
    });

    emitAttendance({
      id: updated.id,
      type,
      userId: targetUserId,
      fullName: target.fullName,
      nis: target.student?.nis ?? null,
      className: className ?? null,
      time: localTime(now),
      status: updated.status,
      method,
      lateMinutes: updated.lateMinutes ?? 0,
    });

    if (target.student) {
      await notifyParentsOfStudent(
        target.student.id,
        'Info Absensi',
        `Anak Anda, ${target.fullName}, jam pulang diperbarui menjadi pukul ${localTime(now)}.`,
        { type: 'attendance', attendanceId: updated.id },
      );
      await sendNotification({
        userId: targetUserId,
        title: 'Absensi Berhasil',
        body: `Kamu absen pulang pukul ${localTime(now)}${earlyLeave ? ' (Pulang Awal)' : ''} — jam pulang diperbarui.`,
        data: { type: 'attendance', attendanceId: updated.id },
      });
    }

    await audit({
      userId: actor.id,
      action: 'ATTENDANCE_UPDATED',
      entity: 'Attendance',
      entityId: updated.id,
      newValue: { type, method, earlyLeave, checkOut: localTime(now), userId: targetUserId },
      request: actor.request,
    });

    return {
      attendance: updated,
      alreadyExists: true,
      fullName: target.fullName,
      nis: target.student?.nis ?? null,
      className,
    };
  };

  const existing = await prisma.attendance.findUnique({
    where: { userId_date_type: { userId: targetUserId, date: dayStart, type } },
  });
  if (existing) return resolveDuplicate(existing);

  // ===== Status & keterlambatan (hanya untuk catatan BARU) =====
  let status: AttendanceStatus = 'PRESENT';
  let lateMinutes = 0;
  if (type === 'CHECK_IN') {
    const pad = (n: number) => String(n).padStart(2, '0');
    const threshold = localTimeToUtc(today, `${pad(rules.lateAfterHour)}:${pad(rules.lateAfterMinute)}`);
    if (now.getTime() > threshold.getTime()) {
      status = 'LATE';
      lateMinutes = Math.max(1, Math.round((now.getTime() - threshold.getTime()) / 60000));
    }
    // Batas akhir absen datang — setelah jam ini siswa tidak bisa absen datang sendiri
    // (dianggap tidak hadir; koreksi manual oleh admin/piket/wali kelas tetap bisa)
    const deadline = localTimeToUtc(today, `${pad(rules.checkInDeadlineHour)}:${pad(rules.checkInDeadlineMinute)}`);
    if (now.getTime() > deadline.getTime()) {
      throw ApiError.badRequest(
        'CHECK_IN_DEADLINE_PASSED',
        `Absen datang sudah ditutup pukul ${pad(rules.checkInDeadlineHour)}:${pad(rules.checkInDeadlineMinute)}. Hubungi petugas piket/administrator untuk koreksi.`,
      );
    }
  } else {
    // status pulang mengikuti status datang hari itu
    const checkIn = await prisma.attendance.findUnique({
      where: { userId_date_type: { userId: targetUserId, date: dayStart, type: 'CHECK_IN' } },
    });
    if (checkIn) status = checkIn.status;
  }

  let attendance;
  try {
    attendance = await prisma.attendance.create({
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
        earlyLeave,
        faceVerified,
        livenessVerified,
        qrVerified,
        cardVerified,
        lateMinutes,
        notes: input.notes,
      },
    });
  } catch (e) {
    // Race kondisi: dua permintaan bersamaan untuk user yang sama → terapkan aturan yang sama
    if ((e as { code?: string }).code === 'P2002') {
      const winner = await prisma.attendance.findUnique({
        where: { userId_date_type: { userId: targetUserId, date: dayStart, type } },
      });
      if (winner) return resolveDuplicate(winner);
    }
    throw e;
  }

  // ===== Realtime + notifikasi + audit =====
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
    try {
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
      // Notifikasi in-app untuk SISWA itu sendiri (muncul realtime di halaman Notifikasi)
      const detail =
        type === 'CHECK_IN'
          ? status === 'LATE'
            ? `pukul ${localTime(now)} — Terlambat ${lateMinutes} menit`
            : `pukul ${localTime(now)}`
          : `pukul ${localTime(now)}${earlyLeave ? ' (Pulang Awal)' : ''}`;
      await sendNotification({
        userId: targetUserId,
        title: 'Absensi Berhasil',
        body: `Kamu absen ${label} ${detail}.`,
        data: { type: 'attendance', attendanceId: attendance.id },
      });
    } catch (err) {
      // Kegagalan notifikasi tidak boleh menggagalkan absensi yang sudah tercatat
      // eslint-disable-next-line no-console
      console.error('[attendance] gagal mengirim notifikasi:', err);
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
 * Verifikasi scope pengelolaan absensi:
 * - SUPER_ADMIN / ADMIN / PIKET: semua siswa (piket menjaga gerbang seluruh sekolah)
 * - HOMEROOM_TEACHER (wali kelas): hanya siswa di kelas yang diwalikannya
 */
async function assertCanManageAttendance(request: FastifyRequest, studentClassId: string | null): Promise<void> {
  const actor = await prisma.user.findUnique({ where: { id: request.user!.id }, include: { role: true, teacher: true } });
  if (!actor) return;
  const actorRoles = [actor.role.key, ...((actor.additionalRoles as string[]) || [])];
  if (!actorRoles.includes('HOMEROOM_TEACHER')) return;
  const myClass = actor.teacher
    ? await prisma.class.findFirst({
        where: { homeroomTeacherId: actor.teacher.id, isActive: true, academicYear: { isActive: true } },
        select: { id: true },
      })
    : null;
  if (!myClass || !studentClassId || studentClassId !== myClass.id) {
    throw ApiError.forbidden('SCOPE_RESTRICTED', 'Anda hanya dapat mengelola absensi siswa di kelas Anda sendiri.');
  }
}

/**
 * Absensi manual oleh admin/piket/wali kelas — wajib audit, dengan konfirmasi status.
 * Jika catatan sudah ada pada tanggal & tipe yang sama, catatan itu DIPERBARUI (ubah status/jam), bukan ditolak.
 */
export async function manualAttendance(input: {
  actor: { id: string; request: FastifyRequest };
  studentId: string;
  status: AttendanceStatus;
  type: AttendanceType;
  dateKeyStr?: string;
  checkIn?: string;
  checkOut?: string;
  notes?: string;
  deviceId?: string;
}): Promise<unknown> {
  const student = await prisma.student.findUnique({
    where: { id: input.studentId },
    include: { user: { include: { role: true } } },
  });
  if (!student || !student.user) throw ApiError.notFound('Siswa tidak ditemukan.');
  await assertCanManageAttendance(input.actor.request, student.classId);

  const dateStr = input.dateKeyStr || dateKey();
  const dayStart = startOfLocalDay(dateStr);
  const now = new Date();
  const checkIn = input.checkIn ? localTimeToUtc(dateStr, input.checkIn) : null;
  const checkOut = input.checkOut ? localTimeToUtc(dateStr, input.checkOut) : null;

  const existing = await prisma.attendance.findUnique({
    where: { userId_date_type: { userId: student.userId, date: dayStart, type: input.type } },
  });

  let attendance;
  if (existing) {
    // Catatan sudah ada → perbarui status/jam/catatan (koreksi absen siswa)
    attendance = await prisma.attendance.update({
      where: { id: existing.id },
      data: {
        status: input.status,
        ...(checkIn ? { checkIn } : {}),
        ...(checkOut ? { checkOut } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        createdById: input.actor.id,
      },
    });
  } else {
    try {
      attendance = await prisma.attendance.create({
        data: {
          userId: student.userId,
          studentId: student.id,
          date: dayStart,
          type: input.type,
          checkIn: input.type === 'CHECK_IN' ? checkIn ?? now : null,
          checkOut: input.type === 'CHECK_OUT' ? checkOut ?? now : null,
          status: input.status,
          method: 'MANUAL',
          createdById: input.actor.id,
          deviceId: input.deviceId,
          notes: input.notes,
        },
      });
    } catch (e) {
      // Race kondisi duplikat → kembalikan pesan yang sama, bukan error 500
      if ((e as { code?: string }).code === 'P2002') {
        throw ApiError.conflict('ALREADY_ATTENDANCE', 'Siswa sudah memiliki catatan absensi pada tanggal tersebut.');
      }
      throw e;
    }
  }

  const className = student.classId ? (await prisma.class.findUnique({ where: { id: student.classId }, select: { name: true } }))?.name : null;
  emitAttendance({
    id: attendance.id,
    type: input.type,
    userId: student.userId,
    fullName: student.user.fullName,
    nis: student.nis,
    className,
    time: localTime(attendance.checkIn ?? attendance.checkOut ?? now),
    status: attendance.status,
    method: 'MANUAL',
    lateMinutes: attendance.lateMinutes ?? 0,
  });

  // Beri tahu siswa bahwa catatan absensinya tercatat/dikoreksi petugas
  if (student.user) {
    await sendNotification({
      userId: student.userId,
      title: existing ? 'Absensi Dikoreksi' : 'Absensi Tercatat',
      body: `Absensi ${input.type === 'CHECK_IN' ? 'datang' : 'pulang'} kamu ${existing ? 'diperbarui' : 'tercatat'} ${checkIn ? `pukul ${localTime(checkIn)}` : checkOut ? `pukul ${localTime(checkOut)}` : ''} (${attendance.status}).`,
      data: { type: 'attendance', attendanceId: attendance.id },
    });
  }

  await audit({
    userId: input.actor.id,
    action: existing ? 'ATTENDANCE_MANUAL_UPDATED' : 'ATTENDANCE_MANUAL_CHANGED',
    entity: 'Attendance',
    entityId: attendance.id,
    newValue: { studentId: student.id, status: input.status, type: input.type, checkIn: input.checkIn ?? null, checkOut: input.checkOut ?? null, notes: input.notes },
    request: input.actor.request,
  });

  return attendance;
}

/**
 * Koreksi catatan absensi siswa yang sudah ada (status / jam datang / jam pulang / catatan).
 * Hanya SUPER_ADMIN / ADMIN / PIKET / wali kelas (kelasnya sendiri) yang boleh.
 */
export async function updateAttendance(input: {
  actor: { id: string; request: FastifyRequest };
  attendanceId: string;
  status?: AttendanceStatus;
  checkIn?: string;
  checkOut?: string;
  notes?: string;
}): Promise<unknown> {
  const record = await prisma.attendance.findUnique({
    where: { id: input.attendanceId },
    include: { student: { include: { class: true } }, user: true },
  });
  if (!record) throw ApiError.notFound('Catatan absensi tidak ditemukan.');
  await assertCanManageAttendance(input.actor.request, record.student?.classId ?? null);

  const dateStr = localDateKeyOfStoredDate(record.date);
  const data: Prisma.AttendanceUpdateInput = {};
  if (input.status) data.status = input.status;
  if (input.checkIn) data.checkIn = localTimeToUtc(dateStr, input.checkIn);
  if (input.checkOut) data.checkOut = localTimeToUtc(dateStr, input.checkOut);
  if (input.notes !== undefined) data.notes = input.notes;

  const updated = await prisma.attendance.update({ where: { id: record.id }, data });

  emitAttendance({
    id: updated.id,
    type: updated.type,
    userId: updated.userId,
    fullName: record.user?.fullName ?? '-',
    nis: record.student?.nis ?? null,
    className: record.student?.class?.name ?? null,
    time: localTime(updated.checkIn ?? updated.checkOut ?? updated.date),
    status: updated.status,
    method: updated.method,
    lateMinutes: updated.lateMinutes ?? 0,
  });

  // Beri tahu siswa bahwa catatannya dikoreksi
  if (record.user) {
    await sendNotification({
      userId: record.userId,
      title: 'Absensi Dikoreksi',
      body: `Catatan absensimu diperbarui (${localTime(updated.checkIn ?? updated.checkOut ?? updated.date)}) — status ${updated.status}.`,
      data: { type: 'attendance', attendanceId: updated.id },
    });
  }

  await audit({
    userId: input.actor.id,
    action: 'ATTENDANCE_UPDATED',
    entity: 'Attendance',
    entityId: updated.id,
    newValue: {
      status: updated.status,
      checkIn: updated.checkIn ? localTime(updated.checkIn) : null,
      checkOut: updated.checkOut ? localTime(updated.checkOut) : null,
      notes: updated.notes,
    },
    request: input.actor.request,
  });

  return updated;
}

/**
 * Hapus bersih catatan absensi siswa dari database (bukan menonaktifkan).
 * Hanya SUPER_ADMIN / ADMIN / PIKET / wali kelas (kelasnya sendiri) yang boleh.
 */
export async function deleteAttendance(input: {
  actor: { id: string; request: FastifyRequest };
  attendanceId: string;
}): Promise<{ id: string }> {
  const record = await prisma.attendance.findUnique({
    where: { id: input.attendanceId },
    include: { student: { include: { class: true } }, user: true },
  });
  if (!record) throw ApiError.notFound('Catatan absensi tidak ditemukan.');
  await assertCanManageAttendance(input.actor.request, record.student?.classId ?? null);

  await prisma.attendance.delete({ where: { id: record.id } });

  await audit({
    userId: input.actor.id,
    action: 'ATTENDANCE_DELETED',
    entity: 'Attendance',
    entityId: record.id,
    newValue: {
      student: record.student ? { id: record.student.id, nis: record.student.nis, className: record.student.class?.name ?? null } : null,
      type: record.type,
      status: record.status,
      method: record.method,
      checkIn: record.checkIn ? localTime(record.checkIn) : null,
      checkOut: record.checkOut ? localTime(record.checkOut) : null,
      date: localDateKeyOfStoredDate(record.date),
    },
    request: input.actor.request,
  });

  return { id: record.id };
}
