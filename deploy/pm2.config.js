// ============================================================
// PresensiKu — PM2 Configuration (No Docker)
// Jalankan: pm2 start deploy/pm2.config.js
// ============================================================

const path = require('path');
const fs = require('fs');

// Load .env from project root
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  envContent.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const idx = trimmed.indexOf('=');
    if (idx > 0) {
      const key = trimmed.slice(0, idx).trim();
      const val = trimmed.slice(idx + 1).trim();
      if (!process.env[key]) process.env[key] = val;
    }
  });
}

const baseDir = path.join(__dirname, '..');

module.exports = {
  apps: [
    {
      name: 'presensiku-api',
      cwd: path.join(baseDir, 'apps/api'),
      script: 'node',
      args: 'dist/server.js',
      env: {
        NODE_ENV: 'production',
        DATABASE_URL: process.env.DATABASE_URL || `postgresql://presensiku:${process.env.DB_PASSWORD || 'presensiku123'}@localhost:5432/presensiku?connection_limit=20&pool_timeout=10`,
        REDIS_URL: process.env.REDIS_URL || 'redis://localhost:6379',
        JWT_SECRET: process.env.JWT_SECRET || 'change-me-in-production',
        JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET || 'change-me-refresh',
        APP_NAME: process.env.APP_NAME || 'PresensiKu',
        SCHOOL_NAME: process.env.SCHOOL_NAME || 'SMKN 1 Kras',
        APP_URL: process.env.APP_URL || 'http://localhost',
        CORS_ORIGIN: process.env.CORS_ORIGIN || 'http://localhost',
        TIMEZONE: 'Asia/Jakarta',
        TZ: 'Asia/Jakarta',
        STORAGE_DRIVER: 'local',
        FACE_RECOGNITION_PROVIDER: 'mock',
      },
      max_memory_restart: '256M',
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: path.join(baseDir, 'logs/api-error.log'),
      out_file: path.join(baseDir, 'logs/api-out.log'),
      merge_logs: true,
    },
  ],
};
