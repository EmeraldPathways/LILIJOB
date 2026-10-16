import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../db/schema";
import { v4MigrationStatements } from "../../lib/v4/migration";

const state: { db: ReturnType<typeof drizzle> } = { db: undefined as never };
vi.mock("../../db", () => ({ getDb: () => state.db }));

function adapter(sqlite: DatabaseSync) {
  return { prepare(sql: string) { let values: unknown[] = []; const statement = { bind(...input: unknown[]) { values = input; return statement; }, async all() { return { results: sqlite.prepare(sql).all(...values as never[]), success: true, meta: {} }; }, async raw() { return sqlite.prepare(sql).all(...values as never[]).map((row) => Object.values(row)); }, async run() { return sqlite.prepare(sql).run(...values as never[]); } }; return statement; } };
}

let sqlite: DatabaseSync;
beforeEach(() => { sqlite = new DatabaseSync(":memory:"); for (const file of ["0000_abnormal_zeigeist.sql", "0001_tearful_eternity.sql", "0002_majestic_warlock.sql"]) sqlite.exec(readFileSync(new URL(`../../drizzle/${file}`, import.meta.url), "utf8").replaceAll("--> statement-breakpoint", "")); for (const statement of v4MigrationStatements) sqlite.exec(statement); state.db = drizzle(adapter(sqlite) as never, { schema }); });
afterEach(() => sqlite.close());

describe("authoritative CRM analytics", () => {
  it("uses owner-scoped applications and immutable events with explicit denominators", async () => {
    sqlite.prepare("INSERT INTO companies (id, owner_id, name, normalized_name, metadata_json) VALUES (?, ?, ?, ?, ?)").run("company-a", "owner-a", "Acme", "acme", '{"sector":"Fintech"}');
    sqlite.prepare("INSERT INTO applications (id, owner_id, company_id, title, stage, dedup_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run("app-a", "owner-a", "company-a", "Product", "Interview", "owner-a:app-a", "2026-10-01", "2026-10-01");
    sqlite.prepare("INSERT INTO application_events (id, owner_id, application_id, type, stage_to, event_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run("event-a", "owner-a", "app-a", "stage-change", "Interview", "2026-10-02", "2026-10-02", "2026-10-02");
    const { getApplicationAnalytics, persistDailyApplicationAnalytics } = await import("../../lib/v5/analytics");
    const analytics = await getApplicationAnalytics("owner-a", { sector: "Fintech" });
    expect(analytics.denominators.target).toBe(1);
    expect(analytics.denominators.interviews).toBe(1);
    expect(analytics.rates.interviewRate).toBe(1);
    expect(analytics.note).toContain("descriptive");
    expect((await persistDailyApplicationAnalytics("owner-a", new Date("2026-10-16T12:00:00.000Z"))).metricDate).toBe("2026-10-16");
  });
});
