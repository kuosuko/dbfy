import type { MigrationFile } from './types.js';

export interface ApplyResult {
  schema: string;
  warnings: string[];
}

export async function applyMigrationsPg(files: MigrationFile[]): Promise<ApplyResult> {
  const { PGlite } = await import('@electric-sql/pglite');
  const { pgDump } = await import('@electric-sql/pglite-tools/pg_dump');

  const db = new PGlite();
  const warnings: string[] = [];

  try {
    for (const f of files) {
      try {
        await db.exec(f.contents);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(
          `Migration ${f.filename} failed: ${msg}\n` +
            `dbfy uses PGlite (in-memory Postgres) as the snapshot engine.`
        );
      }
    }

    const dumpFile = await pgDump({
      pg: db,
      args: ['--schema-only', '--no-owner', '--no-privileges', '--no-comments'],
    });

    const schema = await dumpFile.text();
    return { schema, warnings };
  } finally {
    await db.close();
  }
}
