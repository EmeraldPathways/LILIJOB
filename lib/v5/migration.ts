import { v4MigrationStatements } from "../v4/migration";

/** Additive, repeat-safe changes that cannot be expressed by the V4 create-if-missing migration. */
export const V5_SCHEMA_VERSION = 2;

export const v5MigrationStatements = [
  "ALTER TABLE job_matches ADD COLUMN profile_version INTEGER NOT NULL DEFAULT 1",
  "ALTER TABLE job_matches ADD COLUMN scoring_config_version TEXT NOT NULL DEFAULT 'v5-default-1'",
  "ALTER TABLE outreach_drafts ADD COLUMN revision INTEGER NOT NULL DEFAULT 1",
  "ALTER TABLE outreach_drafts ADD COLUMN approval_fingerprint TEXT",
  "ALTER TABLE outreach_events ADD COLUMN payload_fingerprint TEXT",
] as const;

type SqlDatabase = {
  prepare(sql: string): { run(): Promise<unknown> };
};

async function hasColumn(db: SqlDatabase, table: string, column: string): Promise<boolean> {
  const statement = db.prepare(`PRAGMA table_info(${table})`) as unknown as { all?: () => Promise<{ results: Array<{ name: string }> }> };
  if (!statement.all) return false;
  const result = await statement.all();
  return result.results.some((row) => row.name === column);
}

export async function runV5Migration(db: SqlDatabase): Promise<{ version: number; statements: number; applied: number }> {
  let applied = 0;
  // Re-run the additive V4 create/index statements so newly introduced V5 tables
  // are created on an already migrated production database as well as on fresh DBs.
  for (const statement of v4MigrationStatements) await db.prepare(statement).run();
  const columns = [
    ["job_matches", "profile_version"],
    ["job_matches", "scoring_config_version"],
    ["outreach_drafts", "revision"],
    ["outreach_drafts", "approval_fingerprint"],
    ["outreach_events", "payload_fingerprint"],
  ] as const;
  for (let index = 0; index < v5MigrationStatements.length; index += 1) {
    const [table, column] = columns[index];
    if (await hasColumn(db, table, column)) continue;
    await db.prepare(v5MigrationStatements[index]).run();
    applied += 1;
  }
  return { version: V5_SCHEMA_VERSION, statements: v4MigrationStatements.length + v5MigrationStatements.length, applied };
}
