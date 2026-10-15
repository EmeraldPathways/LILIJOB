import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => {
  const tables = {
    companies: { name: "companies", ownerId: "companies.ownerId", id: "companies.id" },
    companyClaims: { name: "companyClaims", ownerId: "companyClaims.ownerId", companyId: "companyClaims.companyId", status: "companyClaims.status" },
    refreshRuns: { name: "refreshRuns", ownerId: "refreshRuns.ownerId", id: "refreshRuns.id" },
  };
  const state = {
    company: {
      id: "co-1", ownerId: "owner-1", name: "North Star", domain: null, website: null,
      description: null, locality: null, locationText: null, employeeBand: null,
      foundedYear: null, headquarters: null, enrichmentStatus: "not-enriched",
    },
    updates: [] as Array<{ table: string; values: Record<string, unknown> }>,
    failClaimsRead: false,
  };
  const db = {
    select: vi.fn(() => {
      let tableName = "";
      const query = {
        from(table: { name: string }) { tableName = table.name; return query; },
        where() {
          const rows = () => {
              if (tableName === "companies") return [state.company];
              if (tableName === "companyClaims" && state.failClaimsRead) throw new Error("claim store unavailable");
              return [];
          };
          return {
            limit: async () => rows(),
            then: (resolve: (value: unknown[]) => unknown, reject: (error: unknown) => unknown) => Promise.resolve().then(rows).then(resolve, reject),
          };
        },
      };
      return query;
    }),
    update: vi.fn((table: { name: string }) => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => { state.updates.push({ table: table.name, values }); return []; },
      }),
    })),
  };
  return { tables, state, db };
});

vi.mock("drizzle-orm", () => ({
  and: (...values: unknown[]) => values,
  eq: (...values: unknown[]) => values,
}));
vi.mock("../../db", () => ({ getDb: () => harness.db }));
vi.mock("../../db/schema", () => harness.tables);

import { buildGapOnlyProfilePatch, enrichCompany, isRetryableResearchError, retryWithBackoff } from "../../lib/research/enrichment-service";
import type { ExtractedClaim } from "../../lib/research/types";
import type { SearchProvider } from "../../lib/research/search-provider";

describe("enrichment retry behavior", () => {
  it("classifies timeouts and rate limits as retryable", () => {
    expect(isRetryableResearchError(new Error("request timed out"))).toBe(true);
    expect(isRetryableResearchError(new Error("429 rate limit"))).toBe(true);
    expect(isRetryableResearchError(new Error("invalid API key"))).toBe(false);
  });

  it("retries a transient provider failure and returns the successful result", async () => {
    let attempts = 0;
    const result = await retryWithBackoff(async () => {
      attempts += 1;
      if (attempts < 2) throw new Error("timeout");
      return "ok";
    }, { retries: 2, baseDelayMs: 0 });

    expect(result).toBe("ok");
    expect(attempts).toBe(2);
  });
});

describe("canonical profile gap filling", () => {
  it("fills blank canonical fields without replacing imported values", () => {
    const company = {
      website: "https://imported.example",
      domain: "imported.example",
      description: "Imported company description",
      locality: " ",
      locationText: "Imported location text",
      employeeBand: null,
      foundedYear: 2001,
      headquarters: null,
    };
    const claims = [
      { field: "website", value: "https://researched.example" },
      { field: "domain", value: "researched.example" },
      { field: "description", value: "Researched description" },
      { field: "locality", value: "Dublin City" },
      { field: "locationText", value: "Dublin City" },
      { field: "employeeBand", value: "51-200" },
      { field: "foundedYear", value: 2010 },
      { field: "headquarters", value: "Dublin City" },
    ] as ExtractedClaim[];

    expect(buildGapOnlyProfilePatch(company, claims)).toEqual({
      locality: "Dublin City",
      employeeBand: "51-200",
      headquarters: "Dublin City",
    });
  });
});

describe("company enrichment ownership", () => {
  beforeEach(() => {
    harness.state.updates.length = 0;
    harness.state.failClaimsRead = false;
    harness.state.company = {
      id: "co-1", ownerId: "owner-1", name: "North Star", domain: null, website: null,
      description: null, locality: null, locationText: null, employeeBand: null,
      foundedYear: null, headquarters: null, enrichmentStatus: "not-enriched",
    };
  });

  it("returns failure status without changing a parent run and leaves the company out of running", async () => {
    const provider: SearchProvider = { name: "test", search: vi.fn(async () => { throw new Error("provider unavailable"); }) };

    const summary = await enrichCompany("owner-1", "co-1", "batch-parent", { provider });

    expect(summary.status).toBe("failed");
    expect(provider.search).toHaveBeenCalledTimes(1);
    expect(harness.state.updates.some((update) => update.table === "refreshRuns")).toBe(false);
    expect(harness.state.updates.filter((update) => update.table === "companies").map((update) => update.values.enrichmentStatus)).toEqual(["running", "failed"]);
  });

  it("resets company status when enrichment throws after setting it to running", async () => {
    harness.state.failClaimsRead = true;
    const provider: SearchProvider = { name: "test", search: vi.fn(async () => []) };

    await expect(enrichCompany("owner-1", "co-1", "batch-parent", { provider })).rejects.toThrow("claim store unavailable");

    expect(harness.state.updates.filter((update) => update.table === "companies").map((update) => update.values.enrichmentStatus)).toEqual(["running", "failed"]);
    expect(harness.state.updates.some((update) => update.table === "refreshRuns")).toBe(false);
  });
});
