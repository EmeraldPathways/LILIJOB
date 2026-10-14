import { describe, expect, it } from "vitest";
import {
  buildCompanySearchRequests,
  classifySource,
  rankSearchResults,
  shouldUseHighConfidence,
} from "../../lib/research/source-policy";

describe("research source policy", () => {
  it("prioritises official company, careers, and Irish permit sources", () => {
    const ranked = rankSearchResults([
      { url: "https://example.com/blog", title: "Blog", snippet: "", provider: "x", retrievedAt: "2026-01-01" },
      { url: "https://enterprise.gov.ie/permits", title: "Employment permits", snippet: "", provider: "x", retrievedAt: "2026-01-01" },
      { url: "https://example.com/careers", title: "Careers", snippet: "", provider: "x", retrievedAt: "2026-01-01" },
    ]);

    expect(ranked.map((result) => classifySource(result.url, result.title))).toEqual([
      "official-careers",
      "irish-permit",
      "search",
    ]);
    expect(ranked[0]?.url).toBe("https://example.com/careers");
    expect(ranked[1]?.url).toBe("https://enterprise.gov.ie/permits");
  });

  it("creates six bounded, meaningful searches for a company", () => {
    const requests = buildCompanySearchRequests({ name: "North Star", domain: "northstar.ie" });
    expect(requests).toHaveLength(6);
    expect(requests.every((request) => request.query.includes("North Star"))).toBe(true);
    expect(new Set(requests.map((request) => request.purpose)).size).toBe(6);
  });

  it("does not treat a search snippet as high confidence evidence", () => {
    expect(shouldUseHighConfidence({ sourceType: "search", hasFullContent: false })).toBe(false);
    expect(shouldUseHighConfidence({ sourceType: "official-careers", hasFullContent: true })).toBe(true);
  });
});
