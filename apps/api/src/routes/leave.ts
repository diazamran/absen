import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { validate } from '../utils/validate.js';
import { ApiError } from '../utils/errors.js';
import { audit } from '../lib/audit.js';
import { sendNotification, notifyParentsOfStudent } from '../services/notify.js';
import { emitLeaveUpdate } from '../realtime/emitter.js';
import { PERMISSION_KEYS } from '../rbac/permissions.js';
import { startOfLocalDay } from '../lib/time.js';

const leaveCreateSchema = z.object({
  type: z.enum(['SICK', 'PERSONAL', 'LEAVE', 'OFFICIAL_DUTY', 'OTHER']),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason: z.string().min(5, 'Alasan minimal 5 karakter.'),
  attachmentUrl: z.string().optional(),
});

export async function leaveRoutes(app: FastifyInstance) {
  // ===== Kirim pengajuan =====
  app.post('/leave', { preHandler: app.requirePermission(PERMISSION_KEYS.leaveCreate) }, async (request, reply) => {
    const body = validate(leaveCreateSchema, request.body);
    const user = await prisma.user.findUnique({ where: { id: request.user!.id }, include: { student: true } });

    const leave = await prisma.leaveRequest.create({
      data: {
        userId: request.user!.id,
        studentId: user?.student?.id,
        type: body.type,
        startDate: startOfLocalDay(body.startDate),
        endDate: startOfLocalDay(body.endDate),
        reason: body.reason,
        attachmentUrl: body.attachmentUrl,
      },
    });

    await audit({ userId: request.user!.id, action: 'LEAVE_CREATED', entity: 'LeaveRequest', entityId: leave.id, request });
    emitLeaveUpdate({ id: leave.id, action: 'created' });
    return reply.send({ success: true, message: 'Pengajuan izin berhasil dikirim.', data: leave });
  });

  // ===== Daftar pengajuan saya =====
  app.get('/leave/mine', { preHandler: app.authenticate }, async (request, reply) => {
    const rows = await prisma.leaveRequest.findMany({
      where: { userId: request.user!.id },
      orderBy: { createdAt: 'desc' },
    });
    return reply.send({ success: true, data: rows });
  });

  // ===== Semua pengajuan (admin/wali) =====
  app.get('/leave', { preHandler: app.requirePermission(PERMISSION_KEYS.leaveRead) }, async (request, reply) => {
    const q = request.query as { status?: string; classId?: string };
    const where: Record<string, unknown> = {};
    if (q.status) where.status = q.status;
    if (q.classId) where.student = { classId: q.classId };
    const rows = await prisma.leaveRequest.findMany({
      where,
      include: {
        user: { select: { fullName: true } },
        student: { include: { class: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return reply.send({
      success: true,
      data: rows.map((r) => ({
        id: r.id,
        userName: r.user?.fullName ?? '-',
        nis: r.student?.nis ?? null,
        className: r.student?.class?.name ?? null,
        type: r.type,
        startDate: r.startDate,
        endDate: r.endDate,
        reason: r.reason,
        attachmentUrl: r.attachmentUrl,
        status: r.status,
        submittedAt: r.submittedAt,
        rejectionReason: r.rejectionReason,
        reviewedAt: r.reviewedAt,
      })),
    });
  });

  // ===== Setujui =====
  app.post('/leave/:id/approve', { preHandler: app.requirePermission(PERMISSION_KEYS.leaveApprove) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const leave = await prisma.leaveRequest.findUnique({ where: { id }, include: { user: true } });
    if (!leave) throw ApiError.notFound('Pengajuan tidak ditemukan.');
    if (leave.status !== 'PENDING') throw ApiError.conflict('LEAVE_ALREADY_PROCESSED', 'Pengajuan ini sudah diproses.');

    const updated = await prisma.leaveRequest.update({
      where: { id },
      data: { status: 'APPROVED', reviewedAt: new Date(), reviewedById: request.user!.id },
    });
    await prisma.leaveApproval.create({
      data: { leaveRequestId: id, approverId: request.user!.id, action: 'APPROVE' },
    });

    await audit({ userId: request.user!.id, action: 'LEAVE_APPROVED', entity: 'LeaveRequest', entityId: id, request });
    await sendNotification({
      userId: leave.userId,
      title: 'Izin Disetujui',
      body: `Pengajuan izin Anda (${leave.type}) telah disetujui.`,
    });
    if (leave.studentId) {
      await notifyParentsOfStudent(leave.studentId, 'Izin Disetujui', `Izin ${leave.user?.fullName ?? 'anak Anda'} telah disetujui.`);
    }
    emitLeaveUpdate({ id, action: 'approved' });
    return reply.send({ success: true, message: 'Pengajuan disetujui.', data: updated });
  });

  // ===== Tolak =====
  app.post('/leave/:id/reject', { preHandler: app.requirePermission(PERMISSION_KEYS.leaveApprove) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = validate(z.object({ reason: z.string().min(1, 'Alasan penolakan wajib diisi.') }), request.body);
    const leave = await prisma.leaveRequest.findUnique({ where: { id } });
    if (!leave) throw ApiError.notFound('Pengajuan tidak ditemukan.');
    if (leave.status !== 'PENDING') throw ApiError.conflict('LEAVE_ALREADY_PROCESSED', 'Pengajuan ini sudah diproses.');

    const updated = await prisma.leaveRequest.update({
      where: { id },
      data: { status: 'REJECTED', rejectionReason: body.reason, reviewedAt: new Date(), reviewedById: request.user!.id },
    });
    await prisma.leaveApproval.create({
      data: { leaveRequestId: id, approverId: request.user!.id, action: 'REJECT', note: body.reason },
    });

    await audit({
      userId: request.user!.id,
      action: 'LEAVE_REJECTED',
      entity: 'LeaveRequest',
      entityId: id,
      newValue: { reason: body.reason },
      request,
    });
    await sendNotification({
      userId: leave.userId,
      title: 'Izin Ditolak',
      body: `Pengajuan izin Anda ditolak: ${body.reason}`,
    });
    emitLeaveUpdate({ id, action: 'rejected' });
    return reply.send({ success: true, message: 'Pengajuan ditolak.', data: updated });
  });

  // ===== Hapus (super admin) =====
  app.delete('/leave/:id', { preHandler: app.requirePermission(PERMISSION_KEYS.leaveDelete) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const leave = await prisma.leaveRequest.findUnique({ where: { id } });
    if (!leave) throw ApiError.notFound('Pengajuan tidak ditemukan.');
    await prisma.leaveApproval.deleteMany({ where: { leaveRequestId: id } });
    await prisma.leaveRequest.delete({ where: { id } });
    await audit({
      userId: request.user!.id,
      action: 'LEAVE_DELETED',
      entity: 'LeaveRequest',
      entityId: id,
      request,
    });
    return reply.send({ success: true, message: 'Pengajuan izin berhasil dihapus.' });
  });
}
