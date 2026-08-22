import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { errorHandler } from './utils/errors.js';
import { authPlugin } from './plugins/auth.js';
import { rbacPlugin } from './plugins/rbac.js';

import { healthRoutes } from './routes/health.js';
import { authRoutes } from './routes/auth.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { attendanceRoutes } from './routes/attendance.js';
import { faceRoutes } from './routes/face.js';
import { qrRoutes } from './routes/qr.js';
import { cardRoutes } from './routes/cards.js';
import { studentRoutes } from './routes/students.js';
import { userRoutes } from './routes/users.js';
import { akademikRoutes } from './routes/akademik.js';
import { leaveRoutes } from './routes/leave.js';
import { journalRoutes } from './routes/journals.js';
import { reportRoutes } from './routes/reports.js';
import { notificationRoutes } from './routes/notifications.js';
import { deviceRoutes } from './routes/devices.js';
import { auditRoutes } from './routes/audit.js';
import { settingRoutes } from './routes/settings.js';
import { uploadRoutes } from './routes/upload.js';
import { importRoutes } from './routes/import.js';
import { pklRoutes } from './routes/pkl.js';
import { sdmsRoutes } from './routes/sdms.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = path.resolve(__dirname, '../uploads');

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: config.nodeEnv === 'development' ? { transport: undefined, level: 'warn' } : false,
    bodyLimit: 10 * 1024 * 1024,
    trustProxy: true,
  });

  // ===== Security =====
  await app.register(helmet, {
    contentSecurityPolicy: false, // PWA/камера membutuhkan kebijakan dari frontend
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  });
  await app.register(cors, {
    origin: config.corsOrigin,
    credentials: true,
  });

  // Auth dulu (onRequest global) agar request.user tersedia bagi rate-limit keyGenerator
  await app.register(authPlugin);
  await app.register(rbacPlugin);

  await app.register(rateLimit, {
    max: 300,
    timeWindow: '1 minute',
    enableDraftSpec: true,
    // Kunci per USER (bukan per IP): ratusan siswa di belakang 1 IP NAT sekolah
    // tetap mendapat jatah masing-masing saat jam ramai.
    keyGenerator: (request) => {
      const user = (request as { user?: { id: string } }).user;
      return user?.id ?? request.ip;
    },
  });
  await app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024, files: 1 } });

  // Static uploads
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  await app.register(fastifyStatic, {
    root: UPLOADS_DIR,
    prefix: '/uploads/',
  });

  // ===== Error handler standar =====
  app.setErrorHandler(errorHandler as never);

  // ===== Routes (semua di bawah /api) =====
  await app.register(async (api) => {
    api.addHook('onRequest', async (request) => {
      // request.user diisi oleh authPlugin global
      void request;
    });
    await api.register(healthRoutes);
    await api.register(authRoutes);
    await api.register(dashboardRoutes);
    await api.register(attendanceRoutes);
    await api.register(faceRoutes);
    await api.register(qrRoutes);
    await api.register(cardRoutes);
    await api.register(studentRoutes);
    await api.register(userRoutes);
    await api.register(akademikRoutes);
    await api.register(leaveRoutes);
    await api.register(journalRoutes);
    await api.register(reportRoutes);
    await api.register(notificationRoutes);
    await api.register(deviceRoutes);
    await api.register(auditRoutes);
    await api.register(settingRoutes);
    await api.register(uploadRoutes);
    await api.register(importRoutes);
    await api.register(pklRoutes);
    await api.register(sdmsRoutes);
  }, { prefix: '/api' });

  // 404 API
  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith('/api/')) {
      return reply.status(404).send({
        success: false,
        message: 'Endpoint tidak ditemukan.',
        code: 'NOT_FOUND',
      });
    }
    return reply.status(404).send({ success: false, message: 'Halaman tidak ditemukan.', code: 'NOT_FOUND' });
  });

  return app;
}
