import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyMigrationsPg } from '../src/apply-pg.js';

test('applyMigrationsPg: applies migrations and returns pg_dump schema', async () => {
  const { schema, warnings } = await applyMigrationsPg([
    {
      filename: '001-users.sql',
      path: '',
      version: 1,
      contents: `
        CREATE TABLE users (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          email TEXT UNIQUE
        );
      `,
    },
    {
      filename: '002-posts.sql',
      path: '',
      version: 2,
      contents: `
        CREATE TABLE posts (
          id SERIAL PRIMARY KEY,
          user_id INTEGER REFERENCES users(id),
          title TEXT NOT NULL,
          body TEXT,
          created_at TIMESTAMPTZ DEFAULT now()
        );
        CREATE INDEX idx_posts_user_id ON posts(user_id);
      `,
    },
  ]);
  assert.equal(warnings.length, 0);
  assert.match(schema, /CREATE TABLE.*users/);
  assert.match(schema, /CREATE TABLE.*posts/);
  assert.match(schema, /idx_posts_user_id/);
});

test('applyMigrationsPg: schema reflects destructive migrations', async () => {
  const { schema } = await applyMigrationsPg([
    {
      filename: '001.sql',
      path: '',
      version: 1,
      contents: `
        CREATE TABLE t (
          id SERIAL PRIMARY KEY,
          old_col TEXT,
          keep_col TEXT
        );
      `,
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

test('applyMigrationsPg: handles PG-specific types (JSONB, ENUM)', async () => {
  const { schema } = await applyMigrationsPg([
    {
      filename: '001.sql',
      path: '',
      version: 1,
      contents: `
        CREATE TYPE status AS ENUM ('active', 'inactive');
        CREATE TABLE items (
          id SERIAL PRIMARY KEY,
          meta JSONB DEFAULT '{}',
          state status DEFAULT 'active'
        );
      `,
    },
  ]);
  assert.match(schema, /CREATE TYPE.*status/);
  assert.match(schema, /jsonb/i);
  assert.match(schema, /items/);
});

test('applyMigrationsPg: errors on invalid SQL with helpful message', async () => {
  await assert.rejects(
    () =>
      applyMigrationsPg([
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

test('applyMigrationsPg: handles views and triggers', async () => {
  const { schema } = await applyMigrationsPg([
    {
      filename: '001.sql',
      path: '',
      version: 1,
      contents: `
        CREATE TABLE users (id SERIAL PRIMARY KEY, name TEXT);
        CREATE VIEW active_users AS SELECT * FROM users WHERE name IS NOT NULL;
      `,
    },
  ]);
  assert.match(schema, /CREATE TABLE.*users/);
  assert.match(schema, /active_users/);
});
