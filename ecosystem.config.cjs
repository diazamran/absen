/**
 * PM2 Ecosystem Config — Presensiku
 * Jalankan: pm2 start ecosystem.config.cjs
 * Reload  : pm2 reload presensiku-api --update-env
 */
require('dotenv').config({ path: __dirname + '/.env' });

module.exports = {
  apps: [
    {
      name: 'presensiku-api',
      script: './apps/api/dist/server.js',
      cwd: '/opt/presensiku',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',

      // Muat semua env dari .env root sekaligus override eksplisit
      env: {
        NODE_ENV: 'production',
        DATABASE_URL:       process.env.DATABASE_URL,
        JWT_SECRET:         process.env.JWT_SECRET,
        JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET,
        JWT_ACCESS_TTL:     process.env.JWT_ACCESS_TTL     || '8h',
        JWT_REFRESH_TTL:    process.env.JWT_REFRESH_TTL    || '30d',
        APP_NAME:           process.env.APP_NAME           || 'PresensiKu',
        SCHOOL_NAME:        process.env.SCHOOL_NAME        || 'SMKN 1 Kras',
        APP_URL:            process.env.APP_URL            || 'https://absen.smkn1kras.sch.id',
        API_URL:            process.env.API_URL            || 'https://absen.smkn1kras.sch.id',
        API_PORT:           process.env.APP_PORT           || '4000',
        CORS_ORIGIN:        process.env.CORS_ORIGIN        || 'https://absen.smkn1kras.sch.id',
        TIMEZONE:           process.env.TIMEZONE           || 'Asia/Jakarta',
        SSO_SECRET:         process.env.SSO_SECRET         || 'sso_secret_absen_smkn1kras_2026',
        // Tambahkan env lain dari .env jika perlu
        STUDENT_DEFAULT_PASSWORD: process.env.STUDENT_DEFAULT_PASSWORD || 'smkn1kras',
        REDIS_URL:          process.env.REDIS_URL          || '',
        STORAGE_DRIVER:     process.env.STORAGE_DRIVER     || 'local',
      },

      // Log
      error_file: '/opt/presensiku/logs/pm2-error.log',
      out_file:   '/opt/presensiku/logs/pm2-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
    },
  ],
};
