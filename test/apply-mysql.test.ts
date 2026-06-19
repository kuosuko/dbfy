import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyMigrationsMysql } from '../src/apply-mysql.js';
import type { MigrationFile } from '../src/types.js';

function mig(filename: string, contents: string, version = 1): MigrationFile {
  return { filename, path: '', version, contents };
}

test('applyMigrationsMysql: renders a clean CREATE TABLE', async () => {
  const { schema, warnings } = await applyMigrationsMysql([
    mig(
      '001.sql',
      `CREATE TABLE users (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        email VARCHAR(255) NOT NULL,
        PRIMARY KEY (id),
        UNIQUE KEY uq_email (email)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`
    ),
  ]);
  assert.equal(warnings.length, 0);
  assert.match(schema, /CREATE TABLE `users`/);
  assert.match(schema, /`id` int unsigned NOT NULL AUTO_INCREMENT/);
  assert.match(schema, /PRIMARY KEY \(`id`\)/);
  assert.match(schema, /UNIQUE KEY `uq_email` \(`email`\)/);
  assert.match(schema, /ENGINE=InnoDB DEFAULT CHARSET=utf8mb4/);
  // redundant full-length unique prefix is dropped
  assert.doesNotMatch(schema, /`email`\(255\)/);
});

test('applyMigrationsMysql: folds ALTER TABLE into the final schema', async () => {
  const { schema } = await applyMigrationsMysql([
    mig('001.sql', `CREATE TABLE t (id INT PRIMARY KEY, bio TEXT);`, 1),
    mig('002.sql', `ALTER TABLE t ADD COLUMN phone VARCHAR(20);`, 2),
    mig('003.sql', `ALTER TABLE t DROP COLUMN bio;`, 3),
  ]);
  assert.match(schema, /`phone` varchar\(20\)/);
  assert.doesNotMatch(schema, /bio/);
});

test('applyMigrationsMysql: preserves a genuine prefix index length', async () => {
  const { schema } = await applyMigrationsMysql([
    mig(
      '001.sql',
      `CREATE TABLE t (id INT PRIMARY KEY, name VARCHAR(100), KEY idx_name (name(10)));`
    ),
  ]);
  assert.match(schema, /KEY `idx_name` \(`name`\(10\)\)/);
});

test('applyMigrationsMysql: renders default kinds correctly', async () => {
  const { schema } = await applyMigrationsMysql([
    mig(
      '001.sql',
      `CREATE TABLE t (
        a INT DEFAULT 5,
        b VARCHAR(10) DEFAULT 'hi',
        c VARCHAR(10) DEFAULT NULL,
        d TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        e ENUM('x','y') DEFAULT 'x'
      );`
    ),
  ]);
  assert.match(schema, /`a` int DEFAULT 5/);
  assert.match(schema, /`b` varchar\(10\) DEFAULT 'hi'/);
  assert.match(schema, /`c` varchar\(10\) DEFAULT NULL/);
  assert.match(schema, /`d` timestamp DEFAULT CURRENT_TIMESTAMP/);
  assert.match(schema, /`e` enum\('x','y'\) DEFAULT 'x'/);
});

test('applyMigrationsMysql: renders foreign keys with ON DELETE/UPDATE', async () => {
  const { schema } = await applyMigrationsMysql([
    mig('001.sql', `CREATE TABLE users (id INT UNSIGNED PRIMARY KEY);`, 1),
    mig(
      '002.sql',
      `CREATE TABLE posts (
        id INT PRIMARY KEY,
        user_id INT UNSIGNED,
        CONSTRAINT fk FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE ON UPDATE RESTRICT
      );`,
      2
    ),
  ]);
  assert.match(
    schema,
    /CONSTRAINT `fk` FOREIGN KEY \(`user_id`\) REFERENCES `users` \(`id`\) ON DELETE CASCADE ON UPDATE RESTRICT/
  );
});

test('applyMigrationsMysql: counts ignored DML and warns', async () => {
  const { warnings } = await applyMigrationsMysql([
    mig(
      '001.sql',
      `CREATE TABLE t (id INT PRIMARY KEY);
       INSERT INTO t VALUES (1);
       UPDATE t SET id = 2 WHERE id = 1;`
    ),
  ]);
  assert.ok(warnings.some((w) => /Ignored 2 data statement/.test(w)));
});

test('applyMigrationsMysql: warns on views/triggers (unsupported in pure-parse)', async () => {
  const { warnings } = await applyMigrationsMysql([
    mig('001.sql', `CREATE TABLE t (id INT PRIMARY KEY);`, 1),
    mig('002.sql', `CREATE VIEW v AS SELECT * FROM t;`, 2),
  ]);
  assert.ok(warnings.some((w) => /pure-parse mode does not support/.test(w)));
});

test('applyMigrationsMysql: warns on unrecognized statements', async () => {
  const { warnings } = await applyMigrationsMysql([
    mig('001.sql', `CREATE TABLE t (id INT PRIMARY KEY); FLUSH PRIVILEGES;`),
  ]);
  assert.ok(warnings.some((w) => /skipped unrecognized statement/.test(w)));
});

test('applyMigrationsMysql: fallback skips one bad statement but keeps the rest', async () => {
  const { schema, warnings } = await applyMigrationsMysql([
    mig(
      '001.sql',
      `CREATE TABLE a (id INT PRIMARY KEY);
       CREATE TABLE b (id INT, THIS IS BROKEN SYNTAX);
       CREATE TABLE c (id INT PRIMARY KEY);`
    ),
  ]);
  assert.match(schema, /CREATE TABLE `a`/);
  assert.match(schema, /CREATE TABLE `c`/);
  assert.doesNotMatch(schema, /CREATE TABLE `b`/);
  assert.ok(warnings.some((w) => /unparseable statement/.test(w)));
});

test('applyMigrationsMysql: empty input yields empty schema', async () => {
  const { schema, warnings } = await applyMigrationsMysql([]);
  assert.equal(schema, '');
  assert.equal(warnings.length, 0);
});
