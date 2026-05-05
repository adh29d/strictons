#!/usr/bin/env node
/**
 * pgTAP test runner.
 *
 * Runs `tests/_setup.sql`, `tests/_helpers.sql`, then every `tests/*.spec.sql`
 * file in lexical order against the configured Postgres URL. If `pg_prove` is
 * available on PATH it is used (proper TAP harness output); otherwise we fall
 * back to running each spec via `psql -v ON_ERROR_STOP=1` and rely on
 * pgTAP's plan/finish() to surface failures via psql exit code.
 *
 * Required env:
 *   SUPABASE_DB_URL   default: postgresql://postgres:postgres@127.0.0.1:54322/postgres
 *
 * Usage:
 *   pnpm --filter @strictons/db db:test
 */

import { execSync, spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TESTS_DIR = join(__dirname, '..', 'tests');

const DB_URL =
  process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

function which(bin) {
  const r = spawnSync('which', [bin], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}

function runPsqlFile(file) {
  console.log(`-- psql -f ${file}`);
  execSync(`psql -X -q -v ON_ERROR_STOP=1 "${DB_URL}" -f "${file}"`, { stdio: 'inherit' });
}

const setupFiles = ['_setup.sql', '_helpers.sql'];
for (const f of setupFiles) {
  runPsqlFile(join(TESTS_DIR, f));
}

const specs = readdirSync(TESTS_DIR)
  .filter((f) => f.endsWith('.spec.sql'))
  .sort()
  .map((f) => join(TESTS_DIR, f));

if (specs.length === 0) {
  console.error('No *.spec.sql files found in', TESTS_DIR);
  process.exit(1);
}

const pgProve = which('pg_prove');
if (pgProve) {
  console.log(`-- using ${pgProve}`);
  execSync(`${pgProve} --dbname "${DB_URL}" ${specs.map((s) => `"${s}"`).join(' ')}`, {
    stdio: 'inherit',
  });
} else {
  console.log('-- pg_prove not found on PATH; running each spec via psql');
  for (const spec of specs) {
    runPsqlFile(spec);
  }
}

console.log('All pgTAP specs passed.');
