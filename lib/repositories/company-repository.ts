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
import type { CompanyCategory, ConfidenceLevel, DublinLocality } from "../domain/types";
import { buildCompanyCellUpdatePlan, type CompanyCellSnapshot } from "../sheet-data/cell-update";
import { groupRowsByCompanyId } from "./company-relations";

export type CompanyFilters = {
  category?: CompanyCategory | "all";
  locality?: DublinLocality | "all";
  query?: string;
  status?: string;
  permitSignal?: CompanyListItem["permitSignal"] | "all";
  freshness?: "fresh" | "stale" | "unknown" | "all";
  confidence?: ConfidenceLevel | "all";
  openRoles?: "yes" | "no" | "all";
};

export type CompanyListItem = {
  id: string;
  name: string;
  sector?: string | null;
  importedData?: Record<string, string>;
  collections?: string[];
  sheetRows?: Record<string, Record<string, string>>;
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
  openRoles: number;
  confidence: ConfidenceLevel | null;
  freshness: "fresh" | "stale" | "unknown";
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

export function companySheetFields(metadataJson: string | null): {
  sector: string | null;
  importedData: Record<string, string>;
  collections?: string[];
  sheetRows?: Record<string, Record<string, string>>;
} {
  const metadata = parseJson<Record<string, unknown>>(metadataJson, {});
  const original = metadata.original;
  const importedData = original && typeof original === "object" && !Array.isArray(original)
    ? Object.fromEntries(
        Object.entries(original).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
      )
    : {};
  return {
    sector: typeof metadata.sector === "string" && metadata.sector.trim() ? metadata.sector : null,
    importedData,
    ...(Array.isArray(metadata.collections) ? {collections: metadata.collections.filter((value): value is string => typeof value === "string")} : {}),
    ...(metadata.sheetRows && typeof metadata.sheetRows === "object" ? {sheetRows: metadata.sheetRows as Record<string, Record<string,string>>} : {}),
  };
}

export class CompanyCellConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CompanyCellConflictError";
  }
}

function permitSignal(evidence: Array<{ evidenceType: string }>): CompanyListItem["permitSignal"] {
  if (evidence.some((item) => item.evidenceType === "confirmed-sponsor")) return "confirmed";
  if (evidence.some((item) => item.evidenceType === "potentially-qualifying-role")) return "potential";
  return "unknown";
}

function freshness(lastEnrichedAt: string | null): CompanyListItem["freshness"] {
  if (!lastEnrichedAt) return "unknown";
  const timestamp = Date.parse(lastEnrichedAt);
  if (Number.isNaN(timestamp)) return "unknown";
  return Date.now() - timestamp <= 30 * 24 * 60 * 60 * 1000 ? "fresh" : "stale";
}

function strongestConfidence(values: string[]): ConfidenceLevel | null {
  if (values.includes("high")) return "high";
  if (values.includes("medium")) return "medium";
  if (values.includes("low")) return "low";
  return null;
}

async function categoriesFor(ownerId: string, companyId: string): Promise<CompanyCategory[]> {
  const db = getDb();
  const rows = await db
    .select({ category: companyCategories.category })
    .from(companyCategories)
    .where(and(eq(companyCategories.ownerId, ownerId), eq(companyCategories.companyId, companyId)));
  return rows.map((row) => row.category as CompanyCategory);
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

  const [categoryRows, evidenceRows, jobRows, claimRows] = await Promise.all([
    db
      .select({ companyId: companyCategories.companyId, category: companyCategories.category })
      .from(companyCategories)
      .where(eq(companyCategories.ownerId, ownerId)),
    db
      .select({ companyId: permitEvidence.companyId, evidenceType: permitEvidence.evidenceType })
      .from(permitEvidence)
      .where(eq(permitEvidence.ownerId, ownerId)),
    db
      .select({ companyId: jobs.companyId, status: jobs.status })
      .from(jobs)
      .where(eq(jobs.ownerId, ownerId)),
    db
      .select({ companyId: companyClaims.companyId, confidence: companyClaims.confidence, status: companyClaims.status })
      .from(companyClaims)
      .where(eq(companyClaims.ownerId, ownerId)),
  ]);
  const categoriesByCompany = groupRowsByCompanyId(categoryRows);
  const evidenceByCompany = groupRowsByCompanyId(evidenceRows);
  const jobsByCompany = groupRowsByCompanyId(jobRows);
  const claimsByCompany = groupRowsByCompanyId(claimRows);

  const result: CompanyListItem[] = [];
  for (const row of rows) {
    const categories = (categoriesByCompany.get(row.id) ?? []).map((item) => item.category as CompanyCategory);
    if (filters.category && filters.category !== "all" && !categories.includes(filters.category)) {
      continue;
    }
    const evidence = evidenceByCompany.get(row.id) ?? [];
    const signal = permitSignal(evidence);
    const openRoles = (jobsByCompany.get(row.id) ?? []).filter((job) => job.status !== "closed").length;
    const confidence = strongestConfidence((claimsByCompany.get(row.id) ?? []).filter((claim) => claim.status === "current").map((claim) => claim.confidence));
    const rowFreshness = freshness(row.lastEnrichedAt);
    if (filters.permitSignal && filters.permitSignal !== "all" && signal !== filters.permitSignal) continue;
    if (filters.freshness && filters.freshness !== "all" && rowFreshness !== filters.freshness) continue;
    if (filters.confidence && filters.confidence !== "all" && confidence !== filters.confidence) continue;
    if (filters.openRoles === "yes" && openRoles === 0) continue;
    if (filters.openRoles === "no" && openRoles > 0) continue;
    result.push({
      id: row.id,
      name: row.name,
      ...companySheetFields(row.metadataJson),
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
      permitSignal: signal,
      openRoles,
      confidence,
      freshness: rowFreshness,
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
    ...companySheetFields(row.metadataJson),
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
    openRoles: jobsRows.filter((job) => job.status !== "closed").length,
    confidence: strongestConfidence(claimRows.filter((claim) => claim.status === "current").map((claim) => claim.confidence)),
    freshness: freshness(row.lastEnrichedAt),
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

export async function updateCompanyCells(
  ownerId: string,
  companyId: string,
  cells: Record<string, string>,
  collection?: string,
): Promise<CompanyDetail | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(companies)
    .where(and(eq(companies.ownerId, ownerId), eq(companies.id, companyId)))
    .limit(1);
  if (!row) return null;

  const snapshot: CompanyCellSnapshot = {
    name: row.name,
    normalizedName: row.normalizedName,
    domain: row.domain,
    website: row.website,
    aliasesJson: row.aliasesJson,
    description: row.description,
    locality: row.locality,
    locationText: row.locationText,
    employeeBand: row.employeeBand,
    foundedYear: row.foundedYear,
    metadataJson: row.metadataJson,
  };
  const plan = buildCompanyCellUpdatePlan(snapshot, cells, collection);

  if (plan.updates.normalizedName || (plan.updates.domain && plan.updates.domain !== row.domain)) {
    const peers = await db
      .select({ id: companies.id, normalizedName: companies.normalizedName, domain: companies.domain })
      .from(companies)
      .where(eq(companies.ownerId, ownerId));
    const conflict = peers.find((peer) =>
      peer.id !== companyId && (
        (plan.updates.normalizedName !== undefined && peer.normalizedName === plan.updates.normalizedName) ||
        (plan.updates.domain !== undefined && plan.updates.domain !== null && peer.domain === plan.updates.domain)
      ),
    );
    if (conflict) {
      throw new CompanyCellConflictError("Another company already uses that name or website. Choose a unique value or edit the existing company.");
    }
  }

  const now = new Date().toISOString();
  const changed = await db
    .update(companies)
    .set({ ...plan.updates, updatedAt: now })
    .where(and(
      eq(companies.ownerId, ownerId),
      eq(companies.id, companyId),
      eq(companies.metadataJson, row.metadataJson),
      eq(companies.updatedAt, row.updatedAt),
    ))
    .returning({ id: companies.id });
  if (!changed.length) {
    throw new CompanyCellConflictError("This company changed in another tab. Refresh the sheet and retry your edit.");
  }

  if (plan.updateCategories) {
    await db
      .delete(companyCategories)
      .where(and(eq(companyCategories.ownerId, ownerId), eq(companyCategories.companyId, companyId)));
    if (plan.category) {
      await db.insert(companyCategories).values({
        id: `cat_${crypto.randomUUID()}`,
        ownerId,
        companyId,
        category: plan.category,
        confidence: "medium",
        createdAt: now,
        updatedAt: now,
      }).onConflictDoNothing();
    }
  }

  return getCompanyDetail(ownerId, companyId);
}

export async function deleteCompany(ownerId: string, companyId: string): Promise<boolean> {
  const db = getDb();
  const deleted = await db
    .delete(companies)
    .where(and(eq(companies.ownerId, ownerId), eq(companies.id, companyId)))
    .returning({ id: companies.id });
  return deleted.length > 0;
}
