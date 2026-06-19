/**
 * MySQL pure-parse engine — the default, zero-setup MySQL dialect.
 *
 * MySQL has no mature in-memory / WASM engine (unlike PGlite for Postgres),
 * so most tools need a live server or Docker just to see the final schema.
 * dbfy instead parses the DDL directly with `sql-ddl-to-json-schema`, whose
 * compact format automatically folds every `ALTER TABLE` back into its
 * `CREATE TABLE` — exactly the post-merge state we want — in milliseconds.
 *
 * Tradeoff: it understands structure (tables, columns, keys, indexes, foreign
 * keys), not data or stored programs. For full fidelity (views, triggers,
 * routines, generated columns), pass a connection URL to use server mode.
 */

import type { TableInterface } from 'sql-ddl-to-json-schema';
import type { MigrationFile } from './types.js';
import { splitStatements } from './mysql-split.js';
import { renderMysqlSchema } from './mysql-render.js';

export interface ApplyResult {
  schema: string;
  warnings: string[];
}

const STRUCTURAL_RE =
  /^\s*(create\s+(temporary\s+)?table|alter\s+table|drop\s+table|rename\s+table|create\s+(unique\s+|fulltext\s+|spatial\s+)?index|drop\s+index)\b/i;
const DML_RE =
  /^\s*(insert|update|delete|replace|truncate|load\s+data|select)\b/i;
const ROUTINE_RE =
  /^\s*(create|alter|drop)\b[\s\S]*?\b(view|trigger|procedure|function|event)\b/i;
/** Session / transaction noise present in most dumps — ignored without warning. */
const SESSION_RE =
  /^\s*(set|use|start\s+transaction|begin|commit|rollback|lock\s+tables|unlock\s+tables)\b/i;

function preview(stmt: string): string {
  const oneLine = stmt.replace(/\s+/g, ' ').trim();
  return oneLine.length > 60 ? oneLine.slice(0, 60) + '…' : oneLine;
}

interface Classified {
  structural: string[];
  dmlCount: number;
  warnings: string[];
}

function classify(files: MigrationFile[]): Classified {
  const structural: string[] = [];
  const warnings: string[] = [];
  let dmlCount = 0;

  for (const f of files) {
    for (const stmt of splitStatements(f.contents)) {
      if (STRUCTURAL_RE.test(stmt)) {
        structural.push(stmt);
      } else if (DML_RE.test(stmt)) {
        dmlCount++;
      } else if (ROUTINE_RE.test(stmt)) {
        warnings.push(
          `${f.filename}: pure-parse mode does not support views/triggers/routines ` +
            `("${preview(stmt)}") — re-run with --url for full fidelity.`
        );
      } else if (SESSION_RE.test(stmt)) {
        // session / transaction control — irrelevant to the final schema
      } else {
        warnings.push(`${f.filename}: skipped unrecognized statement ("${preview(stmt)}").`);
      }
    }
  }

  return { structural, dmlCount, warnings };
}

function feedToTables(
  Parser: typeof import('sql-ddl-to-json-schema').Parser,
  statements: string[]
): TableInterface[] {
  const p = new Parser('mysql');
  p.feed(statements.map((s) => s + ';').join('\n'));
  return p.toCompactJson(p.results);
}

/**
 * Fallback path: a single bad statement corrupts the parser, so we rebuild the
 * accepted list with a fresh Parser instance for each candidate, dropping any
 * statement that fails to parse.
 */
function feedWithFallback(
  Parser: typeof import('sql-ddl-to-json-schema').Parser,
  statements: string[],
  warnings: string[]
): TableInterface[] {
  const accepted: string[] = [];
  for (const stmt of statements) {
    try {
      feedToTables(Parser, [...accepted, stmt]);
      accepted.push(stmt);
    } catch {
      warnings.push(`Skipped unparseable statement ("${preview(stmt)}").`);
    }
  }
  return accepted.length ? feedToTables(Parser, accepted) : [];
}

export async function applyMigrationsMysql(
  files: MigrationFile[]
): Promise<ApplyResult> {
  const { structural, dmlCount, warnings } = classify(files);

  if (dmlCount > 0) {
    warnings.push(
      `Ignored ${dmlCount} data statement(s) — a schema snapshot describes ` +
        `structure, not data.`
    );
  }

  let tables: TableInterface[] = [];
  if (structural.length > 0) {
    const { Parser } = await import('sql-ddl-to-json-schema');
    try {
      tables = feedToTables(Parser, structural);
    } catch {
      tables = feedWithFallback(Parser, structural, warnings);
    }
  }

  return { schema: renderMysqlSchema(tables), warnings };
}
