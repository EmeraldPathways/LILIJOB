import { and, eq } from "drizzle-orm";
import { DEFAULT_DISCOVERY_LIMITS } from "../domain/constants";
import { normalizeCompanyIdentity, isCountyDublinLocation, normalizeDublinLocality } from "../domain/normalize";
import type { CompanyCategory } from "../domain/types";
import type { DiscoveryLimits, ResearchCompanySeed } from "./types";
import type { SearchProvider } from "./search-provider";
import { createRun, enrichCompany, retryWithBackoff } from "./enrichment-service";

export function discoveryLimits(overrides: Partial<DiscoveryLimits> = {}): DiscoveryLimits {
  return {
    newCompaniesPerCategory: Math.min(Math.max(1, overrides.newCompaniesPerCategory ?? DEFAULT_DISCOVERY_LIMITS.newCompaniesPerCategory), DEFAULT_DISCOVERY_LIMITS.newCompaniesPerCategory),
    searchesPerCompany: Math.min(Math.max(1, overrides.searchesPerCompany ?? DEFAULT_DISCOVERY_LIMITS.searchesPerCompany), DEFAULT_DISCOVERY_LIMITS.searchesPerCompany),
    existingCompaniesPerRefresh: Math.min(Math.max(1, overrides.existingCompaniesPerRefresh ?? DEFAULT_DISCOVERY_LIMITS.existingCompaniesPerRefresh), DEFAULT_DISCOVERY_LIMITS.existingCompaniesPerRefresh),
  };
}

export async function runDiscovery(
  ownerId: string,
  category: CompanyCategory,
  overrides: Partial<DiscoveryLimits> = {},
  provider?: SearchProvider,
) {
  const limits = discoveryLimits(overrides);
  const runId = await createRun(ownerId, "discovery", undefined, category);
  const selectedProvider = provider ?? (await import("./tavily-search-provider")).configuredSearchProvider();
  const search = await retryWithBackoff(() => selectedProvider.search({
    purpose: "category-evidence",
    query: `${category} technology companies County Dublin hiring careers`,
    maxResults: limits.newCompaniesPerCategory,
  }));

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

  const [{ getDb }, schema] = await Promise.all([import("../../db"), import("../../db/schema")]);
  const db = getDb();
  const now = new Date().toISOString();
  let created = 0;
  for (const seed of seeds) {
    const identity = normalizeCompanyIdentity({ companyName: seed.name, website: seed.domain, location: seed.location });
    const companyId = `co_${crypto.randomUUID()}`;
    await db.insert(schema.companies).values({
      id: companyId, ownerId, name: identity.name, normalizedName: identity.normalizedName, domain: identity.domain, website: identity.domain ? `https://${identity.domain}` : null,
      aliasesJson: "[]", locationText: seed.location ?? null, locality: normalizeDublinLocality(seed.location), metadataJson: "{}", enrichmentStatus: "queued", createdAt: now, updatedAt: now,
    }).onConflictDoNothing();
    const [createdRow] = await db.select({ id: schema.companies.id }).from(schema.companies).where(and(eq(schema.companies.ownerId, ownerId), eq(schema.companies.normalizedName, identity.normalizedName))).limit(1);
    if (!createdRow) continue;
    await db.insert(schema.companyCategories).values({ id: `cat_${crypto.randomUUID()}`, ownerId, companyId: createdRow.id, category, confidence: "low", createdAt: now, updatedAt: now }).onConflictDoNothing();
    created += 1;
  }
  await db.update(schema.refreshRuns).set({ status: "completed", total: created, processed: created, succeeded: created, finishedAt: now, updatedAt: now }).where(and(eq(schema.refreshRuns.ownerId, ownerId), eq(schema.refreshRuns.id, runId)));
  return { runId, category, discovered: created, queuedCompanyIds: seeds.map((seed) => seed.name) };
}

export async function refreshExisting(
  ownerId: string,
  scope: { companyId?: string; category?: CompanyCategory | "all" } = {},
  overrides: Partial<DiscoveryLimits> = {},
  provider?: SearchProvider,
) {
  const limits = discoveryLimits(overrides);
  const [{ getDb }, schema] = await Promise.all([import("../../db"), import("../../db/schema")]);
  const db = getDb();
  const runId = await createRun(ownerId, "refresh", scope.companyId, scope.category);
  const where = scope.companyId ? and(eq(schema.companies.ownerId, ownerId), eq(schema.companies.id, scope.companyId)) : eq(schema.companies.ownerId, ownerId);
  const rows = await db.select({ id: schema.companies.id }).from(schema.companies).where(where).limit(limits.existingCompaniesPerRefresh);
  let succeeded = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      const result = await enrichCompany(ownerId, row.id, runId, { provider, maxSearches: limits.searchesPerCompany });
      if (result.status === "failed") failed += 1; else succeeded += 1;
    } catch {
      failed += 1;
    }
  }
  const now = new Date().toISOString();
  await db.update(schema.refreshRuns).set({ status: failed ? (succeeded ? "partial" : "failed") : "completed", total: rows.length, processed: rows.length, succeeded, failed, finishedAt: now, updatedAt: now }).where(and(eq(schema.refreshRuns.ownerId, ownerId), eq(schema.refreshRuns.id, runId)));
  return { runId, total: rows.length, succeeded, failed };
}
