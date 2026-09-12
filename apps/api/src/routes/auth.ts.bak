import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { verifyPassword, hashPassword } from '../lib/crypto.js';
import { issueTokens, refreshTokens, logout } from '../services/auth.js';
import { requestOtp, verifyOtp, maskPhone } from '../services/otp.js';
import { ApiError } from '../utils/errors.js';
import { validate } from '../utils/validate.js';
import { audit } from '../lib/audit.js';
import { config } from '../config.js';
import { ROLE_LABELS } from '../rbac/permissions.js';

const loginSchema = z.object({
  username: z.string().min(1, 'Username wajib diisi.'),
  password: z.string().min(1, 'Password wajib diisi.'),
  deviceId: z.string().optional(),
});

const studentLoginSchema = z.object({
  nis: z.string().min(1, 'NISN wajib diisi.'),
  password: z.string().min(1, 'Password wajib diisi.'),
  deviceId: z.string().optional(),
});

const otpRequestSchema = z.object({
  phone: z.string().min(9, 'Nomor WhatsApp tidak valid.').max(16),
  purpose: z.enum(['parent-login', 'reset-password']).default('parent-login'),
});

const otpVerifySchema = z.object({
  phone: z.string().min(9),
  code: z.string().length(6, 'Kode harus 6 digit.'),
  purpose: z.enum(['parent-login', 'reset-password']).default('parent-login'),
  deviceId: z.string().optional(),
  newPassword: z.string().min(6).optional(), // untuk reset-password
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(6, 'Password baru minimal 6 karakter.'),
});

export async function authRoutes(app: FastifyInstance) {
  app.post('/auth/login', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    const body = validate(loginSchema, request.body);
    const user = await prisma.user.findUnique({
      where: { username: body.username.trim() },
      include: { role: true, student: true, teacher: true, staff: true },
    });
    if (!user || !user.isActive) {
      throw ApiError.unauthorized('INVALID_CREDENTIALS', 'Username atau password salah.');
    }
    if (user.role.key === 'STUDENT') {
      throw ApiError.unauthorized('STUDENT_LOGIN_METHOD', 'Siswa login menggunakan NISN dan password.');
    }
    const userRoles = [user.role.key, ...((user.additionalRoles as string[]) || [])];
    const ok = await verifyPassword(body.password, user.passwordHash);
    if (!ok) {
      throw ApiError.unauthorized('INVALID_CREDENTIALS', 'Username atau password salah.');
    }

    const tokens = await issueTokens(user.id, { request, deviceId: body.deviceId });
    await audit({
      userId: user.id,
      action: 'ADMIN_LOGIN',
      entity: 'User',
      entityId: user.id,
      request,
    });

    return reply.send({
      success: true,
      data: {
        ...tokens,
        user: {
          id: user.id,
          username: user.username,
          fullName: user.fullName,
          roleKey: user.role.key,
          roleName: ROLE_LABELS[user.role.key] || user.role.name,
          roles: userRoles,
          avatarUrl: user.avatarUrl,
          student: user.student ? { id: user.student.id, nis: user.student.nis, className: user.student.classId } : null,
          teacher: user.teacher ? { id: user.teacher.id, nip: user.teacher.nip, isPiket: user.teacher.isPiket } : null,
          staff: user.staff ? { id: user.staff.id, nip: user.staff.nip } : null,
        },
      },
    });
  });

  // Login siswa: NISN + password (password default: smkn1kras, bisa direset massal)
  app.post('/auth/login-student', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    const body = validate(studentLoginSchema, request.body);
    const student = await prisma.student.findUnique({
      where: { nis: body.nis.trim() },
      include: { user: { include: { role: true } } },
    });
    if (!student || !student.user || !student.user.isActive) {
      throw ApiError.unauthorized('INVALID_CREDENTIALS', 'NISN atau password salah.');
    }
    const ok = await verifyPassword(body.password, student.user.passwordHash);
    if (!ok) {
      throw ApiError.unauthorized('INVALID_CREDENTIALS', 'NISN atau password salah.');
    }

    const tokens = await issueTokens(student.user.id, { request, deviceId: body.deviceId });
    await audit({
      userId: student.user.id,
      action: 'STUDENT_LOGIN',
      entity: 'Student',
      entityId: student.id,
      request,
    });

    return reply.send({
      success: true,
      data: {
        ...tokens,
        user: {
          id: student.user.id,
          username: student.user.username,
          fullName: student.user.fullName,
          roleKey: student.user.role.key,
          roleName: ROLE_LABELS[student.user.role.key] || student.user.role.name,
          roles: [student.user.role.key, ...((student.user.additionalRoles as string[]) || [])],
          avatarUrl: student.user.avatarUrl,
          student: { id: student.id, nis: student.nis, className: student.classId },
        },
      },
    });
  });

  app.post('/auth/refresh', async (request, reply) => {
    const body = validate(refreshSchema, request.body);
    const tokens = await refreshTokens(body.refreshToken, { request });
    return reply.send({ success: true, data: tokens });
  });

  app.post('/auth/logout', async (request, reply) => {
    const body = validate(refreshSchema.optional().default({ refreshToken: '' }), request.body ?? {});
    await logout(body.refreshToken, request.user?.id);
    return reply.send({ success: true });
  });

  // ===== OTP (orang tua login via WhatsApp & reset password) =====
  app.post('/auth/otp/request', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (request, reply) => {
    const body = validate(otpRequestSchema, request.body);
    const phone = body.phone.replace(/[^0-9]/g, '');

    if (body.purpose === 'parent-login') {
      const parent = await prisma.parent.findUnique({ where: { phone } });
      if (!parent || !parent.isActive) {
        throw ApiError.badRequest('PHONE_NOT_REGISTERED', 'Nomor WhatsApp ini belum terdaftar sebagai orang tua.');
      }
    } else {
      const user = await prisma.user.findFirst({ where: { phone } });
      if (!user) throw ApiError.badRequest('PHONE_NOT_REGISTERED', 'Nomor WhatsApp ini belum terdaftar.');
    }

    const result = await requestOtp(phone, body.purpose);
    return reply.send({
      success: true,
      data: {
        expiresInSec: result.expiresInSec,
        phoneMasked: maskPhone(phone),
        // Hanya development: preview kode agar alur bisa diuji
        ...(result.devCode ? { devCode: result.devCode } : {}),
      },
    });
  });

  app.post('/auth/otp/verify', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    const body = validate(otpVerifySchema, request.body);
    const phone = body.phone.replace(/[^0-9]/g, '');
    await verifyOtp(phone, body.code, body.purpose);

    if (body.purpose === 'reset-password') {
      if (!body.newPassword) throw ApiError.badRequest('NEW_PASSWORD_REQUIRED', 'Password baru wajib diisi.');
      const user = await prisma.user.findFirst({ where: { phone } });
      if (!user) throw ApiError.notFound('Akun tidak ditemukan.');
      await prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: await hashPassword(body.newPassword) },
      });
      await audit({ userId: user.id, action: 'PASSWORD_RESET', entity: 'User', entityId: user.id, request });
      return reply.send({ success: true, message: 'Password berhasil diubah. Silakan masuk.' });
    }

    const parent = await prisma.parent.findUnique({
      where: { phone },
      include: { user: { include: { role: true } } },
    });
    if (!parent?.user) throw ApiError.badRequest('PHONE_NOT_REGISTERED', 'Nomor WhatsApp ini belum terdaftar.');

    const tokens = await issueTokens(parent.user.id, { request, deviceId: body.deviceId });
    await audit({
      userId: parent.user.id,
      action: 'PARENT_LOGIN',
      entity: 'Parent',
      entityId: parent.id,
      request,
    });

    return reply.send({
      success: true,
      data: {
        ...tokens,
        user: {
          id: parent.user.id,
          fullName: parent.user.fullName,
          roleKey: parent.user.role.key,
          roleName: 'Orang Tua',
          roles: [parent.user.role.key, ...((parent.user.additionalRoles as string[]) || [])],
          parent: { id: parent.id, phone: parent.phone, name: parent.name },
        },
      },
    });
  });

  // ===== Ganti password (login) =====
  app.post('/auth/change-password', { preHandler: app.authenticate }, async (request, reply) => {
    const body = validate(changePasswordSchema, request.body);
    const user = await prisma.user.findUnique({ where: { id: request.user!.id } });
    if (!user) throw ApiError.notFound('Akun tidak ditemukan.');
    const ok = await verifyPassword(body.currentPassword, user.passwordHash);
    if (!ok) throw ApiError.badRequest('WRONG_PASSWORD', 'Password saat ini salah.');
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(body.newPassword) },
    });
    await audit({ userId: user.id, action: 'PASSWORD_CHANGED', entity: 'User', entityId: user.id, request });
    return reply.send({ success: true, message: 'Password berhasil diganti.' });
  });

  // ===== Info pengguna saat ini =====
  app.get('/auth/me', { preHandler: app.authenticate }, async (request, reply) => {
    const user = await prisma.user.findUnique({
      where: { id: request.user!.id },
      include: {
        role: true,
        student: { include: { class: true, major: true } },
        teacher: true,
        staff: true,
        parent: { include: { childLinks: { include: { student: { include: { user: true, class: true } } } } } },
      },
    });
    if (!user) throw ApiError.notFound('Akun tidak ditemukan.');
    return reply.send({
      success: true,
      data: {
        id: user.id,
        username: user.username,
        fullName: user.fullName,
        email: user.email,
        phone: user.phone,
        avatarUrl: user.avatarUrl,
        roleKey: user.role.key,
        roleName: ROLE_LABELS[user.role.key] || user.role.name,
        roles: [user.role.key, ...((user.additionalRoles as string[]) || [])],
        preferences: user.preferences,
        student: user.student
          ? {
              id: user.student.id,
              nis: user.student.nis,
              className: user.student.class?.name ?? null,
              grade: user.student.class?.grade ?? null,
              major: user.student.major?.name ?? null,
            }
          : null,
        teacher: user.teacher ? { id: user.teacher.id, nip: user.teacher.nip, position: user.teacher.position, isPiket: user.teacher.isPiket } : null,
        staff: user.staff ? { id: user.staff.id, nip: user.staff.nip, position: user.staff.position } : null,
        parent: user.parent
          ? {
              id: user.parent.id,
              name: user.parent.name,
              phone: user.parent.phone,
              children: user.parent.childLinks.map((l) => ({
                studentId: l.studentId,
                name: l.student.user?.fullName ?? '',
                nis: l.student.nis,
                className: l.student.class?.name ?? null,
                relation: l.relation,
              })),
            }
          : null,
      },
    });
  });

  // ===== Preferensi tema =====
  app.put('/auth/preferences', { preHandler: app.authenticate }, async (request, reply) => {
    const body = validate(
      z.object({
        preferences: z.record(z.unknown()),
      }),
      request.body,
    );
    await prisma.user.update({
      where: { id: request.user!.id },
      data: { preferences: body.preferences as object },
    });
    return reply.send({ success: true });
  });

  // Info publik (branding) — dipakai halaman login tanpa auth
  app.get('/meta', async (_request, reply) => {
    const settings = await prisma.schoolSetting.findMany({ where: { key: { in: ['branding', 'attendanceRules', 'notifications'] } } });
    const school = await prisma.school.findFirst();
    const map: Record<string, unknown> = {};
    for (const s of settings) map[s.key] = s.value;
    return reply.send({
      success: true,
      data: {
        appName: map.appName,
        branding: map.branding,
        attendanceRules: map.attendanceRules,
        notifications: map.notifications,
        school: school ? { name: school.name, address: school.address, phone: school.phone, email: school.email } : null,
        timezone: config.timezone,
        env: config.nodeEnv,
      },
    });
  });

  // ===== SSO Callback dari SDMS =====
  // GET /api/auth/sso-callback?token=<jwt_dari_sdms>
  app.get('/auth/sso-callback', async (request, reply) => {
    const { token } = request.query as { token?: string };
    const SSO_SECRET = process.env.SSO_SECRET || 'sso_secret_absen_smkn1kras_2026';
    const APP_URL    = config.appUrl;

    if (!token) return reply.redirect(`${APP_URL}/login?error=sso_no_token`);

    try {
      // SDMS menggunakan jsonwebtoken (HS256) — verifikasi manual
      // jsonwebtoken menggunakan base64url untuk header & payload, HMAC-SHA256 untuk signature
      const parts = token.split('.');
      if (parts.length !== 3) throw new Error('INVALID_TOKEN');

      // Verifikasi signature: HMAC-SHA256(header.payload, secret) dalam base64url
      const crypto = await import('node:crypto');
      const signingInput = `${parts[0]}.${parts[1]}`;
      const expectedSig  = crypto.default
        .createHmac('sha256', SSO_SECRET)
        .update(signingInput)
        .digest('base64url');   // jsonwebtoken juga pakai base64url

      if (expectedSig !== parts[2]) throw new Error('INVALID_SIGNATURE');

      // Decode payload
      const payloadJson  = Buffer.from(parts[1], 'base64url').toString('utf8');
      const sdmsPayload  = JSON.parse(payloadJson) as {
        sub: string; username: string; full_name: string; role: string;
        extra_roles?: string[]; aud: string; iss: string; exp: number;
      };

      // Cek expiry
      if (sdmsPayload.exp * 1000 < Date.now()) throw new Error('TOKEN_EXPIRED');

      // Cek audience & issuer
      if (sdmsPayload.aud !== 'absen' || sdmsPayload.iss !== 'sdms-core') {
        throw new Error('INVALID_AUDIENCE');
      }

      // Petakan role SDMS → role key di absen
      const roleMap: Record<string, string> = {
        super_admin:    'ADMIN',
        admin:          'ADMIN',
        kepala_sekolah: 'ADMIN',
        guru:           'TEACHER',
        wali_kelas:     'TEACHER',
        pegawai:        'STAFF',
        operator:       'STAFF',
        petugas_piket:  'TEACHER',
        siswa:          'STUDENT',
      };
      const targetRoleKey = roleMap[sdmsPayload.role] || 'TEACHER';

      // Cari atau buat user
      let user = await prisma.user.findUnique({
        where: { username: sdmsPayload.username },
        include: { role: true },
      });

      if (!user) {
        const roleRow = await prisma.role.findFirst({ where: { key: targetRoleKey } });
        if (!roleRow) throw new Error(`Role ${targetRoleKey} tidak ditemukan`);

        const cryptoLib = await import('../lib/crypto.js');
        const randomLib = await import('node:crypto');
        user = await prisma.user.create({
          data: {
            username:     sdmsPayload.username,
            fullName:     sdmsPayload.full_name || sdmsPayload.username,
            passwordHash: await cryptoLib.hashPassword(randomLib.default.randomBytes(16).toString('hex')),
            roleId:       roleRow.id,
            isActive:     true,
          },
          include: { role: true },
        });
        app.log.info(`[SSO] User baru: ${sdmsPayload.username} (${targetRoleKey})`);
      } else {
        // Update nama jika berubah di SDMS
        if (sdmsPayload.full_name && sdmsPayload.full_name !== user.fullName) {
          await prisma.user.update({ where: { id: user.id }, data: { fullName: sdmsPayload.full_name } });
        }
      }

      if (!user.isActive) return reply.redirect(`${APP_URL}/login?error=sso_inactive`);

      // Buat access token lokal absen
      const authLib    = await import('../services/auth.js');
      const cryptoLib2 = await import('../lib/crypto.js');
      const userRoles  = [user.role.key, ...((user.additionalRoles as string[]) || [])];
      const accessToken = cryptoLib2.signToken(
        { sub: user.id, role: user.role.key, roles: userRoles, name: user.fullName, typ: 'access' },
        config.jwtSecret,
        authLib.accessTtlSeconds(),
        `sso_${Date.now()}`,
      );

      app.log.info(`[SSO] ✅ ${user.role.key} login via SSO: ${user.fullName}`);

      // Redirect ke /sso di frontend React dengan token di URL fragment
      return reply.redirect(`${APP_URL}/sso#access=${accessToken}&role=${user.role.key}`);

    } catch (err: any) {
      app.log.warn(`[SSO] Error: ${err.message}`);
      const errMap: Record<string, string> = {
        TOKEN_EXPIRED:     'sso_expired',
        INVALID_SIGNATURE: 'sso_invalid',
        INVALID_AUDIENCE:  'sso_invalid',
        INVALID_TOKEN:     'sso_invalid',
      };
      return reply.redirect(`${APP_URL}/login?error=${errMap[err.message] || 'sso_error'}`);
    }
  });
}
