import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { validate } from '../utils/validate.js';
import { audit } from '../lib/audit.js';
import { ApiError } from '../utils/errors.js';
import { PERMISSION_KEYS } from '../rbac/permissions.js';
import { getBranding, getAttendanceRules } from '../services/settings.js';
import { storage, MAX_UPLOAD_SIZE } from '../services/storage.js';

const LOGO_MIME = ['image/jpeg', 'image/png', 'image/webp'];

/** Hapus file lama milik upload lokal bila logo diganti/dihapus. */
async function cleanupLogoFile(url: unknown): Promise<void> {
  if (typeof url === 'string' && url.startsWith('/uploads/')) {
    await storage.delete(url).catch(() => {});
  }
}

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

    // Hapus file logo lama bila branding menghapus logoUrl
    if (body.branding && (body.branding as Record<string, unknown>).logoUrl == null) {
      const prev = await prisma.schoolSetting.findUnique({ where: { key: 'branding' } });
      await cleanupLogoFile((prev?.value as Record<string, unknown> | null)?.logoUrl);
    }

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

  // Upload logo sekolah (multipart) — dipakai di kop kartu QR, login, dan PWA
  app.post('/settings/logo', { preHandler: app.requirePermission(PERMISSION_KEYS.settingsManage) }, async (request, reply) => {
    const data = await request.file();
    if (!data) throw ApiError.badRequest('FILE_REQUIRED', 'Pilih file logo terlebih dahulu.');
    if (data.file.truncated || data.file.bytesRead > MAX_UPLOAD_SIZE) {
      throw ApiError.badRequest('FILE_TOO_LARGE', 'Ukuran file maksimal 5 MB.');
    }
    if (!LOGO_MIME.includes(data.mimetype)) {
      throw ApiError.badRequest('INVALID_FILE_TYPE', 'Format logo harus JPG, PNG, atau WEBP.');
    }
    const buffer = await data.toBuffer();
    const url = await storage.save(buffer, data.mimetype, 'logos');

    // Hapus logo lama bila sebelumnya diunggah lokal
    const row = await prisma.schoolSetting.findUnique({ where: { key: 'branding' } });
    await cleanupLogoFile((row?.value as Record<string, unknown> | null)?.logoUrl);

    const value = { ...((row?.value as Record<string, unknown>) || {}), logoUrl: url };
    await prisma.schoolSetting.upsert({
      where: { key: 'branding' },
      update: { value, updatedById: request.user!.id },
      create: { key: 'branding', value, updatedById: request.user!.id },
    });

    await audit({
      userId: request.user!.id,
      action: 'LOGO_UPDATED',
      entity: 'SchoolSetting',
      newValue: { url },
      request,
    });

    return reply.send({ success: true, message: 'Logo sekolah berhasil diunggah.', data: { url } });
  });
}
