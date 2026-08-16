/**
 * LAYANAN QR
 * QR berisi token JWT yang DITANDATANGANI (HMAC-SHA256) dengan:
 *  - nonce (anti-replay)
 *  - exp (masa berlaku)
 *  - sub (userId — bukan data sensitif lain)
 * ID siswa TIDAK pernah dipakai langsung sebagai konten QR.
 */
import { prisma } from '../lib/prisma.js';
import { signToken, verifyToken, randomNonce } from '../lib/crypto.js';
import { config } from '../config.js';
import { ApiError } from '../utils/errors.js';

const DYNAMIC_TTL_SEC = 60; // QR dinamis: 60 detik
const CARD_TTL_SEC = 365 * 24 * 3600; // QR kartu siswa: 1 tahun (fallback)

export type QrType = 'dynamic' | 'student-card';

export interface QrVerifyResult {
  valid: boolean;
  userId: string;
  type: QrType;
  nonce: string;
}

/** Terbitkan QR token untuk seorang user. */
export async function issueQrToken(userId: string, type: QrType = 'dynamic'): Promise<string> {
  const nonce = randomNonce();
  const ttl = type === 'dynamic' ? DYNAMIC_TTL_SEC : CARD_TTL_SEC;

  if (type === 'student-card') {
    // simpan nonce agar bisa divalidasi + dirotasi
    await prisma.qrCredential.upsert({
      where: { userId },
      update: { nonce, isActive: true },
      create: { userId, nonce },
    });
  }

  return signToken({ sub: userId, typ: type, nonce }, config.jwtSecret, ttl);
}

/** Validasi token QR; melempar ApiError dengan kode yang tepat. */
export async function verifyQrToken(token: string): Promise<QrVerifyResult> {
  let payload;
  try {
    payload = verifyToken(token, config.jwtSecret);
  } catch (e) {
    const msg = (e as Error).message;
    if (msg === 'TOKEN_EXPIRED') throw ApiError.badRequest('EXPIRED_QR', 'QR Code sudah kedaluwarsa.');
    throw ApiError.badRequest('INVALID_QR', 'QR Code tidak valid.');
  }

  const userId = payload.sub;
  const type = payload.typ === 'student-card' ? 'student-card' : 'dynamic';
  if (!userId) throw ApiError.badRequest('INVALID_QR', 'QR Code tidak valid.');

  if (type === 'student-card') {
    const cred = await prisma.qrCredential.findUnique({ where: { userId } });
    if (!cred || !cred.isActive || cred.nonce !== payload.nonce) {
      throw ApiError.badRequest('INVALID_QR', 'QR Code tidak valid atau sudah dicabut.');
    }
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !user.isActive) throw ApiError.badRequest('INVALID_QR', 'Akun pengguna tidak aktif.');

  await prisma.qrCredential.updateMany({ where: { userId }, data: { lastUsedAt: new Date() } });

  return { valid: true, userId, type, nonce: String(payload.nonce) };
}
