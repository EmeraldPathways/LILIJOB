type EnrichmentResult = { status: "completed" | "partial" | "failed" };
type EnrichmentRunner = (ownerId: string, companyId: string, runId: string) => Promise<EnrichmentResult>;

async function defaultRunner(ownerId: string, companyId: string, runId: string): Promise<EnrichmentResult> {
  const { enrichCompany } = await import("../research/enrichment-service");
  return enrichCompany(ownerId, companyId, runId);
}

export async function startImportEnrichment(ownerId: string, runId: string, companyIds: string[], runner: EnrichmentRunner = defaultRunner) {
  const results = await Promise.allSettled(companyIds.map((companyId) => runner(ownerId, companyId, runId)));
  let completed = 0;
  let partial = 0;
  let failed = 0;
  for (const result of results) {
    if (result.status === "rejected" || result.value.status === "failed") failed += 1;
    else if (result.value.status === "partial") partial += 1;
    else completed += 1;
  }
  return { completed, partial, failed };
}
