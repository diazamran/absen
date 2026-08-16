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
}
