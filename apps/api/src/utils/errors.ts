/**
 * Format error standar:
 * { success: false, message: "Pesan error", code: "ERROR_CODE" }
 * Jangan pernah menampilkan error teknis (stack/Prisma) ke client.
 */
export class ApiError extends Error {
  code: string;
  statusCode: number;
  details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }

  static badRequest(code: string, message: string, details?: unknown) {
    return new ApiError(400, code, message, details);
  }
  static unauthorized(code = 'UNAUTHORIZED', message = 'Sesi berakhir. Silakan masuk kembali.') {
    return new ApiError(401, code, message);
  }
  static forbidden(code = 'FORBIDDEN', message = 'Anda tidak memiliki akses ke fitur ini.') {
    return new ApiError(403, code, message);
  }
  static notFound(message = 'Data tidak ditemukan.') {
    return new ApiError(404, 'NOT_FOUND', message);
  }
  static conflict(code: string, message: string) {
    return new ApiError(409, code, message);
  }
}

export function isApiError(e: unknown): e is ApiError {
  return e instanceof ApiError;
}

import type { FastifyReply } from 'fastify';
import { Prisma } from '@prisma/client';

export function errorHandler(err: unknown, _req: unknown, reply: FastifyReply) {
  if (isApiError(err)) {
    return reply.status(err.statusCode).send({
      success: false,
      message: err.message,
      code: err.code,
      ...(err.details !== undefined ? { details: err.details } : {}),
    });
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      return reply.status(409).send({
        success: false,
        message: 'Data sudah pernah dibuat. Periksa kembali NIS/username.',
        code: 'DUPLICATE_RECORD',
      });
    }
    if (err.code === 'P2025') {
      return reply.status(404).send({ success: false, message: 'Data tidak ditemukan.', code: 'NOT_FOUND' });
    }
  }

  const code = (err as { code?: string }).code;
  if (code === 'FST_JWT_NO_AUTHORIZATION_IN_HEADER' || code === 'FST_JWT_AUTHORIZATION_TOKEN_INVALID') {
    return reply.status(401).send({
      success: false,
      message: 'Sesi berakhir. Silakan masuk kembali.',
      code: 'UNAUTHORIZED',
    });
  }
  if (code === 'FST_RATE_LIMIT' || code === 'FST_RATE_LIMIT_EXCEEDED') {
    return reply.status(429).send({
      success: false,
      message: 'Terlalu banyak permintaan. Silakan coba beberapa saat lagi.',
      code: 'RATE_LIMITED',
    });
  }

  // Error lain yang sudah membawa statusCode (mis. 429 dari @fastify/rate-limit
  // yang berupa Error polos tanpa code) — hormati statusnya, jangan jadi 500.
  const status = (err as { statusCode?: number }).statusCode;
  if (typeof status === 'number' && status >= 400 && status < 500) {
    const isRateLimited = status === 429;
    return reply.status(status).send({
      success: false,
      message: isRateLimited
        ? 'Terlalu banyak permintaan. Silakan coba beberapa saat lagi.'
        : (err as Error).message || 'Permintaan tidak dapat diproses.',
      code: isRateLimited ? 'RATE_LIMITED' : 'REQUEST_ERROR',
    });
  }

  // eslint-disable-next-line no-console
  console.error('[error]', err);
  return reply.status(500).send({
    success: false,
    message: 'Data belum dapat disimpan. Silakan coba lagi.',
    code: 'INTERNAL_ERROR',
  });
}
