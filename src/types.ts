/**
 * Shared types for dbfy.
 */

export type Dialect = 'sqlite' | 'postgres' | 'mysql';

export interface MigrationFile {
  /** Filename, e.g. "001-create-users.sql" */
  filename: string;
  /** Absolute path */
  path: string;
  /** Numeric version, parsed from filename */
  version: number;
  /** Raw SQL contents */
  contents: string;
}

export interface SnapOptions {
  /** Directory containing migration files */
  migrationsDir: string;
  /** Output path, or '-' for stdout */
  out: string;
  /** Database dialect */
  dialect: Dialect;
  /** Add a header comment with metadata to the snapshot */
  includeHeader?: boolean;
}

export interface SnapResult {
  filesProcessed: number;
  output: string;
  warnings: string[];
}
