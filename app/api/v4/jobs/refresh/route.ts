import { and, eq } from "drizzle-orm";
import { userFromRequest, unauthorizedResponse } from "../../../../../lib/auth/require-user";
import { getDb } from "../../../../../db";
import { companies, sources } from "../../../../../db/schema";
import { discoverOfficialCareerPage } from "../../../../../lib/v4/job-radar";
import { finishJobDiscoveryRun, getJobDiscoveryRun, persistDiscoveredJobs, startJobDiscoveryRun, updateJobDiscoveryCheckpoint } from "../../../../../lib/v4/job-repository";
import { allowedHostsForCompanySource, companyCareerSourceUrl, isEligibleCareerSourceUrl, isSavedCompanyPublicSource } from "../../../../../lib/v4/source-scope";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = userFromRequest(request);
  if (!user) return unauthorizedResponse();
  const body = await request.json().catch(() => null) as { companyId?: unknown; sourceUrl?: unknown } | null;
  if (!body || typeof body.companyId !== "string" || !body.companyId.trim()) return Response.json({ error: { code: "INVALID_REFRESH", message: "A company ID is required." } }, { status: 400 });
  const companyId = body.companyId.trim();
  const [company] = await getDb().select({ id: companies.id, metadataJson: companies.metadataJson, website: companies.website, domain: companies.domain }).from(companies).where(and(eq(companies.ownerId, user.userId), eq(companies.id, companyId))).limit(1);
  if (!company) return Response.json({ error: { code: "NOT_FOUND", message: "Company not found." } }, { status: 404 });
  const savedSources = await getDb().select({ url: sources.url, sourceType: sources.sourceType, provider: sources.provider }).from(sources).where(and(eq(sources.ownerId, user.userId), eq(sources.companyId, companyId)));
  const sourceUrl = typeof body.sourceUrl === "string" && body.sourceUrl.trim() ? body.sourceUrl.trim() : companyCareerSourceUrl(company, savedSources);
  if (!sourceUrl) return Response.json({ error: { code: "CAREER_URL_REQUIRED", message: "Save an official careers URL before refreshing jobs." } }, { status: 400 });
  if (!isSavedCompanyPublicSource(company, savedSources, sourceUrl) || !isEligibleCareerSourceUrl(sourceUrl)) {
    return Response.json({ error: { code: "UNSAVED_CAREER_SOURCE", message: "Choose a saved company website or careers URL. Domain-sale and partner pages cannot be used as Job Radar sources." } }, { status: 400 });
  }

  // Official career refresh is deliberately capped at one public source per request and uses no paid search API.
  const runId = await startJobDiscoveryRun(user.userId, { type: "company", companyId, budget: { maxSources: 1, paidApiCostCents: 0 } }, [sourceUrl]);
  await updateJobDiscoveryCheckpoint(user.userId, runId, { phase: "fetching", sourceUrl, sourceIndex: 0, sourceBudget: 1 });
  const result = await discoverOfficialCareerPage(sourceUrl, undefined, undefined, { allowedHosts: allowedHostsForCompanySource(company, sourceUrl) });
  const currentRun = await getJobDiscoveryRun(user.userId, runId);
  if (!currentRun || currentRun.status === "cancelled") return Response.json({ runId, cancelled: true, result, persisted: { found: false, jobsCreated: 0, snapshotsCreated: 0, sourcesCreated: 0 } }, { status: 202 });
  const persisted = await persistDiscoveredJobs(user.userId, companyId, result);
  await updateJobDiscoveryCheckpoint(user.userId, runId, { phase: "complete", sourceUrl: result.sourceUrl, sourceStatus: result.status, processedSources: 1, sourceBudget: 1, snapshotsCreated: persisted.snapshotsCreated });
  await finishJobDiscoveryRun(user.userId, runId, result, persisted.snapshotsCreated);
  return Response.json({ runId, result, persisted });
}
