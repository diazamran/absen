import type { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { todayStart, todayEnd, dateKey, localTime, localDate, currentMonthKey } from '../lib/time.js';
import { getAttendanceRules, getBranding } from '../services/settings.js';
import { PERMISSION_KEYS } from '../rbac/permissions.js';

const STATUS_LABELS: Record<string, string> = {
  PRESENT: 'Hadir',
  LATE: 'Terlambat',
  EXCUSED: 'Izin',
  SICK: 'Sakit',
  OFFICIAL_DUTY: 'Dinas',
  DISPENSATION: 'Dispensasi',
  ABSENT: 'Tidak Hadir',
  LEAVE: 'Cuti',
};

async function statusCounts(dayStart: Date, dayEnd: Date, classId?: string) {
  const where = {
    date: { gte: dayStart, lt: dayEnd },
    type: 'CHECK_IN' as const,
    ...(classId ? { student: { classId } } : { student: { isNot: null } }),
  };
  const groups = await prisma.attendance.groupBy({
    by: ['status'],
    where,
    _count: { _all: true },
  });
  const counts: Record<string, number> = {};
  for (const g of groups) counts[g.status] = g._count._all;
  return counts;
}

/** Statistik absensi harian seluruh sekolah — dipakai dashboard Admin & Petugas Piket. */
async function schoolStats(dayStart: Date, dayEnd: Date) {
  const counts = await statusCounts(dayStart, dayEnd);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const present = (counts.PRESENT || 0) + (counts.LATE || 0);
  const percent = total ? Math.round((present / total) * 100) : 0;

  const activeStudents = await prisma.student.count({ where: { isActive: true } });

  const recent = await prisma.attendance.findMany({
    where: { date: { gte: dayStart, lt: dayEnd }, type: 'CHECK_IN' },
    orderBy: { checkIn: 'desc' },
    take: 20,
    include: {
      user: { select: { fullName: true } },
      student: { include: { class: { select: { name: true } } } },
    },
  });

  const absentToday = await prisma.student.findMany({
    where: {
      isActive: true,
      classId: { not: null },
      attendance: { none: { date: { gte: dayStart, lt: dayEnd }, type: 'CHECK_IN' } },
    },
    include: { user: { select: { fullName: true } }, class: { select: { name: true } } },
    take: 10,
    orderBy: { nis: 'asc' },
  });

  const classCounts = await prisma.class.findMany({
    where: { isActive: true, academicYear: { isActive: true } },
    select: {
      id: true,
      name: true,
      _count: { select: { students: { where: { isActive: true } } } },
      students: {
        where: {
          isActive: true,
          attendance: { some: { date: { gte: dayStart, lt: dayEnd }, type: 'CHECK_IN' } },
        },
        select: { id: true },
      },
    },
  });

  // Hitung alpa, cuti, dispensasi terpisah
  const absentCount = counts.ABSENT || 0;
  const leaveCount = counts.LEAVE || 0;
  const dispensationCount = counts.DISPENSATION || 0;
  const excusedOnly = (counts.EXCUSED || 0) + (counts.SICK || 0) + (counts.OFFICIAL_DUTY || 0);
  // notYet = total siswa aktif - yang sudah hadir/check-in hari ini
  // Termasuk yang absen, cuti, izin, sakit, terlambat
  const notYet2 = Math.max(0, activeStudents - total);

  // Top 10 siswa dengan poin pelanggaran terbanyak (akumulasi)
  let topViolators: Array<{ id: string; name: string; nis: string | null; className: string | null; totalPoints: number }> = [];
  try {
    const topViol = await prisma.studentViolation.groupBy({
      by: ['studentId'],
      _sum: { points: true },
      orderBy: { _sum: { points: 'desc' } },
      take: 10,
    });
    if (topViol.length > 0) {
      const studentIds = topViol.map((v) => v.studentId);
      const students = await prisma.student.findMany({
        where: { id: { in: studentIds } },
        include: { user: { select: { fullName: true } }, class: { select: { name: true } } },
      });
      const studentMap = new Map(students.map((s) => [s.id, s]));
      topViolators = topViol
        .map((v) => {
          const s = studentMap.get(v.studentId);
          return s ? { id: s.id, name: s.user?.fullName ?? '-', nis: s.nis, className: s.class?.name ?? null, totalPoints: v._sum.points ?? 0 } : null;
        })
        .filter((x): x is { id: string; name: string; nis: string | null; className: string | null; totalPoints: number } => x !== null && x.totalPoints > 0);
    }
  } catch { /* violations table may not exist */ }

  // Top 10 siswa yang paling sering alpa (AKUMULASI bulan ini)
  let topAbsentStudents: Array<{ id: string; name: string; nis: string | null; className: string | null; absenCount: number }> = [];
  try {
    const monthStart = currentMonthKey();
    const topAbsentRaw = await prisma.attendance.groupBy({
      by: ['studentId'],
      where: {
        status: 'ABSENT',
        type: 'CHECK_IN',
        date: { gte: new Date(`${monthStart}-01T00:00:00+07:00`) },
        studentId: { not: null },
      },
      _count: { _all: true },
      orderBy: { _count: { _all: 'desc' } },
      take: 10,
    });
    if (topAbsentRaw.length > 0) {
      const absStudentIds = topAbsentRaw.map((a) => a.studentId).filter((id): id is string => id !== null);
      const absStudents = await prisma.student.findMany({
        where: { id: { in: absStudentIds } },
        include: { user: { select: { fullName: true } }, class: { select: { name: true } } },
      });
      const absMap = new Map(absStudents.map((s) => [s.id, s]));
      topAbsentStudents = topAbsentRaw
        .map((a) => {
          if (!a.studentId) return null;
          const s = absMap.get(a.studentId);
          return s ? { id: s.id, name: s.user?.fullName ?? '-', nis: s.nis, className: s.class?.name ?? null, absenCount: a._count._all } : null;
        })
        .filter((x): x is { id: string; name: string; nis: string | null; className: string | null; absenCount: number } => x !== null);
    }
  } catch { /* table may not exist yet */ }

  return {
    stats: {
      total,
      present,
      late: counts.LATE || 0,
      excused: excusedOnly,
      absent: absentCount,
      leave: leaveCount,
      dispensation: dispensationCount,
      notYet: notYet2,
      percent,
      activeStudents,
    },
    chart: [
      { name: 'Hadir', value: counts.PRESENT || 0, color: '#22c55e' },
      { name: 'Terlambat', value: counts.LATE || 0, color: '#f59e0b' },
      { name: 'Izin', value: counts.EXCUSED || 0, color: '#3b82f6' },
      { name: 'Sakit', value: counts.SICK || 0, color: '#a855f7' },
      { name: 'Dispensasi', value: counts.DISPENSATION || 0, color: '#14b8a6' },
      { name: 'Tidak Hadir', value: absentCount, color: '#ef4444' },
      { name: 'Cuti', value: leaveCount, color: '#8b5cf6' },
    ],
    recent: recent.map((r) => ({
      id: r.id,
      name: r.user?.fullName ?? '-',
      nis: r.student?.nis ?? null,
      className: r.student?.class?.name ?? null,
      time: r.checkIn ? localTime(r.checkIn) : '-',
      status: r.status,
      statusLabel: STATUS_LABELS[r.status],
      method: r.method,
      lateMinutes: r.lateMinutes,
    })),
    absentToday: absentToday.map((s) => ({
      id: s.id,
      name: s.user?.fullName ?? '-',
      nis: s.nis,
      className: s.class?.name ?? null,
    })),
    classes: classCounts.map((c) => ({
      id: c.id,
      name: c.name,
      total: c._count.students,
      present: c.students.length,
    })),
    topViolators,
    topAbsentStudents,
  };
}

export async function dashboardRoutes(app: FastifyInstance) {
  app.get('/dashboard', { preHandler: app.authenticate }, async (request, reply) => {
    const userId = request.user!.id;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        role: true,
        student: { include: { class: true } },
        teacher: true,
        staff: true,
        parent: { include: { childLinks: { include: { student: { include: { user: true, class: true } } } } } },
      },
    });
    if (!user) throw new Error('USER_NOT_FOUND');

    const dayStart = todayStart();
    const dayEnd = todayEnd();
    const today = dateKey();
    const rules = await getAttendanceRules();
    const branding = await getBranding();

    const userRoles = [user.role.key, ...((user.additionalRoles as string[]) || [])];
    const hasRole = (r: string) => userRoles.includes(r);

    switch (true) {
      case hasRole('ADMIN') || hasRole('SUPER_ADMIN') || hasRole('HEADMASTER'): {
        const dash = await schoolStats(dayStart, dayEnd);
        return reply.send({
          success: true,
          data: {
            role: 'ADMIN',
            date: localDate(dayStart),
            dayKey: today,
            ...dash,
          },
        });
      }

      case hasRole('HOMEROOM_TEACHER') && !hasRole('ADMIN') && !hasRole('SUPER_ADMIN'): {
        const teacher = await prisma.teacher.findUnique({ where: { userId } });
        const myClass = teacher ? await prisma.class.findFirst({
          where: { homeroomTeacherId: teacher.id, isActive: true, academicYear: { isActive: true } },
          include: { students: { where: { isActive: true }, include: { user: true } } },
        }) : null;

        const myAtt = await prisma.attendance.findUnique({
          where: { userId_date_type: { userId, date: dayStart, type: 'CHECK_IN' } },
        });

        let classStatus: Record<string, number> = {};
        if (myClass) {
          classStatus = await statusCounts(dayStart, dayEnd, myClass.id);
        }

        const todaySchedule = await prisma.schedule.findMany({
          where: { teacherId: teacher?.id, day: dayName(), isActive: true },
          include: { class: true, subject: true },
          orderBy: { startTime: 'asc' },
        });

        return reply.send({
          success: true,
          data: {
            role: 'HOMEROOM_TEACHER',
            date: localDate(dayStart),
            myClass: myClass ? { id: myClass.id, name: myClass.name, studentCount: myClass.students.length } : null,
            myAttendance: myAtt
              ? {
                  status: myAtt.status,
                  statusLabel: STATUS_LABELS[myAtt.status],
                  time: myAtt.checkIn ? localTime(myAtt.checkIn) : null,
                  lateMinutes: myAtt.lateMinutes,
                }
              : null,
            classStatus,
            schedules: todaySchedule.map((s) => ({
              id: s.id,
              subject: s.subject.name,
              className: s.class.name,
              classId: s.classId,
              startTime: s.startTime,
              endTime: s.endTime,
              room: s.room,
            })),
            attendanceRules: rules,
            branding,
          },
        });
      }

      case hasRole('TEACHER') || hasRole('STAFF') || hasRole('PIKET'): {
        const myAtt = await prisma.attendance.findUnique({
          where: { userId_date_type: { userId, date: dayStart, type: 'CHECK_IN' } },
        });
        const myOut = await prisma.attendance.findUnique({
          where: { userId_date_type: { userId, date: dayStart, type: 'CHECK_OUT' } },
        });
        const teacher = await prisma.teacher.findUnique({ where: { userId } });
        const todaySchedule = teacher
          ? await prisma.schedule.findMany({
              where: { teacherId: teacher.id, day: dayName(), isActive: true },
              include: { class: true, subject: true },
              orderBy: { startTime: 'asc' },
            })
          : [];

        // Petugas piket: dashboard penuh ala admin (statistik seluruh sekolah)
        const dash = hasRole('PIKET') ? await schoolStats(dayStart, dayEnd) : null;

        return reply.send({
          success: true,
          data: {
            role: user.role.key,
            date: localDate(dayStart),
            myAttendance: {
              checkIn: myAtt ? { status: myAtt.status, statusLabel: STATUS_LABELS[myAtt.status], time: myAtt.checkIn ? localTime(myAtt.checkIn) : null, lateMinutes: myAtt.lateMinutes } : null,
              checkOut: myOut ? { time: myOut.checkOut ? localTime(myOut.checkOut) : null } : null,
            },
            schedules: todaySchedule.map((s) => ({
              id: s.id,
              subject: s.subject.name,
              className: s.class.name,
              classId: s.classId,
              startTime: s.startTime,
              endTime: s.endTime,
              room: s.room,
            })),
            attendanceRules: rules,
            branding,
            ...(dash ?? {}),
          },
        });
      }

      case hasRole('STUDENT'): {
        const student = user.student;
        const todayAtt = await prisma.attendance.findMany({
          where: { userId, date: { gte: dayStart, lt: dayEnd } },
          orderBy: { createdAt: 'asc' },
        });
        const monthStart = currentMonthKey();
        const monthStats = await prisma.attendance.groupBy({
          by: ['status'],
          where: { userId, type: 'CHECK_IN', date: { gte: new Date(`${monthStart}-01T00:00:00+07:00`), lt: dayEnd } },
          _count: { _all: true },
        });
        const monthCounts: Record<string, number> = {};
        for (const g of monthStats) monthCounts[g.status] = g._count._all;

        const schedule = student?.classId
          ? await prisma.schedule.findMany({
              where: { classId: student.classId, day: dayName(), isActive: true },
              include: { subject: true, teacher: { include: { user: { select: { fullName: true } } } }, class: true },
              orderBy: { startTime: 'asc' },
            })
          : [];

        const checkInAtt = todayAtt.find((a) => a.type === 'CHECK_IN') ?? null;
        const checkOutAtt = todayAtt.find((a) => a.type === 'CHECK_OUT') ?? null;

        return reply.send({
          success: true,
          data: {
            role: 'STUDENT',
            date: localDate(dayStart),
            student: student
              ? { id: student.id, nis: student.nis, className: student.class?.name ?? null }
              : null,
            // Kartu "Kehadiran Saya" di beranda siswa membaca myAttendance
            myAttendance: {
              checkIn: checkInAtt
                ? {
                    status: checkInAtt.status,
                    statusLabel: STATUS_LABELS[checkInAtt.status],
                    time: checkInAtt.checkIn ? localTime(checkInAtt.checkIn) : null,
                    lateMinutes: checkInAtt.lateMinutes,
                  }
                : null,
              checkOut: checkOutAtt ? { time: checkOutAtt.checkOut ? localTime(checkOutAtt.checkOut) : null, earlyLeave: checkOutAtt.earlyLeave ?? false } : null,
            },
            today: {
              checkIn: checkInAtt,
              checkOut: checkOutAtt,
            },
            monthStats: monthCounts,
            schedules: schedule.map((s) => ({
              id: s.id,
              subject: s.subject.name,
              teacher: s.teacher?.user?.fullName ?? '-',
              startTime: s.startTime,
              endTime: s.endTime,
              room: s.room,
            })),
            attendanceRules: rules,
            branding,
          },
        });
      }

      case hasRole('PARENT'): {
        const childLinks = user.parent?.childLinks ?? [];
        const children = [];
        for (const link of childLinks) {
          const s = link.student;
          if (!s) continue;
          const todayAtt = await prisma.attendance.findMany({
            where: { userId: s.userId, date: { gte: dayStart, lt: dayEnd } },
            orderBy: { createdAt: 'asc' },
          });
          const monthStats = await prisma.attendance.groupBy({
            by: ['status'],
            where: { userId: s.userId, type: 'CHECK_IN', date: { gte: new Date(`${currentMonthKey()}-01T00:00:00+07:00`), lt: dayEnd } },
            _count: { _all: true },
          });
          const counts: Record<string, number> = {};
          for (const g of monthStats) counts[g.status] = g._count._all;
          children.push({
            studentId: s.id,
            name: s.user?.fullName ?? '-',
            nis: s.nis,
            className: s.class?.name ?? null,
            today: {
              checkIn: todayAtt.find((a) => a.type === 'CHECK_IN') ?? null,
              checkOut: todayAtt.find((a) => a.type === 'CHECK_OUT') ?? null,
            },
            monthStats: counts,
          });
        }
        return reply.send({
          success: true,
          data: {
            role: 'PARENT',
            date: localDate(dayStart),
            children,
            branding,
          },
        });
      }

      default:
        return reply.send({ success: true, data: { role: user.role.key, date: localDate(dayStart) } });
    }
  });
}

function dayName(): 'MONDAY' | 'TUESDAY' | 'WEDNESDAY' | 'THURSDAY' | 'FRIDAY' | 'SATURDAY' | 'SUNDAY' {
  const days = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'] as const;
  const shifted = new Date(Date.now() + 7 * 3600_000);
  return days[shifted.getUTCDay()];
}

// ================== HOME ROOM TEACHER DASHBOARD ==================

export async function homeroomRoutes(app: FastifyInstance) {
  app.get('/dashboard/homeroom/attendance', { preHandler: app.requirePermission(PERMISSION_KEYS.attendanceRead) }, async (request, reply) => {
    const user = request.user!;
    const { date } = request.query as { date?: string };
    const targetDate = date ? new Date(date) : new Date();
    const dayStart = new Date(targetDate);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(targetDate);
    dayEnd.setHours(23, 59, 59, 999);

    // Find teacher
    const teacher = await prisma.teacher.findUnique({ where: { userId: user.id } });
    if (!teacher) return reply.status(403).send({ success: false, message: 'Bukan akun guru' });

    // Find classes where this teacher is homeroom teacher
    const classes = await prisma.class.findMany({
      where: { homeroomTeacherId: teacher.id, isActive: true },
      include: { students: { include: { user: true } } },
    });

    if (classes.length === 0) {
      return reply.send({ success: true, data: { date: localDate(dayStart), present: 0, late: 0, sick: 0, excused: 0, absent: 0, total: 0 } });
    }

    const studentIds = classes.flatMap((c) => c.students.map((s) => s.id));
    if (studentIds.length === 0) {
      return reply.send({ success: true, data: { date: localDate(dayStart), present: 0, late: 0, sick: 0, excused: 0, absent: 0, total: 0 } });
    }

    const attendance = await prisma.attendance.findMany({
      where: { studentId: { in: studentIds }, date: { gte: dayStart, lte: dayEnd } },
    });

    const statusCount: Record<string, number> = { PRESENT: 0, LATE: 0, SICK: 0, EXCUSED: 0, ABSENT: 0, LEAVE: 0, OFFICIAL_DUTY: 0, DISPENSATION: 0 };
    for (const a of attendance) {
      statusCount[a.status] = (statusCount[a.status] || 0) + 1;
    }

    return reply.send({
      success: true,
      data: {
        date: localDate(dayStart),
        present: statusCount.PRESENT + statusCount.LATE,
        late: statusCount.LATE,
        sick: statusCount.SICK,
        excused: statusCount.EXCUSED + statusCount.LEAVE,
        absent: Math.max(0, studentIds.length - attendance.length),
        total: studentIds.length,
      },
    });
  });
}
