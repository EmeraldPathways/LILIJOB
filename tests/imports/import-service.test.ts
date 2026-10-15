import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import {
  buildImportPlan,
  parseWorkbook,
} from "../../lib/import/parse-workbook";

describe("workbook import planning", () => {
  it("parses CSV rows, skips blank lines, keeps unknown metadata, and deduplicates identities", async () => {
    const csv = [
      "Company,Website,Location,Category,Internal note",
      "Acme,https://www.acme.ie,Dublin 2,Fintech,first row",
      " , , , , ",
      "Acme Ltd,acme.ie,Dublin City,Fintech,duplicate row",
      "North Star,https://northstar.ie,Swords,Startups,new row",
    ].join("\n");

    const workbook = await parseWorkbook(Buffer.from(csv), "companies.csv");
    const plan = buildImportPlan(workbook);

    expect(plan.rows).toHaveLength(3);
    expect(plan.accepted).toBe(2);
    expect(plan.duplicates).toBe(1);
    expect(plan.errors).toEqual([]);
    expect(plan.rows[0]?.companyName).toBe("Acme");
    expect(plan.rows[0]?.metadata).toMatchObject({ "Internal note": "first row" });
    expect(plan.rows[2]?.companyName).toBe("North Star");
  });

  it("returns row errors without dropping valid rows", async () => {
    const csv = [
      "Company,Website",
      ",https://missing-name.ie",
      "Valid Co,valid.ie",
    ].join("\n");

    const plan = buildImportPlan(await parseWorkbook(Buffer.from(csv), "companies.csv"));

    expect(plan.accepted).toBe(1);
    expect(plan.errors).toEqual([
      { row: 2, message: "Company name is required" },
    ]);
  });

  it("preserves an explicitly out-of-county source company", async () => {
    const csv = [
      "Company,Location",
      "Cork Example,Cork",
      "Dublin Example,Dublin City",
    ].join("\n");

    const plan = buildImportPlan(await parseWorkbook(Buffer.from(csv), "companies.csv"));

    expect(plan.accepted).toBe(2);
    expect(plan.rows).toHaveLength(2);
    expect(plan.errors).toEqual([]);
  });

  it("preserves a generic Ireland source location", async () => {
    const csv = [
      "Company,Location",
      "Ireland Example,Ireland",
      "Dublin Example,Dublin City",
    ].join("\n");

    const plan = buildImportPlan(await parseWorkbook(Buffer.from(csv), "companies.csv"));

    expect(plan.accepted).toBe(2);
    expect(plan.rows).toHaveLength(2);
    expect(plan.errors).toEqual([]);
  });

  it("finds the real header row after spreadsheet title rows and keeps source fields as metadata", async () => {
    const csv = [
      "Irish Fintech Companies — Consolidated Directory,,,,,",
      "316 distinct company names | 255 website links | 61 unresolved,,,,,",
      ",,,,,",
      "Company name,Website,Category / authorisation,Appears in,Website confidence,Map source URL",
      "Acme Payments,https://acme.ie,Credit / Lending,Map A,High,https://source.example/map",
    ].join("\n");

    const plan = buildImportPlan(await parseWorkbook(Buffer.from(csv), "ireland_fintech_companies.xlsx"));

    expect(plan.rows).toHaveLength(1);
    expect(plan.rows[0]).toMatchObject({
      rowNumber: 5,
      companyName: "Acme Payments",
      website: "https://acme.ie",
      category: "fintech",
    });
    expect(plan.rows[0]?.metadata).toMatchObject({
      "Category / authorisation": "Credit / Lending",
      "Appears in": "Map A",
      "Website confidence": "High",
      "Map source URL": "https://source.example/map",
    });
    expect(plan.errors).toEqual([]);
  });

  it("imports arbitrary sector values from a real XLSX and preserves every source column", async () => {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      ["Company"],
      ["Quarterly company export"],
      ["Company Name", "Category", "Sector", "", "Internal owner"],
      ["Northwind Energy", "fintech", "Clean energy", "unheaded value", "Alex"],
      ["Harbor Systems", "startups", "Maritime software", "another value", ""],
    ]);
    XLSX.utils.book_append_sheet(workbook, sheet, "Companies");
    const bytes = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

    const plan = buildImportPlan(await parseWorkbook(bytes, "sector-export.xlsx"));

    expect(plan.rows).toHaveLength(2);
    expect(plan.rows[0]).toMatchObject({
      companyName: "Northwind Energy",
      category: "fintech",
      metadata: {
        sector: "Clean energy",
        "Internal owner": "Alex",
      },
      original: {
        "Company Name": "Northwind Energy",
        Category: "fintech",
        Sector: "Clean energy",
        "Column 4": "unheaded value",
        "Internal owner": "Alex",
      },
    });
    expect(plan.rows[1]?.metadata.sector).toBe("Maritime software");
    expect(plan.rows[1]?.original["Internal owner"]).toBe("");
  });

  it("fails with an actionable message when a workbook has no usable header", async () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([]), "Empty");
    const bytes = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

    await expect(parseWorkbook(bytes, "empty.xlsx")).rejects.toThrow(/header/i);
  });
});
