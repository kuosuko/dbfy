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
export { applyMigrationsMysql } from './apply-mysql.js';
export { applyMigrationsMysqlServer } from './apply-mysql-server.js';
export { splitStatements } from './mysql-split.js';
export { detectMigrationsDir, detectDialect } from './detect.js';

const SUPPORTED_DIALECTS = new Set(['sqlite', 'postgres', 'mysql']);

/** A MySQL connection URL given on the CLI or via env wins over pure-parse mode. */
function resolveMysqlUrl(options: SnapOptions): string | undefined {
  return (
    options.serverUrl ||
    process.env.MYSQL_URL ||
    process.env.DATABASE_URL ||
    undefined
  );
}

export async function snap(options: SnapOptions): Promise<SnapResult> {
  if (!SUPPORTED_DIALECTS.has(options.dialect)) {
    throw new Error(
      `Dialect "${options.dialect}" is not supported. ` +
        `Supported: sqlite, postgres, mysql.`
    );
  }

  const { migrations, skipped } = await discoverMigrations(options.migrationsDir);

  const warnings: string[] = [];
  for (const name of skipped) {
    warnings.push(
      `Skipped "${name}" — does not match the migration naming pattern ` +
        `(<number>[-_]<name>.sql).`
    );
  }
  if (migrations.length === 0) {
    warnings.push(
      `No migration files matched in "${options.migrationsDir}". ` +
        `The snapshot will be empty.`
    );
  }

  let schema: string;
  let engineWarnings: string[];

  if (options.dialect === 'postgres') {
    const { applyMigrationsPg } = await import('./apply-pg.js');
    ({ schema, warnings: engineWarnings } = await applyMigrationsPg(migrations));
  } else if (options.dialect === 'mysql') {
    const url = resolveMysqlUrl(options);
    if (url) {
      const { applyMigrationsMysqlServer } = await import('./apply-mysql-server.js');
      ({ schema, warnings: engineWarnings } = await applyMigrationsMysqlServer(
        migrations,
        url
      ));
    } else {
      const { applyMigrationsMysql } = await import('./apply-mysql.js');
      ({ schema, warnings: engineWarnings } = await applyMigrationsMysql(migrations));
    }
  } else {
    ({ schema, warnings: engineWarnings } = applyMigrationsSqlite(migrations));
  }
  warnings.push(...engineWarnings);

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
