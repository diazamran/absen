import type { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { PERMISSION_KEYS } from '../rbac/permissions.js';

export async function auditRoutes(app: FastifyInstance) {
  app.get('/audit', { preHandler: app.requirePermission(PERMISSION_KEYS.auditRead) }, async (request, reply) => {
    const q = request.query as { action?: string; page?: string; pageSize?: string };
    const page = Math.max(1, Number(q.page) || 1);
    const pageSize = Math.min(100, Number(q.pageSize) || 25);
    const where = q.action ? { action: q.action } : {};
    const [total, rows] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where,
        include: { user: { select: { fullName: true, username: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return reply.send({
      success: true,
      data: rows.map((r) => ({
        id: r.id,
        action: r.action,
        entity: r.entity,
        entityId: r.entityId,
        oldValue: r.oldValue,
        newValue: r.newValue,
        ipAddress: r.ipAddress,
        userAgent: r.userAgent,
        userName: r.user?.fullName ?? null,
        username: r.user?.username ?? null,
        createdAt: r.createdAt,
      })),
      meta: { total, page, pageSize },
    });
  });
}
