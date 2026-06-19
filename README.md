# dbfy

> DB-ify your migrations — generate a clean post-merge schema snapshot from a folder of SQL migration files. Built for AI agents.

When you're developing a database with `001-xxx.sql`, `002-xxx.sql`, ..., `042-xxx.sql` migrations, AI agents (and humans) usually want **one canonical view of the current schema** — not the entire migration history.

**dbfy** applies your migrations to an ephemeral database in order, dumps the final schema, and hands you a single clean `schema.snapshot.sql` file. No live DB required. No Docker. No waiting.

```
$ dbfy
dbfy: auto-detected migrations in "migrations"
dbfy: auto-detected dialect "postgres"
dbfy: wrote ./schema.snapshot.sql (4 migrations, 23ms)
```

Run it bare in your project: dbfy finds your migrations folder and infers the
dialect from the SQL itself — no flags required.

## Why

- **For AI agents** — feed one canonical schema file into context, not 50 migration files
- **For humans** — instant "what does the DB look like right now?" view
- **For CI** — verify destructive migrations actually produce the schema you think
- **For reviews** — diff `schema.snapshot.sql` across branches

## Install

```bash
npm install -g @kuosuko/dbfy
```

Or run without installing:

```bash
npx @kuosuko/dbfy
```

## Usage

```bash
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
```

Both `--migrations` and `--dialect` are auto-detected when omitted. Anything you
pass explicitly always wins over detection.

### Dialects

| Dialect | Engine | Server? | Notes |
|---------|--------|---------|-------|
| `sqlite` | better-sqlite3 (in-memory) | No | Fast (~20ms), zero-setup |
| `postgres` | PGlite (in-memory WASM Postgres) | No | Full PG types: JSONB, ENUM, arrays, partial indexes |
| `mysql` | **pure DDL parser** (default) | **No** | Parses DDL to the final schema in milliseconds — no server, no Docker |
| `mysql` + `--url` | real MySQL via `mysql2` | Yes | Full fidelity: views, triggers, routines, generated columns |

```bash
# SQLite migrations (auto-detected)
dbfy --out schema.snapshot.sql

# PostgreSQL migrations
dbfy --out schema.snapshot.sql --dialect postgres

# MySQL — pure-parse, NO server needed (this is dbfy's differentiator)
dbfy --out schema.snapshot.sql --dialect mysql

# MySQL — full fidelity against a real server
dbfy --dialect mysql --url mysql://root:root@localhost:3306/ --out schema.snapshot.sql

# Pipe to stdout for agent context
dbfy --dialect postgres --out -
```

#### Why MySQL has two modes

Unlike Postgres (which has PGlite, a mature in-memory WASM build), MySQL has **no
embeddable engine**. Most tools therefore need a live MySQL or a Docker container
just to compute the final schema. dbfy's default MySQL mode instead **parses the
DDL directly** — folding every `ALTER TABLE` back into its `CREATE TABLE` — so you
get the post-merge schema in milliseconds with zero setup.

The pure-parse engine understands structure (tables, columns, keys, indexes,
foreign keys) but not stored programs. When you need views, triggers, routines, or
generated columns reproduced exactly, pass `--url` (or set `MYSQL_URL` /
`DATABASE_URL`) and dbfy runs the migrations against a real server in a throwaway
database, then drops it.

### CI: fail the build when a snapshot is stale

`--check` regenerates the schema in memory and compares it to the committed
snapshot (ignoring the volatile `-- generated:` timestamp line). It exits `0` when
they match and `1` on drift — so a contributor who edits a migration but forgets to
refresh `schema.snapshot.sql` fails CI.

```bash
# In CI, after npm ci:
dbfy --check
```

```yaml
# .github/workflows/schema.yml
- run: npx @kuosuko/dbfy --check
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
import { snap } from '@kuosuko/dbfy';

const result = await snap({
  migrationsDir: './migrations',
  out: './schema.snapshot.sql',  // or '-' for stdout
  dialect: 'mysql',
  serverUrl: process.env.MYSQL_URL, // optional — omit for zero-setup pure-parse
  includeHeader: true,
});

console.log(result.filesProcessed, 'migrations applied');
console.log(result.warnings);
```

## Limitations

- Migrations that contain **data backfills** (not just DDL) are still applied, but the backfill data doesn't end up in the schema file (which is correct — the schema file describes structure, not data).
- **MySQL pure-parse mode** (the default, no `--url`) reproduces structure — tables, columns, keys, indexes, foreign keys — but not stored programs (views, triggers, routines) or generated columns. dbfy warns when it skips one; pass `--url` for full fidelity.

## Install as Agent Skill

dbfy ships with a `SKILL.md` that teaches AI agents when and how to use it.

**One-command install (recommended):**
```bash
npx skills add kuosuko/dbfy -g
```

**Manual install:**

| Agent | Location |
|-------|----------|
| Claude Code | `~/.claude/skills/dbfy/SKILL.md` or `.claude/skills/dbfy/SKILL.md` |
| OpenCode | `~/.config/opencode/skills/dbfy/SKILL.md` |
| Cursor | `.cursor/skills/dbfy/SKILL.md` |
| Windsurf | `.windsurf/skills/dbfy/SKILL.md` |

The skill tells the agent to use `dbfy` instead of reading migration files one by one, keeping context lean.

Browse skills at [skills.sh](https://skills.sh).

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
