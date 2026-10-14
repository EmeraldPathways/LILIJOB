import { describe, expect, it } from "vitest";
import { DEFAULT_RUN_CONFIG, normalizeRunConfig } from "../../lib/jobs/run-config";

describe("weekly usage limits", () => {
  it("uses the agreed defaults", () => {
    expect(DEFAULT_RUN_CONFIG).toMatchObject({ newCompaniesPerCategory: 25, searchesPerCompany: 6, existingCompaniesPerRefresh: 500, paused: false });
  });

  it("normalizes editable limits to safe positive bounds", () => {
    expect(normalizeRunConfig({ newCompaniesPerCategory: 0, searchesPerCompany: 100, existingCompaniesPerRefresh: -1 })).toEqual({ newCompaniesPerCategory: 1, searchesPerCompany: 6, existingCompaniesPerRefresh: 1, paused: false, continuationCategory: null });
    expect(normalizeRunConfig({ paused: true, newCompaniesPerCategory: 9 })).toEqual({ newCompaniesPerCategory: 9, searchesPerCompany: 6, existingCompaniesPerRefresh: 500, paused: true, continuationCategory: null });
  });
});
