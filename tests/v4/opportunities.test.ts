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
  sqlite.prepare("INSERT INTO companies (id, owner_id, name, normalized_name) VALUES (?, ?, ?, ?)").run("company-a", "owner-a", "Acme", "acme");
  sqlite.prepare("INSERT INTO jobs (id, owner_id, company_id, title, url, location, status) VALUES (?, ?, ?, ?, ?, ?, ?)").run("job-a", "owner-a", "company-a", "Product Manager", "https://acme.test/jobs/1", "Dublin", "open");
});

afterEach(() => sqlite.close());

describe("Version 4 opportunity persistence", () => {
  it("preserves manual star and dismiss decisions when a profile is re-ranked", async () => {
    const { getOrCreateCandidateProfile } = await import("../../lib/v4/repository");
    const { rankAndPersistOpportunities, updateOpportunityAction } = await import("../../lib/v4/opportunities");
    const profile = await getOrCreateCandidateProfile("owner-a", { name: "Product strategy" });

    await rankAndPersistOpportunities("owner-a", profile.id);
    await updateOpportunityAction("owner-a", profile.id, "job-a", { starred: true, dismissed: true });

    const reranked = await rankAndPersistOpportunities("owner-a", profile.id);
    expect(reranked?.[0]?.match.starred).toBe(true);
    expect(reranked?.[0]?.match.dismissed).toBe(true);
  });

  it("uses the latest persisted job snapshot when explaining a match", async () => {
    const { getOrCreateCandidateProfile } = await import("../../lib/v4/repository");
    const { rankAndPersistOpportunities } = await import("../../lib/v4/opportunities");
    const profile = await getOrCreateCandidateProfile("owner-a", { name: "Evidence profile", constraints: { skills: ["analytics"] } });
    sqlite.prepare("INSERT INTO job_snapshots (id, owner_id, job_id, content_hash, description, requirements_json, location, work_model, last_seen_at, first_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run("snapshot-a", "owner-a", "job-a", "hash-a", "Own analytics experiments", JSON.stringify(["analytics"]), "Dublin", "hybrid", "2026-10-15T12:00:00.000Z", "2026-10-15T12:00:00.000Z");

    const ranked = await rankAndPersistOpportunities("owner-a", profile.id);
    expect(ranked?.[0]?.match.explanationJson).toContain("analytics");
    expect(ranked?.[0]?.match.score).toBeGreaterThan(0);
  });
});
