/**
 * Production migration runner.
 *
 * `prisma migrate deploy` refuses to apply anything once a migration is left in
 * a failed state (Prisma error P3009), which means the API never boots and every
 * request returns 502. This happened in production on 2026-10-30.
 *
 * This script runs `prisma migrate deploy`, and if P3009 is reported it marks the
 * stuck migration(s) as rolled back (the documented recovery), then retries.
 * Migrations in this repo are written to be idempotent, so re-applying is safe.
 *
 * Any other failure is reported and exits non-zero, so a genuinely broken schema
 * change still fails the deploy loudly instead of starting on a wrong schema.
 */
import { execFileSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';

const MAX_RECOVERY_ATTEMPTS = 3;

function migrateDeploy() {
  try {
    const out = execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
      encoding: 'utf8',
      stdio: 'pipe',
      env: process.env,
    });
    process.stdout.write(out);
    return { ok: true, output: out };
  } catch (err) {
    const output = `${err.stdout ?? ''}${err.stderr ?? ''}`;
    process.stdout.write(output);
    return { ok: false, output };
  }
}

function resolveRolledBack(migrationName) {
  try {
    const out = execFileSync(
      'npx',
      ['prisma', 'migrate', 'resolve', '--rolled-back', migrationName],
      { encoding: 'utf8', stdio: 'pipe', env: process.env },
    );
    process.stdout.write(out);
    return true;
  } catch (err) {
    process.stdout.write(`${err.stdout ?? ''}${err.stderr ?? ''}`);
    return false;
  }
}

async function findFailedMigrations() {
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT migration_name
         FROM _prisma_migrations
        WHERE finished_at IS NULL
          AND rolled_back_at IS NULL
        ORDER BY started_at ASC`,
    );
    return rows.map((r) => r.migration_name);
  } finally {
    await prisma.$disconnect();
  }
}

let result = migrateDeploy();
let attempt = 0;

while (!result.ok && result.output.includes('P3009') && attempt < MAX_RECOVERY_ATTEMPTS) {
  attempt += 1;
  console.log(`\n[migrate] P3009 detected — recovery attempt ${attempt}/${MAX_RECOVERY_ATTEMPTS}`);

  const failed = await findFailedMigrations();
  if (failed.length === 0) {
    console.log('[migrate] Could not find a failed migration row; aborting.');
    break;
  }

  for (const name of failed) {
    console.log(`[migrate] Marking failed migration as rolled back: ${name}`);
    resolveRolledBack(name);
  }

  result = migrateDeploy();
}

if (!result.ok) {
  console.error('\n[migrate] Migration deploy failed. The API will not start.');
  process.exit(1);
}

console.log('[migrate] Database schema is up to date.');
