import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../db/schema";
import { v4MigrationStatements } from "../../lib/v4/migration";
import type { JobRadarResult } from "../../lib/v4/job-radar";

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
const result = (description: string): JobRadarResult => ({
  status: "supported",
  sourceUrl: "https://acme.test/careers",
  checkedAt: "2026-10-15T12:00:00.000Z",
  jobs: [{ externalId: "123", title: "Senior Product Manager", url: "https://acme.test/jobs/123#apply", description, location: "Dublin", workModel: "hybrid", employmentType: "FULL_TIME", salary: "€70,000", postedAt: "2026-10-14", firstSeenAt: "2026-10-15T12:00:00.000Z", lastConfirmedAt: "2026-10-15T12:00:00.000Z", verified: true, sourceUrl: "https://acme.test/careers" }],
});

beforeEach(() => {
  sqlite = new DatabaseSync(":memory:");
  for (const file of ["0000_abnormal_zeigeist.sql", "0001_tearful_eternity.sql", "0002_majestic_warlock.sql"]) sqlite.exec(readFileSync(new URL(`../../drizzle/${file}`, import.meta.url), "utf8").replaceAll("--> statement-breakpoint", ""));
  for (const statement of v4MigrationStatements) sqlite.exec(statement);
  state.db = drizzle(adapter(sqlite) as never, { schema });
  sqlite.prepare("INSERT INTO companies (id, owner_id, name, normalized_name) VALUES (?, ?, ?, ?)").run("company-a", "owner-a", "Acme", "acme");
});

afterEach(() => sqlite.close());

describe("Version 4 job persistence", () => {
  it("deduplicates canonical jobs and stores changed snapshots", async () => {
    const { persistDiscoveredJobs } = await import("../../lib/v4/job-repository");
    expect(await persistDiscoveredJobs("owner-b", "company-a", result("wrong owner"))).toMatchObject({ found: false });
    expect(await persistDiscoveredJobs("owner-a", "company-a", result("first text"))).toMatchObject({ found: true, jobsCreated: 1, snapshotsCreated: 1, sourcesCreated: 1 });
    expect(await persistDiscoveredJobs("owner-a", "company-a", result("first text"))).toMatchObject({ found: true, jobsCreated: 0, snapshotsCreated: 0, sourcesCreated: 0 });
    expect(await persistDiscoveredJobs("owner-a", "company-a", result("changed text"))).toMatchObject({ found: true, jobsCreated: 0, snapshotsCreated: 1, sourcesCreated: 0 });
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM jobs WHERE owner_id = ?").get("owner-a")).toMatchObject({ count: 1 });
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM job_snapshots WHERE owner_id = ?").get("owner-a")).toMatchObject({ count: 2 });
  });

  it("filters by title, location, status, salary and recent creation date", async () => {
    const { listV4Jobs, persistDiscoveredJobs } = await import("../../lib/v4/job-repository");
    await persistDiscoveredJobs("owner-a", "company-a", result("role one"));
    sqlite.prepare("UPDATE jobs SET created_at = ?, status = ? WHERE title = ?").run("2026-10-14T12:00:00.000Z", "open", "Senior Product Manager");
    sqlite.prepare("INSERT INTO jobs (id, owner_id, company_id, title, url, location, status, confidence, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run("job-2", "owner-a", "company-a", "Data Analyst", "https://acme.test/jobs/2", "Cork", "closed", "low", "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z");
    expect(await listV4Jobs("owner-a", { title: "product" })).toHaveLength(1);
    expect(await listV4Jobs("owner-a", { location: "dublin" })).toHaveLength(1);
    expect(await listV4Jobs("owner-a", { status: "closed" })).toHaveLength(1);
    expect(await listV4Jobs("owner-a", { salaryPresent: true })).toHaveLength(1);
    expect(await listV4Jobs("owner-a", { newDays: 7 })).toHaveLength(1);
    expect(await listV4Jobs("owner-b")).toHaveLength(0);
  });

  it("does not close or remove existing jobs when a source refresh fails or omits postings", async () => {
    const { persistDiscoveredJobs } = await import("../../lib/v4/job-repository");
    await persistDiscoveredJobs("owner-a", "company-a", result("present"));
    await persistDiscoveredJobs("owner-a", "company-a", { status: "error", sourceUrl: "https://acme.test/careers", checkedAt: "2026-10-16T12:00:00.000Z", jobs: [], error: "upstream unavailable" });
    await persistDiscoveredJobs("owner-a", "company-a", { status: "empty", sourceUrl: "https://acme.test/careers", checkedAt: "2026-10-17T12:00:00.000Z", jobs: [] });
    expect(sqlite.prepare("SELECT status FROM jobs WHERE owner_id = ? AND company_id = ?").get("owner-a", "company-a")).toMatchObject({ status: "open" });
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM jobs WHERE owner_id = ? AND company_id = ?").get("owner-a", "company-a")).toMatchObject({ count: 1 });
  });

  it("uses two comparable supported omissions before closing a role", async () => {
    const { persistDiscoveredJobs } = await import("../../lib/v4/job-repository");
    await persistDiscoveredJobs("owner-a", "company-a", result("present"));
    const missing = { status: "supported" as const, sourceUrl: "https://acme.test/careers", checkedAt: "2026-10-16T12:00:00.000Z", jobs: [] };
    await persistDiscoveredJobs("owner-a", "company-a", missing);
    expect(sqlite.prepare("SELECT status FROM jobs WHERE owner_id = ? AND company_id = ?").get("owner-a", "company-a")).toMatchObject({ status: "open" });
    expect(sqlite.prepare("SELECT state FROM job_snapshots WHERE owner_id = ?").get("owner-a")).toMatchObject({ state: "unverified" });
    await persistDiscoveredJobs("owner-a", "company-a", { ...missing, checkedAt: "2026-10-17T12:00:00.000Z" });
    expect(sqlite.prepare("SELECT status FROM jobs WHERE owner_id = ? AND company_id = ?").get("owner-a", "company-a")).toMatchObject({ status: "closed" });
    expect(sqlite.prepare("SELECT state FROM job_snapshots WHERE owner_id = ?").get("owner-a")).toMatchObject({ state: "removed" });
  });

  it("stores snapshots for changed content but advances the seen timestamp for unchanged content", async () => {
    const { persistDiscoveredJobs } = await import("../../lib/v4/job-repository");
    const initial = result("same body");
    await persistDiscoveredJobs("owner-a", "company-a", initial);
    const repeated = { ...result("same body"), checkedAt: "2026-10-18T12:00:00.000Z", jobs: result("same body").jobs.map((job) => ({ ...job, firstSeenAt: "2026-10-15T12:00:00.000Z", lastConfirmedAt: "2026-10-18T12:00:00.000Z" })) };
    expect(await persistDiscoveredJobs("owner-a", "company-a", repeated)).toMatchObject({ snapshotsCreated: 0 });
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM job_snapshots WHERE owner_id = ?").get("owner-a")).toMatchObject({ count: 1 });
    expect(sqlite.prepare("SELECT last_seen_at FROM job_snapshots WHERE owner_id = ?").get("owner-a")).toMatchObject({ last_seen_at: "2026-10-18T12:00:00.000Z" });
  });

  it("checkpoints owner-scoped runs, cancels safely and retries a failed run with its checkpoint", async () => {
    const { startJobDiscoveryRun, updateJobDiscoveryCheckpoint, getJobDiscoveryRun, cancelJobDiscoveryRun, retryJobDiscoveryRun } = await import("../../lib/v4/job-repository");
    const runId = await startJobDiscoveryRun("owner-a", { type: "company", companyId: "company-a" }, ["https://acme.test/careers"]);
    expect(await updateJobDiscoveryCheckpoint("owner-b", runId, { phase: "wrong-owner" })).toBe(false);
    expect(await updateJobDiscoveryCheckpoint("owner-a", runId, { phase: "fetching", sourceIndex: 0 })).toBe(true);
    expect(JSON.parse((await getJobDiscoveryRun("owner-a", runId))!.checkpointJson)).toMatchObject({ phase: "fetching", sourceIndex: 0 });
    expect(await cancelJobDiscoveryRun("owner-b", runId)).toBe(false);
    expect(await cancelJobDiscoveryRun("owner-a", runId)).toBe(true);
    expect(await retryJobDiscoveryRun("owner-a", runId)).toBeTruthy();
    const runs = sqlite.prepare("SELECT owner_id, scope_json, sources_json, status FROM job_discovery_runs WHERE owner_id = ? ORDER BY created_at").all("owner-a") as Array<{ owner_id: string; scope_json: string; sources_json: string; status: string }>;
    expect(runs).toHaveLength(2);
    expect(runs[0].status).toBe("cancelled");
    expect(JSON.parse(runs[1].scope_json)).toMatchObject({ companyId: "company-a", retryOf: runId, previousCheckpoint: { phase: "fetching", sourceIndex: 0 } });
    expect(JSON.parse(runs[1].sources_json)).toEqual(["https://acme.test/careers"]);
  });
});
