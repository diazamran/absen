import type { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { issueQrToken } from '../services/qr.js';
import { ApiError } from '../utils/errors.js';
import { audit } from '../lib/audit.js';
import { PERMISSION_KEYS } from '../rbac/permissions.js';

export async function qrRoutes(app: FastifyInstance) {
  // QR dinamis untuk diri sendiri (siswa/guru/staff)
  app.get('/qr/me', { preHandler: app.authenticate, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request, reply) => {
    const token = await issueQrToken(request.user!.id, 'dynamic');
    return reply.send({ success: true, data: { token, expiresInSec: 60 } });
  });

  // QR kartu siswa (fallback statis) — dibuat admin, ditandatangani + nonce
  app.get('/qr/student/:id', { preHandler: app.requirePermission(PERMISSION_KEYS.attendanceRead) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const student = await prisma.student.findUnique({ where: { id } });
    if (!student) throw ApiError.notFound('Siswa tidak ditemukan.');
    const token = await issueQrToken(student.userId, 'student-card');
    await audit({
      userId: request.user!.id,
      action: 'QR_ISSUED',
      entity: 'Student',
      entityId: student.id,
      request,
    });
    return reply.send({ success: true, data: { token, type: 'student-card', expiresInSec: 365 * 24 * 3600 } });
  });

  // ===== Kartu QR absen semua siswa satu kelas (untuk dicetak & ditempel di kartu) =====
  app.get('/qr/class/:classId', { preHandler: app.requirePermission(PERMISSION_KEYS.studentsRead) }, async (request, reply) => {
    const { classId } = request.params as { classId: string };
    const klass = await prisma.class.findUnique({
      where: { id: classId },
      include: { students: { where: { isActive: true }, include: { user: { select: { fullName: true } } } } },
    });
    if (!klass) throw ApiError.notFound('Kelas tidak ditemukan.');

    // Scope: wali kelas hanya bisa mencetak kelas yang diwalikannya
    const actor = await prisma.user.findUnique({ where: { id: request.user!.id }, include: { role: true, teacher: true } });
    if (actor?.role.key === 'HOMEROOM_TEACHER') {
      const myClass = actor.teacher
        ? await prisma.class.findFirst({
            where: { homeroomTeacherId: actor.teacher.id, isActive: true, academicYear: { isActive: true } },
            select: { id: true },
          })
        : null;
      if (!myClass || myClass.id !== classId) {
        throw ApiError.forbidden('SCOPE_RESTRICTED', 'Anda hanya dapat mencetak kartu untuk kelas Anda sendiri.');
      }
    }

    const students = await Promise.all(
      klass.students.map(async (s) => ({
        studentId: s.id,
        nis: s.nis,
        fullName: s.user?.fullName ?? '-',
        className: klass.name,
        token: await issueQrToken(s.userId, 'student-card'),
      })),
    );

    await audit({
      userId: request.user!.id,
      action: 'QR_CARDS_ISSUED',
      entity: 'Class',
      entityId: classId,
      newValue: { className: klass.name, count: students.length },
      request,
    });

    return reply.send({ success: true, data: { className: klass.name, students } });
  });
}
