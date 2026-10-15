export type ImportEnrichmentJob = {
  runId: string;
  companyId: string;
};

// Cloudflare D1 allows at most 100 bound parameters per query. The company
// validation queries also bind the owner id, so keep the id list below that
// ceiling with a little room for future filters.
export const D1_COMPANY_ID_BATCH_SIZE = 90;

export function buildImportEnrichmentJobs(
  runId: string,
  companyIds: string[],
): ImportEnrichmentJob[] {
  const normalizedRunId = runId.trim();
  if (!normalizedRunId) return [];

  const uniqueCompanyIds = new Set<string>();
  for (const companyId of companyIds) {
    const normalizedCompanyId = companyId.trim();
    if (normalizedCompanyId) uniqueCompanyIds.add(normalizedCompanyId);
  }

  return [...uniqueCompanyIds].map((companyId) => ({ runId: normalizedRunId, companyId }));
}

export function chunkImportEnrichmentJobs(jobs: ImportEnrichmentJob[], batchSize: number): ImportEnrichmentJob[][] {
  if (batchSize < 1) throw new Error("batchSize must be at least 1");
  const batches: ImportEnrichmentJob[][] = [];
  for (let index = 0; index < jobs.length; index += batchSize) {
    batches.push(jobs.slice(index, index + batchSize));
  }
  return batches;
}
