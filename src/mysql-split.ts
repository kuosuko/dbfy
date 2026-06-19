/**
 * MySQL-aware SQL statement splitter.
 *
 * A naive `sql.split(';')` breaks on semicolons inside strings, comments,
 * and stored-routine bodies. This splitter scans character by character and
 * understands:
 *
 *   - single-quoted '...' and double-quoted "..." string literals, with both
 *     backslash escapes (\') and doubled-quote escapes ('')
 *   - backtick-quoted `identifiers` (with `` `` `` doubling)
 *   - `-- ` line comments (double dash followed by whitespace) and `#` line
 *     comments — both stripped from the output
 *   - block comments and their executable `/*! ... *\/` variant — stripped
 *   - `DELIMITER xxx` redefinition used around triggers / routines
 *
 * Comments are removed; statements are returned trimmed and without their
 * trailing delimiter. Empty statements are dropped.
 */

const DEFAULT_DELIMITER = ';';

function isWhitespace(ch: string): boolean {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f';
}

/** Split a blob of MySQL DDL/DML into individual statements. */
export function splitStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let delimiter = DEFAULT_DELIMITER;
  let i = 0;
  const n = sql.length;

  const pushCurrent = (): void => {
    const trimmed = current.trim();
    if (trimmed.length > 0) statements.push(trimmed);
    current = '';
  };

  while (i < n) {
    const ch = sql[i];
    const rest = sql.slice(i);

    // -- line comment (must be followed by whitespace or end-of-input)
    if (ch === '-' && sql[i + 1] === '-') {
      const after = sql[i + 2];
      if (after === undefined || isWhitespace(after)) {
        const nl = sql.indexOf('\n', i);
        i = nl === -1 ? n : nl; // keep the newline as whitespace
        continue;
      }
    }

    // # line comment
    if (ch === '#') {
      const nl = sql.indexOf('\n', i);
      i = nl === -1 ? n : nl;
      continue;
    }

    // block comment /* ... */  (covers the /*! executable variant too)
    if (ch === '/' && sql[i + 1] === '*') {
      const end = sql.indexOf('*/', i + 2);
      i = end === -1 ? n : end + 2;
      current += ' '; // collapse the comment to a separator
      continue;
    }

    // DELIMITER redefinition — only meaningful at the start of a statement
    if (
      current.trim().length === 0 &&
      /^delimiter[ \t]/i.test(rest)
    ) {
      const nl = sql.indexOf('\n', i);
      const line = sql.slice(i, nl === -1 ? n : nl);
      const newDelim = line.replace(/^delimiter[ \t]+/i, '').trim();
      if (newDelim.length > 0) delimiter = newDelim;
      i = nl === -1 ? n : nl + 1;
      current = '';
      continue;
    }

    // quoted string / identifier
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch;
      current += ch;
      i++;
      while (i < n) {
        const c = sql[i];
        if (c === '\\' && quote !== '`') {
          // backslash escape (not honored inside backticks)
          current += c + (sql[i + 1] ?? '');
          i += 2;
          continue;
        }
        if (c === quote) {
          if (sql[i + 1] === quote) {
            // doubled quote escape
            current += c + c;
            i += 2;
            continue;
          }
          current += c;
          i++;
          break;
        }
        current += c;
        i++;
      }
      continue;
    }

    // statement delimiter
    if (delimiter.length > 0 && sql.startsWith(delimiter, i)) {
      pushCurrent();
      i += delimiter.length;
      continue;
    }

    current += ch;
    i++;
  }

  pushCurrent();
  return statements;
}
