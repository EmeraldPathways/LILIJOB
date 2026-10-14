import { describe, expect, it, vi } from "vitest";
import { startImportEnrichment } from "../../lib/import/auto-enrich";

describe("automatic import enrichment", () => {
  it("starts enrichment for every accepted company and keeps partial failures visible", async () => {
    const enrich = vi.fn(async (_owner: string, companyId: string) => {
      if (companyId === "co-2") return { status: "failed" as const };
      return { status: "completed" as const };
    });

    await expect(startImportEnrichment("owner-1", "run-1", ["co-1", "co-2"], enrich)).resolves.toEqual({ completed: 1, partial: 0, failed: 1 });
    expect(enrich).toHaveBeenCalledTimes(2);
    expect(enrich).toHaveBeenCalledWith("owner-1", "co-1", "run-1");
  });
});
