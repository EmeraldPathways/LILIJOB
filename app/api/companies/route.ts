import { and, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { companyCategories, companies } from "../../../db/schema";
import { normalizeCompanyIdentity, normalizeDublinLocality } from "../../../lib/domain/normalize";
import { COMPANY_CATEGORIES, type CompanyCategory } from "../../../lib/domain/types";
import type { CompanyFilters } from "../../../lib/repositories/company-repository";
import { userFromRequest, unauthorizedResponse } from "../../../lib/auth/require-user";
import { listCompanies } from "../../../lib/repositories/company-repository";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = userFromRequest(request);
  if (!user) return unauthorizedResponse();

  const url = new URL(request.url);
  const category = url.searchParams.get("category") ?? "all";
  const locality = url.searchParams.get("locality") ?? "all";
  const query = url.searchParams.get("q") ?? undefined;
  const status = url.searchParams.get("status") ?? undefined;

  try {
    const companies = await listCompanies(user.userId, {
      category: category as CompanyFilters["category"],
      locality: locality as CompanyFilters["locality"],
      query,
      status,
    });
    return Response.json({ companies });
  } catch (error) {
    return Response.json(
      { error: { code: "COMPANY_LIST_FAILED", message: error instanceof Error ? error.message : "Unable to load companies." } },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const user = userFromRequest(request);
  if (!user) return unauthorizedResponse();

  try {
    const body = (await request.json()) as {
      name?: string;
      website?: string;
      location?: string;
      category?: CompanyCategory;
    };
    if (!body.name?.trim()) {
      return Response.json({ error: { code: "INVALID_COMPANY", message: "Company name is required." } }, { status: 400 });
    }
    const identity = normalizeCompanyIdentity({ companyName: body.name, website: body.website, location: body.location });
    const db = getDb();
    const id = `co_${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    await db.insert(companies).values({
      id,
      ownerId: user.userId,
      name: identity.name,
      normalizedName: identity.normalizedName,
      domain: identity.domain,
      website: body.website ?? null,
      locationText: body.location ?? null,
      locality: normalizeDublinLocality(body.location),
      aliasesJson: JSON.stringify(identity.aliases),
      metadataJson: "{}",
      enrichmentStatus: "queued",
      createdAt: now,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: [companies.ownerId, companies.normalizedName],
      set: { website: body.website ?? null, locationText: body.location ?? null, updatedAt: now },
    });
    const [company] = await db.select({ id: companies.id }).from(companies).where(and(eq(companies.ownerId, user.userId), eq(companies.normalizedName, identity.normalizedName))).limit(1);
    if (body.category && (COMPANY_CATEGORIES as readonly string[]).includes(body.category) && company) {
      await db.insert(companyCategories).values({ id: `cat_${crypto.randomUUID()}`, ownerId: user.userId, companyId: company.id, category: body.category, confidence: "medium", createdAt: now, updatedAt: now }).onConflictDoNothing();
    }
    return Response.json({ id: company?.id ?? id }, { status: 201 });
  } catch (error) {
    return Response.json({ error: { code: "COMPANY_CREATE_FAILED", message: error instanceof Error ? error.message : "Unable to create company." } }, { status: 500 });
  }
}
