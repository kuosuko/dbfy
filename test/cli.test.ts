import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const TSX_LOADER = require.resolve('tsx/esm');
const CLI = fileURLToPath(new URL('../src/cli.ts', import.meta.url));

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

async function runCli(cwd: string, args: string[]): Promise<RunResult> {
  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      ['--import', TSX_LOADER, CLI, ...args],
      { cwd }
    );
    return { code: 0, stdout, stderr };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    return { code: e.code ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

async function makeProject(sql: string, name = '001-init.sql'): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dbfy-cli-'));
  const migrations = join(dir, 'migrations');
  await mkdir(migrations, { recursive: true });
  await writeFile(join(migrations, name), sql);
  return dir;
}

test('cli: bare run auto-detects directory and dialect, writes snapshot', async () => {
  const dir = await makeProject(
    `CREATE TABLE users (id INT UNSIGNED NOT NULL AUTO_INCREMENT, email VARCHAR(255), PRIMARY KEY (id)) ENGINE=InnoDB;`
  );
  try {
    const r = await runCli(dir, []);
    assert.equal(r.code, 0);
    assert.match(r.stderr, /auto-detected migrations/);
    assert.match(r.stderr, /auto-detected dialect "mysql"/);
    assert.match(r.stderr, /wrote/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('cli: --check exits 0 when snapshot is current, 1 after drift', async () => {
  const dir = await makeProject(`CREATE TABLE t (id INT PRIMARY KEY);`);
  try {
    await runCli(dir, []); // generate snapshot
    const ok = await runCli(dir, ['--check']);
    assert.equal(ok.code, 0);
    assert.match(ok.stderr, /up to date/);

    await writeFile(join(dir, 'migrations', '002-add.sql'), `ALTER TABLE t ADD COLUMN x INT;`);
    const drift = await runCli(dir, ['--check']);
    assert.equal(drift.code, 1);
    assert.match(drift.stderr, /out of date/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('cli: --check exits 1 when snapshot does not exist', async () => {
  const dir = await makeProject(`CREATE TABLE t (id INT PRIMARY KEY);`);
  try {
    const r = await runCli(dir, ['--check']);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /does not exist/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('cli: unknown argument exits 2', async () => {
  const dir = await makeProject(`CREATE TABLE t (id INT PRIMARY KEY);`);
  try {
    const r = await runCli(dir, ['--migrationz', './migrations']);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /unknown argument/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('cli: --quiet suppresses the summary line', async () => {
  const dir = await makeProject(`CREATE TABLE t (id INT PRIMARY KEY);`);
  try {
    const r = await runCli(dir, ['--quiet']);
    assert.equal(r.code, 0);
    assert.doesNotMatch(r.stderr, /wrote/);
    assert.doesNotMatch(r.stderr, /auto-detected/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('cli: --out - writes snapshot to stdout', async () => {
  const dir = await makeProject(`CREATE TABLE t (id INT PRIMARY KEY);`);
  try {
    const r = await runCli(dir, ['--dialect', 'sqlite', '--out', '-']);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /CREATE TABLE t/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('cli: --help and --version short-circuit', async () => {
  const dir = await makeProject(`CREATE TABLE t (id INT PRIMARY KEY);`);
  try {
    const help = await runCli(dir, ['--help']);
    assert.equal(help.code, 0);
    assert.match(help.stdout, /DB-ify your migrations/);
    const version = await runCli(dir, ['--version']);
    assert.equal(version.code, 0);
    assert.match(version.stdout, /dbfy \d+\.\d+\.\d+/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
