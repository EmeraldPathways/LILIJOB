import { and, asc, desc, eq } from "drizzle-orm";
import { getDb } from "../../db";
import { companies, jobs } from "../../db/schema";
import { settingsVersions } from "../../db/schema-v4";

export type SavedSearchScope = "all" | "jobs" | "companies";

export type SavedSearchQuery = {
  text: string;
  scope: SavedSearchScope;
};

export type SavedSearchResultItem = {
  id: string;
  kind: "job" | "company";
  title: string;
  summary: string;
  href: string;
  updatedAt: string;
};

export type SavedSearch = {
  id: string;
  name: string;
  query: SavedSearchQuery;
  createdAt: string;
  updatedAt: string;
  lastRunAt: string | null;
  lastRunResult: {
    totalCount: number;
    results: SavedSearchResultItem[];
    moreAvailable: boolean;
  } | null;
};

const namespace = "saved-searches";
const maxStoredResults = 25;
const scopes = new Set<SavedSearchScope>(["all", "jobs", "companies"]);

function now(): string {
  return new Date().toISOString();
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function validateQuery(value: unknown): SavedSearchQuery {
  const raw = objectValue(value);
  const text = typeof raw?.text === "string" ? raw.text.trim() : "";
  const scope = raw?.scope;
  if (text.length < 2 || text.length > 120) throw new Error("Search text must contain 2 to 120 characters.");
  if (typeof scope !== "string" || !scopes.has(scope as SavedSearchScope)) throw new Error("Choose a local dataset scope.");
  return { text, scope: scope as SavedSearchScope };
}

function parseSearch(value: unknown): SavedSearch | null {
  const raw = objectValue(value);
  if (!raw || typeof raw.id !== "string" || typeof raw.name !== "string" || !raw.name.trim() || typeof raw.createdAt !== "string" || typeof raw.updatedAt !== "string") return null;
  let query: SavedSearchQuery;
  try {
    query = validateQuery(raw.query);
  } catch {
    return null;
  }
  const rawResult = objectValue(raw.lastRunResult);
  const resultRows = Array.isArray(rawResult?.results) ? rawResult.results : [];
  const results = resultRows.flatMap((item): SavedSearchResultItem[] => {
    const row = objectValue(item);
    if (!row || typeof row.id !== "string" || (row.kind !== "job" && row.kind !== "company") || typeof row.title !== "string" || typeof row.summary !== "string" || typeof row.href !== "string" || typeof row.updatedAt !== "string") return [];
    return [{ id: row.id, kind: row.kind, title: row.title, summary: row.summary, href: row.href, updatedAt: row.updatedAt }];
  });
  const totalCount = typeof rawResult?.totalCount === "number" && Number.isFinite(rawResult.totalCount) ? Math.max(0, Math.floor(rawResult.totalCount)) : 0;
  const lastRunAt = typeof raw.lastRunAt === "string" ? raw.lastRunAt : null;
  return {
    id: raw.id,
    name: raw.name.trim(),
    query,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    lastRunAt,
    lastRunResult: rawResult ? { totalCount, results, moreAvailable: rawResult.moreAvailable === true } : null,
  };
}

function decodeSearches(settingsJson: string | undefined): SavedSearch[] {
  if (!settingsJson) return [];
  try {
    const raw = objectValue(JSON.parse(settingsJson));
    return Array.isArray(raw?.savedSearches) ? raw.savedSearches.flatMap((item) => {
      const parsed = parseSearch(item);
      return parsed ? [parsed] : [];
    }) : [];
  } catch {
    return [];
  }
}

async function latestVersion(ownerId: string) {
  const [row] = await getDb().select().from(settingsVersions).where(and(
    eq(settingsVersions.ownerId, ownerId),
    eq(settingsVersions.namespace, namespace),
  )).orderBy(desc(settingsVersions.version)).limit(1);
  return row;
}

async function appendVersion(ownerId: string, savedSearches: SavedSearch[]) {
  const previous = await latestVersion(ownerId);
  await getDb().insert(settingsVersions).values({
    id: `settings_${crypto.randomUUID()}`,
    ownerId,
    namespace,
    version: (previous?.version ?? 0) + 1,
    settingsJson: JSON.stringify({ savedSearches }),
    createdBy: ownerId,
    createdAt: now(),
  });
}

export async function listSavedSearches(ownerId: string): Promise<SavedSearch[]> {
  const row = await latestVersion(ownerId);
  return decodeSearches(row?.settingsJson);
}

export async function saveSavedSearch(ownerId: string, input: { name: unknown; query: unknown }): Promise<SavedSearch> {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name || name.length > 80) throw new Error("Search name must contain 1 to 80 characters.");
  const query = validateQuery(input.query);
  const searches = await listSavedSearches(ownerId);
  const timestamp = now();
  const saved: SavedSearch = {
    id: `saved_search_${crypto.randomUUID()}`,
    name,
    query,
    createdAt: timestamp,
    updatedAt: timestamp,
    lastRunAt: null,
    lastRunResult: null,
  };
  await appendVersion(ownerId, [...searches, saved]);
  return saved;
}

async function runLocalQuery(ownerId: string, query: SavedSearchQuery): Promise<SavedSearch["lastRunResult"]> {
  const db = getDb();
  const term = query.text.toLocaleLowerCase();
  const matches: SavedSearchResultItem[] = [];

  if (query.scope === "all" || query.scope === "companies") {
    const rows = await db.select({
      id: companies.id,
      name: companies.name,
      domain: companies.domain,
      locality: companies.locality,
      locationText: companies.locationText,
      description: companies.description,
      updatedAt: companies.updatedAt,
    }).from(companies).where(eq(companies.ownerId, ownerId)).orderBy(asc(companies.name));
    for (const company of rows) {
      const searchable = [company.name, company.domain, company.locality, company.locationText, company.description].filter(Boolean).join(" ").toLocaleLowerCase();
      if (!searchable.includes(term)) continue;
      matches.push({
        id: company.id,
        kind: "company",
        title: company.name,
        summary: [company.domain, company.locality ?? company.locationText].filter(Boolean).join(" · ") || "Company record",
        href: `/company/${encodeURIComponent(company.id)}`,
        updatedAt: company.updatedAt,
      });
    }
  }

  if (query.scope === "all" || query.scope === "jobs") {
    const rows = await db.select({
      id: jobs.id,
      companyId: jobs.companyId,
      companyName: companies.name,
      title: jobs.title,
      location: jobs.location,
      status: jobs.status,
      updatedAt: jobs.updatedAt,
    }).from(jobs).innerJoin(companies, and(
      eq(companies.ownerId, ownerId),
      eq(companies.id, jobs.companyId),
    )).where(eq(jobs.ownerId, ownerId)).orderBy(desc(jobs.updatedAt), asc(jobs.title));
    for (const job of rows) {
      const searchable = [job.title, job.location, job.status, job.companyName].filter(Boolean).join(" ").toLocaleLowerCase();
      if (!searchable.includes(term)) continue;
      matches.push({
        id: job.id,
        kind: "job",
        title: job.title,
        summary: [job.companyName, job.location, job.status].filter(Boolean).join(" · "),
        href: `/company/${encodeURIComponent(job.companyId)}`,
        updatedAt: job.updatedAt,
      });
    }
  }

  matches.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.title.localeCompare(b.title));
  return {
    totalCount: matches.length,
    results: matches.slice(0, maxStoredResults),
    moreAvailable: matches.length > maxStoredResults,
  };
}

export async function runSavedSearch(ownerId: string, searchId: string): Promise<SavedSearch | null> {
  const searches = await listSavedSearches(ownerId);
  const index = searches.findIndex((search) => search.id === searchId);
  if (index < 0) return null;
  const search = searches[index];
  const timestamp = now();
  const updated: SavedSearch = {
    ...search,
    updatedAt: timestamp,
    lastRunAt: timestamp,
    lastRunResult: await runLocalQuery(ownerId, search.query),
  };
  searches[index] = updated;
  await appendVersion(ownerId, searches);
  return updated;
}

export async function deleteSavedSearch(ownerId: string, searchId: string): Promise<boolean> {
  const searches = await listSavedSearches(ownerId);
  const remaining = searches.filter((search) => search.id !== searchId);
  if (remaining.length === searches.length) return false;
  await appendVersion(ownerId, remaining);
  return true;
}
