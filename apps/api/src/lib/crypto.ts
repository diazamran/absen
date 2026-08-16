import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';

/** Hash password (bcrypt, 10 rounds). */
export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/** Hash token/secret dengan SHA-256 (untuk refresh token, OTP, card UID). */
export function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

/** Generate OTP 6 digit acak. */
export function generateOtp(): string {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

/** HMAC-SHA256 signature untuk QR token (anti-tamper). */
export function hmacSign(payload: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

/** Nonce acak. */
export function randomNonce(): string {
  return crypto.randomBytes(16).toString('hex');
}

// ===== JWT (compact JWS, HMAC-SHA256) =====
// Implementasi ringan tanpa dependency eksternal; digunakan untuk akses token
// dan QR token. Standar JWT (base64url header.payload.signature).

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function unb64url(input: string): Buffer {
  return Buffer.from(input, 'base64url');
}

const JWT_HEADER = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));

export interface JwtPayload {
  [key: string]: unknown;
  sub?: string;
  iat?: number;
  exp?: number;
  jti?: string;
}

/** Tanda tangani payload menjadi JWT dengan masa berlaku (detik). */
export function signToken(payload: JwtPayload, secret: string, ttlSeconds: number, jti?: string): string {
  const now = Math.floor(Date.now() / 1000);
  const body: JwtPayload = { ...payload, iat: now, exp: now + ttlSeconds };
  if (jti) body.jti = jti;
  const payloadB64 = b64url(JSON.stringify(body));
  const signature = hmacSign(`${JWT_HEADER}.${payloadB64}`, secret);
  return `${JWT_HEADER}.${payloadB64}.${signature}`;
}

/** Verifikasi JWT; mengembalikan payload atau melempar error. */
export function verifyToken(token: string, secret: string): JwtPayload {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('INVALID_TOKEN');
  const [header, payloadB64, signature] = parts;
  const expected = hmacSign(`${header}.${payloadB64}`, secret);
  // constant-time comparison
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new Error('INVALID_SIGNATURE');
  const payload = JSON.parse(unb64url(payloadB64).toString('utf8')) as JwtPayload;
  if (typeof payload.exp !== 'number' || payload.exp * 1000 < Date.now()) throw new Error('TOKEN_EXPIRED');
  return payload;
}

/** ID acak untuk device fingerprint. */
export function randomId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

/**
 * Embedding "average hash" sederhana (deterministik, tanpa native dependency).
 * Dipakai oleh MockFaceProvider — ganti dengan provider nyata pada production.
 * Mengembalikan array berisi 0/1 (64 bit) sebagai representasi vektor wajah.
 */
export function imageToAverageHash(imageBuffer: Buffer, size = 8): number[] {
  // Dekode tidak bisa dilakukan tanpa library gambar; untuk mock provider kita
  // gunakan hash dari byte image sebagai basis embedding deterministik.
  // (Provider nyata: gunakan face-api.js / AWS Rekognition / dsb.)
  const hash = crypto.createHash('sha256').update(imageBuffer).digest();
  const bits: number[] = [];
  for (let i = 0; i < size * size; i++) {
    bits.push((hash[Math.floor(i / 8)] >> (i % 8)) & 1);
  }
  return bits;
}

/** Jarak Hamming antara dua embedding biner (0..1, semakin kecil semakin mirip). */
export function hammingDistance(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  let dist = 0;
  for (let i = 0; i < len; i++) if (a[i] !== b[i]) dist++;
  return len ? dist / len : 1;
}
