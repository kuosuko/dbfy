import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitStatements } from '../src/mysql-split.js';

test('splitStatements: splits on semicolons', () => {
  const out = splitStatements('CREATE TABLE a (id INT); CREATE TABLE b (id INT);');
  assert.equal(out.length, 2);
  assert.match(out[0], /CREATE TABLE a/);
  assert.match(out[1], /CREATE TABLE b/);
});

test('splitStatements: drops empty trailing statement', () => {
  assert.deepEqual(splitStatements('SELECT 1;   '), ['SELECT 1']);
  assert.deepEqual(splitStatements(';;;'), []);
});

test('splitStatements: ignores semicolons inside single-quoted strings', () => {
  const out = splitStatements(`INSERT INTO t VALUES ('a;b;c'); SELECT 2;`);
  assert.equal(out.length, 2);
  assert.match(out[0], /'a;b;c'/);
});

test('splitStatements: handles doubled single-quote escapes', () => {
  const out = splitStatements(`INSERT INTO t VALUES ('it''s; fine'); SELECT 1;`);
  assert.equal(out.length, 2);
  assert.match(out[0], /'it''s; fine'/);
});

test('splitStatements: handles backslash escapes in strings', () => {
  const out = splitStatements(`INSERT INTO t VALUES ('a\\'; b'); SELECT 1;`);
  assert.equal(out.length, 2);
});

test('splitStatements: respects double-quoted strings and backtick identifiers', () => {
  const out = splitStatements('CREATE TABLE `we;ird` (`a;b` VARCHAR(5) DEFAULT "x;y"); SELECT 1;');
  assert.equal(out.length, 2);
  assert.match(out[0], /`we;ird`/);
});

test('splitStatements: strips -- line comments (requires trailing space)', () => {
  const out = splitStatements('SELECT 1; -- a;b comment\nSELECT 2;');
  assert.equal(out.length, 2);
  assert.doesNotMatch(out.join('\n'), /comment/);
});

test('splitStatements: a double dash without space is not a comment', () => {
  const out = splitStatements('SELECT 1--2 FROM t;');
  assert.equal(out.length, 1);
  assert.match(out[0], /1--2/);
});

test('splitStatements: strips # line comments', () => {
  const out = splitStatements('SELECT 1; # trailing; comment\nSELECT 2;');
  assert.equal(out.length, 2);
  assert.doesNotMatch(out.join('\n'), /comment/);
});

test('splitStatements: strips block comments', () => {
  const out = splitStatements('SELECT /* inline; comment */ 1; SELECT 2;');
  assert.equal(out.length, 2);
  assert.doesNotMatch(out.join('\n'), /comment/);
});

test('splitStatements: honors DELIMITER redefinition for routine bodies', () => {
  const sql = `
DELIMITER $$
CREATE TRIGGER trg BEFORE INSERT ON t FOR EACH ROW
BEGIN
  SET NEW.x = 1;
  SET NEW.y = 2;
END$$
DELIMITER ;
CREATE TABLE t (id INT);
`;
  const out = splitStatements(sql);
  assert.equal(out.length, 2);
  assert.match(out[0], /CREATE TRIGGER trg/);
  assert.match(out[0], /SET NEW\.y = 2/); // inner semicolons did not split
  assert.match(out[1], /CREATE TABLE t/);
});
