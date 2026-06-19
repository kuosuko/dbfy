#!/usr/bin/env node
/**
 * dbfy CLI
 *
 * Usage:
 *   dbfy [--migrations <dir>] [--out <file|->] [--dialect <name>]
 *        [--url <mysql-url>] [--check] [--quiet] [--no-header]
 *
 * Defaults are auto-detected: with no flags, dbfy finds your migrations
 * directory and infers the dialect from the SQL itself.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { snap, discoverMigrations, detectMigrationsDir, detectDialect } from './index.js';
import type { Dialect, SnapOptions } from './types.js';

const require = createRequire(import.meta.url);

const HELP = `dbfy — DB-ify your migrations

Usage:
  dbfy [options]

Options:
   -m, --migrations <dir>   Directory of migration files (auto-detected by default)
   -o, --out <file|->       Output file, or '-' for stdout (default: ./schema.snapshot.sql)
   -d, --dialect <name>     sqlite | postgres | mysql (auto-detected by default)
       --url <url>          MySQL connection URL for full-fidelity server mode
                            (also reads MYSQL_URL / DATABASE_URL)
       --check              Verify the --out file is up to date; exit 1 on drift (CI)
       --quiet              Suppress the summary line
       --no-header          Omit the metadata header from the snapshot
   -h, --help               Show this help
   -v, --version            Show version

Examples:
  dbfy                                   # auto-detect dir + dialect, write snapshot
  dbfy --migrations ./db/migrations --out schema.sql
  dbfy --dialect mysql --out -           # MySQL pure-parse (no server needed)
  dbfy --dialect mysql --url mysql://root@localhost/ci   # full-fidelity server mode
  dbfy --check                           # CI: fail if snapshot is stale
`;

const KNOWN_FLAGS = new Set([
  '-h', '--help', '-v', '--version', '--no-header',
  '-m', '--migrations', '-o', '--out', '-d', '--dialect',
  '--url', '--check', '--quiet',
]);
const VALUE_FLAGS: Record<string, string> = {
  '-m': 'migrations', '--migrations': 'migrations',
  '-o': 'out', '--out': 'out',
  '-d': 'dialect', '--dialect': 'dialect',
  '--url': 'url',
};

interface ParsedArgs {
  values: Record<string, string | boolean>;
  unknown: string[];
}

function parseArgs(argv: string[]): ParsedArgs {
  const values: Record<string, string | boolean> = {};
  const unknown: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--no-header') {
      values.header = false;
    } else if (a === '-h' || a === '--help') {
      values.help = true;
    } else if (a === '-v' || a === '--version') {
      values.version = true;
    } else if (a === '--check') {
      values.check = true;
    } else if (a === '--quiet') {
      values.quiet = true;
    } else if (a in VALUE_FLAGS) {
      values[VALUE_FLAGS[a]] = argv[++i] ?? '';
    } else if (a.startsWith('--') && a.includes('=')) {
      const [k, v] = a.slice(2).split('=', 2);
      if (KNOWN_FLAGS.has(`--${k}`)) values[k === 'no-header' ? 'header' : k] = v;
      else unknown.push(a);
    } else {
      unknown.push(a);
    }
  }
  return { values, unknown };
}

function readPkgVersion(): string {
  try {
    const pkg = require('../package.json') as { version: string };
    return pkg.version;
  } catch {
    return '0.0.0';
  }
}

/** Drop the volatile `-- generated:` line so --check ignores timestamp churn. */
function stripGenerated(text: string): string {
  return text.replace(/^-- generated:.*$/m, '-- generated: <ignored>');
}

async function resolveDialect(
  explicit: string | undefined,
  migrationsDir: string,
  log: (msg: string) => void
): Promise<Dialect> {
  if (explicit) return explicit as Dialect;
  const { migrations } = await discoverMigrations(migrationsDir);
  const detected = detectDialect(migrations);
  log(`dbfy: auto-detected dialect "${detected}"`);
  return detected;
}

async function main(): Promise<void> {
  const { values: args, unknown } = parseArgs(process.argv.slice(2));

  if (args.help) {
    process.stdout.write(HELP);
    return;
  }
  if (args.version) {
    process.stdout.write(`dbfy ${readPkgVersion()}\n`);
    return;
  }
  if (unknown.length > 0) {
    process.stderr.write(`dbfy: unknown argument(s): ${unknown.join(', ')}\n`);
    process.stderr.write(`Run "dbfy --help" for usage.\n`);
    process.exit(2);
  }

  const quiet = args.quiet === true;
  const info = (msg: string): void => {
    if (!quiet) process.stderr.write(msg + '\n');
  };

  // Resolve migrations directory: explicit flag wins, else auto-detect.
  let migrationsDir: string;
  if (args.migrations) {
    migrationsDir = resolve(process.cwd(), args.migrations as string);
  } else {
    const detected = await detectMigrationsDir(process.cwd());
    if (detected) {
      info(`dbfy: auto-detected migrations in "${detected}"`);
      migrationsDir = detected;
    } else {
      migrationsDir = resolve(process.cwd(), './migrations');
    }
  }

  const outPath = (args.out as string) || './schema.snapshot.sql';
  const includeHeader = args.header !== false;
  const dialect = await resolveDialect(args.dialect as string | undefined, migrationsDir, info);
  const serverUrl = (args.url as string) || undefined;

  const snapOptions: SnapOptions = {
    migrationsDir,
    out: '-', // never let snap() write; the CLI owns output / --check below
    dialect,
    includeHeader,
    serverUrl,
  };

  const t0 = Date.now();
  const result = await snap(snapOptions);
  const elapsed = Date.now() - t0;

  for (const w of result.warnings) {
    process.stderr.write(`warning: ${w}\n`);
  }

  // --check: compare against the existing snapshot instead of writing.
  if (args.check === true) {
    let existing: string | null = null;
    try {
      existing = await readFile(outPath, 'utf8');
    } catch {
      existing = null;
    }
    if (existing !== null && stripGenerated(existing) === stripGenerated(result.output)) {
      info(`dbfy: ${outPath} is up to date (${result.filesProcessed} migrations)`);
      return;
    }
    process.stderr.write(
      existing === null
        ? `dbfy: ${outPath} does not exist — run "dbfy" to generate it.\n`
        : `dbfy: ${outPath} is out of date — run "dbfy" to regenerate it.\n`
    );
    process.exit(1);
  }

  if (outPath === '-') {
    process.stdout.write(result.output);
  } else {
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, result.output, 'utf8');
    info(`dbfy: wrote ${outPath} (${result.filesProcessed} migrations, ${elapsed}ms)`);
  }
}

main().catch((err) => {
  process.stderr.write(`dbfy: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
