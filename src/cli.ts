#!/usr/bin/env node
/**
 * dbfy CLI
 *
 * Usage:
 *   dbfy [--migrations <dir>] [--out <file|->] [--dialect sqlite]
 *
 * Defaults:
 *   --migrations ./migrations
 *   --out ./schema.snapshot.sql
 *   --dialect sqlite
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { snap } from './index.js';
import type { Dialect } from './types.js';

const require = createRequire(import.meta.url);

const HELP = `dbfy — DB-ify your migrations

Usage:
  dbfy [options]

Options:
   -m, --migrations <dir>   Directory of migration files (default: ./migrations)
   -o, --out <file|->       Output file, or '-' for stdout (default: ./schema.snapshot.sql)
   -d, --dialect <name>     sqlite | postgres (default: sqlite)
       --no-header          Omit the metadata header from the snapshot
   -h, --help               Show this help
   -v, --version            Show version

Examples:
  dbfy
  dbfy --migrations ./db/migrations --out schema.sql
  dbfy --migrations ./db/migrations --out -
`;

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') out.help = true;
    else if (a === '-v' || a === '--version') out.version = true;
    else if (a === '--no-header') out.header = false;
    else if (a === '-m' || a === '--migrations') {
      out.migrations = argv[++i] ?? '';
    } else if (a === '-o' || a === '--out') {
      out.out = argv[++i] ?? '';
    } else if (a === '-d' || a === '--dialect') {
      out.dialect = argv[++i] ?? '';
    } else if (a.startsWith('--') && a.includes('=')) {
      const [k, v] = a.slice(2).split('=', 2);
      out[k] = v;
    }
  }
  return out;
}

function readPkgVersion(): string {
  try {
    const pkg = require('../package.json') as { version: string };
    return pkg.version;
  } catch {
    return '0.0.0';
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    process.stdout.write(HELP);
    return;
  }
  if (args.version) {
    process.stdout.write(`dbfy ${readPkgVersion()}\n`);
    return;
  }

  const migrationsDir = resolve(
    process.cwd(),
    (args.migrations as string) || './migrations'
  );
  const outPath = (args.out as string) || './schema.snapshot.sql';
  const dialect = ((args.dialect as string) || 'sqlite') as Dialect;
  const includeHeader = args.header !== false;

  const t0 = Date.now();
  const result = await snap({
    migrationsDir,
    out: outPath,
    dialect,
    includeHeader,
  });
  const elapsed = Date.now() - t0;

  if (outPath === '-') {
    process.stdout.write(result.output);
  } else {
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, result.output, 'utf8');
  }

  for (const w of result.warnings) {
    process.stderr.write(`warning: ${w}\n`);
  }

  if (outPath !== '-') {
    process.stderr.write(
      `dbfy: wrote ${outPath} (${result.filesProcessed} migrations, ${elapsed}ms)\n`
    );
  }
}

main().catch((err) => {
  process.stderr.write(`dbfy: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
