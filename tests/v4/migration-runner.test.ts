import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { runV4Migration } from "../../lib/v4/migration-runner";
import { v4MigrationStatements } from "../../lib/v4/migration";

describe("Version 4 migration runner", () => {
  it("executes each statement once and reports the schema version", async () => {
    const executed: string[] = [];
    const db = { prepare(sql: string) { return { run: async () => { executed.push(sql); return {}; } }; } };
    const result = await runV4Migration(db as never);
    expect(result.version).toBe(1);
    expect(result.statements).toBe(v4MigrationStatements.length);
    expect(executed).toHaveLength(v4MigrationStatements.length);
  });

  it("runs against a fresh SQLite database, is repeat-safe, and keeps an existing table", async () => {
    const sqlite = new DatabaseSync(":memory:");
    sqlite.exec("CREATE TABLE legacy_company_data (id TEXT PRIMARY KEY, name TEXT NOT NULL)");
    sqlite.prepare("INSERT INTO legacy_company_data (id, name) VALUES (?, ?)").run("legacy-1", "Existing company");
    const db = {
      prepare(sql: string) {
        return { run: async () => sqlite.prepare(sql).run() };
      },
    };

    await runV4Migration(db);
    const repeated = await runV4Migration(db);
    expect(repeated).toEqual({ version: 1, statements: v4MigrationStatements.length });
    expect(sqlite.prepare("SELECT name FROM legacy_company_data WHERE id = ?").get("legacy-1")).toMatchObject({ name: "Existing company" });
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM candidate_profiles").get()).toMatchObject({ count: 0 });
    sqlite.close();
  });
});
