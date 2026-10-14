import { and, asc, desc, eq, like } from "drizzle-orm";
import { getDb } from "../../db";
import {
  changeHistory,
  companyCategories,
  companyClaims,
  companies,
  contacts,
  jobs,
  permitEvidence,
  sources,
} from "../../db/schema";
import type { CompanyCategory, DublinLocality } from "../domain/types";

export type CompanyFilters = {
  category?: CompanyCategory | "all";
  locality?: DublinLocality | "all";
  query?: string;
  status?: string;
};

export type CompanyListItem = {
  id: string;
  name: string;
  domain: string | null;
  website: string | null;
  locality: DublinLocality | null;
  locationText: string | null;
  description: string | null;
  categories: CompanyCategory[];
  enrichmentStatus: string;
  lastEnrichedAt: string | null;
  nextRefreshAt: string | null;
  employeeBand: string | null;
  permitSignal: "confirmed" | "potential" | "unknown";
};

export type CompanyDetail = CompanyListItem & {
  aliases: string[];
  headquarters: string | null;
  foundedYear: number | null;
  metadata: Record<string, string>;
  jobs: Array<typeof jobs.$inferSelect>;
  permitEvidence: Array<typeof permitEvidence.$inferSelect>;
  contacts: Array<typeof contacts.$inferSelect>;
  sources: Array<typeof sources.$inferSelect>;
  claims: Array<typeof companyClaims.$inferSelect>;
  history: Array<typeof changeHistory.$inferSelect>;
};

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function permitSignal(evidence: Array<{ evidenceType: string }>): CompanyListItem["permitSignal"] {
  if (evidence.some((item) => item.evidenceType === "confirmed-sponsor")) return "confirmed";
  if (evidence.some((item) => item.evidenceType === "potentially-qualifying-role")) return "potential";
  return "unknown";
}

async function categoriesFor(ownerId: string, companyId: string): Promise<CompanyCategory[]> {
  const db = getDb();
  const rows = await db
    .select({ category: companyCategories.category })
    .from(companyCategories)
    .where(and(eq(companyCategories.ownerId, ownerId), eq(companyCategories.companyId, companyId)));
  return rows.map((row) => row.category as CompanyCategory);
}

async function evidenceFor(ownerId: string, companyId: string) {
  const db = getDb();
  return db
    .select({ evidenceType: permitEvidence.evidenceType })
    .from(permitEvidence)
    .where(and(eq(permitEvidence.ownerId, ownerId), eq(permitEvidence.companyId, companyId)));
}

export async function listCompanies(
  ownerId: string,
  filters: CompanyFilters = {},
): Promise<CompanyListItem[]> {
  const db = getDb();
  const clauses = [eq(companies.ownerId, ownerId)];
  if (filters.locality && filters.locality !== "all") {
    clauses.push(eq(companies.locality, filters.locality));
  }
  if (filters.status && filters.status !== "all") {
    clauses.push(eq(companies.enrichmentStatus, filters.status));
  }
  if (filters.query?.trim()) {
    clauses.push(like(companies.name, `%${filters.query.trim()}%`));
  }

  const rows = await db
    .select()
    .from(companies)
    .where(and(...clauses))
    .orderBy(asc(companies.name));

  const result: CompanyListItem[] = [];
  for (const row of rows) {
    const categories = await categoriesFor(ownerId, row.id);
    if (filters.category && filters.category !== "all" && !categories.includes(filters.category)) {
      continue;
    }
    const evidence = await evidenceFor(ownerId, row.id);
    result.push({
      id: row.id,
      name: row.name,
      domain: row.domain,
      website: row.website,
      locality: row.locality as DublinLocality | null,
      locationText: row.locationText,
      description: row.description,
      categories,
      enrichmentStatus: row.enrichmentStatus,
      lastEnrichedAt: row.lastEnrichedAt,
      nextRefreshAt: row.nextRefreshAt,
      employeeBand: row.employeeBand,
      permitSignal: permitSignal(evidence),
    });
  }
  return result;
}

export async function getCompanyDetail(ownerId: string, companyId: string): Promise<CompanyDetail | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(companies)
    .where(and(eq(companies.ownerId, ownerId), eq(companies.id, companyId)))
    .limit(1);
  if (!row) return null;

  const [categories, jobsRows, permitRows, contactsRows, sourceRows, claimRows, historyRows] =
    await Promise.all([
      categoriesFor(ownerId, row.id),
      db.select().from(jobs).where(and(eq(jobs.ownerId, ownerId), eq(jobs.companyId, companyId))).orderBy(desc(jobs.updatedAt)),
      db.select().from(permitEvidence).where(and(eq(permitEvidence.ownerId, ownerId), eq(permitEvidence.companyId, companyId))).orderBy(desc(permitEvidence.updatedAt)),
      db.select().from(contacts).where(and(eq(contacts.ownerId, ownerId), eq(contacts.companyId, companyId))).orderBy(asc(contacts.name)),
      db.select().from(sources).where(and(eq(sources.ownerId, ownerId), eq(sources.companyId, companyId))).orderBy(desc(sources.checkedAt)),
      db.select().from(companyClaims).where(and(eq(companyClaims.ownerId, ownerId), eq(companyClaims.companyId, companyId))).orderBy(desc(companyClaims.updatedAt)),
      db.select().from(changeHistory).where(and(eq(changeHistory.ownerId, ownerId), eq(changeHistory.companyId, companyId))).orderBy(desc(changeHistory.createdAt)),
    ]);

  return {
    id: row.id,
    name: row.name,
    domain: row.domain,
    website: row.website,
    locality: row.locality as DublinLocality | null,
    locationText: row.locationText,
    description: row.description,
    categories,
    enrichmentStatus: row.enrichmentStatus,
    lastEnrichedAt: row.lastEnrichedAt,
    nextRefreshAt: row.nextRefreshAt,
    employeeBand: row.employeeBand,
    permitSignal: permitSignal(permitRows),
    aliases: parseJson(row.aliasesJson, []),
    headquarters: row.headquarters,
    foundedYear: row.foundedYear,
    metadata: parseJson(row.metadataJson, {}),
    jobs: jobsRows,
    permitEvidence: permitRows,
    contacts: contactsRows,
    sources: sourceRows,
    claims: claimRows,
    history: historyRows,
  };
}

export async function deleteCompany(ownerId: string, companyId: string): Promise<boolean> {
  const db = getDb();
  const deleted = await db
    .delete(companies)
    .where(and(eq(companies.ownerId, ownerId), eq(companies.id, companyId)))
    .returning({ id: companies.id });
  return deleted.length > 0;
}
