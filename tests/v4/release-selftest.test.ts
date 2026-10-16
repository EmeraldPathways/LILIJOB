import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { v4MigrationStatements } from "../../lib/v4/migration";

const { state } = vi.hoisted(() => ({
  state: { env: { DB: undefined as unknown } },
}));

vi.mock("cloudflare:workers", () => ({ env: state.env }));

function sqliteD1Adapter(sqlite: DatabaseSync) {
  return {
    prepare(sql: string) {
      let values: unknown[] = [];
      const statement = {
        bind(...input: unknown[]) { values = input; return statement; },
        async all() { return { results: sqlite.prepare(sql).all(...values as never[]), success: true, meta: {} }; },
        async raw() { return sqlite.prepare(sql).all(...values as never[]).map((row) => Object.values(row)); },
        async run() {
          const result = sqlite.prepare(sql).run(...values as never[]);
          return { success: true, meta: { changes: result.changes }, ...result };
        },
      };
      return statement;
    },
    async batch(statements: Array<{ run(): Promise<unknown> }>) {
      const results: unknown[] = [];
      for (const statement of statements) results.push(await statement.run());
      return results;
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
  state.env.DB = sqliteD1Adapter(sqlite);
  sqlite.prepare("INSERT INTO companies (id, owner_id, name, normalized_name) VALUES (?, ?, ?, ?)")
    .run("company-existing", "existing-owner", "Existing company", "existing-company");
});

afterEach(() => {
  sqlite.close();
  state.env.DB = undefined;
});

describe("release self-test", () => {
  it("runs the synthetic D1 release flow and removes only its owner-scoped rows", async () => {
    const { runReleaseSelfTest } = await import("../../lib/v4/release-selftest");

    const result = await runReleaseSelfTest();

    expect(result.passed).toBe(true);
    expect(result.ownerId).toMatch(/^release_validation_[0-9a-f-]+$/i);
    expect(result.steps.map((step) => step.status)).not.toContain("failed");
    expect(result.steps.find((step) => step.name === "verified_job_snapshot")?.observed).toMatchObject({ verified: true });
    expect(result.steps.find((step) => step.name === "ranking")?.observed).toMatchObject({ matches: 1 });
    expect(result.steps.find((step) => step.name === "application_owner_isolation")?.observed).toMatchObject({ foreignOwnerLookup: null });
    expect(result.steps.find((step) => step.name === "dashboard_counts")?.observed).toMatchObject({ funnel: { Applied: 1 } });
    expect(result.steps.find((step) => step.name === "safe_agent_run")?.observed).toMatchObject({ status: "completed", tool: "get_usage_budget" });
    expect(result.steps.find((step) => step.name === "document_exports")?.observed).toMatchObject({ pdfMagic: true, docxMagic: true });
    expect(result.cleanup).toMatchObject({ passed: true, remainingRows: 0 });
    expect(result.cleanup.deletedRows).toBeGreaterThan(0);
    expect(sqlite.prepare("SELECT id FROM companies WHERE owner_id = ?").get("existing-owner")).toMatchObject({ id: "company-existing" });

    const tables = ["companies", "sources", "jobs", "job_snapshots", "candidate_profiles", "experience_evidence", "job_matches", "applications", "application_events", "application_packs", "interviews", "interview_packs", "agent_runs", "agent_steps"];
    for (const table of tables) {
      expect(sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE owner_id = ?`).get(result.ownerId)).toMatchObject({ count: 0 });
    }
  });

  it("cleans its synthetic tenant after an intermediate database failure", async () => {
    sqlite.exec(`CREATE TRIGGER reject_release_profile BEFORE INSERT ON candidate_profiles
      WHEN NEW.owner_id GLOB 'release_validation_*'
      BEGIN SELECT RAISE(ABORT, 'synthetic self-test interruption'); END`);
    const { runReleaseSelfTest } = await import("../../lib/v4/release-selftest");

    const result = await runReleaseSelfTest();

    expect(result.passed).toBe(false);
    expect(result.steps.find((step) => step.name === "candidate_evidence")?.status).toBe("failed");
    expect(result.cleanup).toMatchObject({ passed: true, remainingRows: 0 });
    for (const table of result.cleanup.tables) {
      expect(sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE owner_id = ?`).get(result.ownerId)).toMatchObject({ count: 0 });
    }
    expect(sqlite.prepare("SELECT id FROM companies WHERE owner_id = ?").get("existing-owner")).toMatchObject({ id: "company-existing" });
  });
});

it("counts unique high-fit jobs across multiple candidate profiles", async () => {
 sqlite.prepare("INSERT INTO jobs (id,owner_id,company_id,title,status,confidence) VALUES (?,?,?,?,?,?)").run("job-count","existing-owner","company-existing","Product Manager","open","high");
 for (const id of ["profile-a","profile-b"]) sqlite.prepare("INSERT INTO job_matches (id,owner_id,job_id,profile_id,scoring_version,score,confidence,scored_at) VALUES (?,?,?,?,?,?,?,?)").run(id,"existing-owner","job-count",id,"v1",90,"high",new Date().toISOString());
 const { getDashboardSummary } = await import("../../lib/v4/dashboard");
 expect((await getDashboardSummary("existing-owner")).cards.highFitLiveJobs).toBe(1);
});
