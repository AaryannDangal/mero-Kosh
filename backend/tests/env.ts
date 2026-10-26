import os from 'node:os';
import path from 'node:path';

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://dhukuti:dhukuti@localhost:5432/dhukuti_test?schema=public';

export function applyTestEnv() {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  process.env.JWT_SECRET = 'test-secret-test-secret-test-secret';
  process.env.JWT_EXPIRES_IN = '3650d'; // tests move the clock across months
  process.env.RATE_LIMIT_DISABLED = 'true';
  process.env.ENABLE_SCHEDULER = 'false';
  process.env.SMTP_HOST = '';
  process.env.UPLOAD_DIR = path.join(os.tmpdir(), 'dhukuti-test-uploads');
}
