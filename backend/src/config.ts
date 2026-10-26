import 'dotenv/config';
import path from 'node:path';

function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === '') throw new Error(`Missing required environment variable ${name}`);
  return v;
}

const isProd = process.env.NODE_ENV === 'production';
const corsOrigins = required('CORS_ORIGINS', isProd ? undefined : 'http://localhost:5173')
  .split(',').map((s) => s.trim()).filter(Boolean);
const appUrl = required('APP_URL', isProd ? undefined : 'http://localhost:5173');
const jwtSecret = required('JWT_SECRET', isProd ? undefined : 'dev-only-insecure-secret-change-me');
const rateLimitDisabled = process.env.RATE_LIMIT_DISABLED === 'true';

if (isProd) {
  if (corsOrigins.includes('*')) throw new Error('CORS_ORIGINS must be an explicit origin allow-list in production');
  if (corsOrigins.some((origin) => {
    try {
      const url = new URL(origin);
      return url.protocol !== 'https:' || url.origin !== origin;
    } catch { return true; }
  })) throw new Error('Every production CORS_ORIGINS value must be a bare HTTPS origin');
  try {
    const url = new URL(appUrl);
    if (url.protocol !== 'https:' || url.pathname !== '/' || url.search || url.hash) throw new Error();
  } catch { throw new Error('APP_URL must be a public HTTPS origin in production'); }
  if (jwtSecret.length < 32) throw new Error('JWT_SECRET must be at least 32 characters in production');
  if (rateLimitDisabled) throw new Error('RATE_LIMIT_DISABLED cannot be enabled in production');
}

export const config = {
  env: process.env.NODE_ENV ?? 'development',
  isProd,
  isTest: process.env.NODE_ENV === 'test',
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: required('DATABASE_URL'),
  jwtSecret,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '12h',
  corsOrigins,
  uploadDir: path.resolve(process.env.UPLOAD_DIR ?? path.join(process.cwd(), 'uploads')),
  maxUploadBytes: Number(process.env.MAX_UPLOAD_MB ?? 5) * 1024 * 1024,
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? '',
  appUrl,
  rateLimit: {
    disabled: rateLimitDisabled,
    loginMax: Number(process.env.RATE_LIMIT_LOGIN_MAX ?? 10),
    uploadMax: Number(process.env.RATE_LIMIT_UPLOAD_MAX ?? 30),
    windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS ?? 15 * 60 * 1000),
  },
  smtp: {
    host: process.env.SMTP_HOST ?? '',
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER ?? '',
    pass: process.env.SMTP_PASS ?? '',
    from: process.env.EMAIL_FROM ?? 'Mero Kosh <no-reply@dhukuti.local>',
  },
  enableScheduler: process.env.ENABLE_SCHEDULER !== 'false',
  reminderCron: process.env.REMINDER_CRON ?? '0 8 * * *', // 08:00 every day
  timezone: process.env.TZ_REMINDERS ?? 'Asia/Kathmandu',
  trustProxy: process.env.TRUST_PROXY ?? '1',
};
