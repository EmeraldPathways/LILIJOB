import { beforeEach, describe, expect, it, vi } from "vitest";

const { getDb, updateCompanyCells, CompanyCellConflictError } = vi.hoisted(() => {
  class CompanyCellConflictError extends Error {}
  return {
    getDb: vi.fn(),
    updateCompanyCells: vi.fn(),
    CompanyCellConflictError,
  };
});

vi.mock("../../lib/repositories/company-repository", () => ({
  CompanyCellConflictError,
  updateCompanyCells,
  deleteCompany: vi.fn(),
  getCompanyDetail: vi.fn(),
}));
vi.mock("../../db", () => ({ getDb }));

import { PATCH } from "../../app/api/companies/[companyId]/route";

function request(body: unknown) {
  return new Request("https://example.test/api/companies/co-1", {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      "oai-authenticated-user-id": "owner-1",
      "oai-authenticated-user-email": "owner@example.test",
    },
    body: JSON.stringify(body),
  });
}

describe("company cell update API", () => {
  beforeEach(() => {
    updateCompanyCells.mockReset();
    getDb.mockReturnValue({
      update: () => ({
        set: () => ({
          where: () => ({ returning: async () => [{ id: "co-1" }] }),
        }),
      }),
    });
  });

  it("rejects cell maps with non-string values", async () => {
    const response = await PATCH(request({ cells: { Sector: 42 } }), {
      params: Promise.resolve({ companyId: "co-1" }),
    });

    expect(response.status).toBe(400);
    expect(updateCompanyCells).not.toHaveBeenCalled();
  });

  it("returns the owner-scoped updated company", async () => {
    const company = { id: "co-1", name: "Northwind", sector: "Clean energy", importedData: { Sector: "Clean energy" } };
    updateCompanyCells.mockResolvedValue(company);

    const response = await PATCH(request({ cells: { Sector: "Clean energy" } }), {
      params: Promise.resolve({ companyId: "co-1" }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ company });
    expect(updateCompanyCells).toHaveBeenCalledWith("owner-1", "co-1", { Sector: "Clean energy" });
  });

  it("reports companies outside the owner scope as not found", async () => {
    updateCompanyCells.mockResolvedValue(null);

    const response = await PATCH(request({ cells: { Sector: "Clean energy" } }), {
      params: Promise.resolve({ companyId: "co-1" }),
    });

    expect(response.status).toBe(404);
  });

  it("returns an actionable conflict when a save is stale", async () => {
    updateCompanyCells.mockRejectedValue(new CompanyCellConflictError("This company changed in another tab. Refresh the sheet and retry your edit."));

    const response = await PATCH(request({ cells: { Sector: "Clean energy" } }), {
      params: Promise.resolve({ companyId: "co-1" }),
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: {
        code: "COMPANY_CONFLICT",
        message: "This company changed in another tab. Refresh the sheet and retry your edit.",
      },
    });
  });
});
