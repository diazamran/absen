import type { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { PERMISSION_KEYS } from '../rbac/permissions.js';

export async function notificationRoutes(app: FastifyInstance) {
  app.get('/notifications', { preHandler: app.requirePermission(PERMISSION_KEYS.notificationsRead) }, async (request, reply) => {
    const rows = await prisma.notification.findMany({
      where: { userId: request.user!.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    const unread = await prisma.notification.count({
      where: { userId: request.user!.id, readAt: null },
    });
    return reply.send({ success: true, data: { unread, items: rows } });
  });

  app.post('/notifications/read/:id', { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    await prisma.notification.updateMany({
      where: { id, userId: request.user!.id },
      data: { readAt: new Date() },
    });
    return reply.send({ success: true });
  });

  app.post('/notifications/read-all', { preHandler: app.authenticate }, async (request, reply) => {
    await prisma.notification.updateMany({
      where: { userId: request.user!.id, readAt: null },
      data: { readAt: new Date() },
    });
    return reply.send({ success: true });
  });
}
