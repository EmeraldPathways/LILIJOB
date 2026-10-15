import { describe, expect, it, vi } from "vitest";
import { startImportEnrichment } from "../../lib/import/auto-enrich";

describe("automatic import enrichment", () => {
  it("starts enrichment for every accepted company and keeps partial failures visible", async () => {
    const enrich = vi.fn(async (_owner: string, companyId: string) => {
      if (companyId === "co-2") return { status: "failed" as const };
      return { status: "completed" as const };
    });

    await expect(startImportEnrichment("owner-1", "run-1", ["co-1", "co-2"], enrich)).resolves.toEqual({ completed: 1, partial: 0, failed: 1, processed: 2, total: 2, remaining: 0, retryableCompanyIds: ["co-2"] });
    expect(enrich).toHaveBeenCalledTimes(2);
    expect(enrich).toHaveBeenCalledWith("owner-1", "co-1", "run-1");
  });

  it("keeps provider concurrency bounded and returns a continuation", async () => {
    let active = 0;
    let maxActive = 0;
    const enrich = vi.fn(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return { status: "completed" as const };
    });

    await expect(startImportEnrichment(
      "owner-1",
      "run-1",
      ["co-1", "co-2", "co-3", "co-4", "co-5"],
      enrich,
      { concurrency: 2, maxCompanies: 3 },
    )).resolves.toMatchObject({ completed: 3, processed: 3, total: 5, remaining: 2, retryableCompanyIds: [] });
    expect(enrich).toHaveBeenCalledTimes(3);
    expect(maxActive).toBeLessThanOrEqual(2);
  });
});
