import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { faceService } from '../services/face.js';
import { validate } from '../utils/validate.js';
import { ApiError } from '../utils/errors.js';
import { audit } from '../lib/audit.js';
import { PERMISSION_KEYS, roleHasPermission } from '../rbac/permissions.js';

/** Role yang bisa langsung mengaktifkan wajah (approver). */
const APPROVER_ROLES = new Set(['ADMIN', 'SUPER_ADMIN']);

export async function faceRoutes(app: FastifyInstance) {
  // Registrasi wajah:
  //  - oleh siswa (diri sendiri) / guru untuk siswa → status PENDING, menunggu persetujuan admin
  //  - oleh admin/super admin → langsung REGISTERED (aktif)
  app.post('/face/register', { preHandler: app.requirePermission(PERMISSION_KEYS.faceRegister), config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    const body = validate(
      z.object({
        userId: z.string().optional(),
        descriptors: z.array(z.array(z.number())).min(1).max(8),
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

    const isApprover = APPROVER_ROLES.has(request.user!.roleKey);
    // Registrasi oleh approver → langsung aktif; selain itu menunggu persetujuan admin
    const status = isApprover ? ('REGISTERED' as const) : ('PENDING' as const);

    const result = await faceService.enroll(targetId, body.descriptors, {
      status,
      registeredBy: isApprover ? request.user!.id : null,
    });
    if (status === 'REGISTERED') {
      await prisma.student.updateMany({ where: { userId: targetId }, data: { faceRegistered: true } });
    }

    await audit({
      userId: request.user!.id,
      action: 'FACE_REGISTERED',
      entity: 'FaceProfile',
      entityId: targetId,
      newValue: { samples: body.descriptors.length, provider: faceService.name, consent: body.consent, status },
      request,
    });

    return reply.send({
      success: true,
      message: status === 'PENDING' ? 'Registrasi wajah dikirim. Menunggu persetujuan admin.' : 'Registrasi wajah berhasil.',
      data: {
        userId: targetId,
        samples: body.descriptors.length,
        dimensions: result.dimensions,
        provider: faceService.name,
        status,
      },
    });
  });

  // Daftar wajah yang menunggu persetujuan (admin)
  app.get('/face/pending', { preHandler: app.requirePermission(PERMISSION_KEYS.faceApprove) }, async (_request, reply) => {
    const rows = await prisma.faceProfile.findMany({
      where: { status: 'PENDING' },
      include: {
        user: { select: { id: true, fullName: true } },
        embeddings: { select: { id: true, dimensions: true, createdAt: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    // Ambil info siswa sekaligus
    const userIds = rows.map((r) => r.userId);
    const students = await prisma.student.findMany({
      where: { userId: { in: userIds } },
      include: { class: { select: { name: true } } },
    });
    const studentMap = new Map(students.map((s) => [s.userId, s]));
    return reply.send({
      success: true,
      data: rows.map((r) => {
        const st = r.userId ? studentMap.get(r.userId) : undefined;
        return {
          userId: r.userId,
          fullName: r.user?.fullName ?? '-',
          nis: st?.nis ?? null,
          className: st?.class?.name ?? null,
          samples: r.samplesCount,
          embeddingsCount: r.embeddings.length,
          submittedAt: r.createdAt,
        };
      }),
    });
  });

  // Persetujuan oleh admin → wajah langsung aktif untuk absensi
  app.post('/face/:userId/approve', { preHandler: app.requirePermission(PERMISSION_KEYS.faceApprove) }, async (request, reply) => {
    const { userId } = request.params as { userId: string };
    const profile = await prisma.faceProfile.findUnique({ where: { userId } });
    if (!profile) throw ApiError.notFound('Data wajah tidak ditemukan.');
    if (profile.status === 'REGISTERED') {
      return reply.send({ success: true, message: 'Wajah sudah aktif.' });
    }
    await prisma.faceProfile.update({
      where: { userId },
      data: { status: 'REGISTERED', registeredBy: request.user!.id },
    });
    await prisma.student.updateMany({ where: { userId }, data: { faceRegistered: true } });

    await audit({
      userId: request.user!.id,
      action: 'FACE_APPROVED',
      entity: 'FaceProfile',
      entityId: userId,
      request,
    });

    return reply.send({ success: true, message: 'Registrasi wajah disetujui. Siswa kini dapat absen wajah.' });
  });

  // Status registrasi wajah
  app.get('/face/status/:userId', { preHandler: app.authenticate }, async (request, reply) => {
    const { userId } = request.params as { userId: string };
    const profile = await prisma.faceProfile.findUnique({
      where: { userId },
      include: { embeddings: { select: { id: true, dimensions: true, version: true, createdAt: true } } },
    });
    const latestVersion = profile?.embeddings[0]?.version ?? null;
    return reply.send({
      success: true,
      data: {
        registered: !!profile && profile.status === 'REGISTERED',
        pending: !!profile && profile.status === 'PENDING',
        status: profile?.status ?? 'PENDING',
        provider: profile?.provider ?? null,
        samples: profile?.samplesCount ?? 0,
        consentAt: profile?.consentAt ?? null,
        embeddingsCount: profile?.embeddings.length ?? 0,
        // Wajah terdaftar dengan versi LAMA (mock ahash) → harus daftar ulang agar bisa dipakai
        needsReenroll: !!profile && profile.status === 'REGISTERED' && profile.provider !== 'facenet-web',
        version: latestVersion,
        // Data biometrik tidak pernah diekspos
      },
    });
  });

  // Daftar siswa yang sudah punya wajah terdaftar (untuk bulk reset)
  app.get('/face/registered', { preHandler: app.requirePermission(PERMISSION_KEYS.faceDelete) }, async (request, reply) => {
    const profiles = await prisma.faceProfile.findMany({
      where: { status: 'REGISTERED' },
      include: {
        user: {
          include: {
            student: { include: { class: { select: { name: true } } } },
            teacher: { select: { nip: true } },
          },
        },
        embeddings: { select: { id: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });
    return reply.send({
      success: true,
      data: profiles.map((p) => ({
        userId: p.userId,
        fullName: p.user?.fullName ?? '-',
        nis: p.user?.student?.nis ?? null,
        className: p.user?.student?.class?.name ?? null,
        samples: p.samplesCount,
        embeddingsCount: p.embeddings.length,
        status: p.status,
      })),
    });
  });

  // Reset/hapus data wajah — hanya admin/superadmin yang bisa reset wajah siswa
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
