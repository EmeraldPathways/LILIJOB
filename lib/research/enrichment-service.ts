import { and, eq } from "drizzle-orm";
import { buildCompanySearchRequests, rankSearchResults } from "./source-policy";
import { extractClaims } from "./claim-extractor";
import { mergeClaims } from "./claim-merger";
import type { ExistingClaim, EnrichmentSummary, ResearchCompanySeed, SearchResult } from "./types";
import type { SearchProvider } from "./search-provider";
import { ResearchProviderError } from "./search-provider";

export type RetryOptions = { retries?: number; baseDelayMs?: number };

export function isRetryableResearchError(error: unknown): boolean {
  if (error instanceof ResearchProviderError) return error.retryable;
  const message = error instanceof Error ? error.message : String(error);
  return /timeout|timed out|429|rate.?limit|temporarily unavailable|502|503|504/i.test(message);
}

export async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const retries = options.retries ?? 2;
  const baseDelayMs = options.baseDelayMs ?? 250;
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt === retries || !isRetryableResearchError(error)) throw error;
      const delay = baseDelayMs * 2 ** attempt;
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Research operation failed");
}

function id(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

function parseJson(value: string | null | undefined): unknown {
  try {
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

export async function enrichCompany(
  ownerId: string,
  companyId: string,
  runId: string,
  options: { provider?: SearchProvider; maxSearches?: number } = {},
): Promise<EnrichmentSummary> {
  const [{ getDb }, schema, providerModule] = await Promise.all([
    import("../../db"),
    import("../../db/schema"),
    options.provider ? Promise.resolve(null) : import("./tavily-search-provider"),
  ]);
  const db = getDb();
  const provider = options.provider ?? providerModule!.configuredSearchProvider();
  const [company] = await db
    .select()
    .from(schema.companies)
    .where(and(eq(schema.companies.ownerId, ownerId), eq(schema.companies.id, companyId)))
    .limit(1);
  if (!company) {
    return { companyId, runId, sourcesChecked: 0, claimsAdded: 0, jobsFound: 0, permitEvidenceFound: 0, status: "failed", error: "Company not found." };
  }

  const now = new Date().toISOString();
  await db.update(schema.refreshRuns).set({ status: "running", startedAt: now, updatedAt: now }).where(and(eq(schema.refreshRuns.ownerId, ownerId), eq(schema.refreshRuns.id, runId)));
  await db.update(schema.companies).set({ enrichmentStatus: "running", updatedAt: now }).where(and(eq(schema.companies.ownerId, ownerId), eq(schema.companies.id, companyId)));

  const seed: ResearchCompanySeed = { name: company.name, domain: company.domain, location: company.locationText };
  const requests = buildCompanySearchRequests(seed).slice(0, options.maxSearches ?? 6);
  const results: SearchResult[] = [];
  let failures = 0;
  for (const request of requests) {
    try {
      results.push(...(await retryWithBackoff(() => provider.search(request))));
    } catch {
      failures += 1;
    }
  }

  const ranked = rankSearchResults(results);
  const claims = await extractClaims(seed, ranked);
  const existingRows = await db.select().from(schema.companyClaims).where(and(eq(schema.companyClaims.ownerId, ownerId), eq(schema.companyClaims.companyId, companyId), eq(schema.companyClaims.status, "current")));
  const existing: ExistingClaim[] = existingRows.map((row) => ({
    field: row.field,
    value: parseJson(row.valueJson),
    normalizedValue: row.normalizedValue ?? row.valueJson,
    confidence: row.confidence as ExistingClaim["confidence"],
    source: { url: "", title: "Stored claim", sourceType: "search", provider: "stored", retrievedAt: row.checkedAt ?? row.updatedAt, hasFullContent: false },
    excerpt: "",
    id: row.id,
    status: row.status,
    checkedAt: row.checkedAt,
  }));
  const merged = mergeClaims(existing, claims, runId);

  let claimsAdded = 0;
  for (const result of ranked) {
    const normalizedUrl = result.url.toLowerCase().replace(/#.*$/, "").replace(/\/$/, "");
    await db.insert(schema.sources).values({
      id: id("src"), ownerId, companyId, url: result.url, normalizedUrl, title: result.title, snippet: result.snippet,
      provider: result.provider, sourceType: result.sourceType ?? "search", retrievedAt: result.retrievedAt, checkedAt: now,
      status: result.status ?? "ok", createdAt: now, updatedAt: now,
    }).onConflictDoUpdate({ target: [schema.sources.ownerId, schema.sources.normalizedUrl], set: { checkedAt: now, snippet: result.snippet, updatedAt: now } });
  }

  for (const claim of merged.current) {
    const sourceId = id("src");
    await db.insert(schema.companyClaims).values({
      id: id("claim"), ownerId, companyId, field: claim.field, valueJson: JSON.stringify(claim.value), normalizedValue: claim.normalizedValue,
      confidence: claim.confidence, sourceId, status: "current", checkedAt: now, createdAt: now, updatedAt: now,
    });
    claimsAdded += 1;
  }
  for (const change of merged.changes) {
    await db.insert(schema.changeHistory).values({
      id: id("hist"), ownerId, companyId, runId, entityType: "company_claim", field: change.field,
      previousJson: JSON.stringify(change.previous), nextJson: JSON.stringify(change.next), reason: change.reason, createdAt: now, updatedAt: now,
    });
  }
  for (const claim of merged.current.filter((item) => item.field === "permitEvidence")) {
    const value = claim.value as { evidenceType?: string; statement?: string };
    if (!value.evidenceType || !value.statement) continue;
    await db.insert(schema.permitEvidence).values({
      id: id("permit"), ownerId, companyId, evidenceType: value.evidenceType, statement: value.statement, excerpt: claim.excerpt,
      confidence: claim.confidence, checkedAt: now, createdAt: now, updatedAt: now,
    });
  }

  const status: EnrichmentSummary["status"] = failures === 0 ? "completed" : ranked.length ? "partial" : "failed";
  const error = failures && !ranked.length ? "All research provider requests failed." : undefined;
  await db.update(schema.refreshRuns).set({ status, processed: requests.length, succeeded: requests.length - failures, failed: failures, finishedAt: now, updatedAt: now, error: error ?? null }).where(and(eq(schema.refreshRuns.ownerId, ownerId), eq(schema.refreshRuns.id, runId)));
  await db.update(schema.companies).set({ enrichmentStatus: status, lastEnrichedAt: now, updatedAt: now }).where(and(eq(schema.companies.ownerId, ownerId), eq(schema.companies.id, companyId)));

  return { companyId, runId, sourcesChecked: ranked.length, claimsAdded, jobsFound: 0, permitEvidenceFound: merged.current.filter((claim) => claim.field === "permitEvidence").length, status, error };
}

export async function createRun(ownerId: string, kind: string, companyId?: string, category?: string): Promise<string> {
  const { getDb } = await import("../../db");
  const { refreshRuns } = await import("../../db/schema");
  const runId = id("run");
  const now = new Date().toISOString();
  await getDb().insert(refreshRuns).values({ id: runId, ownerId, kind, companyId: companyId ?? null, category: category ?? null, requestedBy: "user", status: "queued", createdAt: now, updatedAt: now });
  return runId;
}
