import { describe, expect, it } from "vitest";
import { discoveryLimits, planRefreshBatch, runStatusForBatch, uniqueDiscoveryCompanyIds } from "../../lib/research/run-worker";

describe("run guardrails", () => {
  it("uses the agreed weekly defaults and caps oversized requests", () => {
    expect(discoveryLimits()).toEqual({
      newCompaniesPerCategory: 25,
      searchesPerCompany: 6,
      existingCompaniesPerRefresh: 500,
    });
    expect(discoveryLimits({ newCompaniesPerCategory: 500, searchesPerCompany: 20, existingCompaniesPerRefresh: 1000 })).toEqual({
      newCompaniesPerCategory: 25,
      searchesPerCompany: 6,
      existingCompaniesPerRefresh: 500,
    });
  });

  it("returns real, unique company ids for discovery enrichment", () => {
    expect(uniqueDiscoveryCompanyIds(["co-1", "", " co-2 ", "co-1"])).toEqual(["co-1", "co-2"]);
  });

  it("keeps a manual refresh resumable instead of processing all companies in one request", () => {
    const plan = planRefreshBatch(Array.from({ length: 500 }, (_, index) => `co-${index}`), 8);
    expect(plan.batch).toHaveLength(8);
    expect(plan.remaining).toHaveLength(492);
  });

  it("uses aggregate counters when deciding whether a completed queue is partial", () => {
    expect(runStatusForBatch({
      done: true,
      previousProcessed: 8,
      previousSucceeded: 8,
      previousFailed: 0,
      batchProcessed: 2,
      batchSucceeded: 1,
      batchPartial: 1,
      batchFailed: 0,
    })).toBe("partial");
    expect(runStatusForBatch({
      done: true,
      previousProcessed: 8,
      previousSucceeded: 8,
      previousFailed: 0,
      batchProcessed: 2,
      batchSucceeded: 2,
      batchPartial: 0,
      batchFailed: 0,
    })).toBe("completed");
  });
});
