---
name: dbfy
description: Generate a clean post-merge schema snapshot from a folder of SQL migration files. Use when you need to understand the current database schema but only have migration files, or want to feed one canonical schema into context instead of dozens of individual migrations. Supports SQLite and PostgreSQL (via in-memory PGlite). Triggers on: "what does the schema look like", "show me the database structure", "consolidate migrations", "schema snapshot", "current database schema".
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
# SQLite migrations (default, ~20ms)
npx dbfy --migrations ./migrations --out schema.snapshot.sql

# PostgreSQL migrations (supports JSONB, ENUM, arrays, partial indexes, etc.)
npx dbfy --migrations ./migrations --out schema.snapshot.sql --dialect postgres

# Output to stdout — pipe directly into agent context
npx dbfy --migrations ./migrations --dialect postgres --out -
```

## Dialects

| Dialect | Engine | Speed | Notes |
|---------|--------|-------|-------|
| `sqlite` | better-sqlite3 (in-memory) | ~20ms | Default. Zero-setup. |
| `postgres` | PGlite (in-memory WASM Postgres) | ~800ms | Full PG type support. |

## What it does

1. Discovers migration files matching `<number>[-_]<name>.(sql|up.sql)`
2. Spins up an in-memory database (SQLite or PGlite)
3. Applies each migration in order
4. Dumps the final schema as a single clean SQL file

## Programmatic API

```ts
import { snap } from 'dbfy';

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
