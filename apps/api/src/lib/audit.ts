import { prisma } from './prisma.js';
import type { FastifyRequest } from 'fastify';
import { Prisma } from '@prisma/client';

export interface AuditParams {
  userId?: string | null;
  action: string;
  entity?: string | null;
  entityId?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  request?: FastifyRequest;
}

/** Catat aktivitas penting ke audit log. Tidak pernah throw. */
export async function audit(params: AuditParams): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId: params.userId ?? null,
        action: params.action,
        entity: params.entity ?? null,
        entityId: params.entityId ?? null,
        oldValue: params.oldValue === undefined ? undefined : ((params.oldValue as Prisma.InputJsonValue) ?? Prisma.JsonNull),
        newValue: params.newValue === undefined ? undefined : ((params.newValue as Prisma.InputJsonValue) ?? Prisma.JsonNull),
        ipAddress: params.request?.ip ?? null,
        userAgent: params.request?.headers?.['user-agent'] ?? null,
      },
    });
  } catch (e) {
    // Audit tidak boleh menggagalkan operasi utama
    // eslint-disable-next-line no-console
    console.error('[audit] gagal mencatat:', e);
  }
}
