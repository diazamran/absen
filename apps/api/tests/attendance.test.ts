import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { seedFixture, type Fixture } from './helpers.js';
import { buildApp } from '../src/app.js';
import { issueQrToken } from '../src/services/qr.js';
import { startOfLocalDay } from '../src/lib/time.js';

let fx: Fixture;
let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  fx = await seedFixture();
  app = await buildApp();
});

describe('Mesin Absensi', () => {
  it('check-in via QR berhasil (status sesuai waktu server)', async () => {
    const token = await issueQrToken(fx.studentUserId, 'dynamic');
    const res = await app.inject({
      method: 'POST',
      url: '/api/attendance/qr',
      headers: { authorization: `Bearer ${fx.studentToken}` },
      payload: { type: 'CHECK_IN', token },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.data.fullName).toBe('Siswa Test');
    expect(['PRESENT', 'LATE']).toContain(body.data.status);
  });

  it('absensi ganda ditolak (duplicate prevention)', async () => {
    const token = await issueQrToken(fx.studentUserId, 'dynamic');
    const res = await app.inject({
      method: 'POST',
      url: '/api/attendance/qr',
      headers: { authorization: `Bearer ${fx.studentToken}` },
      payload: { type: 'CHECK_IN', token },
    });
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).code).toBe('ALREADY_ATTENDANCE');
  });

  it('check-out tanpa check-in ditolak', async () => {
    // siswa lain: buat user baru tanpa check-in
    const role = await prisma.role.findUnique({ where: { key: 'STUDENT' } });
    const user = await prisma.user.create({
      data: { username: 'siswa_baru', passwordHash: await (await import('../src/lib/crypto.js')).hashPassword('siswa123'), fullName: 'Siswa Baru', roleId: role!.id },
    });
    await prisma.student.create({ data: { userId: user.id, nis: '999002' } });
    // langsung uji via engine: check-out tanpa check-in
    const { recordAttendance } = await import('../src/services/attendance.js');
    await expect(
      recordAttendance({
        actor: { id: user.id, roleKey: 'STUDENT', request: { ip: '127.0.0.1' } as never },
        type: 'CHECK_OUT',
        method: 'QR',
        proof: { token: await issueQrToken(user.id, 'dynamic') },
      }),
    ).rejects.toMatchObject({ code: 'NO_CHECK_IN' });
  });

  it('absensi manual oleh admin membuat catatan baru + audit log', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/attendance/manual',
      headers: { authorization: `Bearer ${fx.adminToken}` },
      payload: { studentId: fx.studentId, status: 'EXCUSED', type: 'CHECK_IN', checkIn: '07:00', notes: 'uji manual' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.data.status).toBe('EXCUSED');
    const auditCount = await prisma.auditLog.count({
      where: { OR: [{ action: 'ATTENDANCE_MANUAL_CHANGED' }, { action: 'ATTENDANCE_MANUAL_UPDATED' }] },
    });
    expect(auditCount).toBeGreaterThanOrEqual(1);
  });

  it('hapus bersih catatan absensi via DELETE + audit log', async () => {
    const created = await prisma.attendance.create({
      data: {
        userId: fx.studentUserId,
        studentId: fx.studentId,
        date: startOfLocalDay('2026-08-10'),
        type: 'CHECK_IN',
        checkIn: new Date('2026-08-10T01:00:00Z'),
        status: 'PRESENT',
        method: 'MANUAL',
      },
    });
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/attendance/${created.id}`,
      headers: { authorization: `Bearer ${fx.adminToken}` },
    });
    expect(res.statusCode).toBe(200);
    const gone = await prisma.attendance.findUnique({ where: { id: created.id } });
    expect(gone).toBeNull();
    const auditCount = await prisma.auditLog.count({ where: { action: 'ATTENDANCE_DELETED', entityId: created.id } });
    expect(auditCount).toBe(1);
  });

  it('batas akhir absen datang: check-in setelah jam batas ditolak', async () => {
    // Atur batas akhir absen datang = 00:00 (sudah lewat hari ini)
    await prisma.schoolSetting.upsert({
      where: { key: 'attendanceRules' },
      update: { value: { checkInDeadlineHour: 0, checkInDeadlineMinute: 0 } },
      create: { key: 'attendanceRules', value: { checkInDeadlineHour: 0, checkInDeadlineMinute: 0 } },
    });
    try {
      // siswa baru (belum ada catatan hari ini) supaya lolos cek duplikat dulu
      const role = await prisma.role.findUnique({ where: { key: 'STUDENT' } });
      const user = await prisma.user.create({
        data: { username: 'siswa_deadline', passwordHash: await (await import('../src/lib/crypto.js')).hashPassword('siswa123'), fullName: 'Siswa Deadline', roleId: role!.id },
      });
      await prisma.student.create({ data: { userId: user.id, nis: '999003' } });
      const { recordAttendance } = await import('../src/services/attendance.js');
      await expect(
        recordAttendance({
          actor: { id: user.id, roleKey: 'STUDENT', request: { ip: '127.0.0.1' } as never },
          type: 'CHECK_IN',
          method: 'QR',
          proof: { token: await issueQrToken(user.id, 'dynamic') },
        }),
      ).rejects.toMatchObject({ code: 'CHECK_IN_DEADLINE_PASSED' });
    } finally {
      await prisma.schoolSetting.delete({ where: { key: 'attendanceRules' } }).catch(() => {});
    }
    // Default: batas datang 23:59 (tidak dibatasi), pulang awal ikut jam pulang sekolah
    const { getAttendanceRules } = await import('../src/services/settings.js');
    const rules = await getAttendanceRules();
    expect(rules.checkInDeadlineHour).toBe(23);
    expect(rules.checkInDeadlineMinute).toBe(59);
    expect(rules.earlyLeaveBeforeHour).toBe(rules.checkOutAfterHour);
    expect(rules.earlyLeaveBeforeMinute).toBe(rules.checkOutAfterMinute);
  });

  it('koreksi absen via PATCH mengubah status catatan yang sudah ada + audit log', async () => {
    // siswa sudah punya check-in dari tes pertama → ambil id-nya
    const existing = await prisma.attendance.findFirst({
      where: { userId: fx.studentUserId, type: 'CHECK_IN' },
      orderBy: { createdAt: 'desc' },
    });
    expect(existing).toBeTruthy();
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/attendance/${existing!.id}`,
      headers: { authorization: `Bearer ${fx.adminToken}` },
      payload: { status: 'SICK', checkIn: '08:30', notes: 'koreksi wali kelas' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.status).toBe('SICK');
    const updated = await prisma.attendance.findUnique({ where: { id: existing!.id } });
    expect(updated?.status).toBe('SICK');
    expect(updated?.notes).toBe('koreksi wali kelas');
    const auditCount = await prisma.auditLog.count({ where: { action: 'ATTENDANCE_UPDATED' } });
    expect(auditCount).toBeGreaterThanOrEqual(1);
  });
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});
