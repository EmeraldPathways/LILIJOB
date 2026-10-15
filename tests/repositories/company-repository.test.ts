import { describe, expect, it } from "vitest";
import { groupRowsByCompanyId } from "../../lib/repositories/company-relations";

describe("company relation aggregation", () => {
  it("groups category and evidence rows without losing duplicate relations", () => {
    const grouped = groupRowsByCompanyId([
      { companyId: "company-a", category: "fintech" },
      { companyId: "company-b", category: "startups" },
      { companyId: "company-a", category: "work-permit" },
    ]);

    expect(grouped.get("company-a")).toEqual([
      { companyId: "company-a", category: "fintech" },
      { companyId: "company-a", category: "work-permit" },
    ]);
    expect(grouped.get("company-b")).toEqual([
      { companyId: "company-b", category: "startups" },
    ]);
    expect(grouped.get("missing")).toBeUndefined();
  });
});
