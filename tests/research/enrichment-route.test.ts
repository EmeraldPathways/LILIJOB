import { describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => {
  const tables = {
    companies: { name: "companies", ownerId: "companies.ownerId", id: "companies.id" },
    refreshRuns: { name: "refreshRuns", ownerId: "refreshRuns.ownerId", id: "refreshRuns.id" },
  };
  const run = { id: "run-1", ownerId: "owner-1", kind: "enrichment", status: "queued", total: 0, processed: 0, succeeded: 0, failed: 0, startedAt: null, cursor: null };
  const updates: Array<{ table: string; values: Record<string, unknown> }> = [];
  const db = {
    select: vi.fn(() => {
      let tableName = "";
      const query = {
        from(table: { name: string }) { tableName = table.name; return query; },
        where() {
          return { limit: async () => tableName === "refreshRuns" ? [run] : [] };
        },
      };
      return query;
    }),
    update: vi.fn((table: { name: string }) => ({
      set: (values: Record<string, unknown>) => ({ where: async () => { updates.push({ table: table.name, values }); return []; } }),
    })),
  };
  return { tables, run, updates, db };
});

vi.mock("drizzle-orm", () => ({ and: (...values: unknown[]) => values, eq: (...values: unknown[]) => values }));
vi.mock("../../db", () => ({ getDb: () => harness.db }));
vi.mock("../../db/schema", () => harness.tables);
vi.mock("../../lib/auth/require-user", () => ({
  userFromRequest: () => ({ userId: "owner-1" }),
  unauthorizedResponse: () => Response.json({ error: "unauthorized" }, { status: 401 }),
}));
vi.mock("../../lib/import/auto-enrich", () => ({ startImportEnrichment: vi.fn(), IMPORT_ENRICHMENT_BATCH_SIZE: 8, IMPORT_ENRICHMENT_CONCURRENCY: 2 }));
vi.mock("../../lib/import/enrichment-queue", () => ({ D1_COMPANY_ID_BATCH_SIZE: 50 }));
vi.mock("../../lib/research/run-worker", () => ({ runStatusForBatch: vi.fn(), uniqueDiscoveryCompanyIds: (ids: string[]) => [...new Set(ids)] }));
vi.mock("../../lib/research/enrichment-service", () => ({
  createRun: vi.fn(async () => "run-1"),
  enrichCompany: vi.fn(async () => ({ companyId: "co-1", runId: "run-1", status: "completed", sourcesChecked: 1, claimsAdded: 1, jobsFound: 0, contactsFound: 0, permitEvidenceFound: 0 })),
}));

import { POST } from "../../app/api/enrichment/route";

describe("single-company enrichment run ownership", () => {
  it("finalizes the single route's own run after enrichment", async () => {
    harness.updates.length = 0;
    const response = await POST(new Request("https://site.example/api/enrichment", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ companyId: "co-1" }),
    }));
    const body = await response.json() as { summary: { status: string } };

    expect(response.status).toBe(200);
    expect(body.summary.status).toBe("completed");
    expect(harness.updates).toContainEqual({
      table: "refreshRuns",
      values: expect.objectContaining({ status: "running" }),
    });
    expect(harness.updates).toContainEqual({
      table: "refreshRuns",
      values: expect.objectContaining({ status: "completed", total: 1, processed: 1, succeeded: 1, failed: 0 }),
    });
  });
});
