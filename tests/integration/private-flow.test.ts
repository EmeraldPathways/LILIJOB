import { describe, expect, it, vi } from "vitest";
import { createAgentTools } from "../../lib/ai/tools";
import { userFromHeaders } from "../../lib/auth/require-user";
import { buildImportPlan, parseWorkbook } from "../../lib/import/parse-workbook";

describe("private workbench flow boundaries", () => {
  it("keeps the owner boundary while importing County Dublin seed data", async () => {
    const plan = buildImportPlan(await parseWorkbook(Buffer.from("Company,Location\nDublin Example,Dublin City\nCork Example,Cork"), "seed.csv"));
    const user = userFromHeaders(new Headers({ "oai-authenticated-user-id": "owner-1", "oai-authenticated-user-email": "owner@example.com" }));
    const searchCompanies = vi.fn().mockResolvedValue(plan.rows.map((row) => ({ name: row.companyName })));
    const tools = createAgentTools(user?.userId ?? "", { searchCompanies });

    expect(user?.userId).toBe("owner-1");
    expect(plan.rows.map((row) => row.companyName)).toEqual(["Dublin Example", "Cork Example"]);
    await tools.searchSaved({ category: "fintech" });
    expect(searchCompanies).toHaveBeenCalledWith("owner-1", { category: "fintech" });
  });
});
