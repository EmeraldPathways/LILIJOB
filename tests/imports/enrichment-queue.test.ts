import { describe, expect, it } from "vitest";
import { buildImportEnrichmentJobs, chunkImportEnrichmentJobs, D1_COMPANY_ID_BATCH_SIZE } from "../../lib/import/enrichment-queue";

describe("import enrichment queue", () => {
  it("creates one background job per accepted company", () => {
    expect(buildImportEnrichmentJobs("run-1", ["co-1", "co-2"])).toEqual([
      { runId: "run-1", companyId: "co-1" },
      { runId: "run-1", companyId: "co-2" },
    ]);
  });

  it("does not queue empty company ids", () => {
    expect(buildImportEnrichmentJobs("run-1", ["", "  ", "co-1"])).toEqual([
      { runId: "run-1", companyId: "co-1" },
    ]);
  });

  it("deduplicates company ids before queueing", () => {
    expect(buildImportEnrichmentJobs("run-1", ["co-1", "co-1", " co-2 ", "co-2"])).toEqual([
      { runId: "run-1", companyId: "co-1" },
      { runId: "run-1", companyId: "co-2" },
    ]);
  });

  it("splits large enrichment queues into database-safe batches", () => {
    const jobs = buildImportEnrichmentJobs("run-1", Array.from({ length: 501 }, (_, index) => `co-${index}`));

    expect(D1_COMPANY_ID_BATCH_SIZE).toBeLessThanOrEqual(99);
    expect(chunkImportEnrichmentJobs(jobs, D1_COMPANY_ID_BATCH_SIZE).map((batch) => batch.length)).toEqual([90, 90, 90, 90, 90, 51]);
  });
});
