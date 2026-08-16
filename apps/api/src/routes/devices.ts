import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { validate } from '../utils/validate.js';
import { setDeviceStatus } from '../services/auth.js';
import { PERMISSION_KEYS } from '../rbac/permissions.js';

export async function deviceRoutes(app: FastifyInstance) {
  // Daftarkan perangkat (dipanggil frontend setelah login)
  app.post('/devices/register', { preHandler: app.authenticate }, async (request, reply) => {
    const body = validate(
      z.object({
        deviceId: z.string().min(1),
        name: z.string().optional(),
        browser: z.string().optional(),
        os: z.string().optional(),
      }),
      request.body,
    );
    const existing = await prisma.device.findUnique({ where: { deviceId: body.deviceId } });
    const wasBlocked = existing?.status === 'BLOCKED';
    if (wasBlocked) {
      return reply.status(403).send({
        success: false,
        message: 'Perangkat ini diblokir. Hubungi admin sekolah.',
        code: 'DEVICE_BLOCKED',
      });
    }
    const device = await prisma.device.upsert({
      where: { deviceId: body.deviceId },
      update: {
        userId: request.user!.id,
        name: body.name,
        browser: body.browser,
        os: body.os,
        ip: request.ip,
        lastSeenAt: new Date(),
        status: wasBlocked ? 'BLOCKED' : 'ONLINE',
      },
      create: {
        deviceId: body.deviceId,
        userId: request.user!.id,
        name: body.name || 'Perangkat',
        browser: body.browser,
        os: body.os,
        ip: request.ip,
        lastSeenAt: new Date(),
        status: 'ONLINE',
      },
    });
    return reply.send({ success: true, data: { id: device.id, status: device.status } });
  });

  app.get('/devices', { preHandler: app.requirePermission(PERMISSION_KEYS.devicesManage) }, async (_request, reply) => {
    const rows = await prisma.device.findMany({
      include: { user: { select: { fullName: true, username: true } } },
      orderBy: { lastSeenAt: 'desc' },
      take: 200,
    });
    return reply.send({
      success: true,
      data: rows.map((d) => ({
        deviceId: d.deviceId,
        name: d.name,
        browser: d.browser,
        os: d.os,
        ip: d.ip,
        lastSeenAt: d.lastSeenAt,
        status: d.status,
        userName: d.user?.fullName ?? null,
        username: d.user?.username ?? null,
        createdAt: d.createdAt,
      })),
    });
  });

  app.post('/devices/:deviceId/block', { preHandler: app.requirePermission(PERMISSION_KEYS.devicesManage) }, async (request, reply) => {
    const { deviceId } = request.params as { deviceId: string };
    await setDeviceStatus(deviceId, 'BLOCKED', request.user!.id, request);
    return reply.send({ success: true, message: 'Perangkat diblokir.' });
  });

  app.post('/devices/:deviceId/unblock', { preHandler: app.requirePermission(PERMISSION_KEYS.devicesManage) }, async (request, reply) => {
    const { deviceId } = request.params as { deviceId: string };
    await setDeviceStatus(deviceId, 'ONLINE', request.user!.id, request);
    return reply.send({ success: true, message: 'Perangkat diaktifkan kembali.' });
  });
}
