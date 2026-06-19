/**
 * MySQL server mode — full-fidelity snapshot against a real MySQL server.
 *
 * Used only when a connection URL is supplied (CLI `--url`, or the MYSQL_URL /
 * DATABASE_URL env vars). It spins up a uniquely named temporary database,
 * applies every migration, reconstructs the schema from `SHOW CREATE …`, then
 * drops the temporary database. Output is made deterministic by stripping the
 * volatile `AUTO_INCREMENT=<n>` counter and `DEFINER=…` clauses.
 *
 * `mysql2` is an optional dependency: if it is not installed, we fail with a
 * clear, actionable message rather than a module-resolution stack trace.
 */

import type { MigrationFile } from './types.js';

export interface ApplyResult {
  schema: string;
  warnings: string[];
}

type Row = Record<string, unknown>;

function str(row: Row, key: string): string {
  const v = row[key];
  return typeof v === 'string' ? v : '';
}

/** Strip the volatile AUTO_INCREMENT counter so the snapshot is stable. */
function stripAutoIncrement(ddl: string): string {
  return ddl.replace(/\s+AUTO_INCREMENT=\d+/gi, '');
}

/** Strip DEFINER=`user`@`host` so views/triggers are environment-independent. */
function stripDefiner(ddl: string): string {
  return ddl.replace(/\s*DEFINER=`[^`]*`@`[^`]*`/gi, '').replace(/\s*DEFINER=\S+/gi, '');
}

async function loadMysql(): Promise<typeof import('mysql2/promise')> {
  try {
    return await import('mysql2/promise');
  } catch {
    throw new Error(
      `MySQL server mode requires the optional "mysql2" package. ` +
        `Install it with:  npm install mysql2\n` +
        `(Or drop the --url / MYSQL_URL to use the zero-setup pure-parse engine.)`
    );
  }
}

export async function applyMigrationsMysqlServer(
  files: MigrationFile[],
  url: string
): Promise<ApplyResult> {
  const mysql = await loadMysql();
  const warnings: string[] = [];
  const dbName = `dbfy_snap_${process.pid}_${Date.now()}`;

  const conn = await mysql.createConnection({ uri: url, multipleStatements: true });
  const ident = `\`${dbName.replace(/`/g, '``')}\``;

  try {
    await conn.query(`CREATE DATABASE ${ident}`);
    await conn.query(`USE ${ident}`);

    for (const f of files) {
      try {
        await conn.query(f.contents);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`Migration ${f.filename} failed: ${msg}`);
      }
    }

    const blocks: string[] = [];

    const [tableRows] = await conn.query(
      `SELECT TABLE_NAME, TABLE_TYPE FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME`,
      [dbName]
    );
    const tables = tableRows as Row[];

    for (const t of tables) {
      const name = str(t, 'TABLE_NAME');
      const isView = str(t, 'TABLE_TYPE') === 'VIEW';
      const tIdent = `\`${name.replace(/`/g, '``')}\``;
      if (isView) {
        const [rows] = await conn.query(`SHOW CREATE VIEW ${tIdent}`);
        const ddl = str((rows as Row[])[0] ?? {}, 'Create View');
        blocks.push(`-- view: ${name}\n${stripDefiner(ddl)};`);
      } else {
        const [rows] = await conn.query(`SHOW CREATE TABLE ${tIdent}`);
        const ddl = str((rows as Row[])[0] ?? {}, 'Create Table');
        blocks.push(`-- table: ${name}\n${stripAutoIncrement(ddl)};`);
      }
    }

    const [triggerRows] = await conn.query(
      `SELECT TRIGGER_NAME FROM information_schema.TRIGGERS
       WHERE TRIGGER_SCHEMA = ? ORDER BY TRIGGER_NAME`,
      [dbName]
    );
    for (const tr of triggerRows as Row[]) {
      const name = str(tr, 'TRIGGER_NAME');
      const trIdent = `\`${name.replace(/`/g, '``')}\``;
      const [rows] = await conn.query(`SHOW CREATE TRIGGER ${trIdent}`);
      const ddl = str((rows as Row[])[0] ?? {}, 'SQL Original Statement');
      blocks.push(`-- trigger: ${name}\n${stripDefiner(ddl)};`);
    }

    const schema = blocks.join('\n\n') + (blocks.length ? '\n' : '');
    return { schema, warnings };
  } finally {
    try {
      await conn.query(`DROP DATABASE IF EXISTS ${ident}`);
    } finally {
      await conn.end();
    }
  }
}
