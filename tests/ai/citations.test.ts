import { describe, expect, it } from "vitest";
import { formatCitations } from "../../lib/ai/citations";

describe("AI source citations", () => {
  it("returns readable source links, checked dates, and confidence", () => {
    expect(formatCitations([
      { url: "https://example.ie/careers", title: "Example careers", checkedAt: "2026-10-14T10:00:00.000Z", confidence: "high", sourceType: "official-careers" },
      { url: "https://enterprise.gov.ie/permits", title: null, checkedAt: null, confidence: "medium", sourceType: "irish-permit" },
    ])).toEqual([
      { url: "https://example.ie/careers", title: "Example careers", checkedAt: "2026-10-14T10:00:00.000Z", confidence: "high", sourceType: "official-careers" },
      { url: "https://enterprise.gov.ie/permits", title: "https://enterprise.gov.ie/permits", checkedAt: null, confidence: "medium", sourceType: "irish-permit" },
    ]);
  });
});
