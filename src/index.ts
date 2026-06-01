/**
 * dbfy — DB-ify your migrations. Generate a clean post-merge
 * schema snapshot from a folder of ordered SQL migration files.
 * Built for AI agents that need one canonical schema view,
 * not 50 migration files.
 */

import { discoverMigrations } from './discover.js';
import { applyMigrationsSqlite } from './apply.js';
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { SnapOptions, SnapResult } from './types.js';

export type { SnapOptions, SnapResult, MigrationFile, Dialect } from './types.js';
export { discoverMigrations } from './discover.js';
export { applyMigrationsSqlite, dumpSchemaSqlite } from './apply.js';
export { applyMigrationsPg } from './apply-pg.js';

const SUPPORTED_DIALECTS = new Set(['sqlite', 'postgres']);

export async function snap(options: SnapOptions): Promise<SnapResult> {
  if (!SUPPORTED_DIALECTS.has(options.dialect)) {
    throw new Error(
      `Dialect "${options.dialect}" is not supported. ` +
        `Supported: sqlite, postgres. MySQL support is on the roadmap.`
    );
  }

  const { migrations } = await discoverMigrations(options.migrationsDir);

  let schema: string;
  let warnings: string[];

  if (options.dialect === 'postgres') {
    const { applyMigrationsPg } = await import('./apply-pg.js');
    ({ schema, warnings } = await applyMigrationsPg(migrations));
  } else {
    ({ schema, warnings } = applyMigrationsSqlite(migrations));
  }

  let output = schema;
  if (options.includeHeader !== false) {
    const header = [
      `-- dbfy schema snapshot`,
      `-- generated: ${new Date().toISOString()}`,
      `-- migrations: ${migrations.length}`,
      `-- dialect: ${options.dialect}`,
      ``,
    ].join('\n');
    output = header + output;
  }

  if (options.out && options.out !== '-') {
    await mkdir(dirname(options.out), { recursive: true });
    await writeFile(options.out, output, 'utf8');
  }

  return {
    filesProcessed: migrations.length,
    output,
    warnings,
  };
}
