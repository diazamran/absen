/**
 * PENYIMPANAN FILE
 * Abstraksi object storage (S3-compatible) dengan fallback lokal untuk development.
 * Digunakan untuk: avatar, bukti izin, dokumen, attachment.
 * Foto wajah mentah TIDAK disimpan — hanya embedding.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface StorageService {
  /** Simpan file; kembalikan URL publik relatif (mis. /uploads/xxx.jpg). */
  save(buffer: Buffer, mimetype: string, folder: string): Promise<string>;
  delete(url: string): Promise<void>;
}

const UPLOADS_DIR = path.resolve(__dirname, '../../uploads');

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
  'text/csv': 'csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
};

class LocalStorageProvider implements StorageService {
  async save(buffer: Buffer, mimetype: string, folder: string): Promise<string> {
    const ext = EXT_BY_MIME[mimetype] || 'bin';
    const name = `${crypto.randomBytes(12).toString('hex')}.${ext}`;
    const dir = path.join(UPLOADS_DIR, folder);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, name), buffer);
    return `/uploads/${folder}/${name}`;
  }

  async delete(url: string): Promise<void> {
    const file = path.join(UPLOADS_DIR, url.replace(/^\/uploads\//, ''));
    if (file.startsWith(UPLOADS_DIR) && fs.existsSync(file)) {
      fs.unlinkSync(file);
    }
  }
}

class S3StorageProvider implements StorageService {
  async save(): Promise<string> {
    throw new Error('S3_STORAGE_NOT_CONFIGURED');
  }
  async delete(): Promise<void> {
    throw new Error('S3_STORAGE_NOT_CONFIGURED');
  }
}

function createStorage(): StorageService {
  if (config.storage.driver === 's3' || config.storage.driver === 'minio') {
    // TODO: inisialisasi client S3 (@aws-sdk/client-s3) dengan config.storage
    return new S3StorageProvider();
  }
  return new LocalStorageProvider();
}

export const storage = createStorage();

/** Validasi MIME & ukuran upload (maks 5 MB). */
export const ALLOWED_MIME = new Set(Object.keys(EXT_BY_MIME));
export const MAX_UPLOAD_SIZE = 5 * 1024 * 1024;

export function validateUpload(mimetype: string, size: number): void {
  if (!ALLOWED_MIME.has(mimetype)) {
    throw new Error('INVALID_FILE_TYPE');
  }
  if (size > MAX_UPLOAD_SIZE) {
    throw new Error('FILE_TOO_LARGE');
  }
}
