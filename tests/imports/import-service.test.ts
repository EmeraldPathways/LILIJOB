import { describe, expect, it } from "vitest";
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

  it("does not queue an explicitly out-of-county company", async () => {
    const csv = [
      "Company,Location",
      "Cork Example,Cork",
      "Dublin Example,Dublin City",
    ].join("\n");

    const plan = buildImportPlan(await parseWorkbook(Buffer.from(csv), "companies.csv"));

    expect(plan.accepted).toBe(1);
    expect(plan.rows.map((row) => row.companyName)).toEqual(["Dublin Example"]);
    expect(plan.errors).toEqual([{ row: 2, message: "Location is outside County Dublin" }]);
  });
});
