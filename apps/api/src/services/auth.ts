/**
 * LAYANAN AUTENTIKASI
 * - JWT access token (HMAC-SHA256, TTL 8 jam)
 * - Refresh token acak 256-bit, disimpan HASH di DB, rotasi pada tiap penggunaan
 * - Session + device tracking (browser/OS/IP)
 */
import type { FastifyRequest } from 'fastify';
import crypto from 'node:crypto';
import { prisma } from '../lib/prisma.js';
import { config } from '../config.js';
import { signToken, sha256, randomId } from '../lib/crypto.js';
import { ApiError } from '../utils/errors.js';
import { audit } from '../lib/audit.js';
import type { DeviceStatus } from '@prisma/client';

export interface SessionUser {
  id: string;
  roleKey: string;
  fullName: string;
}

function ttlSeconds(ttl: string): number {
  const match = ttl.match(/^(\d+)([smhd])$/);
  if (!match) return 8 * 3600;
  const n = Number(match[1]);
  switch (match[2]) {
    case 's': return n;
    case 'm': return n * 60;
    case 'h': return n * 3600;
    case 'd': return n * 86400;
    default: return n;
  }
}

export function accessTtlSeconds(): number {
  return ttlSeconds(config.jwtAccessTtl);
}

function refreshTtlMs(): number {
  return ttlSeconds(config.jwtRefreshTtl) * 1000;
}

interface IssueParams {
  request: FastifyRequest;
  deviceId?: string;
}

export async function issueTokens(userId: string, params: IssueParams): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: SessionUser;
}> {
  const user = await prisma.user.findUnique({ where: { id: userId }, include: { role: true } });
  if (!user || !user.isActive) throw ApiError.unauthorized('Akun tidak aktif. Hubungi admin.');

  const now = new Date();
  const refreshToken = crypto.randomBytes(48).toString('base64url');
  const jti = randomId('rt');
  const session = await prisma.session.create({
    data: {
      userId: user.id,
      deviceId: params.deviceId,
      ip: params.request.ip,
      userAgent: params.request.headers['user-agent'] || null,
      status: 'ONLINE',
      lastSeenAt: now,
    },
  });

  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: sha256(refreshToken),
      jti,
      sessionId: session.id,
      expiresAt: new Date(now.getTime() + refreshTtlMs()),
    },
  });

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: now, lastLoginIp: params.request.ip },
  });

  // Device tracking
  if (params.deviceId) {
    const existing = await prisma.device.findUnique({ where: { deviceId: params.deviceId } });
    await prisma.device.upsert({
      where: { deviceId: params.deviceId },
      update: {
        userId: user.id,
        ip: params.request.ip,
        browser: browserFromUA(params.request.headers['user-agent']),
        os: osFromUA(params.request.headers['user-agent']),
        lastSeenAt: now,
        status: existing?.status === 'BLOCKED' ? 'BLOCKED' : 'ONLINE',
      },
      create: {
        deviceId: params.deviceId,
        userId: user.id,
        name: 'Perangkat',
        ip: params.request.ip,
        browser: browserFromUA(params.request.headers['user-agent']),
        os: osFromUA(params.request.headers['user-agent']),
        fingerprint: params.request.headers['user-agent'] || null,
        lastSeenAt: now,
        status: 'ONLINE',
      },
    });
  }

  const sessionUser: SessionUser = {
    id: user.id,
    roleKey: user.role.key,
    fullName: user.fullName,
  };

  const userRoles = [user.role.key, ...((user.additionalRoles as string[]) || [])];
  const accessToken = signToken(
    { sub: user.id, role: user.role.key, roles: userRoles, name: user.fullName, typ: 'access' },
    config.jwtSecret,
    accessTtlSeconds(),
    jti,
  );

  return { accessToken, refreshToken, expiresIn: accessTtlSeconds(), user: sessionUser };
}

/** Refresh dengan ROTASI: token lama langsung dicabut. */
export async function refreshTokens(
  refreshToken: string,
  params: IssueParams,
): Promise<{ accessToken: string; refreshToken: string; expiresIn: number; user: SessionUser }> {
  const hash = sha256(refreshToken);
  const row = await prisma.refreshToken.findUnique({ where: { tokenHash: hash } });
  if (!row) throw ApiError.unauthorized();
  if (row.revokedAt) throw ApiError.unauthorized();
  if (row.expiresAt.getTime() < Date.now()) {
    await prisma.refreshToken.update({ where: { id: row.id }, data: { revokedAt: new Date() } });
    throw ApiError.unauthorized('Sesi berakhir. Silakan masuk kembali.');
  }

  // Rotasi: cabut yang lama, terbitkan yang baru
  await prisma.refreshToken.update({ where: { id: row.id }, data: { revokedAt: new Date() } });
  await prisma.session.updateMany({ where: { id: row.sessionId ?? '' }, data: { lastSeenAt: new Date() } });

  const result = await issueTokens(row.userId, params);
  await prisma.refreshToken.update({
    where: { id: row.id },
    data: { replacedById: sha256(result.refreshToken) },
  });
  return result;
}

export async function logout(refreshToken: string, userId?: string): Promise<void> {
  if (!refreshToken) return;
  const hash = sha256(refreshToken);
  const row = await prisma.refreshToken.findUnique({ where: { tokenHash: hash } });
  if (row) {
    await prisma.refreshToken.update({ where: { id: row.id }, data: { revokedAt: new Date() } });
    if (row.sessionId) {
      await prisma.session.update({ where: { id: row.sessionId }, data: { revokedAt: new Date(), status: 'OFFLINE' } });
    }
  }
  if (userId) {
    await audit({ userId, action: 'USER_LOGOUT', entity: 'Session' });
  }
}

function browserFromUA(ua?: string): string | null {
  if (!ua) return null;
  if (ua.includes('Edg/')) return 'Edge';
  if (ua.includes('Chrome/')) return 'Chrome';
  if (ua.includes('Firefox/')) return 'Firefox';
  if (ua.includes('Safari/')) return 'Safari';
  return 'Lainnya';
}

function osFromUA(ua?: string): string | null {
  if (!ua) return null;
  if (ua.includes('Windows')) return 'Windows';
  if (ua.includes('Android')) return 'Android';
  if (ua.includes('iPhone') || ua.includes('iPad')) return 'iOS';
  if (ua.includes('Mac OS')) return 'macOS';
  if (ua.includes('Linux')) return 'Linux';
  return 'Lainnya';
}

/** Blokir perangkat. */
export async function setDeviceStatus(deviceId: string, status: DeviceStatus, actorId: string, request: FastifyRequest): Promise<void> {
  await prisma.device.update({ where: { deviceId }, data: { status } });
  await audit({
    userId: actorId,
    action: status === 'BLOCKED' ? 'DEVICE_BLOCKED' : 'DEVICE_UNBLOCKED',
    entity: 'Device',
    entityId: deviceId,
    request,
  });
}
