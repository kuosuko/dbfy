---
name: dbfy
description: Generate a clean post-merge schema snapshot from a folder of SQL migration files. Use when you need to understand the current database schema but only have migration files, or want to feed one canonical schema into context instead of dozens of individual migrations. Supports SQLite, PostgreSQL (in-memory PGlite), and MySQL (zero-setup pure DDL parser by default; real server with --url). Triggers on: "what does the schema look like", "show me the database structure", "consolidate migrations", "schema snapshot", "current database schema".
---

# dbfy — DB-ify your migrations

## When to use

- You need to understand the current database schema but only have migration files (`001-xxx.sql`, `002-xxx.sql`, etc.)
- You want one canonical schema file in context instead of 50 migration files
- You need to verify what the schema looks like after applying all migrations
- You want to diff schema across git branches
- A user asks "what tables/columns/indexes exist?"

## When NOT to use

- If you have access to a live database — just run `pg_dump --schema-only` or `.schema` directly
- If you need to inspect data, not structure (dbfy snapshots DDL only)

## Usage

```bash
# Zero-config: auto-detects the migrations dir AND the dialect from the SQL
npx @kuosuko/dbfy --out -

# Explicit dialect
npx @kuosuko/dbfy --migrations ./migrations --out schema.snapshot.sql --dialect postgres

# MySQL — pure-parse, NO server / Docker needed (dbfy's differentiator)
npx @kuosuko/dbfy --migrations ./migrations --dialect mysql --out -

# MySQL — full fidelity (views/triggers/routines) against a real server
npx @kuosuko/dbfy --dialect mysql --url mysql://root:root@localhost:3306/ --out -

# CI: fail if the committed snapshot is stale (exit 1 on drift)
npx @kuosuko/dbfy --check
```

## Dialects

| Dialect | Engine | Server? | Notes |
|---------|--------|---------|-------|
| `sqlite` | better-sqlite3 (in-memory) | No | Default fallback. Zero-setup. |
| `postgres` | PGlite (in-memory WASM Postgres) | No | Full PG type support. |
| `mysql` | pure DDL parser (default) | No | Milliseconds, no server. Structure only. |
| `mysql` + `--url` | real MySQL via `mysql2` | Yes | Full fidelity incl. views/triggers/routines. |

**MySQL note:** MySQL has no embeddable engine, so most tools need a live server or
Docker to compute the final schema. dbfy's default MySQL mode parses the DDL directly
(folding `ALTER TABLE` into `CREATE TABLE`) for an instant, zero-setup snapshot. It
covers tables, columns, keys, indexes, and foreign keys; pass `--url` only when you
need stored programs reproduced exactly.

## What it does

1. Discovers migration files matching `<number>[-_]<name>.(sql|up.sql)`
2. Spins up an in-memory database (SQLite or PGlite)
3. Applies each migration in order
4. Dumps the final schema as a single clean SQL file

## Programmatic API

```ts
import { snap } from '@kuosuko/dbfy';

const result = await snap({
  migrationsDir: './migrations',
  out: './schema.snapshot.sql',
  dialect: 'postgres',
  includeHeader: true,
});

console.log(result.filesProcessed, 'migrations applied');
```

## Tips for agents

- Use `--out -` to pipe the snapshot directly into context without writing a file
- After running dbfy, you can reason about the full schema in one shot — table names, columns, types, constraints, indexes, foreign keys
- For destructive migrations (column drops, table renames), the snapshot correctly reflects the post-merge state
- Re-run dbfy after any migration change to get an updated snapshot
- Run dbfy bare (no `--migrations`/`--dialect`) to let it auto-detect; pass flags only to override
- In CI, `dbfy --check` guards against migrations that were changed without refreshing the snapshot
- If a MySQL snapshot warns about skipped views/triggers, re-run with `--url <mysql-url>` for full fidelity
