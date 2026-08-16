import type { ZodTypeAny, z } from 'zod';
import { ApiError } from './errors.js';

export function validate<S extends ZodTypeAny>(schema: S, data: unknown): z.output<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const first = result.error.errors[0];
    const message = first
      ? `${first.path.join('.')}: ${first.message}`
      : 'Data yang dikirim tidak valid.';
    throw ApiError.badRequest('VALIDATION_ERROR', message, result.error.flatten());
  }
  return result.data;
}
