import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { seedFixture, type Fixture } from './helpers.js';
import { buildApp } from '../src/app.js';
import { hashPassword } from '../src/lib/crypto.js';

let fx: Fixture;
let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  fx = await seedFixture();
  app = await buildApp();
});

describe('Reset password siswa', () => {
  it('tanpa login ditolak (401)', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/students/reset-password', payload: { ids: [fx.studentId] } });
    expect(res.statusCode).toBe(401);
  });

  it('login siswa (non-admin) ditolak (403)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/students/reset-password',
      headers: { authorization: `Bearer ${fx.studentToken}` },
      payload: { ids: [fx.studentId] },
    });
    expect(res.statusCode).toBe(403);
  });

  it('reset massal mengembalikan password ke smkn1kras', async () => {
    // ubah password siswa ke nilai lain dulu agar reset terbukti bekerja
    await prisma.user.update({ where: { id: fx.studentUserId }, data: { passwordHash: await hashPassword('rahasia-baru') } });
    const loginBefore = await app.inject({ method: 'POST', url: '/api/auth/login-student', payload: { nis: '999001', password: 'smkn1kras' } });
    expect(loginBefore.statusCode).toBe(401);

    const reset = await app.inject({
      method: 'POST',
      url: '/api/students/reset-password',
      headers: { authorization: `Bearer ${fx.adminToken}` },
      payload: { ids: [fx.studentId] },
    });
    expect(reset.statusCode).toBe(200);
    expect(JSON.parse(reset.body).data.count).toBe(1);

    const loginAfter = await app.inject({ method: 'POST', url: '/api/auth/login-student', payload: { nis: '999001', password: 'smkn1kras' } });
    expect(loginAfter.statusCode).toBe(200);
    expect(JSON.parse(loginAfter.body).data.user.student.nis).toBe('999001');
  });
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});
