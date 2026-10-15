import { v4MigrationStatements, V4_SCHEMA_VERSION } from "./migration";

type SqlDatabase = {
  prepare(sql: string): { run(): Promise<unknown> };
};

export type V4MigrationResult = {
  version: number;
  statements: number;
};

/**
 * Runs only additive, IF NOT EXISTS statements. It is safe to call on every
 * request during the one-time upgrade window and on an already-upgraded DB.
 */
export async function runV4Migration(db: SqlDatabase): Promise<V4MigrationResult> {
  for (const statement of v4MigrationStatements) {
    await db.prepare(statement).run();
  }

  return { version: V4_SCHEMA_VERSION, statements: v4MigrationStatements.length };
}
