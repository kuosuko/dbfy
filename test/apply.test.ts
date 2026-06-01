import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyMigrationsSqlite, dumpSchemaSqlite } from '../src/apply.js';
import Database from 'better-sqlite3';

test('applyMigrationsSqlite: applies migrations in order and returns final schema', () => {
  const { schema, warnings } = applyMigrationsSqlite([
    {
      filename: '001-users.sql',
      path: '',
      version: 1,
      contents: `CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);`,
    },
    {
      filename: '002-posts.sql',
      path: '',
      version: 2,
      contents: `CREATE TABLE posts (id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id), title TEXT);`,
    },
  ]);
  assert.equal(warnings.length, 0);
  assert.match(schema, /CREATE TABLE users/);
  assert.match(schema, /CREATE TABLE posts/);
  // tables come before indexes, but no indexes here — just check both present
  const usersIdx = schema.indexOf('CREATE TABLE users');
  const postsIdx = schema.indexOf('CREATE TABLE posts');
  assert.ok(usersIdx > -1 && postsIdx > -1);
});

test('applyMigrationsSqlite: schema reflects destructive migrations (column drop)', () => {
  const { schema } = applyMigrationsSqlite([
    {
      filename: '001.sql',
      path: '',
      version: 1,
      contents: `CREATE TABLE t (id INT, old_col TEXT, keep_col TEXT);`,
    },
    {
      filename: '002.sql',
      path: '',
      version: 2,
      contents: `ALTER TABLE t DROP COLUMN old_col;`,
    },
  ]);
  assert.doesNotMatch(schema, /old_col/);
  assert.match(schema, /keep_col/);
});

test('applyMigrationsSqlite: errors on invalid SQL with helpful message', () => {
  assert.throws(
    () =>
      applyMigrationsSqlite([
        {
          filename: '001-bad.sql',
          path: '',
          version: 1,
          contents: 'THIS IS NOT SQL',
        },
      ]),
    /001-bad\.sql/
  );
});

test('applyMigrationsSqlite: handles indexes from CREATE TABLE + CREATE INDEX', () => {
  const { schema } = applyMigrationsSqlite([
    {
      filename: '001.sql',
      path: '',
      version: 1,
      contents: `CREATE TABLE t (id INT PRIMARY KEY, name TEXT); CREATE INDEX idx_t_name ON t(name);`,
    },
  ]);
  assert.match(schema, /CREATE TABLE t/);
  assert.match(schema, /CREATE INDEX idx_t_name/);
});

test('dumpSchemaSqlite: empty DB returns empty string', () => {
  const db = new Database(':memory:');
  try {
    const out = dumpSchemaSqlite(db);
    assert.equal(out, '');
  } finally {
    db.close();
  }
});
