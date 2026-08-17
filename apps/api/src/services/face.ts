/**
 * LAYANAN PENGENALAN WAJAH (provider: facenet-web)
 * -------------------------------------------------
 * Deteksi wajah & ekstraksi descriptor dilakukan DI BROWSER (HP/PC siswa)
 * menggunakan face-api.js + TensorFlow.js. Server hanya:
 *   - menyimpan descriptor (128 angka) saat registrasi, dan
 *   - membandingkan descriptor (jarak euclidean) saat verifikasi.
 *
 * Foto mentah TIDAK pernah dikirim ke server & tidak disimpan.
 * Privasi: hanya representasi matematis wajah (embedding) yang disimpan.
 */
import type { FastifyRequest } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { ApiError } from '../utils/errors.js';

export const FACENET_DIMENSIONS = 128;
export const FACENET_VERSION = 'facenet-v1';

export interface FaceRecognitionProvider {
  readonly name: string;
  /** Daftarkan beberapa descriptor wajah (hasil deteksi di browser). */
  enroll(
    userId: string,
    descriptors: number[][],
    opts?: { status?: 'REGISTERED' | 'PENDING'; registeredBy?: string | null },
  ): Promise<{ dimensions: number; samples: number }>;
  /** Verifikasi 1 descriptor → user paling mirip + confidence. */
  verify(
    descriptor: number[],
    opts?: { threshold?: number; margin?: number },
  ): Promise<{ userId: string | null; confidence: number }>;
  deleteEmbeddings(userId: string): Promise<void>;
}

/** Validasi descriptor 128-d (angka finite). */
function assertDescriptors(descriptors: number[][]): void {
  if (!Array.isArray(descriptors) || descriptors.length < 1 || descriptors.length > 8) {
    throw ApiError.badRequest('INVALID_DESCRIPTORS', 'Jumlah sampel wajah harus 1–8.');
  }
  for (const d of descriptors) {
    if (!Array.isArray(d) || d.length !== FACENET_DIMENSIONS || !d.every((v) => typeof v === 'number' && Number.isFinite(v))) {
      throw ApiError.badRequest('INVALID_DESCRIPTOR', 'Data wajah tidak valid. Silakan ambil ulang sampel wajah.');
    }
  }
}

/** L2-normalisasi vektor (jarak euclidean jadi konsisten dengan cosine similarity). */
function normalize(v: number[]): number[] {
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm);
  if (norm === 0) return v;
  return v.map((x) => x / norm);
}

function euclidean(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}

const DEFAULT_THRESHOLD = 0.6; // jarak euclidean maksimum dianggap "cocok" (konvensi face-api)
const DEFAULT_MARGIN = 0.15; // user kedua harus lebih jauh minimal ini (cegah false positive saat banyak siswa)

/**
 * Provider nyata: descriptor dihitung di browser (face-api.js), dibandingkan di server.
 * Embedding lama (ahash-v1, mock lama) otomatis diabaikan karena version-nya beda.
 */
class FaceNetWebProvider implements FaceRecognitionProvider {
  readonly name = 'facenet-web';

  async enroll(
    userId: string,
    descriptors: number[][],
    opts?: { status?: 'REGISTERED' | 'PENDING'; registeredBy?: string | null },
  ): Promise<{ dimensions: number; samples: number }> {
    assertDescriptors(descriptors);
    const status = opts?.status ?? 'REGISTERED';

    const profile = await prisma.faceProfile.upsert({
      where: { userId },
      update: { status, samplesCount: descriptors.length, provider: this.name, registeredBy: opts?.registeredBy ?? null },
      create: {
        userId,
        consent: true,
        consentAt: new Date(),
        status,
        provider: this.name,
        samplesCount: descriptors.length,
        registeredBy: opts?.registeredBy ?? null,
      },
    });

    // Ganti seluruh embedding lama dengan yang baru (data wajah lama otomatis terhapus)
    await prisma.faceEmbedding.deleteMany({ where: { userId } });
    await prisma.faceEmbedding.createMany({
      data: descriptors.map((d) => ({
        faceProfileId: profile.id,
        userId,
        embedding: d as unknown as object,
        dimensions: FACENET_DIMENSIONS,
        version: FACENET_VERSION,
      })),
    });

    return { dimensions: FACENET_DIMENSIONS, samples: descriptors.length };
  }

  async verify(
    descriptor: number[],
    opts?: { threshold?: number; margin?: number },
  ): Promise<{ userId: string | null; confidence: number }> {
    if (!Array.isArray(descriptor) || descriptor.length !== FACENET_DIMENSIONS || !descriptor.every((v) => typeof v === 'number' && Number.isFinite(v))) {
      throw ApiError.badRequest('INVALID_DESCRIPTOR', 'Wajah belum terdeteksi dengan baik. Posisikan wajah di tengah dan coba lagi.');
    }
    const probe = normalize(descriptor);
    const threshold = opts?.threshold ?? DEFAULT_THRESHOLD;
    const margin = opts?.margin ?? DEFAULT_MARGIN;

    const embeddings = await prisma.faceEmbedding.findMany({
      where: { version: FACENET_VERSION },
      include: {
        faceProfile: { select: { status: true } },
        user: { select: { id: true, isActive: true, student: { select: { isActive: true } } } },
      },
    });

    // Cari jarak terkecil per user (best distance tiap orang)
    const bestByUser = new Map<string, number>();
    for (const e of embeddings) {
      if (e.faceProfile?.status !== 'REGISTERED') continue;
      const user = e.user;
      if (!user || !user.isActive) continue;
      if (user.student && !user.student.isActive) continue;
      const emb = e.embedding as number[];
      if (!Array.isArray(emb) || emb.length !== FACENET_DIMENSIONS) continue;
      const d = euclidean(probe, normalize(emb));
      const cur = bestByUser.get(user.id);
      if (cur === undefined || d < cur) bestByUser.set(user.id, d);
    }

    // Urutkan user dari yang paling mirip
    const ranked = [...bestByUser.entries()].sort((a, b) => a[1] - b[1]);
    if (ranked.length === 0) {
      return { userId: null, confidence: 0 };
    }

    const [bestUserId, bestDist] = ranked[0];
    const secondDist = ranked[1]?.[1];
    if (bestDist > threshold) {
      return { userId: null, confidence: 0 };
    }
    // Cegah salah kenal: user kedua tidak boleh terlalu dekat juga
    if (secondDist !== undefined && secondDist - bestDist < margin) {
      return { userId: null, confidence: 0 };
    }

    const confidence = Math.max(0.5, Math.min(0.99, 0.99 - (bestDist / threshold) * 0.49));
    return { userId: bestUserId, confidence };
  }

  async deleteEmbeddings(userId: string): Promise<void> {
    await prisma.faceEmbedding.deleteMany({ where: { userId } });
    await prisma.faceProfile.updateMany({ where: { userId }, data: { status: 'DISABLED', samplesCount: 0 } });
  }
}

/** Provider eksternal placeholder — implementasikan sesuai vendor. */
class ExternalFaceProvider implements FaceRecognitionProvider {
  readonly name = 'external';
  async enroll(): Promise<{ dimensions: number; samples: number }> {
    throw ApiError.badRequest('FACE_PROVIDER_NOT_CONFIGURED', 'Provider pengenalan wajah eksternal belum dikonfigurasi.');
  }
  async verify(): Promise<{ userId: string | null; confidence: number }> {
    throw ApiError.badRequest('FACE_PROVIDER_NOT_CONFIGURED', 'Provider pengenalan wajah eksternal belum dikonfigurasi.');
  }
  async deleteEmbeddings(): Promise<void> {
    // tidak ada data lokal
  }
}

function createProvider(name: string): FaceRecognitionProvider {
  // 'mock' lama dipetakan ke facenet-web (descriptor di browser)
  if (name === 'facenet-web' || name === 'mock') return new FaceNetWebProvider();
  return new ExternalFaceProvider();
}

export const faceService: FaceRecognitionProvider = createProvider(
  process.env.FACE_RECOGNITION_PROVIDER || 'facenet-web',
);

/** Pilih field ip/user-agent dengan aman. */
export function requestMeta(req: FastifyRequest) {
  return { ip: req.ip, ua: req.headers['user-agent'] || '' };
}
