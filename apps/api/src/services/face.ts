/**
 * LAYANAN PENGENALAN WAJAH
 * -------------------------
 * Antarmuka provider yang jelas + implementasi mock yang BENAR-BENAR BEKERJA
 * untuk development/demo (perceptual hash dari frame kamera, tanpa dependency native).
 *
 * Untuk production, ganti provider dengan implementasi nyata (face-api.js,
 * AWS Rekognition, dsb.) tanpa mengubah kode lain — cukup ubah FACE_RECOGNITION_PROVIDER
 * dan implementasikan interface FaceRecognitionProvider.
 *
 * Privasi: embedding disimpan, foto mentah TIDAK disimpan. Embedding tidak pernah
 * diekspos lewat API publik.
 */
import type { FastifyRequest } from 'fastify';
import jpeg from 'jpeg-js';
import { prisma } from '../lib/prisma.js';
import { ApiError } from '../utils/errors.js';

export interface FaceRecognitionProvider {
  readonly name: string;
  /** Daftarkan beberapa sampel wajah; simpan embedding. */
  enroll(userId: string, samples: string[]): Promise<{ embedding: number[]; dimensions: number }>;
  /** Verifikasi 1 frame: kembalikan user paling mirip + confidence + hasil liveness. */
  verify(image: string, challenge?: { action?: string; prevImage?: string }): Promise<{
    userId: string | null;
    confidence: number;
    liveness: boolean;
  }>;
  deleteEmbeddings(userId: string): Promise<void>;
}

/** Ubah base64 image (JPEG) menjadi buffer. */
function base64ToBuffer(dataUrl: string): Buffer {
  const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
  return Buffer.from(base64, 'base64');
}

/** Decode JPEG → grid luminance (grayscale) berukuran kecil. Mendukung PNG secara best-effort. */
export function decodeToGray(dataUrl: string, size = 8): number[] | null {
  const buf = base64ToBuffer(dataUrl);
  try {
    let width: number;
    let height: number;
    let data: Buffer;
    if (buf[0] === 0xff && buf[1] === 0xd8) {
      const img = jpeg.decode(buf, { useTArray: true });
      width = img.width;
      height = img.height;
      data = Buffer.from(img.data);
    } else if (buf[0] === 0x89 && buf[1] === 0x50) {
      // PNG minimal: gunakan hash biner sebagai fallback (provider nyata untuk akurasi penuh)
      return null;
    } else {
      return null;
    }
    if (!width || !height) return null;
    // nearest-neighbor resize ke size x size
    const out: number[] = new Array(size * size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const sx = Math.min(width - 1, Math.floor((x / size) * width));
        const sy = Math.min(height - 1, Math.floor((y / size) * height));
        const i = (sy * width + sx) * 4;
        // luminance: 0.299R + 0.587G + 0.114B
        out[y * size + x] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      }
    }
    return out;
  } catch {
    return null;
  }
}

/** Average hash (aHash) dari luminance grid → array bit 0/1. */
function averageHash(gray: number[]): number[] {
  const mean = gray.reduce((a, b) => a + b, 0) / gray.length;
  return gray.map((v) => (v >= mean ? 1 : 0));
}

function hamming(a: number[], b: number[]): number {
  let d = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
  return d / a.length;
}

const THRESHOLD_MATCH = 0.3; // di bawah ini = cocok
const THRESHOLD_STRONG = 0.15; // confidence tinggi

/**
 * Provider mock — berfungsi penuh untuk development:
 * - embedding = average hash dari frame (tahan terhadap perbedaan kecil pencahayaan/kompresi)
 * - liveness = deteksi pergerakan antar 2 frame (challenge dasar)
 */
class MockFaceProvider implements FaceRecognitionProvider {
  readonly name = 'mock';

  async enroll(userId: string, samples: string[]): Promise<{ embedding: number[]; dimensions: number }> {
    const grays = samples.map((s) => decodeToGray(s, 8)).filter((g): g is number[] => g !== null);
    if (grays.length < 1) {
      throw ApiError.badRequest('INVALID_IMAGE', 'Wajah belum terlihat jelas. Pastikan pencahayaan cukup dan posisikan wajah di tengah.');
    }
    // rata-rata hash dari semua sampel untuk stabilitas
    const meanGray: number[] = new Array(64).fill(0);
    for (const g of grays) for (let i = 0; i < 64; i++) meanGray[i] += g[i] / grays.length;
    const embedding = averageHash(meanGray);

    // simpan embedding + profil
    const profile = await prisma.faceProfile.upsert({
      where: { userId },
      update: { status: 'REGISTERED', samplesCount: samples.length, provider: this.name },
      create: {
        userId,
        consent: true,
        consentAt: new Date(),
        status: 'REGISTERED',
        provider: this.name,
        samplesCount: samples.length,
      },
    });
    await prisma.faceEmbedding.deleteMany({ where: { userId } });
    await prisma.faceEmbedding.create({
      data: {
        faceProfileId: profile.id,
        userId,
        embedding: embedding as unknown as object,
        dimensions: 64,
        version: 'ahash-v1',
      },
    });
    return { embedding, dimensions: 64 };
  }

  async verify(
    image: string,
    challenge?: { action?: string; prevImage?: string },
  ): Promise<{ userId: string | null; confidence: number; liveness: boolean }> {
    const gray = decodeToGray(image, 8);
    if (!gray) {
      throw ApiError.badRequest('INVALID_IMAGE', 'Wajah belum terlihat jelas. Pastikan pencahayaan cukup dan posisikan wajah di tengah.');
    }
    const hash = averageHash(gray);

    // Liveness dasar: jika ada frame sebelumnya, pastikan ada pergerakan (frame tidak identik)
    let liveness = true;
    if (challenge?.prevImage) {
      const prevGray = decodeToGray(challenge.prevImage, 8);
      if (prevGray) {
        const prevHash = averageHash(prevGray);
        const motion = hamming(prevHash, hash);
        // frame hampir identik (kertas foto / layar) → kemungkinan spoof
        liveness = motion > 0.02;
      }
    }

    const embeddings = await prisma.faceEmbedding.findMany({
      include: { user: { select: { id: true, isActive: true, student: { select: { isActive: true } } } } },
    });

    let best: { userId: string | null; distance: number } = { userId: null, distance: 1 };
    for (const e of embeddings) {
      const user = e.user;
      if (!user || !user.isActive) continue;
      if (user.student && !user.student.isActive) continue;
      const emb = e.embedding as number[];
      const d = hamming(hash, emb);
      if (d < best.distance) best = { userId: user.id, distance: d };
    }

    if (best.userId === null || best.distance > THRESHOLD_MATCH) {
      return { userId: null, confidence: 0, liveness };
    }
    const confidence = best.distance <= THRESHOLD_STRONG ? 0.97 : 0.82;
    return { userId: best.userId, confidence, liveness };
  }

  async deleteEmbeddings(userId: string): Promise<void> {
    await prisma.faceEmbedding.deleteMany({ where: { userId } });
    await prisma.faceProfile.updateMany({ where: { userId }, data: { status: 'DISABLED', samplesCount: 0 } });
  }
}

/** Provider eksternal placeholder — implementasikan sesuai vendor. */
class ExternalFaceProvider implements FaceRecognitionProvider {
  readonly name = 'external';
  async enroll(): Promise<{ embedding: number[]; dimensions: number }> {
    throw ApiError.badRequest('FACE_PROVIDER_NOT_CONFIGURED', 'Provider pengenalan wajah eksternal belum dikonfigurasi.');
  }
  async verify(): Promise<{ userId: string | null; confidence: number; liveness: boolean }> {
    throw ApiError.badRequest('FACE_PROVIDER_NOT_CONFIGURED', 'Provider pengenalan wajah eksternal belum dikonfigurasi.');
  }
  async deleteEmbeddings(): Promise<void> {
    // tidak ada data lokal
  }
}

function createProvider(name: string): FaceRecognitionProvider {
  switch (name) {
    case 'mock':
      return new MockFaceProvider();
    default:
      return new ExternalFaceProvider();
  }
}

export const faceService: FaceRecognitionProvider = createProvider(
  process.env.FACE_RECOGNITION_PROVIDER || 'mock',
);

/** Pilih field ip/user-agent dengan aman. */
export function requestMeta(req: FastifyRequest) {
  return { ip: req.ip, ua: req.headers['user-agent'] || '' };
}
