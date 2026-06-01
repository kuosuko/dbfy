/**
 * Apply migrations to an ephemeral database and dump the resulting schema.
 *
 * Strategy: in-memory SQLite. Fast (~50ms for hundreds of migrations),
 * zero-setup, no Docker required. Limits: only migrations whose DDL
 * is SQLite-compatible will work. For Postgres/MySQL-specific syntax,
 * use a real DB (planned for future versions).
 */

import Database from 'better-sqlite3';
import type { MigrationFile } from './types.js';

export interface ApplyResult {
  schema: string;
  warnings: string[];
}

export function applyMigrationsSqlite(files: MigrationFile[]): ApplyResult {
  const db = new Database(':memory:');
  const warnings: string[] = [];

  try {
    for (const f of files) {
      try {
        db.exec(f.contents);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        warnings.push(`${f.filename}: ${msg}`);
        throw new Error(
          `Migration ${f.filename} failed: ${msg}\n` +
            `Tip: dbfy uses SQLite as the snapshot engine. For Postgres/MySQL-specific ` +
            `syntax (e.g. JSONB, ENUM, partial indexes), use a real DB engine.`
        );
      }
    }
    const schema = dumpSchemaSqlite(db);
    return { schema, warnings };
  } finally {
    db.close();
  }
}

export function dumpSchemaSqlite(db: Database.Database): string {
  const rows = db
    .prepare(
      `
      SELECT type, name, sql
      FROM sqlite_master
      WHERE name NOT LIKE 'sqlite_%'
      ORDER BY
        CASE type
          WHEN 'table' THEN 1
          WHEN 'index' THEN 2
          WHEN 'view' THEN 3
          WHEN 'trigger' THEN 4
        END,
        name
      `
    )
    .all() as Array<{ type: string; name: string; sql: string | null }>;

  const blocks: string[] = [];
  for (const row of rows) {
    if (!row.sql) continue; // auto-generated indexes, etc.
    blocks.push(`-- ${row.type}: ${row.name}\n${row.sql};`);
  }
  return blocks.join('\n\n') + (blocks.length ? '\n' : '');
}
