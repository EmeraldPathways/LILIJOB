import { describe, expect, it } from "vitest";
import {
  buildCompanySearchRequests,
  classifySource,
  companyNameFromSearchTitle,
  matchesCompany,
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

  it("combines only missing profile fields into one search request", () => {
    const requests = buildCompanySearchRequests({
      name: "North Star",
      domain: null,
      website: null,
      description: null,
      locality: null,
      headquarters: null,
      location: null,
      employeeBand: null,
      foundedYear: null,
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]?.purpose).toBe("official-profile");
    expect(requests[0]?.query).toContain("North Star");
    expect(requests[0]?.query).toMatch(/website.*domain/i);
    expect(requests[0]?.query).toMatch(/description/i);
    expect(requests[0]?.query).toMatch(/headquarters|locality/i);
    expect(requests[0]?.query).toMatch(/careers|open roles/i);
  });

  it("does not use a generic search-result title as a company seed", () => {
    expect(companyNameFromSearchTitle("North Star | Careers")).toBe("North Star");
    expect(companyNameFromSearchTitle("Dublin technology companies hiring careers")).toBeNull();
    expect(companyNameFromSearchTitle("Fintech technology companies County Dublin hiring careers")).toBeNull();
  });

  it("does not attribute a result because the company name appears only in its URL path", () => {
    expect(matchesCompany(
      { name: "North Star", domain: "northstar.ie" },
      {
        url: "https://directory.example/north-star",
        title: "Technology companies",
        snippet: "Companies listed in this directory are hiring.",
        provider: "test",
        retrievedAt: "2026-10-15T00:00:00.000Z",
      },
    )).toBe(false);
  });

  it("does not treat a search snippet as high confidence evidence", () => {
    expect(shouldUseHighConfidence({ sourceType: "search", hasFullContent: false })).toBe(false);
    expect(shouldUseHighConfidence({ sourceType: "official-careers", hasFullContent: true })).toBe(true);
  });
});
