import type { FastifyInstance } from 'fastify';
import crypto from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { validate } from '../utils/validate.js';
import { audit } from '../lib/audit.js';
import { ApiError } from '../utils/errors.js';
import { PERMISSION_KEYS } from '../rbac/permissions.js';

// Get SDMS settings from database
async function getSDMSSettings() {
  const row = await prisma.schoolSetting.findUnique({ where: { key: 'sdms' } });
  return (row?.value as Record<string, unknown>) || {};
}

// Verify HMAC-SHA256 signature
function verifySignature(payload: unknown, signature: string, secret: string): boolean {
  const expected = crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(payload))
    .digest('hex');
  return signature === expected;
}

// Upsert siswa from SDMS payload
async function upsertSiswa(payload: Record<string, unknown>) {
  const nisn = payload.nisn as string;
  const nama = payload.nama as string;
  const nis = payload.nis as string | undefined;
  const kelasId = payload.kelas_id as string | undefined;
  const jurusanId = payload.jurusan_id as string | undefined;
  const status = payload.status as string;

  // Find or create student by NISN
  const existing = await prisma.student.findFirst({ where: { nis: nisn } });
  
  if (existing) {
    // Update existing student
    await prisma.student.update({
      where: { id: existing.id },
      data: {
        isActive: status === 'Aktif',
        // Update user name if needed
        user: {
          update: { fullName: nama }
        }
      }
    });
    return { action: 'updated', id: existing.id };
  }

  // Create new student
  const user = await prisma.user.create({
    data: {
      username: nisn,
      passwordHash: crypto.createHash('sha256').update('smkn1kras').digest('hex'),
      fullName: nama,
      roleId: (await prisma.role.findFirst({ where: { key: 'STUDENT' } }))!.id,
      isActive: status === 'Aktif',
    }
  });

  await prisma.student.create({
    data: {
      userId: user.id,
      nis: nisn,
      classId: kelasId || undefined,
      majorId: jurusanId || undefined,
    }
  });

  return { action: 'created', id: user.id };
}

// Upsert guru from SDMS payload
async function upsertGuru(payload: Record<string, unknown>) {
  const nip = payload.nip as string;
  const nama = payload.nama as string;
  const status = payload.status as string;

  const existing = await prisma.teacher.findFirst({ where: { nip } });
  
  if (existing) {
    await prisma.teacher.update({
      where: { id: existing.id },
      data: { isActive: status === 'Aktif' }
    });
    if (existing.userId) {
      await prisma.user.update({
        where: { id: existing.userId },
        data: { fullName: nama }
      });
    }
    return { action: 'updated', id: existing.id };
  }

  const user = await prisma.user.create({
    data: {
      username: nip,
      passwordHash: crypto.createHash('sha256').update('smkn1kras').digest('hex'),
      fullName: nama,
      roleId: (await prisma.role.findFirst({ where: { key: 'TEACHER' } }))!.id,
      isActive: status === 'Aktif',
    }
  });

  await prisma.teacher.create({
    data: {
      userId: user.id,
      nip,
    }
  });

  return { action: 'created', id: user.id };
}

// Upsert kelas from SDMS payload
async function upsertKelas(payload: Record<string, unknown>) {
  const nama = payload.nama as string;
  const grade = payload.grade as string | undefined;
  const jurusanId = payload.jurusan_id as string | undefined;

  const existing = await prisma.class.findFirst({ where: { name: nama } });
  
  if (existing) {
    return { action: 'updated', id: existing.id };
  }

  const academicYear = await prisma.academicYear.findFirst({ where: { isActive: true } });
  const kelas = await prisma.class.create({
    data: {
      name: nama,
      grade: grade || nama.split('-')[0] || 'X',
      majorId: jurusanId || undefined,
      academicYearId: academicYear?.id || undefined,
    }
  });

  return { action: 'created', id: kelas.id };
}

export async function sdmsRoutes(app: FastifyInstance) {
  // Webhook endpoint - terima event dari SDMS
  app.post('/webhooks/sdms', async (request, reply) => {
    const settings = await getSDMSSettings();
    const apiSecret = settings.apiSecret as string | undefined;
    
    if (!apiSecret) {
      return reply.status(400).send({ error: 'SDMS not configured' });
    }

    // Verify signature
    const signature = request.headers['x-api-signature'] as string | undefined;
    if (!signature || !verifySignature(request.body, signature, apiSecret)) {
      return reply.status(401).send({ error: 'Invalid signature' });
    }

    const { event, payload } = request.body as { event: string; payload: Record<string, unknown> };

    try {
      switch (event) {
        case 'siswa.created':
        case 'siswa.updated':
          await upsertSiswa(payload);
          break;
        case 'siswa.deleted':
          // Mark student as inactive
          if (payload.id) {
            const student = await prisma.student.findFirst({ where: { nis: payload.id as string } });
            if (student) {
              await prisma.student.update({ where: { id: student.id }, data: { isActive: false } });
            }
          }
          break;
        case 'guru.created':
        case 'guru.updated':
          await upsertGuru(payload);
          break;
        case 'guru.deleted':
          if (payload.nip) {
            const teacher = await prisma.teacher.findFirst({ where: { nip: payload.nip as string } });
            if (teacher) {
              await prisma.teacher.update({ where: { id: teacher.id }, data: { isActive: false } });
            }
          }
          break;
        case 'kelas.created':
        case 'kelas.updated':
          await upsertKelas(payload);
          break;
        case 'bulk.sync':
          // Bulk sync - process all items
          const items = payload.items as Array<{ event: string; payload: Record<string, unknown> }>;
          if (items && Array.isArray(items)) {
            for (const item of items) {
              if (item.event.startsWith('siswa.')) await upsertSiswa(item.payload);
              if (item.event.startsWith('guru.')) await upsertGuru(item.payload);
              if (item.event.startsWith('kelas.')) await upsertKelas(item.payload);
            }
          }
          break;
        default:
          // Unknown event - ignore
          break;
      }

      // Log sync
      const webhookData = { lastWebhook: new Date().toISOString(), event };
      await prisma.schoolSetting.upsert({
        where: { key: 'sdms_last_sync' },
        update: { value: webhookData },
        create: { key: 'sdms_last_sync', value: webhookData },
      });

      return reply.send({ status: 'ok' });
    } catch (error) {
      console.error('SDMS webhook error:', error);
      return reply.status(500).send({ error: 'Internal error' });
    }
  });

  // Get SDMS settings
  app.get('/sdms/settings', { preHandler: app.requirePermission(PERMISSION_KEYS.settingsManage) }, async (_request, reply) => {
    const settings = await getSDMSSettings();
    const lastSync = await prisma.schoolSetting.findUnique({ where: { key: 'sdms_last_sync' } });
    return reply.send({
      success: true,
      data: {
        apiKey: settings.apiKey || '',
        apiSecret: settings.apiSecret || '',
        apiBaseUrl: settings.apiBaseUrl || 'https://sdms.sekolah.id/api/v1/master',
        webhookUrl: settings.webhookUrl || '',
        syncEnabled: settings.syncEnabled ?? true,
        lastSync: lastSync?.value || null,
      }
    });
  });

  // Update SDMS settings
  app.put('/sdms/settings', { preHandler: app.requirePermission(PERMISSION_KEYS.settingsManage) }, async (request, reply) => {
    const body = validate(
      z.object({
        apiKey: z.string().min(1),
        apiSecret: z.string().min(1),
        apiBaseUrl: z.string().url().optional().or(z.literal('')),
        webhookUrl: z.string().url().optional().or(z.literal('')),
        syncEnabled: z.boolean(),
      }),
      request.body,
    );

    await prisma.schoolSetting.upsert({
      where: { key: 'sdms' },
      update: {
        value: body as object,
        updatedById: request.user!.id,
      },
      create: {
        key: 'sdms',
        value: body as object,
        updatedById: request.user!.id,
      },
    });

    await audit({
      userId: request.user!.id,
      action: 'SDMS_SETTINGS_UPDATED',
      entity: 'SchoolSetting',
      newValue: body,
      request,
    });

    return reply.send({ success: true, message: 'Pengaturan SDMS disimpan.' });
  });

  // Manual sync - pull data from SDMS
  app.post('/sdms/sync', { preHandler: app.requirePermission(PERMISSION_KEYS.settingsManage) }, async (request, reply) => {
    const settings = await getSDMSSettings();
    const apiKey = settings.apiKey as string;
    const apiSecret = settings.apiSecret as string;

    if (!apiKey || !apiSecret) {
      throw ApiError.badRequest('SDMS_NOT_CONFIGURED', 'Konfigurasi SDMS belum lengkap.');
    }

    const baseUrl = (settings.apiBaseUrl as string) || 'https://sdms.sekolah.id/api/v1/master';
    // Try API Key as Bearer first, then API Secret
    const headers = {
      'Authorization': `Bearer ${apiKey}`,
      'X-API-Key': apiKey,
    };

    const results: Record<string, unknown> = { students: 0, teachers: 0, classes: 0, errors: [] };

    try {
      // Sync siswa
      const siswaRes = await fetch(`${baseUrl}/siswa?limit=1000`, { headers });
      if (siswaRes.ok) {
        const { data: siswaData } = await siswaRes.json() as { data: Array<Record<string, unknown>> };
        for (const s of siswaData || []) {
          try {
            await upsertSiswa(s);
            results.students = (results.students as number) + 1;
          } catch (e) {
            (results.errors as string[]).push(`Siswa ${s.nisn}: ${e}`);
          }
        }
      }

      // Sync guru
      const guruRes = await fetch(`${baseUrl}/guru?limit=500`, { headers });
      if (guruRes.ok) {
        const { data: guruData } = await guruRes.json() as { data: Array<Record<string, unknown>> };
        for (const g of guruData || []) {
          try {
            await upsertGuru(g);
            results.teachers = (results.teachers as number) + 1;
          } catch (e) {
            (results.errors as string[]).push(`Guru ${g.nip}: ${e}`);
          }
        }
      }

      // Sync kelas
      const kelasRes = await fetch(`${baseUrl}/kelas?limit=200`, { headers });
      if (kelasRes.ok) {
        const { data: kelasData } = await kelasRes.json() as { data: Array<Record<string, unknown>> };
        for (const k of kelasData || []) {
          try {
            await upsertKelas(k);
            results.classes = (results.classes as number) + 1;
          } catch (e) {
            (results.errors as string[]).push(`Kelas ${k.nama}: ${e}`);
          }
        }
      }

      // Update last sync
      const syncData = { lastPull: new Date().toISOString(), results: results as unknown as object };
      await prisma.schoolSetting.upsert({
        where: { key: 'sdms_last_sync' },
        update: { value: syncData },
        create: { key: 'sdms_last_sync', value: syncData },
      });

      await audit({
        userId: request.user!.id,
        action: 'SDMS_MANUAL_SYNC',
        entity: 'SchoolSetting',
        newValue: results,
        request,
      });

      return reply.send({ success: true, message: 'Sinkronisasi selesai.', data: results });
    } catch (error) {
      throw ApiError.badRequest('SYNC_FAILED', `Gagal sinkronisasi: ${error}`);
    }
  });

  // Test webhook connection
  app.post('/sdms/test', { preHandler: app.requirePermission(PERMISSION_KEYS.settingsManage) }, async (request, reply) => {
    const settings = await getSDMSSettings();
    const apiKey = settings.apiKey as string;
    const apiSecret = settings.apiSecret as string;

    if (!apiKey || !apiSecret) {
      throw ApiError.badRequest('SDMS_NOT_CONFIGURED', 'Konfigurasi SDMS belum lengkap.');
    }

    // Try to fetch a small amount of data to verify connection
    const baseUrl = (settings.apiBaseUrl as string) || 'https://sdms.sekolah.id/api/v1/master';
    
    // Try multiple auth methods
    const authMethods = [
      // Method 1: API Key as Bearer token
      { headers: { 'Authorization': `Bearer ${apiKey}`, 'X-API-Key': apiKey } },
      // Method 2: API Secret as Bearer token (original)
      { headers: { 'Authorization': `Bearer ${apiSecret}`, 'X-API-Key': apiKey } },
      // Method 3: Only X-API-Key header
      { headers: { 'X-API-Key': apiKey } },
    ];

    let lastError = '';
    for (const auth of authMethods) {
      try {
        const res = await fetch(`${baseUrl}/siswa?limit=1`, auth);
        if (res.ok) {
          return reply.send({ success: true, message: 'Koneksi ke SDMS berhasil.' });
        }
        const text = await res.text().catch(() => '');
        lastError = `${res.status}: ${text.slice(0, 150)}`;
      } catch (error: unknown) {
        lastError = error instanceof Error ? error.message : String(error);
      }
    }
    return reply.status(400).send({ success: false, message: `SDMS mengembalikan error: ${lastError}` });
  });
}
