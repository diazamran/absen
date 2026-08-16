import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { validate } from '../utils/validate.js';
import { audit } from '../lib/audit.js';
import { PERMISSION_KEYS } from '../rbac/permissions.js';
import { getBranding, getAttendanceRules } from '../services/settings.js';

export async function settingRoutes(app: FastifyInstance) {
  // Publik: branding + aturan (tanpa auth)
  app.get('/settings/public', async (_request, reply) => {
    const branding = await getBranding();
    const rules = await getAttendanceRules();
    return reply.send({ success: true, data: { branding, rules } });
  });

  app.get('/settings', { preHandler: app.requirePermission(PERMISSION_KEYS.settingsManage) }, async (_request, reply) => {
    const rows = await prisma.schoolSetting.findMany();
    const school = await prisma.school.findFirst();
    const map: Record<string, unknown> = {};
    for (const r of rows) map[r.key] = r.value;
    return reply.send({ success: true, data: { ...map, school } });
  });

  app.put('/settings', { preHandler: app.requirePermission(PERMISSION_KEYS.settingsManage) }, async (request, reply) => {
    const body = validate(
      z.object({
        branding: z.record(z.unknown()).optional(),
        attendanceRules: z.record(z.unknown()).optional(),
        notifications: z.record(z.unknown()).optional(),
        school: z.record(z.unknown()).optional(),
      }),
      request.body,
    );

    const updated: string[] = [];
    for (const key of ['branding', 'attendanceRules', 'notifications'] as const) {
      if (body[key]) {
        await prisma.schoolSetting.upsert({
          where: { key },
          update: { value: body[key] as object, updatedById: request.user!.id },
          create: { key, value: body[key] as object, updatedById: request.user!.id },
        });
        updated.push(key);
      }
    }
    if (body.school) {
      await prisma.school.updateMany({ data: { ...(body.school as object), updatedAt: new Date() } });
      updated.push('school');
    }

    await audit({
      userId: request.user!.id,
      action: 'SETTING_CHANGED',
      entity: 'SchoolSetting',
      newValue: body,
      request,
    });

    return reply.send({ success: true, message: 'Pengaturan disimpan.', data: { updated } });
  });
}
