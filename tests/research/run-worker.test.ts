import { describe, expect, it } from "vitest";
import { discoveryLimits } from "../../lib/research/run-worker";

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
});
