import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { faceService } from '../services/face.js';
import { validate } from '../utils/validate.js';
import { ApiError } from '../utils/errors.js';
import { audit } from '../lib/audit.js';
import { PERMISSION_KEYS } from '../rbac/permissions.js';

export async function faceRoutes(app: FastifyInstance) {
  // Registrasi wajah (admin untuk siswa; user juga bisa untuk dirinya sendiri)
  app.post('/face/register', { preHandler: app.requirePermission(PERMISSION_KEYS.faceRegister), config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    const body = validate(
      z.object({
        userId: z.string().optional(),
        samples: z.array(z.string().min(10)).min(1).max(8),
        consent: z.boolean().default(true),
      }),
      request.body,
    );

    const targetId = body.userId ?? request.user!.id;
    const target = await prisma.user.findUnique({ where: { id: targetId } });
    if (!target) throw ApiError.notFound('Pengguna tidak ditemukan.');

    // Izin: admin/self; siswa harus di-register oleh admin/guru
    if (request.user!.id !== targetId && !['ADMIN', 'SUPER_ADMIN', 'HOMEROOM_TEACHER', 'TEACHER'].includes(request.user!.roleKey)) {
      throw ApiError.forbidden();
    }

    const result = await faceService.enroll(targetId, body.samples);
    await prisma.student.updateMany({ where: { userId: targetId }, data: { faceRegistered: true } });

    await audit({
      userId: request.user!.id,
      action: 'FACE_REGISTERED',
      entity: 'FaceProfile',
      entityId: targetId,
      newValue: { samples: body.samples.length, provider: faceService.name, consent: body.consent },
      request,
    });

    return reply.send({
      success: true,
      message: 'Registrasi wajah berhasil.',
      data: { userId: targetId, samples: body.samples.length, dimensions: result.dimensions, provider: faceService.name },
    });
  });

  // Status registrasi wajah
  app.get('/face/status/:userId', { preHandler: app.authenticate }, async (request, reply) => {
    const { userId } = request.params as { userId: string };
    const profile = await prisma.faceProfile.findUnique({
      where: { userId },
      include: { embeddings: { select: { id: true, dimensions: true, version: true, createdAt: true } } },
    });
    return reply.send({
      success: true,
      data: {
        registered: !!profile && profile.status === 'REGISTERED',
        status: profile?.status ?? 'PENDING',
        provider: profile?.provider ?? null,
        samples: profile?.samplesCount ?? 0,
        consentAt: profile?.consentAt ?? null,
        embeddingsCount: profile?.embeddings.length ?? 0,
        // Data biometrik tidak pernah diekspos
      },
    });
  });

  // Reset/hapus data wajah (privasi: siswa berhak dihapus)
  app.delete('/face/:userId', { preHandler: app.requirePermission(PERMISSION_KEYS.faceDelete) }, async (request, reply) => {
    const { userId } = request.params as { userId: string };
    await faceService.deleteEmbeddings(userId);
    await prisma.student.updateMany({ where: { userId }, data: { faceRegistered: false } });
    await audit({
      userId: request.user!.id,
      action: 'FACE_DELETED',
      entity: 'FaceProfile',
      entityId: userId,
      request,
    });
    return reply.send({ success: true, message: 'Data wajah telah dihapus.' });
  });
}
