import { test } from 'node:test';
import assert from 'node:assert/strict';
import { discoverMigrations } from '../src/discover.js';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function makeTempDir(): Promise<string> {
  return await mkdtemp(join(tmpdir(), 'dbfy-test-'));
}

async function writeMig(dir: string, name: string, body: string): Promise<void> {
  await writeFile(join(dir, name), body, 'utf8');
}

test('discoverMigrations: sorts by leading number', async () => {
  const dir = await makeTempDir();
  try {
    await writeMig(dir, '010-c.sql', 'CREATE TABLE c (id INT);');
    await writeMig(dir, '002-a.sql', 'CREATE TABLE a (id INT);');
    await writeMig(dir, '001-b.sql', 'CREATE TABLE b (id INT);');
    const { migrations, skipped } = await discoverMigrations(dir);
    assert.equal(migrations.length, 3);
    assert.deepEqual(
      migrations.map((m) => m.version),
      [1, 2, 10]
    );
    assert.equal(skipped.length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('discoverMigrations: supports both _ and - separators and .up.sql', async () => {
  const dir = await makeTempDir();
  try {
    await writeMig(dir, '001_create_users.sql', '');
    await writeMig(dir, '002-add-posts.sql', '');
    await writeMig(dir, '003-add-comments.up.sql', '');
    const { migrations } = await discoverMigrations(dir);
    assert.equal(migrations.length, 3);
    assert.equal(migrations[0].filename, '001_create_users.sql');
    assert.equal(migrations[1].filename, '002-add-posts.sql');
    assert.equal(migrations[2].filename, '003-add-comments.up.sql');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('discoverMigrations: ignores non-matching files but reports .sql ones as skipped', async () => {
  const dir = await makeTempDir();
  try {
    await writeMig(dir, '001-good.sql', 'SELECT 1;');
    await writeMig(dir, 'README.sql', 'ignored');
    await writeMig(dir, 'notes.md', 'also ignored');
    const { migrations, skipped } = await discoverMigrations(dir);
    assert.equal(migrations.length, 1);
    assert.deepEqual(skipped, ['README.sql']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('discoverMigrations: handles deeply nested subdirectory call by listing files only', async () => {
  const dir = await makeTempDir();
  try {
    await mkdir(join(dir, 'sub'));
    await writeMig(join(dir, 'sub'), '001-nested.sql', 'SELECT 1;');
    // discoverMigrations reads one level — caller is expected to pass the right dir
    const { migrations } = await discoverMigrations(join(dir, 'sub'));
    assert.equal(migrations.length, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
