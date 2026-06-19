/**
 * Render a `sql-ddl-to-json-schema` compact model back into clean,
 * deterministic `CREATE TABLE` statements.
 *
 * The compact model has already merged every `ALTER TABLE` into the original
 * `CREATE TABLE`, so what we render is the final post-merge schema. We aim for
 * stable, readable output: preserved column order, a fixed clause order
 * (PRIMARY KEY → UNIQUE KEY → KEY → FOREIGN KEY), and no redundant index
 * prefix lengths.
 */

import type {
  TableInterface,
  ColumnInterface,
  IndexColumnInterface,
} from 'sql-ddl-to-json-schema';

/** Datatypes that carry an integer display width, e.g. int(11). */
const INT_TYPES = new Set([
  'tinyint',
  'smallint',
  'mediumint',
  'int',
  'integer',
  'bigint',
]);

/** Datatypes whose declared length is meaningful, e.g. varchar(255). */
const LENGTH_TYPES = new Set(['varchar', 'char', 'varbinary', 'binary']);

/** Datatypes that render (digits[,decimals]). */
const DECIMAL_TYPES = new Set([
  'decimal',
  'numeric',
  'dec',
  'fixed',
  'float',
  'double',
  'real',
]);

/** String defaults that are SQL keywords / functions and must stay unquoted. */
const KEYWORD_DEFAULTS = new Set([
  'CURRENT_TIMESTAMP',
  'CURRENT_DATE',
  'CURRENT_TIME',
  'LOCALTIME',
  'LOCALTIMESTAMP',
  'UTC_TIMESTAMP',
  'UTC_DATE',
  'UTC_TIME',
  'TRUE',
  'FALSE',
  'NULL',
]);

function quoteIdent(name: string): string {
  return '`' + name.replace(/`/g, '``') + '`';
}

function quoteString(value: string): string {
  return "'" + value.replace(/'/g, "''") + "'";
}

function isKeywordDefault(value: string): boolean {
  const upper = value.toUpperCase();
  return KEYWORD_DEFAULTS.has(upper) || /\)\s*$/.test(value);
}

function renderDefault(value: boolean | string | number | null): string {
  if (value === null) return 'NULL';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  return isKeywordDefault(value) ? value : quoteString(value);
}

function renderType(column: ColumnInterface): string {
  const t = column.type;
  const datatype = t.datatype.toLowerCase();
  let base = datatype;

  if (INT_TYPES.has(datatype)) {
    if (t.displayWidth !== undefined) base = `${datatype}(${t.displayWidth})`;
  } else if (LENGTH_TYPES.has(datatype)) {
    if (t.length !== undefined) base = `${datatype}(${t.length})`;
  } else if (DECIMAL_TYPES.has(datatype)) {
    if (t.digits !== undefined && t.decimals !== undefined) {
      base = `${datatype}(${t.digits},${t.decimals})`;
    } else if (t.digits !== undefined) {
      base = `${datatype}(${t.digits})`;
    }
  } else if ((datatype === 'enum' || datatype === 'set') && t.values) {
    base = `${datatype}(${t.values.map(quoteString).join(',')})`;
  }

  const opts = column.options ?? {};
  if (opts.unsigned) base += ' unsigned';
  if (opts.zerofill) base += ' zerofill';
  return base;
}

function renderColumn(column: ColumnInterface): string {
  const opts = column.options ?? {};
  const parts = [quoteIdent(column.name), renderType(column)];

  if (opts.charset) parts.push(`CHARACTER SET ${opts.charset}`);
  if (opts.collation) parts.push(`COLLATE ${opts.collation}`);
  if (opts.nullable === false) parts.push('NOT NULL');
  if (Object.prototype.hasOwnProperty.call(opts, 'default')) {
    parts.push(`DEFAULT ${renderDefault(opts.default as never)}`);
  }
  if (opts.autoincrement) parts.push('AUTO_INCREMENT');
  if (opts.onUpdate) parts.push(`ON UPDATE ${opts.onUpdate}`);
  if (opts.comment) parts.push(`COMMENT ${quoteString(opts.comment)}`);

  return '  ' + parts.join(' ');
}

/**
 * Render an index column list. A prefix length equal to the column's full
 * declared length is redundant (the parser auto-fills it) and is dropped;
 * a genuine shorter prefix like name(10) is preserved.
 */
function renderIndexColumns(
  columns: IndexColumnInterface[],
  declaredLengths: Map<string, number | undefined>
): string {
  return columns
    .map((c) => {
      const name = c.column ?? '';
      const declared = declaredLengths.get(name);
      const keepLength =
        c.length !== undefined && c.length !== declared;
      return keepLength ? `${quoteIdent(name)}(${c.length})` : quoteIdent(name);
    })
    .join(', ');
}

function renderTable(table: TableInterface): string {
  const columns = table.columns ?? [];
  const declaredLengths = new Map<string, number | undefined>();
  for (const col of columns) {
    declaredLengths.set(col.name, col.type.length);
  }

  const lines: string[] = columns.map(renderColumn);

  if (table.primaryKey?.columns?.length) {
    lines.push(
      `  PRIMARY KEY (${renderIndexColumns(table.primaryKey.columns, declaredLengths)})`
    );
  }

  for (const uk of table.uniqueKeys ?? []) {
    const name = uk.name ? ` ${quoteIdent(uk.name)}` : '';
    lines.push(
      `  UNIQUE KEY${name} (${renderIndexColumns(uk.columns, declaredLengths)})`
    );
  }

  for (const idx of table.indexes ?? []) {
    const name = idx.name ? ` ${quoteIdent(idx.name)}` : '';
    lines.push(
      `  KEY${name} (${renderIndexColumns(idx.columns, declaredLengths)})`
    );
  }

  for (const fk of table.foreignKeys ?? []) {
    const name = fk.name ? `CONSTRAINT ${quoteIdent(fk.name)} ` : '';
    const cols = renderIndexColumns(fk.columns, declaredLengths);
    const refTable = quoteIdent(fk.reference.table);
    const refCols = renderIndexColumns(fk.reference.columns ?? [], declaredLengths);
    let line = `  ${name}FOREIGN KEY (${cols}) REFERENCES ${refTable} (${refCols})`;
    for (const on of fk.reference.on ?? []) {
      line += ` ON ${on.trigger.toUpperCase()} ${on.action.toUpperCase()}`;
    }
    lines.push(line);
  }

  const tableOpts = table.options ?? {};
  const suffixParts: string[] = [];
  if (tableOpts.engine) suffixParts.push(`ENGINE=${tableOpts.engine}`);
  if (tableOpts.charset) suffixParts.push(`DEFAULT CHARSET=${tableOpts.charset}`);
  if (tableOpts.collation) suffixParts.push(`COLLATE=${tableOpts.collation}`);
  const suffix = suffixParts.length ? ' ' + suffixParts.join(' ') : '';

  return (
    `-- table: ${table.name}\n` +
    `CREATE TABLE ${quoteIdent(table.name)} (\n` +
    lines.join(',\n') +
    `\n)${suffix};`
  );
}

/** Render a list of compact-model tables to a deterministic schema string. */
export function renderMysqlSchema(tables: TableInterface[]): string {
  if (tables.length === 0) return '';
  return tables.map(renderTable).join('\n\n') + '\n';
}
