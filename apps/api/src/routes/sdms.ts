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

// Helper: find or create major by SDMS jurusan data
async function findMajorFromSDMS(jurusan: Record<string, unknown> | undefined): Promise<string | undefined> {
  if (!jurusan) return undefined;
  const jurusanName = jurusan.nama as string;
  const jurusanKode = jurusan.kode as string;
  if (!jurusanName) return undefined;

  // Try to find existing major by name (case-insensitive)
  let major = await prisma.major.findFirst({
    where: { name: { contains: jurusanName, mode: 'insensitive' } },
  });
  // Also try by code
  if (!major && jurusanKode) {
    major = await prisma.major.findFirst({
      where: { code: jurusanKode },
    });
  }
  // If not found, try partial match (e.g. 'TKJ' matches 'Teknik Komputer dan Jaringan')
  if (!major && jurusanKode) {
    major = await prisma.major.findFirst({
      where: { name: { contains: jurusanKode, mode: 'insensitive' } },
    });
  }
  if (!major) {
    // Create new major
    major = await prisma.major.create({
      data: { name: jurusanName, code: jurusanKode || jurusanName.toUpperCase().slice(0, 5) },
    });
  }
  return major.id;
}

// Helper: normalize class name for fuzzy matching
// "X KULINER 1" → "X-KULINER-1", "XI TKR 1" → "XI-TKR-1"
function normalizeClassName(name: string): string {
  return name
    .toUpperCase()
    .replace(/\s+/g, '-')     // spasi → strip
    .replace(/-+/g, '-')      // double strip → single
    .replace(/^-|-$/g, '');    // hapus strip awal/akhir
}

// Class cache — loaded once per sync,避免 repeated queries
type ClassInfo = { id: string; name: string; normalizedName: string; grade: string; majorName: string; number: string };
let classCache: ClassInfo[] | null = null;

async function getClassCache(): Promise<ClassInfo[]> {
  if (classCache) return classCache;
  const all = await prisma.class.findMany({ select: { id: true, name: true } });
  classCache = all.map((c) => {
    const n = normalizeClassName(c.name);
    // Extract: "X-KULINER-1" → grade=X, majorName=KULINER, number=1
    const parts = n.split('-');
    return {
      id: c.id,
      name: c.name,
      normalizedName: n,
      grade: parts[0] || '',
      majorName: parts[1] || '',
      number: parts[2] || '',
    };
  });
  return classCache;
}

function clearClassCache() { classCache = null; }

// Helper: find class by fuzzy name match (uses cache)
async function findClassByName(sdmaName: string): Promise<string | undefined> {
  if (!sdmaName) return undefined;
  const normalized = normalizeClassName(sdmaName);
  const cache = await getClassCache();

  // 1. Exact match
  const exact = cache.find((c) => c.name === sdmaName);
  if (exact) return exact.id;

  // 2. Normalized match
  const normMatch = cache.find((c) => c.normalizedName === normalized);
  if (normMatch) return normMatch.id;

  // 3. Parse SDMS name: "X KULINER 1" → grade=X, major=KULINER, num=1
  const sdmsParts = normalized.split('-');
  const sdmsGrade = sdmsParts[0] || '';
  const sdmsMajor = sdmsParts[1] || '';
  const sdmsNum = sdmsParts[2] || '';

  // Find class with SAME grade + major + number
  const partial = cache.find((c) => {
    return c.grade === sdmsGrade && c.majorName === sdmsMajor && c.number === sdmsNum;
  });
  if (partial) return partial.id;

  // 4. Last resort: same grade + major (any number) — only if exact number not found
  // This prevents wrong matching (e.g. "X KULINER 1" → "X KULINER 2")
  // Skip this to avoid false positives

  return undefined;
}

// Helper: find teacher by SDMS waliKelas name
async function findTeacherByName(nama: string): Promise<{ teacherId: string; userId: string } | undefined> {
  if (!nama) return undefined;
  // Find user with matching full name and TEACHER role
  const user = await prisma.user.findFirst({
    where: {
      fullName: { contains: nama, mode: 'insensitive' },
      role: { key: 'TEACHER' },
    },
    include: { teacher: true },
  });
  if (!user?.teacher) return undefined;
  return { teacherId: user.teacher.id, userId: user.id };
}

// Helper: add HOMEROOM_TEACHER role to teacher's user (fire-and-forget)
async function ensureHomeroomRole(userId: string): Promise<void> {
  try {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { additionalRoles: true } });
    if (!user) return;
    const raw = user.additionalRoles;
    const current: string[] = Array.isArray(raw) ? (raw as string[]) : [];
    if (current.includes('HOMEROOM_TEACHER')) return; // sudah ada
    const updated = [...current, 'HOMEROOM_TEACHER'];
    await prisma.user.update({
      where: { id: userId },
      data: { additionalRoles: JSON.parse(JSON.stringify(updated)) },
    });
  } catch {
    // Silent — role assignment tidak boleh gagalkan sync
  }
}

// Upsert siswa from SDMS payload
async function upsertSiswa(payload: Record<string, unknown>) {
  const nisn = payload.nisn as string;
  const nama = payload.nama as string;
  const status = payload.status as string;

  // Map gender from SDMS payload
  const rawGender = (payload.jenisKelamin || payload.gender || payload.sex || payload.jenis_kelamin || '') as string;
  const genderNorm = rawGender.toLowerCase().trim();
  const gender = (genderNorm === 'perempuan' || genderNorm === 'p' || genderNorm === 'female' || genderNorm === 'f') ? 'FEMALE' : 'MALE';

  // SDMS sends nested objects with names, not just IDs
  const jurusan = payload.jurusan as Record<string, unknown> | undefined;
  const kelasData = payload.kelas as Record<string, unknown> | undefined;

  const existing = await prisma.student.findFirst({ where: { nis: nisn } });
  
  // Resolve major from nested jurusan object
  const majorId = await findMajorFromSDMS(jurusan);

  // Resolve class by fuzzy name match
  let classId: string | undefined;
  if (kelasData?.nama) {
    classId = await findClassByName(kelasData.nama as string);
  }

  if (existing) {
    const updateData: Record<string, unknown> = {
      isActive: status === 'Aktif',
      gender,
      user: { update: { fullName: nama } },
    };
    if (classId) updateData.class = { connect: { id: classId } };
    if (majorId) updateData.major = { connect: { id: majorId } };
    await prisma.student.update({ where: { id: existing.id }, data: updateData as any });
    return { action: 'updated', id: existing.id };
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
      gender,
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
  const grade = payload.tingkat as string || payload.grade as string || 'X';
  const ruangan = payload.ruangan as string | undefined;
  const jurusan = payload.jurusan as Record<string, unknown> | undefined;
  const waliKelas = payload.waliKelas as Record<string, unknown> | undefined;

  // Resolve major from jurusan object
  const majorId = await findMajorFromSDMS(jurusan);

  // Resolve homeroom teacher from waliKelas name
  let homeroomTeacherId: string | undefined;
  if (waliKelas?.nama) {
    const found = await findTeacherByName(waliKelas.nama as string);
    if (found) {
      homeroomTeacherId = found.teacherId;
      // Auto-assign HOMEROOM_TEACHER role ke guru wali kelas
      ensureHomeroomRole(found.userId);
    }
  }

  // Find existing class by fuzzy name match
  const existingId = await findClassByName(nama);
  const existing = existingId ? await prisma.class.findUnique({ where: { id: existingId } }) : null;
  if (existing) {
    // Update existing class with new major/wali kelas/room data
    const updateData: Record<string, unknown> = {};
    if (majorId && !existing.majorId) updateData.major = { connect: { id: majorId } };
    if (homeroomTeacherId && homeroomTeacherId !== existing.homeroomTeacherId) {
      updateData.homeroomTeacher = { connect: { id: homeroomTeacherId } };
      // Auto-assign HOMEROOM_TEACHER role
      const found = waliKelas?.nama ? await findTeacherByName(waliKelas.nama as string) : null;
      if (found) ensureHomeroomRole(found.userId);
    }
    if (ruangan && !existing.room) updateData.room = ruangan;
    if (grade && grade !== existing.grade) updateData.grade = grade;

    if (Object.keys(updateData).length > 0) {
      await prisma.class.update({ where: { id: existing.id }, data: updateData as any });
    }
    return { action: 'updated', id: existing.id };
  }

  const id = crypto.randomUUID();
  await prisma.class.create({
    data: {
      id,
      name: nama,
      grade: grade || 'X',
      majorId: majorId || undefined,
      homeroomTeacherId: homeroomTeacherId || undefined,
      room: ruangan || undefined,
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

      const webhookData = JSON.parse(JSON.stringify({ lastWebhook: new Date().toISOString(), event }));
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

    const settingsJson = JSON.parse(JSON.stringify(toSave));
    await prisma.schoolSetting.upsert({
      where: { key: 'sdms' },
      update: {
        value: settingsJson,
        updatedById: request.user!.id,
      },
      create: {
        key: 'sdms',
        value: settingsJson,
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

  // ===== MONITORING =====

  // SDMS connection monitor — live status check + sync stats
  app.get('/sdms/monitor', { preHandler: app.requirePermission(PERMISSION_KEYS.settingsManage) }, async (_request, reply) => {
    const settings = await getSDMSSettings();
    const baseUrl = (settings.sdmsBaseUrl as string) || '';
    const username = settings.sdmsUsername as string;
    const password = settings.sdmsPassword as string;
    const lastSyncRow = await prisma.schoolSetting.findUnique({ where: { key: 'sdms_last_sync' } });
    const lastSync = (lastSyncRow?.value as Record<string, unknown>) || {};

    // Live connection check
    let connectionStatus: 'online' | 'offline' | 'not_configured' = 'not_configured';
    let latencyMs: number | null = null;
    let sdmsStudentsCount: number | null = null;
    let errorMessage: string | null = null;

    if (username && password && baseUrl) {
      try {
        const start = Date.now();
        const token = await sdmsLogin(
          baseUrl,
          username,
          password === '••••••••' ? password : password
        );
        const loginMs = Date.now() - start;

        const res = await fetch(`${baseUrl}/siswa?limit=1`, {
          headers: { 'Authorization': `Bearer ${token}` },
          signal: AbortSignal.timeout(10000),
        });
        if (res.ok) {
          const json = await res.json() as Record<string, unknown>;
          const meta = json.meta as Record<string, unknown> | undefined;
          sdmsStudentsCount = (meta?.total as number) || 0;
          latencyMs = Date.now() - start;
          connectionStatus = 'online';
        } else {
          connectionStatus = 'offline';
          errorMessage = `HTTP ${res.status}`;
        }
      } catch (err: unknown) {
        connectionStatus = 'offline';
        errorMessage = err instanceof Error ? err.message : 'Unknown error';
      }
    }

    // Local stats
    const localStudents = await prisma.student.count({ where: { isActive: true } });
    const localTeachers = await prisma.teacher.count({ where: { isActive: true } });
    const localClasses = await prisma.class.count({ where: { isActive: true } });

    // Recent webhook events (last 20)
    const recentWebhooks = await prisma.auditLog.findMany({
      where: { action: { in: ['SDMS_MANUAL_SYNC', 'SDMS_SETTINGS_UPDATED'] } },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true,
        action: true,
        newValue: true,
        createdAt: true,
        user: { select: { fullName: true } },
      },
    });

    return reply.send({
      success: true,
      data: {
        connection: {
          status: connectionStatus,
          latencyMs,
          sdmsStudentsCount,
          errorMessage,
          configured: !!(username && password && baseUrl),
        },
        lastSync: {
          time: lastSync.lastPull || lastSync.lastWebhook || null,
          results: lastSync.results || null,
          webhookTime: lastSync.lastWebhook || null,
          webhookEvent: lastSync.event || null,
        },
        local: {
          students: localStudents,
          teachers: localTeachers,
          classes: localClasses,
        },
        recentEvents: recentWebhooks.map((w) => ({
          id: w.id,
          action: w.action,
          user: w.user?.fullName ?? 'System',
          details: w.newValue,
          time: w.createdAt,
        })),
      },
    });
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

    // Clear class cache agar sync selalu pakai data terbaru
    clearClassCache();

    try {
      // 1. Sync GURU dulu (agar wali kelas bisa di-resolve)
      let page = 1;
      let hasMore = true;
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

      // 2. Sync KELAS (agar siswa bisa di-link ke kelas yang benar)
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

      // Clear cache lagi setelah kelas sync (agar siswa sync pakai data terbaru)
      clearClassCache();

      // 3. Sync SISWA (setelah kelas & guru ada)
      page = 1;
      hasMore = true;
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

      const syncData = { lastPull: new Date().toISOString(), results };
      const syncJson = JSON.parse(JSON.stringify(syncData));
      await prisma.schoolSetting.upsert({
        where: { key: 'sdms_last_sync' },
        update: { value: syncJson },
        create: { key: 'sdms_last_sync', value: syncJson },
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
