import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { seedFixture, type Fixture } from './helpers.js';
import { buildApp } from '../src/app.js';

let fx: Fixture;
let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  fx = await seedFixture();
  app = await buildApp();
});

describe('Autentikasi', () => {
  it('login berhasil mengembalikan access + refresh token', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'siswa_test', password: 'siswa123' } });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.data.accessToken).toBeTruthy();
    expect(body.data.refreshToken).toBeTruthy();
    expect(body.data.user.roleKey).toBe('STUDENT');
  });

  it('login gagal dengan password salah', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'siswa_test', password: 'salah' } });
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).code).toBe('INVALID_CREDENTIALS');
  });

  it('refresh token berputar (rotasi)', async () => {
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'siswa_test', password: 'siswa123' } });
    const refresh = JSON.parse(login.body).data.refreshToken;
    const res1 = await app.inject({ method: 'POST', url: '/api/auth/refresh', payload: { refreshToken: refresh } });
    expect(res1.statusCode).toBe(200);
    const newRefresh = JSON.parse(res1.body).data.refreshToken;
    // token lama sudah dicabut
    const res2 = await app.inject({ method: 'POST', url: '/api/auth/refresh', payload: { refreshToken: refresh } });
    expect(res2.statusCode).toBe(401);
    expect(newRefresh).not.toBe(refresh);
  });

  it('/auth/me membutuhkan autentikasi', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/auth/me' });
    expect(res.statusCode).toBe(401);
  });
});

describe('RBAC', () => {
  it('siswa TIDAK bisa mengakses daftar siswa (forbidden)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/students',
      headers: { authorization: `Bearer ${fx.studentToken}` },
    });
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).code).toBe('FORBIDDEN');
  });

  it('siswa TIDAK bisa menyetujui izin', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/leave/abc/approve',
      headers: { authorization: `Bearer ${fx.studentToken}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('admin bisa mengakses daftar siswa', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/students',
      headers: { authorization: `Bearer ${fx.adminToken}` },
    });
    expect(res.statusCode).toBe(200);
  });

  it('token tidak valid ditolak', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/dashboard', headers: { authorization: 'Bearer abc.def.ghi' } });
    expect(res.statusCode).toBe(401);
  });
});

describe('OTP', () => {
  it('OTP untuk nomor belum terdaftar ditolak', async () => {
    const request = await app.inject({ method: 'POST', url: '/api/auth/otp/request', payload: { phone: '081234567899', purpose: 'reset-password' } });
    expect(request.statusCode).toBe(400); // nomor belum terdaftar
    expect(JSON.parse(request.body).code).toBe('PHONE_NOT_REGISTERED');
  });
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});
