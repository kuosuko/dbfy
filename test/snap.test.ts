import { test } from 'node:test';
import assert from 'node:assert/strict';
import { snap } from '../src/index.js';
import { mkdtemp, writeFile, mkdir, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('snap: end-to-end writes a snapshot file', async () => {
  const workdir = await mkdtemp(join(tmpdir(), 'dbfy-e2e-'));
  try {
    const migrationsDir = join(workdir, 'migrations');
    await mkdir(migrationsDir, { recursive: true });
    await writeFile(
      join(migrationsDir, '001-users.sql'),
      `CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT UNIQUE);`
    );
    await writeFile(
      join(migrationsDir, '002-posts.sql'),
      `CREATE TABLE posts (id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id), body TEXT);`
    );

    const outPath = join(workdir, 'schema.snapshot.sql');
    const result = await snap({
      migrationsDir,
      out: outPath,
      dialect: 'sqlite',
    });

    assert.equal(result.filesProcessed, 2);
    assert.equal(result.warnings.length, 0);

    const written = await readFile(outPath, 'utf8');
    assert.match(written, /dbfy schema snapshot/);
    assert.match(written, /CREATE TABLE users/);
    assert.match(written, /CREATE TABLE posts/);
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});

test('snap: header is omittable', async () => {
  const workdir = await mkdtemp(join(tmpdir(), 'dbfy-e2e-'));
  try {
    const migrationsDir = join(workdir, 'migrations');
    await mkdir(migrationsDir, { recursive: true });
    await writeFile(
      join(migrationsDir, '001-t.sql'),
      `CREATE TABLE t (id INT);`
    );
    const result = await snap({
      migrationsDir,
      out: '-',
      dialect: 'sqlite',
      includeHeader: false,
    });
    assert.doesNotMatch(result.output, /dbfy schema snapshot/);
    assert.match(result.output, /CREATE TABLE t/);
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});

test('snap: rejects unsupported dialect', async () => {
  await assert.rejects(
    () =>
      snap({
        migrationsDir: '/tmp/none',
        out: '-',
        dialect: 'oracle' as never,
      }),
    /not supported/
  );
});

test('snap: friendly error when migrations directory is missing', async () => {
  await assert.rejects(
    () =>
      snap({
        migrationsDir: join(tmpdir(), 'dbfy-does-not-exist-xyz'),
        out: '-',
        dialect: 'sqlite',
      }),
    /No migrations directory found/
  );
});

test('snap: skipped files surface as warnings', async () => {
  const workdir = await mkdtemp(join(tmpdir(), 'dbfy-skip-'));
  try {
    const migrationsDir = join(workdir, 'migrations');
    await mkdir(migrationsDir, { recursive: true });
    await writeFile(join(migrationsDir, '001-ok.sql'), `CREATE TABLE t (id INT);`);
    await writeFile(join(migrationsDir, 'README.sql'), `-- not a migration`);
    const result = await snap({ migrationsDir, out: '-', dialect: 'sqlite' });
    assert.equal(result.filesProcessed, 1);
    assert.ok(result.warnings.some((w) => /Skipped "README.sql"/.test(w)));
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});

test('snap: empty migrations directory warns', async () => {
  const workdir = await mkdtemp(join(tmpdir(), 'dbfy-empty-'));
  try {
    const migrationsDir = join(workdir, 'migrations');
    await mkdir(migrationsDir, { recursive: true });
    const result = await snap({ migrationsDir, out: '-', dialect: 'sqlite' });
    assert.equal(result.filesProcessed, 0);
    assert.ok(result.warnings.some((w) => /No migration files matched/.test(w)));
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});

test('snap: mysql dialect uses the pure-parse engine by default', async () => {
  const workdir = await mkdtemp(join(tmpdir(), 'dbfy-mysql-'));
  try {
    const migrationsDir = join(workdir, 'migrations');
    await mkdir(migrationsDir, { recursive: true });
    await writeFile(
      join(migrationsDir, '001-users.sql'),
      `CREATE TABLE users (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        email VARCHAR(255) NOT NULL,
        PRIMARY KEY (id)
      ) ENGINE=InnoDB;`
    );
    const result = await snap({ migrationsDir, out: '-', dialect: 'mysql' });
    assert.equal(result.filesProcessed, 1);
    assert.match(result.output, /CREATE TABLE `users`/);
    assert.match(result.output, /dialect: mysql/);
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});
