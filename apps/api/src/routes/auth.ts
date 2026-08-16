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
          avatarUrl: user.avatarUrl,
          student: user.student ? { id: user.student.id, nis: user.student.nis, className: user.student.classId } : null,
          teacher: user.teacher ? { id: user.teacher.id, nip: user.teacher.nip, isPiket: user.teacher.isPiket } : null,
          staff: user.staff ? { id: user.staff.id, nip: user.staff.nip } : null,
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
}
