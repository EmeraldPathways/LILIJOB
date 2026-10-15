import { describe, expect, it } from "vitest";
import type { CompanyListItem } from "../../lib/repositories/company-repository";
import {
  filterCompanies,
  getColumnFilterValues,
  getSheetCellValue,
  getSheetColumns,
  sortCompanies,
  toggleCompanySelection,
  toggleVisibleSelection,
  type SheetCompany,
} from "../../lib/sheet/company-sheet";

function company(
  id: string,
  name: string,
  importedData?: Record<string, string>,
  options: { website?: string | null; sector?: string | null } = {},
): SheetCompany {
  return {
    id,
    name,
    domain: null,
    website: options.website ?? null,
    locality: null,
    locationText: null,
    description: null,
    categories: [],
    enrichmentStatus: "queued",
    lastEnrichedAt: null,
    nextRefreshAt: null,
    employeeBand: null,
    permitSignal: "unknown",
    openRoles: 0,
    confidence: null,
    freshness: "unknown",
    importedData,
    sector: options.sector ?? null,
  } as CompanyListItem & SheetCompany;
}

describe("company sheet helpers", () => {
  it("keeps first-seen original columns, including blank fields, and marks profile fallbacks", () => {
    const rows = [
      company("a", "Alpha", { "Company name": "Alpha", Notes: "" }),
      company("b", "Beta", { Sector: "Fintech", "Company name": "Beta" }, { sector: "Fintech" }),
      company("c", "Manual", undefined, { website: "https://manual.ie", sector: "Services" }),
    ];

    const columns = getSheetColumns(rows);

    expect(columns.map(({ id }) => id)).toEqual([
      "imported:Company name",
      "imported:Notes",
      "imported:Sector",
      "profile:Company",
      "profile:Website",
      "profile:Sector",
    ]);
    expect(columns.map(({ source }) => source)).toEqual([
      "imported",
      "imported",
      "imported",
      "profile",
      "profile",
      "profile",
    ]);
    expect(getSheetCellValue(rows[0], columns[1])).toBe("");
    expect(getSheetCellValue(rows[2], columns[3])).toBe("Manual");
    expect(getSheetCellValue(rows[2], columns[4])).toBe("https://manual.ie");
    expect(getSheetCellValue(rows[2], columns[5])).toBe("Services");
    expect(getSheetCellValue(rows[0], columns[3])).toBe("");
  });

  it("does not fill a blank original field with a synthesized profile value", () => {
    const rows = [
      company("a", "Imported label", { Company: "Spreadsheet label" }),
      company("b", "Profile name", {}),
    ];
    const columns = getSheetColumns(rows);
    const companyColumn = columns.find(({ id }) => id === "imported:Company");
    const profileCompanyColumn = columns.find(({ id }) => id === "profile:Company");

    expect(companyColumn?.source).toBe("imported");
    expect(getSheetCellValue(rows[1], companyColumn!)).toBe("");
    expect(getSheetCellValue(rows[1], profileCompanyColumn!)).toBe("Profile name");
  });

  it("searches every raw field and filters by one selected column value", () => {
    const rows = [
      company("a", "Alpha", { Notes: "Priority account", Industry: "Fintech" }),
      company("b", "Beta", { Notes: "Follow up", Industry: "Services" }),
    ];

    const industryColumn = getSheetColumns(rows).find(({ key }) => key === "Industry")!;
    const notesColumn = getSheetColumns(rows).find(({ key }) => key === "Notes")!;

    expect(filterCompanies(rows, { query: "priority", column: null, value: null }).map(({ id }) => id)).toEqual(["a"]);
    expect(filterCompanies(rows, { query: "", column: industryColumn, value: "Services" }).map(({ id }) => id)).toEqual(["b"]);
    expect(getColumnFilterValues(rows, notesColumn)).toEqual(["Priority account", "Follow up"]);
  });

  it("sorts by raw cell values in either direction without changing the input", () => {
    const rows = [
      company("b", "Beta", { "Annual revenue": "20" }),
      company("a", "Alpha", { "Annual revenue": "3" }),
    ];

    const revenueColumn = getSheetColumns(rows).find(({ key }) => key === "Annual revenue")!;
    expect(sortCompanies(rows, revenueColumn, "ascending").map(({ id }) => id)).toEqual(["a", "b"]);
    expect(sortCompanies(rows, revenueColumn, "descending").map(({ id }) => id)).toEqual(["b", "a"]);
    expect(rows.map(({ id }) => id)).toEqual(["b", "a"]);
  });

  it("toggles one row and visible rows while preserving selections outside the visible set", () => {
    expect(toggleCompanySelection(["a", "b"], "a")).toEqual(["b"]);
    expect(toggleCompanySelection(["a"], "b")).toEqual(["a", "b"]);
    expect(toggleVisibleSelection(["hidden", "a"], ["a", "b"])).toEqual(["hidden", "a", "b"]);
    expect(toggleVisibleSelection(["hidden", "a", "b"], ["a", "b"])).toEqual(["hidden"]);
  });
});
