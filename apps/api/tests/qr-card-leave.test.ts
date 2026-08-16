import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { seedFixture, type Fixture } from './helpers.js';
import { buildApp } from '../src/app.js';
import { signToken, verifyToken } from '../src/lib/crypto.js';
import { config } from '../src/config.js';

let fx: Fixture;
let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  fx = await seedFixture();
  app = await buildApp();
});

describe('Validasi QR', () => {
  it('token QR kedaluwarsa ditolak (EXPIRED_QR)', async () => {
    // token dengan exp sudah lewat
    const expired = signToken({ sub: fx.studentUserId, typ: 'dynamic', nonce: 'x' }, config.jwtSecret, -10);
    const { verifyQrToken } = await import('../src/services/qr.js');
    await expect(verifyQrToken(expired)).rejects.toMatchObject({ code: 'EXPIRED_QR' });
  });

  it('token QR dengan signature salah ditolak (INVALID_QR)', async () => {
    const { verifyQrToken } = await import('../src/services/qr.js');
    const tampered = `${signToken({ sub: fx.studentUserId, typ: 'dynamic', nonce: 'x' }, config.jwtSecret, 60)}tampered`;
    await expect(verifyQrToken(tampered)).rejects.toMatchObject({ code: 'INVALID_QR' });
  });

  it('token QR kartu dengan nonce valid diterima', async () => {
    const { issueQrToken, verifyQrToken } = await import('../src/services/qr.js');
    const token = await issueQrToken(fx.studentUserId, 'student-card');
    const res = await verifyQrToken(token);
    expect(res.valid).toBe(true);
    expect(res.userId).toBe(fx.studentUserId);
  });
});

describe('Validasi Kartu', () => {
  it('UID kartu terdaftar → userId sesuai', async () => {
    const { verifyCard } = await import('../src/services/card.js');
    const res = await verifyCard('CARD-TEST-001');
    expect(res.userId).toBe(fx.studentUserId);
  });

  it('UID kartu tidak dikenal → CARD_NOT_REGISTERED', async () => {
    const { verifyCard } = await import('../src/services/card.js');
    await expect(verifyCard('CARD-TIDAK-ADA')).rejects.toMatchObject({ code: 'CARD_NOT_REGISTERED' });
  });
});

describe('Persetujuan Izin', () => {
  it('pengajuan → disetujui admin → notifikasi', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/leave',
      headers: { authorization: `Bearer ${fx.studentToken}` },
      payload: { type: 'SICK', startDate: '2026-08-17', endDate: '2026-08-17', reason: 'Demam tinggi, perlu istirahat.' },
    });
    expect(create.statusCode).toBe(200);
    const leaveId = JSON.parse(create.body).data.id;

    const approve = await app.inject({
      method: 'POST',
      url: `/api/leave/${leaveId}/approve`,
      headers: { authorization: `Bearer ${fx.adminToken}` },
    });
    expect(approve.statusCode).toBe(200);
    expect(JSON.parse(approve.body).data.status).toBe('APPROVED');

    const notif = await prisma.notification.findFirst({ where: { userId: fx.studentUserId } });
    expect(notif?.title).toBe('Izin Disetujui');
  });

  it('penolakan membutuhkan alasan', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/leave',
      headers: { authorization: `Bearer ${fx.studentToken}` },
      payload: { type: 'PERSONAL', startDate: '2026-08-18', endDate: '2026-08-18', reason: 'Ada keperluan keluarga penting.' },
    });
    const leaveId = JSON.parse(create.body).data.id;

    const rejectNoReason = await app.inject({
      method: 'POST',
      url: `/api/leave/${leaveId}/reject`,
      headers: { authorization: `Bearer ${fx.adminToken}` },
      payload: {},
    });
    expect(rejectNoReason.statusCode).toBe(400);

    const reject = await app.inject({
      method: 'POST',
      url: `/api/leave/${leaveId}/reject`,
      headers: { authorization: `Bearer ${fx.adminToken}` },
      payload: { reason: 'Surat izin belum lengkap.' },
    });
    expect(reject.statusCode).toBe(200);
    expect(JSON.parse(reject.body).data.status).toBe('REJECTED');
  });
});

describe('Laporan', () => {
  it('laporan harian mengembalikan ringkasan', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/reports/daily',
      headers: { authorization: `Bearer ${fx.adminToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data).toHaveProperty('summary');
    expect(body.data).toHaveProperty('rows');
  });

  it('export CSV mengembalikan file', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/reports/export?report=daily',
      headers: { authorization: `Bearer ${fx.adminToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
  });
});

describe('Face Recognition Service', () => {
  it('provider mock: enroll lalu verifikasi frame cocok', async () => {
    const { faceService } = await import('../src/services/face.js');
    const { MockImageMaker } = await import('./mock-image.js');
    const frames = [0, 1, 2].map((i) => MockImageMaker.jpg(i));
    await faceService.enroll(fx.studentUserId, frames);
    const result = await faceService.verify(MockImageMaker.jpg(3), { prevImage: MockImageMaker.jpg(2) });
    expect(result.userId).toBe(fx.studentUserId);
    expect(result.liveness).toBe(true);
    expect(result.confidence).toBeGreaterThan(0.5);
  });
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});
