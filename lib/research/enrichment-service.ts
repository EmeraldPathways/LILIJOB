import { and, eq, sql } from "drizzle-orm";
import { buildCompanySearchRequests, matchesCompany, rankSearchResults } from "./source-policy";
import { extractClaims, sourceTypeForCompany } from "./claim-extractor";
import { mergeClaims } from "./claim-merger";
import type { ExistingClaim, EnrichmentSummary, ResearchCompanySeed, SearchResult } from "./types";
import type { SearchProvider } from "./search-provider";
import { ResearchProviderError } from "./search-provider";
import { COMPANY_CATEGORIES, type CompanyCategory } from "../domain/types";

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

type CanonicalProfile = {
  website?: string | null;
  domain?: string | null;
  description?: string | null;
  locality?: string | null;
  locationText?: string | null;
  employeeBand?: string | null;
  foundedYear?: number | null;
  headquarters?: string | null;
};

function hasCanonicalValue(value: string | number | null | undefined): boolean {
  return typeof value === "string" ? Boolean(value.trim()) : value !== null && value !== undefined;
}

export function buildGapOnlyProfilePatch(
  company: CanonicalProfile,
  claims: Pick<ExistingClaim, "field" | "value">[],
): Partial<CanonicalProfile> {
  const patch: Partial<CanonicalProfile> = {};
  const firstValue = (field: string): unknown => claims.find((claim) => claim.field === field)?.value;
  const textFields = ["website", "domain", "description", "locality", "employeeBand", "headquarters"] as const;
  for (const field of textFields) {
    const value = firstValue(field);
    if (!hasCanonicalValue(company[field]) && typeof value === "string" && value.trim()) {
      patch[field] = value.trim();
    }
  }
  const foundedYear = firstValue("foundedYear");
  if (!hasCanonicalValue(company.foundedYear) && typeof foundedYear === "number" && Number.isInteger(foundedYear)) {
    patch.foundedYear = foundedYear;
  }

  if (!hasCanonicalValue(company.website) && hasCanonicalValue(company.domain)) {
    const domain = company.domain!.trim().replace(/^https?:\/\//i, "").replace(/\/$/, "");
    if (domain) patch.website = `https://${domain}`;
  }
  if (!hasCanonicalValue(company.domain) && hasCanonicalValue(company.website)) {
    try {
      patch.domain = new URL(company.website!.startsWith("http") ? company.website! : `https://${company.website}`).hostname.replace(/^www\./, "");
    } catch {
      // An invalid imported website is preserved without deriving a domain from it.
    }
  }
  return patch;
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
    return { companyId, runId, sourcesChecked: 0, claimsAdded: 0, jobsFound: 0, contactsFound: 0, permitEvidenceFound: 0, status: "failed", error: "Company not found." };
  }

  const now = new Date().toISOString();
  try {
    await db.update(schema.companies).set({ enrichmentStatus: "running", updatedAt: now }).where(and(eq(schema.companies.ownerId, ownerId), eq(schema.companies.id, companyId)));
    const seed: ResearchCompanySeed = {
      name: company.name,
      domain: company.domain,
      website: company.website,
      description: company.description,
      locality: company.locality,
      location: company.locationText,
      headquarters: company.headquarters,
      employeeBand: company.employeeBand,
      foundedYear: company.foundedYear,
    };
    const requests = buildCompanySearchRequests(seed).slice(0, 1);
    const results: SearchResult[] = [];
    let failures = 0;
    for (const [requestIndex, request] of requests.entries()) {
      try {
        results.push(...(await retryWithBackoff(() => provider.search({
          ...request,
          usage: { ownerId, operationId: `enrichment:${runId}:${companyId}:${requestIndex}`, scope: "enrichment", runId },
        }), { retries: 0 })));
      } catch {
        failures += 1;
      }
    }

    const ranked = rankSearchResults(results.filter((result) => matchesCompany(seed, result)));
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
    sourceId: row.sourceId,
    status: row.status,
    checkedAt: row.checkedAt,
  }));
  const merged = mergeClaims(existing, claims, runId);

  let claimsAdded = 0;
  let jobsFound = 0;
  let contactsFound = 0;
    const sourceIds = new Map<string, string>();
    const groupedSources = new Map<string, { result: SearchResult; titles: string[]; snippets: string[] }>();
    for (const result of ranked) {
      const normalizedUrl = result.url.toLowerCase().replace(/#.*$/, "").replace(/\/$/, "");
      const group = groupedSources.get(normalizedUrl) ?? { result, titles: [], snippets: [] };
      if (result.title.trim() && !group.titles.includes(result.title.trim())) group.titles.push(result.title.trim());
      if (result.snippet.trim() && !group.snippets.includes(result.snippet.trim())) group.snippets.push(result.snippet.trim());
      groupedSources.set(normalizedUrl, group);
    }
    for (const [normalizedUrl, group] of groupedSources) {
      const result = group.result;
    await db.insert(schema.sources).values({
      id: id("src"), ownerId, companyId, url: result.url, normalizedUrl, title: group.titles.join(" · "), snippet: group.snippets.join("\n"),
      provider: result.provider, sourceType: sourceTypeForCompany(seed, result), retrievedAt: result.retrievedAt, checkedAt: now,
      status: result.status ?? "ok", createdAt: now, updatedAt: now,
    }).onConflictDoUpdate({ target: [schema.sources.ownerId, schema.sources.normalizedUrl], set: { checkedAt: now, title: group.titles.join(" · "), snippet: group.snippets.join("\n"), updatedAt: now } });
    const [sourceRow] = await db.select({ id: schema.sources.id }).from(schema.sources).where(and(eq(schema.sources.ownerId, ownerId), eq(schema.sources.normalizedUrl, normalizedUrl))).limit(1);
    if (sourceRow) sourceIds.set(normalizedUrl, sourceRow.id);
  }

  const currentClaimIds = new Set(merged.current.map((claim) => claim.id).filter((value): value is string => Boolean(value)));
  for (const previous of existing) {
    if (previous.id && !currentClaimIds.has(previous.id)) {
      await db.update(schema.companyClaims).set({ status: "superseded", updatedAt: now }).where(and(eq(schema.companyClaims.ownerId, ownerId), eq(schema.companyClaims.id, previous.id)));
    }
  }

  for (const claim of merged.current) {
    const normalizedUrl = claim.source.url.toLowerCase().replace(/#.*$/, "").replace(/\/$/, "");
    const sourceId = claim.sourceId ?? sourceIds.get(normalizedUrl) ?? null;
    if (claim.id) {
      await db.update(schema.companyClaims).set({ valueJson: JSON.stringify(claim.value), normalizedValue: claim.normalizedValue, confidence: claim.confidence, sourceId, status: "current", checkedAt: now, updatedAt: now }).where(and(eq(schema.companyClaims.ownerId, ownerId), eq(schema.companyClaims.id, claim.id)));
      continue;
    }
    const [stored] = await db.select({ id: schema.companyClaims.id }).from(schema.companyClaims).where(and(eq(schema.companyClaims.ownerId, ownerId), eq(schema.companyClaims.companyId, companyId), eq(schema.companyClaims.field, claim.field), eq(schema.companyClaims.normalizedValue, claim.normalizedValue), eq(schema.companyClaims.status, "current"))).limit(1);
    if (stored) {
      await db.update(schema.companyClaims).set({ valueJson: JSON.stringify(claim.value), confidence: claim.confidence, sourceId, checkedAt: now, updatedAt: now }).where(and(eq(schema.companyClaims.ownerId, ownerId), eq(schema.companyClaims.id, stored.id)));
    } else {
      await db.insert(schema.companyClaims).values({
        id: id("claim"), ownerId, companyId, field: claim.field, valueJson: JSON.stringify(claim.value), normalizedValue: claim.normalizedValue,
        confidence: claim.confidence, sourceId, status: "current", checkedAt: now, createdAt: now, updatedAt: now,
      });
      claimsAdded += 1;
    }
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
    const sourceId = sourceIds.get(claim.source.url.toLowerCase().replace(/#.*$/, "").replace(/\/$/, "")) ?? null;
    const [stored] = await db.select({ id: schema.permitEvidence.id }).from(schema.permitEvidence).where(and(eq(schema.permitEvidence.ownerId, ownerId), eq(schema.permitEvidence.companyId, companyId), eq(schema.permitEvidence.evidenceType, value.evidenceType), eq(schema.permitEvidence.statement, value.statement))).limit(1);
    if (stored) {
      await db.update(schema.permitEvidence).set({ excerpt: claim.excerpt, sourceId, confidence: claim.confidence, checkedAt: now, updatedAt: now }).where(and(eq(schema.permitEvidence.ownerId, ownerId), eq(schema.permitEvidence.id, stored.id)));
    } else {
      await db.insert(schema.permitEvidence).values({
        id: id("permit"), ownerId, companyId, evidenceType: value.evidenceType, statement: value.statement, excerpt: claim.excerpt,
        sourceId, confidence: claim.confidence, checkedAt: now, createdAt: now, updatedAt: now,
      });
    }
  }

  for (const claim of merged.current.filter((item) => item.field === "category")) {
    const category = typeof claim.value === "string" && (COMPANY_CATEGORIES as readonly string[]).includes(claim.value) ? claim.value as CompanyCategory : null;
    if (!category) continue;
    await db.insert(schema.companyCategories).values({ id: id("cat"), ownerId, companyId, category, confidence: claim.confidence, sourceId: sourceIds.get(claim.source.url.toLowerCase().replace(/#.*$/, "").replace(/\/$/, "")) ?? null, createdAt: now, updatedAt: now }).onConflictDoNothing();
  }

  for (const claim of merged.current.filter((item) => item.field === "job")) {
    const value = claim.value as { title?: string; url?: string | null; location?: string | null; employmentType?: string | null; salary?: string | null; postedAt?: string | null };
    if (!value.title) continue;
    const normalizedJobUrl = value.url?.toLowerCase().replace(/#.*$/, "").replace(/\/$/, "") ?? null;
    const existingJobs = await db.select().from(schema.jobs).where(and(eq(schema.jobs.ownerId, ownerId), eq(schema.jobs.companyId, companyId)));
    const stored = existingJobs.find((job) => job.title.trim().toLowerCase() === value.title!.trim().toLowerCase() && (job.url?.toLowerCase().replace(/#.*$/, "").replace(/\/$/, "") ?? null) === normalizedJobUrl);
    const sourceId = sourceIds.get(claim.source.url.toLowerCase().replace(/#.*$/, "").replace(/\/$/, "")) ?? null;
    if (stored) {
      await db.update(schema.jobs).set({ location: value.location ?? stored.location, employmentType: value.employmentType ?? stored.employmentType, salary: value.salary ?? stored.salary, postedAt: value.postedAt ?? stored.postedAt, sourceId, confidence: claim.confidence, status: "open", updatedAt: now }).where(and(eq(schema.jobs.ownerId, ownerId), eq(schema.jobs.id, stored.id)));
    } else {
      await db.insert(schema.jobs).values({ id: id("job"), ownerId, companyId, title: value.title, url: value.url ?? null, location: value.location ?? null, employmentType: value.employmentType ?? null, salary: value.salary ?? null, postedAt: value.postedAt ?? null, sourceId, confidence: claim.confidence, status: "open", createdAt: now, updatedAt: now }).onConflictDoNothing();
    }
    jobsFound += 1;
  }

  for (const claim of merged.current.filter((item) => item.field === "contact")) {
    const value = claim.value as { name?: string | null; role?: string | null; email?: string | null; linkedinUrl?: string | null };
    if (!value.email && !value.name) continue;
    const existingContacts = await db.select().from(schema.contacts).where(and(eq(schema.contacts.ownerId, ownerId), eq(schema.contacts.companyId, companyId)));
    const stored = existingContacts.find((contact) => (value.email && contact.email?.toLowerCase() === value.email.toLowerCase()) || (!value.email && value.name && contact.name?.toLowerCase() === value.name.toLowerCase()));
    const sourceId = sourceIds.get(claim.source.url.toLowerCase().replace(/#.*$/, "").replace(/\/$/, "")) ?? null;
    if (stored) {
      await db.update(schema.contacts).set({ name: value.name ?? stored.name, role: value.role ?? stored.role, linkedinUrl: value.linkedinUrl ?? stored.linkedinUrl, sourceId, confidence: claim.confidence, updatedAt: now }).where(and(eq(schema.contacts.ownerId, ownerId), eq(schema.contacts.id, stored.id)));
    } else {
      await db.insert(schema.contacts).values({ id: id("contact"), ownerId, companyId, name: value.name ?? null, role: value.role ?? null, email: value.email ?? null, linkedinUrl: value.linkedinUrl ?? null, sourceId, confidence: claim.confidence, createdAt: now, updatedAt: now });
    }
    contactsFound += 1;
  }

  const profilePatch = buildGapOnlyProfilePatch(company, claims);
  if (Object.keys(profilePatch).length) {
    const guardedPatch = Object.fromEntries(Object.entries(profilePatch).map(([field, value]) => {
      const column = schema.companies[field as keyof CanonicalProfile];
      return [field, sql`CASE WHEN ${column} IS NULL OR trim(CAST(${column} AS TEXT)) = '' THEN ${value} ELSE ${column} END`];
    }));
    await db.update(schema.companies).set({ ...guardedPatch, updatedAt: now }).where(and(eq(schema.companies.ownerId, ownerId), eq(schema.companies.id, companyId)));
  }

  const status: EnrichmentSummary["status"] = failures === 0 ? "completed" : ranked.length ? "partial" : "failed";
  const error = failures && !ranked.length ? "All research provider requests failed." : undefined;
  await db.update(schema.companies).set({ enrichmentStatus: status, lastEnrichedAt: now, updatedAt: now }).where(and(eq(schema.companies.ownerId, ownerId), eq(schema.companies.id, companyId)));

  return { companyId, runId, sourcesChecked: ranked.length, claimsAdded, jobsFound, contactsFound, permitEvidenceFound: merged.current.filter((claim) => claim.field === "permitEvidence").length, status, error };
  } catch (error) {
    try {
      await db.update(schema.companies).set({ enrichmentStatus: "failed", updatedAt: new Date().toISOString() }).where(and(eq(schema.companies.ownerId, ownerId), eq(schema.companies.id, companyId)));
    } catch {
      // Preserve the original failure for the run owner.
    }
    throw error;
  }
}

export async function createRun(ownerId: string, kind: string, companyId?: string, category?: string): Promise<string> {
  const { getDb } = await import("../../db");
  const { refreshRuns } = await import("../../db/schema");
  const runId = id("run");
  const now = new Date().toISOString();
  await getDb().insert(refreshRuns).values({ id: runId, ownerId, kind, companyId: companyId ?? null, category: category ?? null, requestedBy: "user", status: "queued", createdAt: now, updatedAt: now });
  return runId;
}
