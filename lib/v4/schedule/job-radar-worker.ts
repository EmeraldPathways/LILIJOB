import { and, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { companies, sources } from "../../../db/schema";
import { collectPublicCompanyData, persistOfficialPublicFindings } from "../collection";
import { discoverOfficialCareerPageWithContent } from "../job-radar";
import { finishJobDiscoveryRun, persistDiscoveredJobs, startJobDiscoveryRun, updateJobDiscoveryCheckpoint } from "../job-repository";
import { allowedHostsForCompanySource, companyCareerSourceUrl, isEligibleCareerSourceUrl, isSavedCompanyPublicSource } from "../source-scope";
import type { ScheduledCompanyOutcome } from "./job-radar-schedule";

/** Runs one explicitly selected company's saved public source with a fixed, zero-cost budget. */
export async function runScheduledJobRadarCompany(ownerId: string, companyId: string): Promise<ScheduledCompanyOutcome> {
  const db = getDb();
  const [company] = await db.select({ id: companies.id, ownerId: companies.ownerId, website: companies.website, domain: companies.domain, metadataJson: companies.metadataJson })
    .from(companies).where(and(eq(companies.ownerId, ownerId), eq(companies.id, companyId))).limit(1);
  if (!company) return { status: "unavailable", jobsFound: 0, contactsFound: 0, signalsFound: 0, error: "Selected company is unavailable to this owner." };
  const savedSources = await db.select({ url: sources.url, sourceType: sources.sourceType, provider: sources.provider })
    .from(sources).where(and(eq(sources.ownerId, ownerId), eq(sources.companyId, companyId)));
  const sourceUrl = companyCareerSourceUrl(company, savedSources);
  if (!sourceUrl || !isSavedCompanyPublicSource(company, savedSources, sourceUrl) || !isEligibleCareerSourceUrl(sourceUrl)) {
    return { status: "unavailable", jobsFound: 0, contactsFound: 0, signalsFound: 0, error: "Save an eligible official website or careers URL before scheduling this company." };
  }

  const checkedAt = new Date().toISOString();
  const runId = await startJobDiscoveryRun(ownerId, {
    type: "scheduled-company",
    companyId,
    budget: { maxSources: 1, maxRoleDetails: 3, paidApiCostCents: 0 },
  }, [sourceUrl]);
  await updateJobDiscoveryCheckpoint(ownerId, runId, { phase: "fetching", sourceUrl, sourceIndex: 0, sourceBudget: 1, maxRoleDetails: 3 });

  const discovery = await discoverOfficialCareerPageWithContent(sourceUrl, fetch, checkedAt, {
    allowedHosts: allowedHostsForCompanySource(company, sourceUrl),
    maxRolePages: 3,
  });
  const result = discovery.result;
  let persisted = { found: false, jobsCreated: 0, snapshotsCreated: 0, sourcesCreated: 0 };
  let contactsFound = 0;
  let signalsFound = 0;
  let collectionError: string | undefined;

  if (["supported", "partial", "empty"].includes(result.status)) {
    persisted = await persistDiscoveredJobs(ownerId, companyId, result);
  }
  const landingPage = discovery.fetchedPages[0];
  if (landingPage) {
    try {
      const findings = await persistOfficialPublicFindings(ownerId, {
        companyId,
        companyDomain: company.domain,
        sourceUrl: landingPage.sourceUrl,
        html: landingPage.body,
        checkedAt,
      });
      contactsFound = findings.contacts.length;
      signalsFound = findings.signals.length;
    } catch (error) {
      collectionError = error instanceof Error ? error.message : "Public contact and signal collection failed.";
    }
  }

  const status = result.status === "partial" ? "partial"
    : result.status === "source-blocked" ? "blocked"
      : ["error", "stale", "unsupported"].includes(result.status) ? "unavailable"
        : "completed";
  const error = [result.error, collectionError].filter(Boolean).join(" ") || undefined;
  await updateJobDiscoveryCheckpoint(ownerId, runId, {
    phase: "complete",
    sourceUrl: result.sourceUrl,
    sourceStatus: result.status,
    processedSources: 1,
    sourceBudget: 1,
    roleDetailsBudget: 3,
    fetchedPages: discovery.fetchedPages.length,
    snapshotsCreated: persisted.snapshotsCreated,
    contactsFound,
    signalsFound,
    collectionStatus: landingPage ? collectionError ? "partial" : "collected" : "unavailable",
  });
  await finishJobDiscoveryRun(ownerId, runId, { ...result, ...(error ? { error } : {}) }, persisted.snapshotsCreated, 0);
  return {
    status: collectionError && status === "completed" ? "partial" : status,
    jobsFound: result.jobs.length,
    contactsFound,
    signalsFound,
    ...(error ? { error } : {}),
  };
}

/** Manual collection uses the same owner and saved-source checks as the scheduled worker. */
export async function collectSavedPublicCompanyPage(ownerId: string, companyId: string, sourceUrl: string) {
  return collectPublicCompanyData(ownerId, companyId, sourceUrl);
}
