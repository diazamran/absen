import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { assignCard, removeCard } from '../services/card.js';
import { validate } from '../utils/validate.js';
import { ApiError } from '../utils/errors.js';
import { audit } from '../lib/audit.js';
import { PERMISSION_KEYS } from '../rbac/permissions.js';

export async function cardRoutes(app: FastifyInstance) {
  // Daftarkan kartu untuk siswa
  app.post('/cards', { preHandler: app.requirePermission(PERMISSION_KEYS.attendanceManage) }, async (request, reply) => {
    const body = validate(
      z.object({
        userId: z.string().min(1),
        cardUid: z.string().min(1),
      }),
      request.body,
    );
    const user = await prisma.user.findUnique({ where: { id: body.userId } });
    if (!user) throw ApiError.notFound('Pengguna tidak ditemukan.');
    await assignCard(body.userId, body.cardUid);
    await audit({
      userId: request.user!.id,
      action: 'CARD_ASSIGNED',
      entity: 'CardCredential',
      entityId: body.userId,
      request,
    });
    return reply.send({ success: true, message: 'Kartu berhasil didaftarkan.' });
  });

  // Hapus kartu
  app.delete('/cards/:userId', { preHandler: app.requirePermission(PERMISSION_KEYS.attendanceManage) }, async (request, reply) => {
    const { userId } = request.params as { userId: string };
    await removeCard(userId);
    await audit({
      userId: request.user!.id,
      action: 'CARD_REMOVED',
      entity: 'CardCredential',
      entityId: userId,
      request,
    });
    return reply.send({ success: true, message: 'Kartu dihapus.' });
  });
}
