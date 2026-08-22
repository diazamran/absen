import type { FastifyInstance } from 'fastify';
import crypto from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { validate } from '../utils/validate.js';
import { audit } from '../lib/audit.js';
import { ApiError } from '../utils/errors.js';
import { PERMISSION_KEYS } from '../rbac/permissions.js';

// SDMS access token cache (in-memory, per-process)
let cachedToken: string | null = null;
let tokenExpiresAt = 0;

// Get SDMS settings from database
async function getSDMSSettings() {
  const row = await prisma.schoolSetting.findUnique({ where: { key: 'sdms' } });
  return (row?.value as Record<string, unknown>) || {};
}

// Login to SDMS and get access token
async function sdmsLogin(baseUrl: string, username: string, password: string): Promise<string> {
  const baseClean = baseUrl.replace(/\/api\/v1\/master.*$/, '').replace(/\/api\/v1\/.*$/, '').replace(/\/api\/.*$/, '').replace(/\/$/, '');
  const loginPaths = [
    '/api/v1/auth/login',
    '/api/auth/login',
    '/auth/login',
  ];

  for (const path of loginPaths) {
    try {
      const res = await fetch(`${baseClean}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      if (res.ok) {
        const json = await res.json() as Record<string, unknown>;
        const data = json.data as Record<string, unknown> | undefined;
        const token = (data?.access_token as string) || (json.access_token as string) || '';
        if (token) return token;
      }
    } catch { /* try next */ }
  }
  throw new Error('Gagal login ke SDMS — semua endpoint login gagal');
}

// Get valid SDMS token (auto-login & refresh)
async function getSDMSToken(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiresAt - 300000) {
    return cachedToken;
  }

  const settings = await getSDMSSettings();
  const baseUrl = (settings.sdmsBaseUrl as string) || 'https://sdms.smkn1kras.sch.id/api/v1/master';
  const username = settings.sdmsUsername as string;
  const password = settings.sdmsPassword as string;

  if (!username || !password) {
    throw new Error('Konfigurasi SDMS belum lengkap (username/password)');
  }

  const token = await sdmsLogin(baseUrl, username, password);
  cachedToken = token;
  tokenExpiresAt = Date.now() + 28800000; // 8 hours
  return token;
}

// Verify HMAC-SHA256 signature (for webhooks)
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
  const kelasId = payload.kelas_id as string | undefined;
  const jurusanId = payload.jurusan_id as string | undefined;
  const status = payload.status as string;

  const existing = await prisma.student.findFirst({ where: { nis: nisn } });
  
  if (existing) {
    await prisma.student.update({
      where: { id: existing.id },
      data: {
        isActive: status === 'Aktif',
        user: { update: { fullName: nama } }
      }
    });
    return { action: 'updated', id: existing.id };
  }

  let classId: string | undefined;
  if (kelasId) {
    const kelas = await prisma.class.findFirst({ where: { id: kelasId } });
    if (kelas) classId = kelas.id;
  }

  let majorId: string | undefined;
  if (jurusanId) {
    const jurusan = await prisma.major.findFirst({ where: { id: jurusanId } });
    if (jurusan) majorId = jurusan.id;
  }

  const userId = crypto.randomUUID();
  const studentId = crypto.randomUUID();

  await prisma.user.create({
    data: {
      id: userId,
      username: nisn,
      fullName: nama,
      role: { connect: { key: 'STUDENT' } },
      passwordHash: '$2b$10$placeholder',
    },
  });

  await prisma.student.create({
    data: {
      id: studentId,
      userId,
      nis: nisn,
      classId,
      majorId,
      isActive: status === 'Aktif',
    },
  });

  return { action: 'created', id: studentId };
}

// Upsert guru from SDMS payload
async function upsertGuru(payload: Record<string, unknown>) {
  const nip = payload.nip as string;
  const nama = payload.nama as string;

  const existing = await prisma.teacher.findFirst({ where: { nip } });
  if (existing) {
    await prisma.teacher.update({
      where: { id: existing.id },
      data: {
        isActive: true,
        user: { update: { fullName: nama } }
      }
    });
    return { action: 'updated', id: existing.id };
  }

  const userId = crypto.randomUUID();
  const teacherId = crypto.randomUUID();

  await prisma.user.create({
    data: {
      id: userId,
      username: nip,
      fullName: nama,
      role: { connect: { key: 'TEACHER' } },
      passwordHash: '$2b$10$placeholder',
    },
  });

  await prisma.teacher.create({
    data: {
      id: teacherId,
      userId,
      nip,
      isActive: true,
    },
  });

  return { action: 'created', id: teacherId };
}

// Upsert kelas from SDMS payload
async function upsertKelas(payload: Record<string, unknown>) {
  const nama = payload.nama as string;
  const majorId = payload.major_id as string | undefined;
  const grade = payload.grade as string | undefined;

  const existing = await prisma.class.findFirst({ where: { name: nama } });
  if (existing) {
    return { action: 'exists', id: existing.id };
  }

  const id = crypto.randomUUID();
  await prisma.class.create({
    data: {
      id,
      name: nama,
      grade: grade || 'X',
      majorId: majorId || undefined,
    },
  });

  return { action: 'created', id };
}

export async function sdmsRoutes(app: FastifyInstance) {
  // Register webhook endpoint (no auth — called by SDMS)
  app.post('/webhooks/sdms', async (request, reply) => {
    try {
      const settings = await getSDMSSettings();
      const body = request.body as Record<string, unknown>;
      const event = body.event as string;
      const payload = body.payload as Record<string, unknown>;

      const secret = settings.webhookSecret as string | undefined;
      if (secret) {
        const signature = (request.headers['x-signature'] as string) || '';
        if (!verifySignature(payload, signature, secret)) {
          return reply.status(401).send({ error: 'Invalid signature' });
        }
      }

      switch (event) {
        case 'siswa.created':
        case 'siswa.updated':
          await upsertSiswa(payload);
          break;
        case 'siswa.deleted':
          if (payload.nisn) {
            const student = await prisma.student.findFirst({ where: { nis: payload.nisn as string } });
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
          break;
      }

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
        sdmsUsername: settings.sdmsUsername || '',
        sdmsPassword: settings.sdmsPassword ? '••••••••' : '',
        sdmsBaseUrl: settings.sdmsBaseUrl || 'https://sdms.smkn1kras.sch.id/api/v1/master',
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
        sdmsUsername: z.string().min(1),
        sdmsPassword: z.string().min(1),
        sdmsBaseUrl: z.string().optional().or(z.literal('')),
        webhookUrl: z.string().optional().or(z.literal('')),
        syncEnabled: z.boolean(),
      }),
      request.body,
    );

    const current = await getSDMSSettings();
    const toSave: Record<string, unknown> = {
      ...body,
      sdmsPassword: body.sdmsPassword === '••••••••' ? (current.sdmsPassword as string) : body.sdmsPassword,
    };

    await prisma.schoolSetting.upsert({
      where: { key: 'sdms' },
      update: {
        value: toSave as object,
        updatedById: request.user!.id,
      },
      create: {
        key: 'sdms',
        value: toSave as object,
        updatedById: request.user!.id,
      },
    });

    cachedToken = null;
    tokenExpiresAt = 0;

    await audit({
      userId: request.user!.id,
      action: 'SDMS_SETTINGS_UPDATED',
      entity: 'SchoolSetting',
      newValue: { ...toSave, sdmsPassword: '***' },
      request,
    });

    return reply.send({ success: true, message: 'Pengaturan SDMS disimpan.' });
  });

  // Test connection — login to SDMS and fetch sample data
  app.post('/sdms/test', { preHandler: app.requirePermission(PERMISSION_KEYS.settingsManage) }, async (_request, reply) => {
    const settings = await getSDMSSettings();
    const username = settings.sdmsUsername as string;
    const password = (settings.sdmsPassword === '••••••••' ? null : settings.sdmsPassword) as string | null;
    const actualPassword = password || (await getSDMSSettings()).sdmsPassword as string;

    if (!username || !actualPassword) {
      throw ApiError.badRequest('SDMS_NOT_CONFIGURED', 'Konfigurasi SDMS belum lengkap (username/password).');
    }

    const baseUrl = (settings.sdmsBaseUrl as string) || 'https://sdms.smkn1kras.sch.id/api/v1/master';

    try {
      const token = await sdmsLogin(baseUrl, username, actualPassword);

      const res = await fetch(`${baseUrl}/siswa?limit=1`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });

      if (res.ok) {
        const json = await res.json() as Record<string, unknown>;
        const meta = json.meta as Record<string, unknown> | undefined;
        const total = meta?.total || 0;
        return reply.send({
          success: true,
          message: `Koneksi ke SDMS berhasil! Login OK, ${total} siswa terdaftar.`,
          data: { totalStudents: total, tokenValid: true },
        });
      }

      const text = await res.text().catch(() => '');
      return reply.status(400).send({
        success: false,
        message: `Login berhasil tapi gagal ambil data: ${res.status} ${text.slice(0, 200)}`,
      });
    } catch (err: unknown) {
      return reply.status(400).send({
        success: false,
        message: `Gagal koneksi ke SDMS: ${err instanceof Error ? err.message : 'unknown error'}`,
      });
    }
  });

  // Manual sync — pull all data from SDMS
  app.post('/sdms/sync', { preHandler: app.requirePermission(PERMISSION_KEYS.settingsManage) }, async (request, reply) => {
    const settings = await getSDMSSettings();
    const username = settings.sdmsUsername as string;
    const password = (settings.sdmsPassword === '••••••••' ? null : settings.sdmsPassword) as string | null;
    const actualPassword = password || (await getSDMSSettings()).sdmsPassword as string;

    if (!username || !actualPassword) {
      throw ApiError.badRequest('SDMS_NOT_CONFIGURED', 'Konfigurasi SDMS belum lengkap.');
    }

    const baseUrl = (settings.sdmsBaseUrl as string) || 'https://sdms.smkn1kras.sch.id/api/v1/master';

    let token: string;
    try {
      token = await sdmsLogin(baseUrl, username, actualPassword);
    } catch (err: unknown) {
      throw ApiError.badRequest('SDMS_LOGIN_FAILED', `Gagal login ke SDMS: ${err instanceof Error ? err.message : 'unknown error'}`);
    }

    const headers = { 'Authorization': `Bearer ${token}` };
    const results: Record<string, unknown> = { students: 0, teachers: 0, classes: 0, errors: [] as string[] };

    try {
      // Sync siswa (paginated)
      let page = 1;
      let hasMore = true;
      while (hasMore) {
        const siswaRes = await fetch(`${baseUrl}/siswa?limit=500&page=${page}`, { headers });
        if (siswaRes.ok) {
          const json = await siswaRes.json() as { data: Array<Record<string, unknown>>; meta: { totalPages: number } };
          const data = json.data || [];
          for (const s of data) {
            try {
              await upsertSiswa(s);
              (results.students as number)++;
            } catch (e) {
              (results.errors as string[]).push(`Siswa ${s.nisn}: ${e}`);
            }
          }
          hasMore = page < (json.meta?.totalPages || 1);
          page++;
        } else {
          hasMore = false;
        }
      }

      // Sync guru
      page = 1;
      hasMore = true;
      while (hasMore) {
        const guruRes = await fetch(`${baseUrl}/guru?limit=500&page=${page}`, { headers });
        if (guruRes.ok) {
          const json = await guruRes.json() as { data: Array<Record<string, unknown>>; meta: { totalPages: number } };
          const data = json.data || [];
          for (const g of data) {
            try {
              await upsertGuru(g);
              (results.teachers as number)++;
            } catch (e) {
              (results.errors as string[]).push(`Guru ${g.nip}: ${e}`);
            }
          }
          hasMore = page < (json.meta?.totalPages || 1);
          page++;
        } else {
          hasMore = false;
        }
      }

      // Sync kelas
      const kelasRes = await fetch(`${baseUrl}/kelas?limit=500`, { headers });
      if (kelasRes.ok) {
        const json = await kelasRes.json() as { data: Array<Record<string, unknown>> };
        for (const k of json.data || []) {
          try {
            await upsertKelas(k);
            (results.classes as number)++;
          } catch (e) {
            (results.errors as string[]).push(`Kelas ${(k as Record<string, unknown>).nama}: ${e}`);
          }
        }
      }

      const syncData = { lastPull: new Date().toISOString(), results };
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
}
