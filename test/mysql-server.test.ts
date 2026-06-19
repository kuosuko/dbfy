import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyMigrationsMysqlServer } from '../src/apply-mysql-server.js';
import type { MigrationFile } from '../src/types.js';

const MYSQL_URL = process.env.MYSQL_URL;

function mig(filename: string, contents: string, version = 1): MigrationFile {
  return { filename, path: '', version, contents };
}

// These tests need a live MySQL server. They are skipped automatically when
// MYSQL_URL is not set (e.g. local dev without a server); CI sets it via a
// mysql:8 service container.
test(
  'applyMigrationsMysqlServer: full-fidelity snapshot against a real server',
  { skip: MYSQL_URL ? false : 'MYSQL_URL not set' },
  async () => {
    const { schema, warnings } = await applyMigrationsMysqlServer(
      [
        mig(
          '001.sql',
          `CREATE TABLE users (
            id INT UNSIGNED NOT NULL AUTO_INCREMENT,
            email VARCHAR(255) NOT NULL,
            PRIMARY KEY (id),
            UNIQUE KEY uq_email (email)
          ) ENGINE=InnoDB;`
        ),
        mig('002.sql', `INSERT INTO users (email) VALUES ('a@b.com');`, 2),
        mig('003.sql', `ALTER TABLE users ADD COLUMN name VARCHAR(50);`, 3),
        mig(
          '004.sql',
          `CREATE VIEW active_users AS SELECT id, email FROM users;`,
          4
        ),
      ],
      MYSQL_URL as string
    );
    assert.match(schema, /CREATE TABLE `users`/);
    assert.match(schema, /`name` varchar\(50\)/);
    assert.match(schema, /-- view: active_users/);
    // deterministic: no volatile AUTO_INCREMENT counter, no DEFINER
    assert.doesNotMatch(schema, /AUTO_INCREMENT=\d+/);
    assert.doesNotMatch(schema, /DEFINER=/);
    assert.equal(warnings.length, 0);
  }
);
