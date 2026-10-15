type EnrichmentResult = { status: "completed" | "partial" | "failed" };
type EnrichmentRunner = (ownerId: string, companyId: string, runId: string) => Promise<EnrichmentResult>;

export type ImportEnrichmentOptions = {
  concurrency?: number;
  maxCompanies?: number;
};

export type ImportEnrichmentSummary = {
  completed: number;
  partial: number;
  failed: number;
  processed: number;
  total: number;
  remaining: number;
  retryableCompanyIds: string[];
};

export const IMPORT_ENRICHMENT_BATCH_SIZE = 8;
export const IMPORT_ENRICHMENT_CONCURRENCY = 2;

async function defaultRunner(ownerId: string, companyId: string, runId: string): Promise<EnrichmentResult> {
  const { enrichCompany } = await import("../research/enrichment-service");
  return enrichCompany(ownerId, companyId, runId);
}

export async function startImportEnrichment(
  ownerId: string,
  runId: string,
  companyIds: string[],
  runner: EnrichmentRunner = defaultRunner,
  options: ImportEnrichmentOptions = {},
): Promise<ImportEnrichmentSummary> {
  const uniqueCompanyIds = [...new Set(companyIds.map((companyId) => companyId.trim()).filter(Boolean))];
  const total = uniqueCompanyIds.length;
  const maxCompanies = Math.max(1, Math.floor(options.maxCompanies ?? IMPORT_ENRICHMENT_BATCH_SIZE));
  const concurrency = Math.max(1, Math.floor(options.concurrency ?? IMPORT_ENRICHMENT_CONCURRENCY));
  const selectedCompanyIds = uniqueCompanyIds.slice(0, maxCompanies);
  const results: Array<EnrichmentResult | { status: "failed" }> = [];
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      const companyId = selectedCompanyIds[index];
      if (!companyId) return;
      try {
        results[index] = await runner(ownerId, companyId, runId);
      } catch {
        results[index] = { status: "failed" };
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, selectedCompanyIds.length) }, () => worker()));
  let completed = 0;
  let partial = 0;
  let failed = 0;
  const retryableCompanyIds: string[] = [];
  for (const [index, result] of results.entries()) {
    if (result.status === "failed") failed += 1;
    else if (result.status === "partial") partial += 1;
    else completed += 1;
    if (result.status === "failed" || result.status === "partial") {
      const companyId = selectedCompanyIds[index];
      if (companyId) retryableCompanyIds.push(companyId);
    }
  }
  return { completed, partial, failed, processed: selectedCompanyIds.length, total, remaining: total - selectedCompanyIds.length, retryableCompanyIds };
}
