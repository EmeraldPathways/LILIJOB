import { and, asc, desc, eq, inArray, or } from "drizzle-orm";
import { DEFAULT_DISCOVERY_LIMITS } from "../domain/constants";
import { normalizeCompanyIdentity, isCountyDublinLocation, normalizeDublinLocality } from "../domain/normalize";
import type { CompanyCategory } from "../domain/types";
import type { DiscoveryLimits, ResearchCompanySeed } from "./types";
import type { SearchProvider } from "./search-provider";
import { createRun, enrichCompany, retryWithBackoff } from "./enrichment-service";
import { startImportEnrichment } from "../import/auto-enrich";
import { D1_COMPANY_ID_BATCH_SIZE } from "../import/enrichment-queue";

export const REFRESH_BATCH_SIZE = 4;
export const DISCOVERY_ENRICHMENT_BATCH_SIZE = 2;

export type RunBatchStatusInput = {
  done: boolean;
  previousProcessed: number;
  previousSucceeded: number;
  previousFailed: number;
  batchProcessed: number;
  batchSucceeded: number;
  batchPartial: number;
  batchFailed: number;
};

export function runStatusForBatch(input: RunBatchStatusInput): "running" | "completed" | "partial" | "failed" {
  if (!input.done) return "partial";
  const processed = input.previousProcessed + input.batchProcessed;
  const succeeded = input.previousSucceeded + input.batchSucceeded;
  const failed = input.previousFailed + input.batchFailed;
  const hadPartialResults = input.batchPartial > 0 || input.previousProcessed > input.previousSucceeded + input.previousFailed;
  if (processed > 0 && failed >= processed) return "failed";
  if (failed > 0 || hadPartialResults || succeeded + failed < processed) return "partial";
  return "completed";
}

export function discoveryLimits(overrides: Partial<DiscoveryLimits> = {}): DiscoveryLimits {
  return {
    newCompaniesPerCategory: Math.min(Math.max(1, overrides.newCompaniesPerCategory ?? DEFAULT_DISCOVERY_LIMITS.newCompaniesPerCategory), DEFAULT_DISCOVERY_LIMITS.newCompaniesPerCategory),
    searchesPerCompany: Math.min(Math.max(1, overrides.searchesPerCompany ?? DEFAULT_DISCOVERY_LIMITS.searchesPerCompany), DEFAULT_DISCOVERY_LIMITS.searchesPerCompany),
    existingCompaniesPerRefresh: Math.min(Math.max(1, overrides.existingCompaniesPerRefresh ?? DEFAULT_DISCOVERY_LIMITS.existingCompaniesPerRefresh), DEFAULT_DISCOVERY_LIMITS.existingCompaniesPerRefresh),
  };
}

export function uniqueDiscoveryCompanyIds(companyIds: readonly string[]): string[] {
  return [...new Set(companyIds.map((companyId) => companyId.trim()).filter(Boolean))];
}

export function planRefreshBatch(companyIds: readonly string[], batchSize: number): { batch: string[]; remaining: string[] } {
  const safeSize = Math.max(1, Math.floor(batchSize));
  return { batch: [...companyIds.slice(0, safeSize)], remaining: [...companyIds.slice(safeSize)] };
}

function cursorCompanyIds(cursor: string | null, field: "remainingCompanyIds" | "retryableCompanyIds" = "remainingCompanyIds"): string[] {
  if (!cursor) return [];
  try {
    const value = JSON.parse(cursor) as Record<string, unknown>;
    const ids = value[field];
    return Array.isArray(ids) ? uniqueDiscoveryCompanyIds(ids.filter((id): id is string => typeof id === "string")) : [];
  } catch {
    return [];
  }
}

export async function runDiscovery(
  ownerId: string,
  category: CompanyCategory,
  overrides: Partial<DiscoveryLimits> = {},
  provider?: SearchProvider,
) {
  const limits = discoveryLimits(overrides);
  const selectedProvider = provider ?? (await import("./tavily-search-provider")).configuredSearchProvider();
  const [{ getDb }, schema] = await Promise.all([import("../../db"), import("../../db/schema")]);
  const db = getDb();
  const [previous] = await db.select().from(schema.refreshRuns).where(and(eq(schema.refreshRuns.ownerId, ownerId), eq(schema.refreshRuns.kind, "discovery"), eq(schema.refreshRuns.category, category), eq(schema.refreshRuns.status, "partial"))).orderBy(desc(schema.refreshRuns.updatedAt)).limit(1);
  const resumedCompanyIds = previous ? uniqueDiscoveryCompanyIds([...cursorCompanyIds(previous.cursor), ...cursorCompanyIds(previous.cursor, "retryableCompanyIds")]) : [];
  const runId = previous?.id ?? await createRun(ownerId, "discovery", undefined, category);
  let created = 0;
  let queuedCompanyIds = resumedCompanyIds;
  if (!resumedCompanyIds.length) {
    let search: Awaited<ReturnType<SearchProvider["search"]>>;
    try {
      search = await retryWithBackoff(() => selectedProvider.search({
        purpose: "category-evidence",
        query: `${category} technology companies County Dublin hiring careers`,
        maxResults: limits.newCompaniesPerCategory,
      }));
    } catch (error) {
      await db.update(schema.refreshRuns).set({ status: "failed", error: error instanceof Error ? error.message : "Discovery provider failed.", finishedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }).where(and(eq(schema.refreshRuns.ownerId, ownerId), eq(schema.refreshRuns.id, runId)));
      throw error;
    }

    const seen = new Set<string>();
    const seeds: ResearchCompanySeed[] = [];
    for (const result of search) {
      const text = `${result.title} ${result.content ?? result.snippet}`;
      if (!isCountyDublinLocation(text)) continue;
      let domain: string | null = null;
      try {
        domain = new URL(result.url).hostname.replace(/^www\./, "");
      } catch {
        continue;
      }
      const name = result.title.split(/[|–—-]/)[0]?.trim() || domain;
      const identity = normalizeCompanyIdentity({ companyName: name, website: domain });
      if (seen.has(identity.dedupeKey)) continue;
      seen.add(identity.dedupeKey);
      seeds.push({ name: identity.name, domain, location: text, category });
      if (seeds.length >= limits.newCompaniesPerCategory) break;
    }

    const now = new Date().toISOString();
    queuedCompanyIds = [];
    for (const seed of seeds) {
      const identity = normalizeCompanyIdentity({ companyName: seed.name, website: seed.domain, location: seed.location });
      const identityMatch = identity.domain
        ? or(eq(schema.companies.normalizedName, identity.normalizedName), eq(schema.companies.domain, identity.domain))
        : eq(schema.companies.normalizedName, identity.normalizedName);
      const [existingBefore] = await db.select({ id: schema.companies.id }).from(schema.companies).where(and(eq(schema.companies.ownerId, ownerId), identityMatch)).limit(1);
      await db.insert(schema.companies).values({
        id: `co_${crypto.randomUUID()}`, ownerId, name: identity.name, normalizedName: identity.normalizedName, domain: identity.domain, website: identity.domain ? `https://${identity.domain}` : null,
        aliasesJson: "[]", locationText: seed.location ?? null, locality: normalizeDublinLocality(seed.location), metadataJson: "{}", enrichmentStatus: "queued", createdAt: now, updatedAt: now,
      }).onConflictDoNothing();
      const [createdRow] = await db.select({ id: schema.companies.id }).from(schema.companies).where(and(eq(schema.companies.ownerId, ownerId), identityMatch)).limit(1);
      if (!createdRow) continue;
      await db.insert(schema.companyCategories).values({ id: `cat_${crypto.randomUUID()}`, ownerId, companyId: createdRow.id, category, confidence: "low", createdAt: now, updatedAt: now }).onConflictDoNothing();
      if (!existingBefore) {
        created += 1;
        queuedCompanyIds.push(createdRow.id);
      }
    }
  }

  const enrichment = queuedCompanyIds.length
    ? await startImportEnrichment(ownerId, runId, uniqueDiscoveryCompanyIds(queuedCompanyIds), (enrichmentOwnerId, companyId, enrichmentRunId) => enrichCompany(enrichmentOwnerId, companyId, enrichmentRunId, { provider: selectedProvider, maxSearches: limits.searchesPerCompany }), { maxCompanies: DISCOVERY_ENRICHMENT_BATCH_SIZE, concurrency: 1 })
    : { completed: 0, partial: 0, failed: 0, processed: 0, total: 0, remaining: 0, retryableCompanyIds: [] };
  const nextCompanyIds = queuedCompanyIds.slice(enrichment.processed);
  const done = nextCompanyIds.length === 0;
  const status = runStatusForBatch({
    done,
    previousProcessed: previous?.processed ?? 0,
    previousSucceeded: previous?.succeeded ?? 0,
    previousFailed: previous?.failed ?? 0,
    batchProcessed: enrichment.processed,
    batchSucceeded: enrichment.completed,
    batchPartial: enrichment.partial,
    batchFailed: enrichment.failed,
  });
  await db.update(schema.refreshRuns).set({ status, total: previous?.total || queuedCompanyIds.length, processed: (previous?.processed ?? 0) + enrichment.processed, succeeded: (previous?.succeeded ?? 0) + enrichment.completed, failed: (previous?.failed ?? 0) + enrichment.failed, cursor: JSON.stringify({ remainingCompanyIds: nextCompanyIds, retryableCompanyIds: enrichment.retryableCompanyIds }), finishedAt: done ? new Date().toISOString() : null, updatedAt: new Date().toISOString() }).where(and(eq(schema.refreshRuns.ownerId, ownerId), eq(schema.refreshRuns.id, runId)));
  return { runId, category, discovered: created, queuedCompanyIds, nextCompanyIds, retryableCompanyIds: enrichment.retryableCompanyIds, done, enrichment };
}

export async function refreshExisting(
  ownerId: string,
  scope: { companyId?: string; category?: CompanyCategory | "all"; companyIds?: string[]; runId?: string } = {},
  overrides: Partial<DiscoveryLimits> = {},
  provider?: SearchProvider,
) {
  const limits = discoveryLimits(overrides);
  const [{ getDb }, schema] = await Promise.all([import("../../db"), import("../../db/schema")]);
  const db = getDb();
  let runId = scope.runId;
  if (!runId && !scope.companyId && !scope.companyIds) {
    const [previous] = await db.select().from(schema.refreshRuns).where(and(eq(schema.refreshRuns.ownerId, ownerId), eq(schema.refreshRuns.kind, "refresh"), eq(schema.refreshRuns.status, "partial"))).orderBy(desc(schema.refreshRuns.updatedAt)).limit(1);
    const previousIds = cursorCompanyIds(previous?.cursor ?? null);
    if (previous && previousIds.length) {
      runId = previous.id;
      scope = { ...scope, runId, companyIds: previousIds };
    }
  }
  runId ??= await createRun(ownerId, "refresh", scope.companyId, scope.category);
  let candidateIds: string[];
  if (scope.companyId) {
    candidateIds = [scope.companyId];
  } else if (scope.companyIds) {
    candidateIds = uniqueDiscoveryCompanyIds(scope.companyIds);
  } else if (scope.category && scope.category !== "all") {
    const categoryRows = await db.select({ companyId: schema.companyCategories.companyId }).from(schema.companyCategories).where(and(eq(schema.companyCategories.ownerId, ownerId), eq(schema.companyCategories.category, scope.category)));
    candidateIds = categoryRows.map((row) => row.companyId);
  } else {
    const allRows = await db.select({ id: schema.companies.id }).from(schema.companies).where(eq(schema.companies.ownerId, ownerId)).orderBy(asc(schema.companies.name)).limit(limits.existingCompaniesPerRefresh);
    candidateIds = allRows.map((row) => row.id);
  }

  const rows: Array<{ id: string }> = [];
  for (let index = 0; index < candidateIds.length; index += D1_COMPANY_ID_BATCH_SIZE) {
    const batch = candidateIds.slice(index, index + D1_COMPANY_ID_BATCH_SIZE);
    if (!batch.length) continue;
    const batchRows = await db.select({ id: schema.companies.id }).from(schema.companies).where(and(eq(schema.companies.ownerId, ownerId), inArray(schema.companies.id, batch))).orderBy(asc(schema.companies.name));
    rows.push(...batchRows);
  }
  const cappedIds = rows.slice(0, limits.existingCompaniesPerRefresh).map((row) => row.id);
  const batchPlan = planRefreshBatch(cappedIds, scope.companyId ? 1 : REFRESH_BATCH_SIZE);
  const [run] = await db.select().from(schema.refreshRuns).where(and(eq(schema.refreshRuns.ownerId, ownerId), eq(schema.refreshRuns.id, runId))).limit(1);
  const total = run?.total || cappedIds.length;
  const start = new Date().toISOString();
  await db.update(schema.refreshRuns).set({ status: "running", total, startedAt: run?.startedAt ?? start, updatedAt: start }).where(and(eq(schema.refreshRuns.ownerId, ownerId), eq(schema.refreshRuns.id, runId)));
  let succeeded = 0;
  let partial = 0;
  let failed = 0;
  const retryableCompanyIds: string[] = [];
  for (const companyId of batchPlan.batch) {
    try {
      const result = await enrichCompany(ownerId, companyId, runId, { provider, maxSearches: limits.searchesPerCompany });
      if (result.status === "failed") { failed += 1; retryableCompanyIds.push(companyId); } else if (result.status === "partial") { partial += 1; retryableCompanyIds.push(companyId); } else succeeded += 1;
    } catch {
      failed += 1;
      retryableCompanyIds.push(companyId);
    }
  }
  const done = batchPlan.remaining.length === 0;
  const status = runStatusForBatch({
    done,
    previousProcessed: run?.processed ?? 0,
    previousSucceeded: run?.succeeded ?? 0,
    previousFailed: run?.failed ?? 0,
    batchProcessed: batchPlan.batch.length,
    batchSucceeded: succeeded,
    batchPartial: partial,
    batchFailed: failed,
  });
  const now = new Date().toISOString();
  const previousRetryable = cursorCompanyIds(run?.cursor ?? null, "retryableCompanyIds").filter((companyId) => !batchPlan.batch.includes(companyId));
  const retryable = uniqueDiscoveryCompanyIds([...previousRetryable, ...retryableCompanyIds]);
  await db.update(schema.refreshRuns).set({ status: done ? status : "running", total, processed: (run?.processed ?? 0) + batchPlan.batch.length, succeeded: (run?.succeeded ?? 0) + succeeded, failed: (run?.failed ?? 0) + failed, cursor: JSON.stringify({ remainingCompanyIds: batchPlan.remaining, retryableCompanyIds: retryable }), finishedAt: done ? now : null, updatedAt: now }).where(and(eq(schema.refreshRuns.ownerId, ownerId), eq(schema.refreshRuns.id, runId)));
  return { runId, total, processed: batchPlan.batch.length, succeeded, partial, failed, nextCompanyIds: batchPlan.remaining, retryableCompanyIds: retryable, done };
}
