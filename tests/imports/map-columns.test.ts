import { describe, expect, it } from "vitest";
import { mapWorkbookColumns, normalizeHeader } from "../../lib/import/map-columns";

describe("workbook column mapping", () => {
  it("maps common aliases and retains unknown headings", () => {
    const mapping = mapWorkbookColumns([
      "Company Name",
      "Website URL",
      "Sector",
      "HQ / Location",
      "Careers",
      "Irish permit notes",
      "Internal owner",
    ]);

    expect(mapping.companyName).toBe("Company Name");
    expect(mapping.website).toBe("Website URL");
    expect(mapping.category).toBe("Sector");
    expect(mapping.location).toBe("HQ / Location");
    expect(mapping.careersUrl).toBe("Careers");
    expect(mapping.unknown).toEqual(["Irish permit notes", "Internal owner"]);
  });

  it("normalizes headings without changing their original label", () => {
    expect(normalizeHeader("  Company_Name  ")).toBe("company name");
    expect(normalizeHeader("URL (careers)")).toBe("url careers");
  });

  it("falls back to the first heading as the company name", () => {
    const mapping = mapWorkbookColumns(["Employer", "Notes"]);
    expect(mapping.companyName).toBe("Employer");
    expect(mapping.unknown).toEqual(["Notes"]);
  });
});
