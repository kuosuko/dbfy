/**
 * Zero-config auto-detection for the friendly `dbfy` no-args experience.
 *
 * When run bare in a project, dbfy tries to figure out where the migrations
 * live and which dialect they're written in, so the common case needs no flags
 * at all. Anything the user passes explicitly always wins over detection.
 */

import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Dialect, MigrationFile } from './types.js';

const MIGRATION_RE = /^(\d+)[-_].+\.(sql|up\.sql)$/i;

/** Common conventional locations, in priority order. */
const CANDIDATE_DIRS = [
  'migrations',
  'db/migrations',
  'database/migrations',
  'sql/migrations',
  'prisma/migrations',
  'supabase/migrations',
  'migrate',
  'sql',
  'db',
  '.',
];

async function countMigrations(dir: string): Promise<number> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isFile() && MIGRATION_RE.test(e.name)).length;
  } catch {
    return 0;
  }
}

/**
 * Find the first conventional directory under `cwd` that actually contains
 * migration files. Returns null if none match.
 */
export async function detectMigrationsDir(cwd: string): Promise<string | null> {
  for (const candidate of CANDIDATE_DIRS) {
    const dir = join(cwd, candidate);
    if ((await countMigrations(dir)) > 0) return dir;
  }
  return null;
}

const POSTGRES_SIGNALS: RegExp[] = [
  /\bserial\b/i,
  /\bbigserial\b/i,
  /\bjsonb\b/i,
  /\buuid\b/i,
  /\bgen_random_uuid\b/i,
  /\bcreate\s+extension\b/i,
  /\bcreate\s+type\b.+\bas\s+enum\b/is,
  /\btsvector\b/i,
  /\b\w+\[\]/, // array types: text[], int[]
  /::[a-z]/i, // ::type casts
  /\btimestamptz\b/i,
  /\bgenerated\s+(always|by\s+default)\s+as\s+identity\b/i,
];

const MYSQL_SIGNALS: RegExp[] = [
  /\bauto_increment\b/i,
  /\bengine\s*=/i,
  /\bdefault\s+charset\b/i,
  /\bunsigned\b/i,
  /\btinyint\b/i,
  /\bmediumtext\b/i,
  /\blongtext\b/i,
  /`[^`]+`/, // backtick-quoted identifiers
  /\bon\s+update\s+current_timestamp\b/i,
];

function score(text: string, signals: RegExp[]): number {
  return signals.reduce((acc, re) => acc + (re.test(text) ? 1 : 0), 0);
}

/**
 * Infer the SQL dialect from migration contents. Defaults to 'sqlite' when no
 * Postgres- or MySQL-specific syntax is detected (the most portable engine).
 */
export function detectDialect(migrations: MigrationFile[]): Dialect {
  const text = migrations.map((m) => m.contents).join('\n');
  const pg = score(text, POSTGRES_SIGNALS);
  const my = score(text, MYSQL_SIGNALS);

  if (pg === 0 && my === 0) return 'sqlite';
  return my > pg ? 'mysql' : 'postgres';
}
