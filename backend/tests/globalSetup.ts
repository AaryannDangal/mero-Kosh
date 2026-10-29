import { execSync } from 'node:child_process';
import { TEST_DATABASE_URL } from './env';

export default function setup() {
  const testDatabase = new URL(TEST_DATABASE_URL);
  const databaseName = decodeURIComponent(testDatabase.pathname.slice(1));
  const localHosts = new Set(['localhost', '127.0.0.1', '::1']);
  const appDatabase = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null;
  const sameAsAppDatabase = appDatabase
    && appDatabase.hostname === testDatabase.hostname
    && appDatabase.port === testDatabase.port
    && appDatabase.pathname === testDatabase.pathname;

  if (!/(^|_)test($|_)/i.test(databaseName)) {
    throw new Error('Refusing test reset: TEST_DATABASE_URL must use a database name containing "test".');
  }
  if (sameAsAppDatabase) {
    throw new Error('Refusing test reset: TEST_DATABASE_URL points to DATABASE_URL.');
  }
  if (!localHosts.has(testDatabase.hostname) && process.env.ALLOW_REMOTE_TEST_RESET !== 'true') {
    throw new Error('Refusing remote test reset. Set ALLOW_REMOTE_TEST_RESET=true only for a disposable CI database.');
  }

  // Fresh schema + migrations are destructive, so the target is constrained to an isolated test database.
  execSync('npx prisma migrate reset --force --skip-seed --skip-generate', {
    stdio: 'pipe',
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
  });
}
