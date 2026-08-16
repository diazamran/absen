import 'dotenv/config';

const num = (v: string | undefined, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

export const config = {
  nodeEnv: process.env.NODE_ENV || 'development',
  appName: process.env.APP_NAME || 'PresensiKu',
  schoolName: process.env.SCHOOL_NAME || 'SMA Negeri 1 Nusantara',
  // Password default akun siswa (bisa direset massal dari menu Siswa)
  defaultStudentPassword: process.env.STUDENT_DEFAULT_PASSWORD || 'smkn1kras',
  apiUrl: process.env.API_URL || 'http://localhost:4000',
  appUrl: process.env.APP_URL || 'http://localhost:5173',
  timezone: process.env.TIMEZONE || 'Asia/Jakarta',
  port: num(process.env.API_PORT, 4000),

  databaseUrl: process.env.DATABASE_URL || '',

  jwtSecret: process.env.JWT_SECRET || 'dev-secret',
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret',
  jwtAccessTtl: process.env.JWT_ACCESS_TTL || '8h',
  jwtRefreshTtl: process.env.JWT_REFRESH_TTL || '30d',
  corsOrigin: (process.env.CORS_ORIGIN || 'http://localhost:5173').split(','),
  otpDevPreview: process.env.OTP_DEV_PREVIEW !== 'false',

  // Aturan absensi
  lateAfterHour: num(process.env.LATE_AFTER_HOUR, 7),
  lateAfterMinute: num(process.env.LATE_AFTER_MINUTE, 0),
  checkOutAfterHour: num(process.env.CHECK_OUT_AFTER_HOUR, 15),
  checkOutAfterMinute: num(process.env.CHECK_OUT_AFTER_MINUTE, 30),
  locationEnabled: process.env.LOCATION_ENABLED === 'true',
  locationRadiusMeters: num(process.env.LOCATION_RADIUS_METERS, 100),
  schoolLatitude: num(process.env.SCHOOL_LATITUDE, -6.2088),
  schoolLongitude: num(process.env.SCHOOL_LONGITUDE, 106.8456),

  storage: {
    driver: process.env.STORAGE_DRIVER || 'local',
    endpoint: process.env.STORAGE_ENDPOINT || '',
    bucket: process.env.STORAGE_BUCKET || 'presensiku',
    accessKey: process.env.STORAGE_ACCESS_KEY || '',
    secretKey: process.env.STORAGE_SECRET_KEY || '',
    publicUrl: process.env.STORAGE_PUBLIC_URL || '',
  },

  faceProvider: process.env.FACE_RECOGNITION_PROVIDER || 'mock',
  whatsappProvider: process.env.WHATSAPP_PROVIDER || 'none',
  whatsappApiKey: process.env.WHATSAPP_API_KEY || '',

  smtp: {
    host: process.env.SMTP_HOST || '',
    port: num(process.env.SMTP_PORT, 587),
    user: process.env.SMTP_USER || '',
    password: process.env.SMTP_PASSWORD || '',
  },

  redisUrl: process.env.REDIS_URL || '',
};
