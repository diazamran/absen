/**
 * LAYANAN OTP (WhatsApp login orang tua, reset password)
 * OTP TIDAK PERNAH disimpan plaintext — hanya hash bcrypt.
 * Masa berlaku 5 menit, maksimal 5 percobaan.
 */
import { prisma } from '../lib/prisma.js';
import { generateOtp, hashPassword, verifyPassword, sha256 } from '../lib/crypto.js';
import { ApiError } from '../utils/errors.js';
import { config } from '../config.js';

const OTP_TTL_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 5;

async function sendOtp(phone: string, code: string, purpose: string): Promise<void> {
  // Abstraction provider WhatsApp/SMS — default: log (development).
  // eslint-disable-next-line no-console
  console.log(`[otp] ${purpose} untuk ${phone}: kode ${code} (hanya untuk development)`);
}

export async function requestOtp(phone: string, purpose = 'parent-login'): Promise<{ expiresInSec: number; devCode?: string }> {
  const code = generateOtp();
  const codeHash = await hashPassword(code);

  // Ganti OTP lama yang belum terpakai
  await prisma.otpCode.updateMany({
    where: { phone, purpose, verifiedAt: null },
    data: { verifiedAt: new Date(0) },
  });

  await prisma.otpCode.create({
    data: {
      phone,
      purpose,
      codeHash,
      expiresAt: new Date(Date.now() + OTP_TTL_MS),
      attempts: 0,
    },
  });

  await sendOtp(phone, code, purpose);

  // Di development, tampilkan kode agar alur bisa diuji; tidak pernah di production.
  const devCode = config.nodeEnv !== 'production' && config.otpDevPreview ? code : undefined;
  return { expiresInSec: OTP_TTL_MS / 1000, devCode };
}

export async function verifyOtp(phone: string, code: string, purpose = 'parent-login'): Promise<boolean> {
  const rows = await prisma.otpCode.findMany({
    where: { phone, purpose, verifiedAt: null },
    orderBy: { createdAt: 'desc' },
    take: 1,
  });
  if (!rows.length) {
    throw ApiError.badRequest('OTP_NOT_FOUND', 'Kode tidak ditemukan. Silakan kirim kode baru.');
  }
  const row = rows[0];

  if (row.expiresAt.getTime() < Date.now()) {
    throw ApiError.badRequest('OTP_EXPIRED', 'Kode sudah kedaluwarsa. Silakan kirim kode baru.');
  }
  if (row.attempts >= MAX_ATTEMPTS) {
    throw ApiError.badRequest('OTP_TOO_MANY_ATTEMPTS', 'Terlalu banyak percobaan. Silakan kirim kode baru.');
  }

  const ok = await verifyPassword(code, row.codeHash);
  if (!ok) {
    await prisma.otpCode.update({ where: { id: row.id }, data: { attempts: { increment: 1 } } });
    throw ApiError.badRequest('OTP_INVALID', 'Kode salah. Periksa kembali kode yang Anda terima.');
  }

  await prisma.otpCode.update({
    where: { id: row.id },
    data: { verifiedAt: new Date() },
  });
  return true;
}

/** Hash telepon untuk pencatatan (bukan plaintext di log). */
export function maskPhone(phone: string): string {
  if (phone.length < 8) return phone;
  return `${phone.slice(0, 3)}****${phone.slice(-3)}`;
}

export function phoneFingerprint(phone: string): string {
  return sha256(phone);
}
