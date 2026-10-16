import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../db/schema";
import { v4MigrationStatements } from "../../lib/v4/migration";

const state: { db: ReturnType<typeof drizzle> } = { db: undefined as never };
vi.mock("../../db", () => ({ getDb: () => state.db }));

function adapter(sqlite: DatabaseSync) {
  return {
    prepare(sql: string) {
      let values: unknown[] = [];
      const statement = {
        bind(...input: unknown[]) { values = input; return statement; },
        async all() { return { results: sqlite.prepare(sql).all(...values as never[]), success: true, meta: {} }; },
        async raw() { return sqlite.prepare(sql).all(...values as never[]).map((row) => Object.values(row)); },
        async run() { return sqlite.prepare(sql).run(...values as never[]); },
      };
      return statement;
    },
  };
}

let sqlite: DatabaseSync;

beforeEach(() => {
  sqlite = new DatabaseSync(":memory:");
  for (const file of ["0000_abnormal_zeigeist.sql", "0001_tearful_eternity.sql", "0002_majestic_warlock.sql"]) {
    sqlite.exec(readFileSync(new URL(`../../drizzle/${file}`, import.meta.url), "utf8").replaceAll("--> statement-breakpoint", ""));
  }
  for (const statement of v4MigrationStatements) sqlite.exec(statement);
  state.db = drizzle(adapter(sqlite) as never, { schema });
});

afterEach(() => sqlite.close());

describe("owner-versioned saved searches", () => {
  it("validates the saved-search name, text and local dataset scope", async () => {
    const { saveSavedSearch } = await import("../../lib/v4/saved-searches");
    await expect(saveSavedSearch("owner-a", { name: " ", query: { text: "product", scope: "jobs" } })).rejects.toThrow();
    await expect(saveSavedSearch("owner-a", { name: "Product roles", query: { text: "x", scope: "jobs" } })).rejects.toThrow();
    await expect(saveSavedSearch("owner-a", { name: "Product roles", query: { text: "product", scope: "web" } as never })).rejects.toThrow();
  });

  it("runs against only the owner's local job records and versions each saved result", async () => {
    const { saveSavedSearch, listSavedSearches, runSavedSearch, deleteSavedSearch } = await import("../../lib/v4/saved-searches");
    sqlite.prepare("INSERT INTO companies (id, owner_id, name, normalized_name) VALUES (?, ?, ?, ?)").run("company-a", "owner-a", "Acme", "acme");
    sqlite.prepare("INSERT INTO companies (id, owner_id, name, normalized_name) VALUES (?, ?, ?, ?)").run("company-b", "owner-b", "Other", "other");
    sqlite.prepare("INSERT INTO jobs (id, owner_id, company_id, title, location, status) VALUES (?, ?, ?, ?, ?, ?)").run("job-a", "owner-a", "company-a", "Senior Product Manager", "Dublin", "open");
    sqlite.prepare("INSERT INTO jobs (id, owner_id, company_id, title, location, status) VALUES (?, ?, ?, ?, ?, ?)").run("job-b", "owner-b", "company-b", "Product Analyst", "Dublin", "open");

    const saved = await saveSavedSearch("owner-a", { name: "Product roles", query: { text: "product", scope: "jobs" } });
    expect((await listSavedSearches("owner-a")).map((item) => item.id)).toEqual([saved.id]);
    expect(await listSavedSearches("owner-b")).toEqual([]);

    const ran = await runSavedSearch("owner-a", saved.id);
    expect(ran?.lastRunResult).toMatchObject({ totalCount: 1, results: [{ id: "job-a", kind: "job", title: "Senior Product Manager" }] });
    expect(await runSavedSearch("owner-b", saved.id)).toBeNull();
    expect(await deleteSavedSearch("owner-b", saved.id)).toBe(false);
    expect(await listSavedSearches("owner-a")).toHaveLength(1);

    expect(sqlite.prepare("SELECT version, settings_json FROM settings_versions WHERE owner_id = ? AND namespace = ? ORDER BY version").all("owner-a", "saved-searches")).toHaveLength(2);
    expect(await deleteSavedSearch("owner-a", saved.id)).toBe(true);
    expect(await listSavedSearches("owner-a")).toEqual([]);
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM settings_versions WHERE owner_id = ? AND namespace = ?").get("owner-a", "saved-searches")).toMatchObject({ count: 3 });
  });

  it("searches company records locally and ignores SQL wildcard characters as wildcards", async () => {
    const { saveSavedSearch, runSavedSearch } = await import("../../lib/v4/saved-searches");
    sqlite.prepare("INSERT INTO companies (id, owner_id, name, normalized_name, location_text) VALUES (?, ?, ?, ?, ?)").run("company-a", "owner-a", "Acme 100% Labs", "acme-100-labs", "Dublin");
    sqlite.prepare("INSERT INTO companies (id, owner_id, name, normalized_name, location_text) VALUES (?, ?, ?, ?, ?)").run("company-b", "owner-a", "Acme 100 Labs", "acme-100-other", "Dublin");
    const saved = await saveSavedSearch("owner-a", { name: "Exact percent", query: { text: "100%", scope: "companies" } });
    expect((await runSavedSearch("owner-a", saved.id))?.lastRunResult?.results.map((item) => item.id)).toEqual(["company-a"]);
  });
});
