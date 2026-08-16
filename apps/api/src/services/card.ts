/**
 * LAYANAN KARTU (RFID/NFC)
 * UID kartu disimpan sebagai SHA-256, tidak pernah plaintext.
 * Validasi: hash UID input → cari kredensial aktif → userId.
 */
import { prisma } from '../lib/prisma.js';
import { sha256 } from '../lib/crypto.js';
import { ApiError } from '../utils/errors.js';

export async function assignCard(userId: string, cardUid: string): Promise<void> {
  const normalized = cardUid.trim().toUpperCase();
  if (!/^[0-9A-F:]{8,32}$/.test(normalized.replace(/ /g, ''))) {
    throw ApiError.badRequest('INVALID_CARD_UID', 'Format UID kartu tidak valid.');
  }
  const uid = normalized.replace(/\s+/g, '');
  const cardUidHash = sha256(uid);

  const existing = await prisma.cardCredential.findUnique({ where: { cardUidHash } });
  if (existing && existing.userId !== userId) {
    throw ApiError.conflict('CARD_ALREADY_ASSIGNED', 'Kartu ini sudah terdaftar untuk pengguna lain.');
  }

  await prisma.cardCredential.upsert({
    where: { userId },
    update: { cardUidHash, isActive: true },
    create: { userId, cardUidHash },
  });

  // simpan UID (hash) juga di student.cardUidHash agar cepat diakses
  await prisma.student.updateMany({ where: { userId }, data: { cardUidHash } });
}

export async function verifyCard(cardUid: string): Promise<{ userId: string }> {
  const uid = cardUid.trim().replace(/\s+/g, '').toUpperCase();
  if (!uid) throw ApiError.badRequest('CARD_NOT_REGISTERED', 'Kartu belum terdaftar.');

  const cred = await prisma.cardCredential.findFirst({
    where: { cardUidHash: sha256(uid), isActive: true },
    include: { user: { select: { isActive: true } } },
  });

  if (!cred) throw ApiError.badRequest('CARD_NOT_REGISTERED', 'Kartu belum terdaftar.');
  if (!cred.user?.isActive) throw ApiError.badRequest('CARD_NOT_REGISTERED', 'Akun pengguna kartu tidak aktif.');

  await prisma.cardCredential.update({ where: { id: cred.id }, data: { lastUsedAt: new Date() } });
  return { userId: cred.userId };
}

export async function removeCard(userId: string): Promise<void> {
  await prisma.cardCredential.deleteMany({ where: { userId } });
  await prisma.student.updateMany({ where: { userId }, data: { cardUidHash: null } });
}
