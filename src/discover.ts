/**
 * Migration file discovery and ordering.
 *
 * Accepts filenames matching: `<number>[_-]<name>.(sql|up.sql)`
 *   - 001-create-users.sql
 *   - 001_create_users.sql
 *   - 042-add-user-email.up.sql
 *   - 20250101_1200-init.sql   (timestamp-based, sorted numerically)
 *
 * Files are sorted by leading number ascending. Files that don't match
 * the pattern are ignored (with a warning emitted by the caller).
 */

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { MigrationFile } from './types.js';

const MIGRATION_RE = /^(\d+)[-_](.+)\.(sql|up\.sql)$/i;

export interface DiscoverResult {
  migrations: MigrationFile[];
  skipped: string[];
}

export async function discoverMigrations(dir: string): Promise<DiscoverResult> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err instanceof Error && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(
        `No migrations directory found at "${dir}". ` +
          `Pass --migrations <dir> to point dbfy at your SQL migration files.`
      );
    }
    throw err;
  }
  const migrations: MigrationFile[] = [];
  const skipped: string[] = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const m = entry.name.match(MIGRATION_RE);
    if (!m) {
      if (entry.name.endsWith('.sql') || entry.name.endsWith('.up.sql')) {
        skipped.push(entry.name);
      }
      continue;
    }
    const version = parseInt(m[1], 10);
    const path = join(dir, entry.name);
    const contents = await readFile(path, 'utf8');
    migrations.push({ filename: entry.name, path, version, contents });
  }

  migrations.sort((a, b) => a.version - b.version);
  return { migrations, skipped };
}
