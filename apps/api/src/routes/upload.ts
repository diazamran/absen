import type { FastifyInstance } from 'fastify';
import { storage, validateUpload, MAX_UPLOAD_SIZE } from '../services/storage.js';
import { ApiError } from '../utils/errors.js';
import { audit } from '../lib/audit.js';

export async function uploadRoutes(app: FastifyInstance) {
  app.post('/upload', { preHandler: app.authenticate }, async (request, reply) => {
    const data = await request.file();
    if (!data) throw ApiError.badRequest('FILE_REQUIRED', 'Pilih file terlebih dahulu.');
    if (data.file.truncated || data.file.bytesRead > MAX_UPLOAD_SIZE) {
      throw ApiError.badRequest('FILE_TOO_LARGE', 'Ukuran file maksimal 5 MB.');
    }
    let mimetype = data.mimetype;
    if (mimetype === 'application/octet-stream' && data.filename?.toLowerCase().endsWith('.csv')) {
      mimetype = 'text/csv';
    }
    try {
      validateUpload(mimetype, data.file.bytesRead);
    } catch (e) {
      throw ApiError.badRequest((e as Error).message, 'Jenis file tidak diizinkan.');
    }
    const buffer = await data.toBuffer();
    const url = await storage.save(buffer, mimetype, 'attachments');
    await audit({
      userId: request.user!.id,
      action: 'FILE_UPLOADED',
      entity: 'File',
      newValue: { url, mimetype },
      request,
    });
    return reply.send({ success: true, data: { url } });
  });
}
