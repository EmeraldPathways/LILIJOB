import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../db/schema";
import { v4MigrationStatements } from "../../lib/v4/migration";
import type { HiringSignalCandidate } from "../../lib/v4/signals";
import { evaluatePermit, type PermitEvaluationInput, type PermitRule } from "../../lib/v4/permit";

const state: { db: ReturnType<typeof drizzle> } = { db: undefined as never };
vi.mock("../../db", () => ({ getDb: () => state.db }));

function sqliteD1Adapter(sqlite: DatabaseSync) {
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
    async batch(statements: Array<{ run(): Promise<unknown> }>) { for (const statement of statements) await statement.run(); return []; },
  };
}

let sqlite: DatabaseSync;
beforeEach(() => {
  sqlite = new DatabaseSync(":memory:");
  sqlite.exec("CREATE TABLE companies (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL)");
  sqlite.exec("CREATE TABLE sources (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, company_id TEXT, url TEXT NOT NULL, normalized_url TEXT NOT NULL, title TEXT, snippet TEXT, provider TEXT NOT NULL, source_type TEXT NOT NULL DEFAULT 'search', retrieved_at TEXT, checked_at TEXT, status TEXT NOT NULL DEFAULT 'ok', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)");
  sqlite.exec("CREATE UNIQUE INDEX sources_owner_normalized_url_idx ON sources(owner_id, normalized_url)");
  for (const statement of v4MigrationStatements) sqlite.exec(statement);
  state.db = drizzle(sqliteD1Adapter(sqlite) as never, { schema });
  sqlite.prepare("INSERT INTO companies (id, owner_id) VALUES (?, ?)").run("company-a", "owner-a");
  sqlite.prepare("INSERT INTO companies (id, owner_id) VALUES (?, ?)").run("company-b", "owner-b");
});
afterEach(() => sqlite.close());

const candidate = (overrides: Partial<HiringSignalCandidate> & { sourceId?: string | null } = {}): HiringSignalCandidate & { sourceId?: string | null } => ({
  companyId: "company-a",
  type: "hiring-surge",
  summary: "Acme is expanding its Dublin team",
  eventDate: new Date().toISOString().slice(0, 10),
  discoveredAt: new Date().toISOString(),
  sourceUrl: "https://acme.test/news/team-expansion",
  sourceReliability: "secondary",
  dublinConnection: true,
  functionRelevance: 75,
  companyInterest: 75,
  ...overrides,
});

describe("Version 4 intelligence repository safeguards", () => {
  it("preserves effective rule provenance and exposes a manual-only refresh state", async () => {
    const { createPermitRule, listPermitRules } = await import("../../lib/v4/intelligence-repository");
    await createPermitRule({
      id: "rule-current",
      ruleSet: "critical-skills",
      effectiveFrom: "2026-06-01",
      effectiveTo: null,
      sourceUrl: "https://enterprise.gov.ie/permits",
      eligibleOccupations: ["Product Manager"],
      salaryThreshold: 64000,
      provenance: { authority: "Department of Enterprise", title: "Employment permits", sourceCheckedAt: "2026-10-14" },
    });
    const [rule] = await listPermitRules();
    expect(rule).toMatchObject({ effectiveFrom: "2026-06-01", recordedAt: expect.any(String) });
    expect(rule.provenance).toMatchObject({ authority: "Department of Enterprise", sourceCheckedAt: "2026-10-14", sourceCheckBasis: "admin-reported", verificationStatus: "not-live-verified" });
    expect(rule.refresh).toMatchObject({ status: "manual-review-required", automated: false, liveVerificationPerformed: false });
    expect(rule).not.toHaveProperty("checkedAt");
  });

  it("stores a permit evaluation rule snapshot with its effective dates and verification limits", async () => {
    const { savePermitEvaluation } = await import("../../lib/v4/intelligence-repository");
    const input: PermitEvaluationInput & { companyId: string; jobId: string | null } = {
      companyId: "company-a",
      jobId: null,
      roleTitle: "Product Manager",
      salary: null,
      relevantDate: "2026-10-15",
      dublinEvidence: "unknown",
      pastSponsorshipEvidence: null,
      currentSupportEvidence: null,
    };
    const rule: PermitRule = {
      id: "audit-rule",
      ruleSet: "critical-skills",
      effectiveFrom: "2026-06-01",
      effectiveTo: null,
      sourceUrl: "https://enterprise.gov.ie/permits",
      eligibleOccupations: ["Product Manager"],
      provenance: { authority: "Department of Enterprise", title: "Employment permits", sourceCheckedAt: null },
    };
    const result = evaluatePermit(input, [rule]);
    const id = await savePermitEvaluation("owner-a", input, result);
    const saved = sqlite.prepare("SELECT inputs_json FROM permit_evaluations WHERE id = ?").get(id) as { inputs_json: string };
    const snapshot = JSON.parse(saved.inputs_json).ruleSnapshot;
    expect(snapshot).toMatchObject({
      ruleId: "audit-rule",
      effectiveFrom: "2026-06-01",
      sourceUrl: "https://enterprise.gov.ie/permits",
      provenance: { authority: "Department of Enterprise", verificationStatus: "not-live-verified" },
      refresh: { liveVerificationPerformed: false },
    });
  });

  it("rejects a supplied source ID whose owner or URL does not match the signal", async () => {
    const { createHiringSignal } = await import("../../lib/v4/intelligence-repository");
    sqlite.prepare("INSERT INTO sources (id, owner_id, company_id, url, normalized_url, provider, source_type) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run("foreign-source", "owner-b", "company-b", "https://other.test/news", "https://other.test/news", "test", "news");
    await expect(createHiringSignal("owner-a", candidate({ sourceId: "foreign-source" }))).rejects.toThrow(/source/i);
    expect(sqlite.prepare("SELECT count(*) AS count FROM company_signals").get()).toEqual({ count: 0 });
  });

  it("deduplicates an event and replaces syndicated attribution with the primary source without marking it verified", async () => {
    const { createHiringSignal, listHiringSignals } = await import("../../lib/v4/intelligence-repository");
    const first = await createHiringSignal("owner-a", candidate());
    const repeated = await createHiringSignal("owner-a", candidate({
      summary: "  ACME is expanding its Dublin team! ",
      sourceUrl: "https://acme.test/news/team-expansion-primary",
      sourceReliability: "primary",
    }));
    expect(repeated?.id).toBe(first?.id);
    expect(repeated?.verifiedStatus).toBe("unverified");
    expect(repeated?.confidence).toBe("high");
    expect((await listHiringSignals("owner-a"))[0]).toMatchObject({
      sourceUrl: "https://acme.test/news/team-expansion-primary",
      sourceReliability: "primary",
      sourceVerificationStatus: "not-live-verified",
    });
    expect(sqlite.prepare("SELECT provider, retrieved_at, checked_at, status FROM sources WHERE url = ?").get("https://acme.test/news/team-expansion-primary")).toEqual({
      provider: "user-reported:primary",
      retrieved_at: null,
      checked_at: null,
      status: "user-provided",
    });
  });

  it("does not churn attribution when a duplicate has the same reported source reliability", async () => {
    const { createHiringSignal, listHiringSignals } = await import("../../lib/v4/intelligence-repository");
    await createHiringSignal("owner-a", candidate({ sourceReliability: "unknown", sourceUrl: "https://news.test/first" }));
    await createHiringSignal("owner-a", candidate({ sourceReliability: "unknown", sourceUrl: "https://news.test/second" }));
    expect((await listHiringSignals("owner-a"))[0].sourceUrl).toBe("https://news.test/first");
  });

  it("does not erase a user correction when a stronger duplicate source arrives", async () => {
    const { createHiringSignal, updateHiringSignal, listHiringSignals } = await import("../../lib/v4/intelligence-repository");
    const first = await createHiringSignal("owner-a", candidate());
    await updateHiringSignal("owner-a", first!.id, { correction: { summary: "Acme is expanding its Dublin team!" } });
    await createHiringSignal("owner-a", candidate({ sourceReliability: "primary", sourceUrl: "https://acme.test/news/primary" }));
    expect((await listHiringSignals("owner-a"))[0]).toMatchObject({
      summary: "Acme is expanding its Dublin team!",
      verifiedStatus: "corrected",
      sourceUrl: "https://acme.test/news/primary",
    });
  });

  it("persists correction and suppression state and reports expired signals as inactive", async () => {
    const { createHiringSignal, updateHiringSignal, listHiringSignals } = await import("../../lib/v4/intelligence-repository");
    const created = await createHiringSignal("owner-a", candidate({
      eventDate: "2025-01-01",
      discoveredAt: "2025-01-02T00:00:00.000Z",
      sourceUrl: "https://acme.test/news/old-team-expansion",
    }));
    expect(created).not.toBeNull();
    const corrected = await updateHiringSignal("owner-a", created!.id, { correction: { summary: "Corrected description", eventDate: "2025-01-03", sourceUrl: "https://acme.test/news/corrected-source" } });
    expect(corrected?.summary).toBe("Corrected description");
    expect(corrected?.verifiedStatus).toBe("corrected");
    const suppressed = await updateHiringSignal("owner-a", created!.id, { suppressed: true });
    expect(suppressed?.verifiedStatus).toBe("suppressed-corrected");
    const restored = await updateHiringSignal("owner-a", created!.id, { suppressed: false });
    expect(restored?.verifiedStatus).toBe("corrected");
    expect((await listHiringSignals("owner-a"))[0]).toMatchObject({ sourceUrl: "https://acme.test/news/corrected-source", sourceReliability: "unknown", sourceVerificationStatus: "not-live-verified" });
    expect((await listHiringSignals("owner-a"))[0]).toMatchObject({ qaStatus: "expired", isExpired: true, isSuppressed: false });
    expect(await updateHiringSignal("owner-b", created!.id, { suppressed: true })).toBeNull();
  });

  it("does not overwrite an existing effective-date rule version", async () => {
    const { createPermitRule, listPermitRules } = await import("../../lib/v4/intelligence-repository");
    const original = {
      id: "immutable-rule",
      ruleSet: "critical-skills",
      effectiveFrom: "2026-06-01",
      effectiveTo: null,
      sourceUrl: "https://enterprise.gov.ie/permits",
      eligibleOccupations: ["Product Manager"],
      salaryThreshold: 64000,
      provenance: { authority: "Department of Enterprise", title: "Employment permits", sourceCheckedAt: null },
    };
    await createPermitRule(original);
    const conflict = await createPermitRule({ ...original, salaryThreshold: 1 });
    expect(conflict).toBeNull();
    expect((await listPermitRules())[0].rulesJson).toContain("64000");
  });
});
