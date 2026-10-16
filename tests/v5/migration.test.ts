import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { runV5Migration, v5MigrationStatements } from "../../lib/v5/migration";
import { v4MigrationStatements } from "../../lib/v4/migration";

function adapter(sqlite: DatabaseSync) {
  return { prepare(sql: string) { const statement = { async all() { return { results: sqlite.prepare(sql).all(), success: true, meta: {} }; }, async run() { return sqlite.prepare(sql).run(); } }; return statement; } };
}

describe("Version5 additive migration", () => {
  it("is repeat-safe and creates the new persistent tables", async () => {
    const sqlite = new DatabaseSync(":memory:");
    for (const statement of v4MigrationStatements) sqlite.exec(statement);
    const first = await runV5Migration(adapter(sqlite));
    const second = await runV5Migration(adapter(sqlite));
    expect(first.version).toBe(2);
    expect(first.applied).toBe(0);
    expect(second.applied).toBe(0);
    expect(first.statements).toBe(v4MigrationStatements.length + v5MigrationStatements.length);
    expect(sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('provider_usage_events','scheduled_task_runs','cv_edit_proposals','outreach_attachments','application_tasks','candidate_work_permissions','pitch_usages')").all()).toHaveLength(7);
    sqlite.close();
  });
});
