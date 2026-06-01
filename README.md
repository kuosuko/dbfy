# dbfy

> DB-ify your migrations — generate a clean post-merge schema snapshot from a folder of SQL migration files. Built for AI agents.

When you're developing a database with `001-xxx.sql`, `002-xxx.sql`, ..., `042-xxx.sql` migrations, AI agents (and humans) usually want **one canonical view of the current schema** — not the entire migration history.

**dbfy** applies your migrations to an ephemeral database in order, dumps the final schema, and hands you a single clean `schema.snapshot.sql` file. No live DB required. No Docker. No waiting.

```
$ dbfy --migrations ./migrations --out schema.snapshot.sql
dbfy: wrote schema.snapshot.sql (4 migrations, 23ms)
```

## Why

- **For AI agents** — feed one canonical schema file into context, not 50 migration files
- **For humans** — instant "what does the DB look like right now?" view
- **For CI** — verify destructive migrations actually produce the schema you think
- **For reviews** — diff `schema.snapshot.sql` across branches

## Install

```bash
npm install -g dbfy
```

Or run without installing:

```bash
npx dbfy
```

## Usage

```bash
dbfy [options]

Options:
  -m, --migrations <dir>   Directory of migration files (default: ./migrations)
  -o, --out <file|->       Output file, or '-' for stdout (default: ./schema.snapshot.sql)
  -d, --dialect <name>     sqlite | postgres | mysql (default: sqlite)
      --no-header          Omit the metadata header from the snapshot
  -h, --help               Show this help
  -v, --version            Show version
```

### Migration filename pattern

Any file matching this regex is picked up:

```
/^(\d+)[-_](.+)\.(sql|up\.sql)$/i
```

So all of these work:

- `001-create-users.sql`
- `001_create_users.sql`
- `042-add-user-email.up.sql`
- `20250101_1200-init.sql` (timestamp-based, sorted numerically)

### Example

Given migrations:

```
migrations/
├── 001-create-users.sql
├── 002-create-posts.sql
├── 003-add-comments.sql
└── 004-add-user-bio.sql
```

Running `dbfy` produces a single `schema.snapshot.sql` containing the **post-merge** state of the schema — including destructive changes from later migrations (column drops, etc.).

## How it works

1. Discover migration files matching the pattern, sort by leading number
2. Spin up an in-memory SQLite database
3. Apply each migration in order
4. Dump the final `sqlite_master` schema
5. Write to file (or stdout)

The whole thing takes ~20-50ms for typical projects. No external services, no Docker, no configuration files.

## Programmatic API

```ts
import { snap } from 'dbfy';

const result = await snap({
  migrationsDir: './migrations',
  out: './schema.snapshot.sql',  // or '-' for stdout
  dialect: 'sqlite',
  includeHeader: true,
});

console.log(result.filesProcessed, 'migrations applied');
console.log(result.warnings);
```

## Limitations

- **v0.1.0 only supports SQLite** as the apply engine. Postgres and MySQL support is on the roadmap.
- Migrations that contain **data backfills** (not just DDL) are still applied, but the backfill data doesn't end up in the schema file (which is correct — the schema file describes structure, not data).
- For Postgres/MySQL-specific syntax (JSONB, partial indexes, ENUM types, etc.), use a real DB engine. A future version will spin up ephemeral Docker containers for these.

## Development

```bash
git clone https://github.com/kuosuko/dbfy.git
cd dbfy
npm install
npm test
npm run build
```

## License

MIT
