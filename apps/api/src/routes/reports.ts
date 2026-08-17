import type { FastifyInstance, FastifyRequest } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { toCsv } from '../lib/csv.js';
import { startOfLocalDay, monthRange, dateKey, localTime, todayStart, todayEnd, localDateKeyOfStoredDate } from '../lib/time.js';
import { ApiError } from '../utils/errors.js';
import { audit } from '../lib/audit.js';
import { PERMISSION_KEYS } from '../rbac/permissions.js';

const STATUS_LABELS: Record<string, string> = {
  PRESENT: 'Hadir',
  LATE: 'Terlambat',
  EXCUSED: 'Izin',
  SICK: 'Sakit',
  OFFICIAL_DUTY: 'Dinas',
  ABSENT: 'Tidak Hadir',
  LEAVE: 'Cuti',
};

function statusCountsMap(rows: { status: string }[]): Record<string, number> {
  const m: Record<string, number> = {};
  for (const r of rows) m[r.status] = (m[r.status] || 0) + 1;
  return m;
}

/** Wali kelas hanya bisa mengakses kelas yang diwalikannya — filter classId dipaksa ke kelasnya. */
async function scopedClassId(request: FastifyRequest, requested?: string): Promise<string | undefined> {
  const user = await prisma.user.findUnique({ where: { id: request.user!.id }, include: { role: true, teacher: true } });
  if (user?.role.key !== 'HOMEROOM_TEACHER') return requested || undefined;
  const myClass = user.teacher
    ? await prisma.class.findFirst({
        where: { homeroomTeacherId: user.teacher.id, isActive: true, academicYear: { isActive: true } },
        select: { id: true },
      })
    : null;
  // sentinel '__none__' → tanpa data bila wali kelas tidak punya kelas
  return myClass?.id ?? '__none__';
}

/** Rekap per kelas: total siswa, hadir, terlambat, izin/sakit, dan tidak hadir pada rentang tanggal. */
async function classRecap(start: Date, end: Date) {
  const classes = await prisma.class.findMany({
    where: { isActive: true, academicYear: { isActive: true } },
    include: { students: { where: { isActive: true }, select: { id: true } } },
    orderBy: { name: 'asc' },
  });
  const atts = await prisma.attendance.groupBy({
    by: ['studentId', 'status'],
    where: { type: 'CHECK_IN', date: { gte: start, lt: end }, studentId: { not: null } },
    _count: { _all: true },
  });
  const byStudent = new Map<string, Set<string>>();
  for (const a of atts) {
    if (!a.studentId) continue;
    const set = byStudent.get(a.studentId) ?? new Set<string>();
    set.add(a.status);
    byStudent.set(a.studentId, set);
  }
  const EXCUSED = new Set(['EXCUSED', 'SICK', 'OFFICIAL_DUTY', 'LEAVE']);
  return classes.map((c) => {
    const total = c.students.length;
    const present = c.students.filter((s) => {
      const st = byStudent.get(s.id);
      return !!st && (st.has('PRESENT') || st.has('LATE'));
    }).length;
    const late = c.students.filter((s) => byStudent.get(s.id)?.has('LATE')).length;
    const excused = c.students.filter((s) => {
      const st = byStudent.get(s.id);
      return !!st && [...st].some((x) => EXCUSED.has(x));
    }).length;
    const any = c.students.filter((s) => byStudent.has(s.id)).length;
    return {
      className: c.name,
      total,
      present,
      late,
      excused,
      absent: Math.max(0, total - any),
    };
  });
}

export async function reportRoutes(app: FastifyInstance) {
  app.get('/reports/daily', { preHandler: app.requirePermission(PERMISSION_KEYS.reportsRead) }, async (request, reply) => {
    const q = request.query as { date?: string; classId?: string };
    const dayStart = q.date ? startOfLocalDay(q.date) : todayStart();
    const dayEnd = new Date(dayStart.getTime() + 24 * 3600_000);
    const classId = await scopedClassId(request, q.classId);

    const rows = await prisma.attendance.findMany({
      where: { date: { gte: dayStart, lt: dayEnd }, type: 'CHECK_IN', ...(classId ? { student: { classId } } : {}) },
      include: {
        user: { select: { fullName: true } },
        student: { include: { class: true } },
      },
      orderBy: { checkIn: 'asc' },
    });
    const classSummary = classId ? [] : await classRecap(dayStart, dayEnd);

    const counts = statusCountsMap(rows);
    const total = rows.length;
    return reply.send({
      success: true,
      data: {
        date: dateKey(dayStart),
        total,
        summary: {
          PRESENT: counts.PRESENT || 0,
          LATE: counts.LATE || 0,
          EXCUSED: counts.EXCUSED || 0,
          SICK: counts.SICK || 0,
          OFFICIAL_DUTY: counts.OFFICIAL_DUTY || 0,
          ABSENT: counts.ABSENT || 0,
        },
        rows: rows.map((r) => ({
          name: r.user?.fullName ?? '-',
          nis: r.student?.nis ?? null,
          className: r.student?.class?.name ?? null,
          time: r.checkIn ? localTime(r.checkIn) : null,
          status: r.status,
          statusLabel: STATUS_LABELS[r.status],
          method: r.method,
          lateMinutes: r.lateMinutes,
        })),
        classSummary,
      },
    });
  });

  app.get('/reports/monthly', { preHandler: app.requirePermission(PERMISSION_KEYS.reportsRead) }, async (request, reply) => {
    const q = request.query as { month?: string; classId?: string; studentId?: string };
    const month = q.month || dateKey().slice(0, 7);
    const { start, end } = monthRange(month);
    const classId = await scopedClassId(request, q.classId);

    const rows = await prisma.attendance.findMany({
      where: {
        type: 'CHECK_IN',
        date: { gte: start, lt: end },
        ...(classId ? { student: { classId } } : {}),
        ...(q.studentId ? { studentId: q.studentId } : {}),
      },
      include: {
        user: { select: { fullName: true } },
        student: { include: { class: true } },
      },
      orderBy: { date: 'asc' },
    });

    const counts = statusCountsMap(rows);
    const classSummary = classId ? [] : await classRecap(start, end);
    return reply.send({
      success: true,
      data: {
        month,
        total: rows.length,
        classSummary,
        summary: {
          PRESENT: counts.PRESENT || 0,
          LATE: counts.LATE || 0,
          EXCUSED: counts.EXCUSED || 0,
          SICK: counts.SICK || 0,
          OFFICIAL_DUTY: counts.OFFICIAL_DUTY || 0,
          ABSENT: counts.ABSENT || 0,
        },
        rows: rows.map((r) => ({
          name: r.user?.fullName ?? '-',
          nis: r.student?.nis ?? null,
          className: r.student?.class?.name ?? null,
          date: localDateKeyOfStoredDate(r.date),
          time: r.checkIn ? localTime(r.checkIn) : null,
          status: r.status,
          statusLabel: STATUS_LABELS[r.status],
          method: r.method,
          lateMinutes: r.lateMinutes,
        })),
      },
    });
  });

  app.get('/reports/class/:id', { preHandler: app.requirePermission(PERMISSION_KEYS.reportsRead) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const q = request.query as { month?: string };
    const month = q.month || dateKey().slice(0, 7);
    const { start, end } = monthRange(month);

    const klass = await prisma.class.findUnique({
      where: { id },
      include: { students: { where: { isActive: true }, include: { user: true } } },
    });
    if (!klass) throw ApiError.notFound('Kelas tidak ditemukan.');

    const atts = await prisma.attendance.findMany({
      where: { student: { classId: id }, type: 'CHECK_IN', date: { gte: start, lt: end } },
    });
    const byStudent = new Map<string, typeof atts>();
    for (const a of atts) {
      const list = byStudent.get(a.userId) || [];
      list.push(a);
      byStudent.set(a.userId, list);
    }

    const rows = klass.students.map((s) => {
      const list = byStudent.get(s.userId) || [];
      const counts = statusCountsMap(list);
      return {
        name: s.user?.fullName ?? '-',
        nis: s.nis,
        total: list.length,
        present: counts.PRESENT || 0,
        late: counts.LATE || 0,
        excused: (counts.EXCUSED || 0) + (counts.SICK || 0) + (counts.OFFICIAL_DUTY || 0) + (counts.LEAVE || 0),
        absent: counts.ABSENT || 0,
        attendanceRate: list.length ? Math.round(((counts.PRESENT || 0) + (counts.LATE || 0)) / list.length * 100) : 0,
      };
    });

    return reply.send({ success: true, data: { className: klass.name, month, rows } });
  });

  // ===== Export CSV =====
  app.get('/reports/export', { preHandler: app.requirePermission(PERMISSION_KEYS.exportCreate) }, async (request, reply) => {
    const q = request.query as { report?: string; date?: string; month?: string; classId?: string; studentId?: string };
    const report = q.report || 'daily';

    let rows: Record<string, unknown>[] = [];
    if (report === 'daily' || report === 'monthly') {
      const isMonthly = report === 'monthly';
      const start = isMonthly ? monthRange(q.month || dateKey().slice(0, 7)).start : startOfLocalDay(q.date || dateKey());
      const end = isMonthly
        ? monthRange(q.month || dateKey().slice(0, 7)).end
        : new Date(start.getTime() + 24 * 3600_000);
      const classId = await scopedClassId(request, q.classId);
      const atts = await prisma.attendance.findMany({
        where: {
          type: 'CHECK_IN',
          date: { gte: start, lt: end },
          ...(classId ? { student: { classId } } : {}),
          ...(q.studentId ? { studentId: q.studentId } : {}),
        },
        include: {
          user: { select: { fullName: true } },
          student: { include: { class: true } },
        },
        orderBy: { date: 'asc' },
      });
      rows = atts.map((r) => ({
        Tanggal: localDateKeyOfStoredDate(r.date),
        Nama: r.user?.fullName ?? '-',
        NIS: r.student?.nis ?? '',
        Kelas: r.student?.class?.name ?? '',
        'Jam Datang': r.checkIn ? localTime(r.checkIn) : '',
        'Jam Pulang': r.checkOut ? localTime(r.checkOut) : '',
        Status: STATUS_LABELS[r.status] ?? r.status,
        Metode: r.method,
        'Terlambat (menit)': r.lateMinutes,
      }));
    } else if (report === 'student') {
      if (!q.studentId) throw ApiError.badRequest('STUDENT_REQUIRED', 'Pilih siswa terlebih dahulu.');
      const { start, end } = monthRange(q.month || dateKey().slice(0, 7));
      const atts = await prisma.attendance.findMany({
        where: { userId: (await prisma.student.findUnique({ where: { id: q.studentId } }))?.userId, type: 'CHECK_IN', date: { gte: start, lt: end } },
        orderBy: { date: 'asc' },
      });
      rows = atts.map((r) => ({
        Tanggal: localDateKeyOfStoredDate(r.date),
        'Jam Datang': r.checkIn ? localTime(r.checkIn) : '',
        'Jam Pulang': r.checkOut ? localTime(r.checkOut) : '',
        Status: STATUS_LABELS[r.status] ?? r.status,
        Metode: r.method,
        'Terlambat (menit)': r.lateMinutes,
      }));
    } else {
      throw ApiError.badRequest('INVALID_REPORT', 'Jenis laporan tidak dikenal.');
    }

    await audit({ userId: request.user!.id, action: 'EXPORT_REPORT', entity: 'Report', newValue: { report, date: q.date, month: q.month }, request });

    const filename = `laporan_${report}_${dateKey()}.csv`;
    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="${filename}"`);
    return reply.send(toCsv(rows));
  });
}
