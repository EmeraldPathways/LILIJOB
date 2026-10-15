import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
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
  sqlite.prepare("INSERT INTO companies (id, owner_id, name, normalized_name, metadata_json) VALUES (?, ?, ?, ?, ?)").run("company-a", "owner-a", "Acme", "acme", "{}");
  sqlite.prepare("INSERT INTO sources (id, owner_id, company_id, url, normalized_url, snippet, provider) VALUES (?, ?, ?, ?, ?, ?, ?)").run("source-a", "owner-a", "company-a", "https://acme.test/jobs", "https://acme.test/jobs", "Role details", "fixture");
  sqlite.prepare("INSERT INTO jobs (id, owner_id, company_id, title, url, location, salary, source_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run("job-a", "owner-a", "company-a", "Product Manager", "https://acme.test/jobs/1", "Dublin", "70000", "source-a", "2026-01-01", "2026-01-02");
  sqlite.prepare("INSERT INTO contacts (id, owner_id, company_id, name, role, email, source_id, confidence, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run("contact-a", "owner-a", "company-a", "A Person", "Talent Partner", "info@acme.test", "source-a", "high", "2026-01-01", "2026-01-02");
});

afterEach(() => sqlite.close());

describe("Version 4 legacy backfill", () => {
  it("links existing jobs, sources and contacts without changing legacy rows", async () => {
    const { backfillV4ExistingData } = await import("../../lib/v4/backfill");
    const first = await backfillV4ExistingData("owner-a");
    const second = await backfillV4ExistingData("owner-a");
    expect(first).toEqual({ companiesLinked: 1, sourceLinksObserved: 2, jobSnapshotsCreated: 1, recruitmentContactsCreated: 1 });
    expect(second).toEqual({ companiesLinked: 1, sourceLinksObserved: 2, jobSnapshotsCreated: 0, recruitmentContactsCreated: 0 });
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM jobs WHERE owner_id = ?").get("owner-a")).toMatchObject({ count: 1 });
    expect(sqlite.prepare("SELECT contact_type, relevance_type FROM recruitment_contacts WHERE owner_id = ?").get("owner-a")).toMatchObject({ contact_type: "general-business", relevance_type: "recruiter" });
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM job_snapshots WHERE owner_id = ?").get("owner-a")).toMatchObject({ count: 1 });
  });
});
