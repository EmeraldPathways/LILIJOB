import { describe, expect, it } from "vitest";
import { mergeClaims } from "../../lib/research/claim-merger";
import type { ExtractedClaim } from "../../lib/research/types";

const claim = (overrides: Partial<ExtractedClaim>): ExtractedClaim => ({
  field: "description",
  value: "A technology company",
  normalizedValue: "a technology company",
  confidence: "medium",
  source: { url: "https://example.com", title: "Example", sourceType: "official-company", provider: "test", retrievedAt: "2026-01-01", hasFullContent: true },
  excerpt: "A technology company",
  ...overrides,
});

describe("claim merging", () => {
  it("keeps confirmed sponsorship separate from potential role evidence", () => {
    const result = mergeClaims([], [
      claim({ field: "permitEvidence", value: { evidenceType: "confirmed-sponsor", statement: "Named on a permit source" } }),
      claim({ field: "permitEvidence", value: { evidenceType: "potentially-qualifying-role", statement: "Role appears eligible" } }),
    ], "run-1");

    expect(result.current).toHaveLength(2);
    expect(result.current.map((item) => (item.value as { evidenceType: string }).evidenceType)).toEqual([
      "confirmed-sponsor",
      "potentially-qualifying-role",
    ]);
  });

  it("does not replace a stronger claim with a weaker finding", () => {
    const result = mergeClaims([
      claim({ confidence: "high", source: { url: "https://example.com/careers", title: "Careers", sourceType: "official-careers", provider: "test", retrievedAt: "2026-01-01", hasFullContent: true } }),
    ], [claim({ confidence: "low", value: "Maybe a technology company", normalizedValue: "maybe a technology company", source: { url: "https://directory.example", title: "Directory", sourceType: "directory", provider: "test", retrievedAt: "2026-01-01", hasFullContent: false } })], "run-2");

    expect(result.current[0]?.value).toBe("A technology company");
    expect(result.changes[0]?.reason).toBe("weaker-finding-retained-for-history");
  });

  it("retains comparable conflicting claims in history", () => {
    const result = mergeClaims([
      claim({ field: "locality", value: "Dublin City", normalizedValue: "dublin city" }),
    ], [claim({ field: "locality", value: "Fingal", normalizedValue: "fingal" })], "run-3");

    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]?.values).toEqual(["Dublin City", "Fingal"]);
    expect(result.changes.some((change) => change.reason === "conflict-retained")).toBe(true);
  });
});
