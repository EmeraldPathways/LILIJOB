import { and, asc, desc, eq, exists, gte, like, isNotNull, lt, or, sql } from "drizzle-orm";
import { getDb } from "../../db";
import { companies, companyCategories, jobs, sources } from "../../db/schema";
import { jobDiscoveryRuns, jobMatches, jobSnapshots } from "../../db/schema-v4";
import { parsePublishedSalary } from "./salary";
import type { DiscoveredJob, JobRadarResult } from "./job-radar";

function now(): string {
  return new Date().toISOString();
}

function canonicalUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = "";
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    return url.toString();
  } catch {
    return value.trim();
  }
}

async function contentHash(job: DiscoveredJob): Promise<string> {
  const source = JSON.stringify({ title: job.title, url: canonicalUrl(job.url), description: job.description, location: job.location, workModel: job.workModel, employmentType: job.employmentType, salary: job.salary, postedAt: job.postedAt });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export type JobListFilters = {
  title?: string;
  titleFamily?: string;
  location?: string;
  locality?: string;
  workModel?: string;
  sector?: string;
  status?: string;
  salaryPresent?: boolean;
  salaryMin?: number;
  salaryMax?: number;
  fitMin?: number;
  profileId?: string;
  newDays?: number;
  limit?: number;
  cursor?: string;
};

const TITLE_FAMILY_TERMS: Record<string, string[]> = {
  product: ["product", "product manager", "product marketing"],
  growth: ["growth", "marketing", "demand", "acquisition"],
  ecommerce: ["e-commerce", "ecommerce", "commerce", "marketplace"],
  ai: ["ai", "artificial intelligence", "machine learning", "ml"],
  solutions: ["solutions", "consulting", "implementation", "customer success"],
};

function decodeCursor(value: string | undefined): { updatedAt: string; id: string } | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(value)) as { updatedAt?: unknown; id?: unknown };
    return typeof parsed.updatedAt === "string" && typeof parsed.id === "string" ? { updatedAt: parsed.updatedAt, id: parsed.id } : null;
  } catch {
    return null;
  }
}

function encodeCursor(updatedAt: string, id: string): string {
  return encodeURIComponent(JSON.stringify({ updatedAt, id }));
}

export async function listV4JobsPage(ownerId: string, filters: JobListFilters = {}) {
  const clauses = [eq(jobs.ownerId, ownerId)];
  if (filters.title?.trim()) clauses.push(like(jobs.title, `%${filters.title.trim().replaceAll("%", "\\%")}%`));
  if (filters.location?.trim()) clauses.push(like(jobs.location, `%${filters.location.trim().replaceAll("%", "\\%")}%`));
  if (filters.status?.trim()) clauses.push(eq(jobs.status, filters.status.trim()));
  if (filters.salaryPresent === true) clauses.push(isNotNull(jobs.salary));
  if (filters.newDays && Number.isFinite(filters.newDays) && filters.newDays > 0) clauses.push(gte(jobs.createdAt, new Date(Date.now() - filters.newDays * 86_400_000).toISOString()));
  if (filters.locality?.trim()) clauses.push(like(jobs.location, `%${filters.locality.trim().replaceAll("%", "\\%")}%`));
  if (filters.workModel?.trim()) clauses.push(exists(getDb().select({ id: jobSnapshots.id }).from(jobSnapshots).where(and(eq(jobSnapshots.ownerId, ownerId), eq(jobSnapshots.jobId, jobs.id), like(jobSnapshots.workModel, `%${filters.workModel.trim().replaceAll("%", "\\%")}%`)))));
  if (filters.sector?.trim()) clauses.push(exists(getDb().select({ id: companyCategories.id }).from(companyCategories).where(and(eq(companyCategories.ownerId, ownerId), eq(companyCategories.companyId, jobs.companyId), eq(companyCategories.category, filters.sector.trim() as typeof companyCategories.$inferSelect.category)))));
  const familyTerms = filters.titleFamily?.trim().toLowerCase() ? TITLE_FAMILY_TERMS[filters.titleFamily.trim().toLowerCase()] : undefined;
  if (familyTerms?.length) clauses.push(or(...familyTerms.map((term) => like(jobs.title, `%${term.replaceAll("%", "\\%")}%`)))!);
  if (filters.fitMin !== undefined && Number.isFinite(filters.fitMin)) {
    const score = Math.max(0, Math.min(100, Math.floor(filters.fitMin)));
    const matchClauses = [eq(jobMatches.ownerId, ownerId), eq(jobMatches.jobId, jobs.id), gte(jobMatches.score, score), eq(jobMatches.dismissed, false)];
    if (filters.profileId?.trim()) matchClauses.push(eq(jobMatches.profileId, filters.profileId.trim()));
    clauses.push(exists(getDb().select({ id: jobMatches.id }).from(jobMatches).where(and(...matchClauses))));
  }
  const cursor = decodeCursor(filters.cursor);
  if (cursor) clauses.push(or(lt(jobs.updatedAt, cursor.updatedAt), and(eq(jobs.updatedAt, cursor.updatedAt), sql`${jobs.id} > ${cursor.id}`))!);
  const limit = Math.max(1, Math.min(100, Math.floor(filters.limit ?? 50)));
  const rows = await getDb().select({
    id: jobs.id,
    companyId: jobs.companyId,
    title: jobs.title,
    url: jobs.url,
    location: jobs.location,
    employmentType: jobs.employmentType,
    salary: jobs.salary,
    postedAt: jobs.postedAt,
    status: jobs.status,
    sourceId: jobs.sourceId,
    confidence: jobs.confidence,
    updatedAt: jobs.updatedAt,
    companyName: companies.name,
  }).from(jobs).innerJoin(companies, and(eq(companies.ownerId, ownerId), eq(companies.id, jobs.companyId))).where(and(...clauses)).orderBy(desc(jobs.updatedAt), asc(jobs.id)).limit(limit + 1);
  const hasNext = rows.length > limit;
  const page = (hasNext ? rows.slice(0, limit) : rows).filter((row) => {
    if (filters.salaryMin === undefined && filters.salaryMax === undefined) return true;
    const parsed = parsePublishedSalary(row.salary, null);
    if (!parsed || parsed.period !== "year") return false;
    if (filters.salaryMin !== undefined && parsed.max < filters.salaryMin) return false;
    if (filters.salaryMax !== undefined && parsed.min > filters.salaryMax) return false;
    return true;
  });
  return {
    jobs: page,
    nextCursor: hasNext && rows.length ? encodeCursor(rows[rows.length - 1].updatedAt, rows[rows.length - 1].id) : null,
  };
}

/** Backward-compatible list used by agent and dashboard callers that do not paginate. */
export async function listV4Jobs(ownerId: string, filters: JobListFilters = {}) {
  return (await listV4JobsPage(ownerId, { ...filters, limit: filters.limit ?? 100 })).jobs;
}

export async function getV4Job(ownerId: string, jobId: string) {
  const db = getDb();
  const [job] = await db.select().from(jobs).where(and(eq(jobs.ownerId, ownerId), eq(jobs.id, jobId))).limit(1);
  if (!job) return null;
  const snapshots = await db.select().from(jobSnapshots).where(and(eq(jobSnapshots.ownerId, ownerId), eq(jobSnapshots.jobId, jobId))).orderBy(desc(jobSnapshots.lastSeenAt));
  return { job, snapshots };
}

export async function startJobDiscoveryRun(ownerId: string, scope: unknown, sourcesQueried: string[] = []) {
  const timestamp = now();
  const id = `job_run_${crypto.randomUUID()}`;
  await getDb().insert(jobDiscoveryRuns).values({
    id,
    ownerId,
    scopeJson: JSON.stringify(scope ?? {}),
    sourcesJson: JSON.stringify(sourcesQueried),
    status: "running",
    startedAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  return id;
}

export async function getJobDiscoveryRun(ownerId: string, runId: string) {
  const [run] = await getDb().select().from(jobDiscoveryRuns).where(and(eq(jobDiscoveryRuns.ownerId, ownerId), eq(jobDiscoveryRuns.id, runId))).limit(1);
  return run ?? null;
}

export async function listJobDiscoveryRuns(ownerId: string, limit = 25) {
  return getDb().select().from(jobDiscoveryRuns).where(eq(jobDiscoveryRuns.ownerId, ownerId)).orderBy(desc(jobDiscoveryRuns.createdAt)).limit(Math.max(1, Math.min(100, limit)));
}

export async function updateJobDiscoveryCheckpoint(ownerId: string, runId: string, checkpoint: unknown) {
  const timestamp = now();
  const run = await getJobDiscoveryRun(ownerId, runId);
  if (!run || run.status !== "running") return false;
  await getDb().update(jobDiscoveryRuns).set({ checkpointJson: JSON.stringify(checkpoint ?? {}), updatedAt: timestamp }).where(and(eq(jobDiscoveryRuns.ownerId, ownerId), eq(jobDiscoveryRuns.id, runId), eq(jobDiscoveryRuns.status, "running")));
  return true;
}

export async function cancelJobDiscoveryRun(ownerId: string, runId: string) {
  const timestamp = now();
  const run = await getJobDiscoveryRun(ownerId, runId);
  if (!run || !["queued", "running"].includes(run.status)) return false;
  await getDb().update(jobDiscoveryRuns).set({ status: "cancelled", error: "Cancelled by the user.", finishedAt: timestamp, updatedAt: timestamp }).where(and(eq(jobDiscoveryRuns.ownerId, ownerId), eq(jobDiscoveryRuns.id, runId), eq(jobDiscoveryRuns.status, run.status)));
  return true;
}

export async function retryJobDiscoveryRun(ownerId: string, runId: string) {
  const run = await getJobDiscoveryRun(ownerId, runId);
  if (!run || !["failed", "partial", "cancelled"].includes(run.status)) return null;
  let scope: unknown = {};
  let sources: string[] = [];
  try { scope = JSON.parse(run.scopeJson) as unknown; } catch { /* preserve with empty safe scope */ }
  try {
    const parsed = JSON.parse(run.sourcesJson) as unknown;
    if (Array.isArray(parsed)) sources = parsed.filter((value): value is string => typeof value === "string");
  } catch { /* preserve with no external sources */ }
  const checkpoint = (() => { try { return JSON.parse(run.checkpointJson) as unknown; } catch { return {}; } })();
  return startJobDiscoveryRun(ownerId, { ...((scope && typeof scope === "object" && !Array.isArray(scope)) ? scope as Record<string, unknown> : {}), retryOf: runId, previousCheckpoint: checkpoint }, sources);
}

export async function finishJobDiscoveryRun(ownerId: string, runId: string, result: Pick<JobRadarResult, "status" | "jobs" | "error">, changesCount: number, costCents = 0) {
  const timestamp = now();
  await getDb().update(jobDiscoveryRuns).set({
    status: result.status === "error" || result.status === "unsupported" || result.status === "source-blocked" ? "failed" : result.status === "stale" || result.status === "partial" ? "partial" : "completed",
    resultCount: result.jobs.length,
    changesCount,
    apiCostCents: costCents,
    error: result.error ?? null,
    finishedAt: timestamp,
    updatedAt: timestamp,
  }).where(and(eq(jobDiscoveryRuns.ownerId, ownerId), eq(jobDiscoveryRuns.id, runId), eq(jobDiscoveryRuns.status, "running")));
}

export async function persistDiscoveredJobs(ownerId: string, companyId: string, result: JobRadarResult) {
  const db = getDb();
  const [company] = await db.select({ id: companies.id }).from(companies).where(and(eq(companies.ownerId, ownerId), eq(companies.id, companyId))).limit(1);
  if (!company) return { found: false, jobsCreated: 0, snapshotsCreated: 0, sourcesCreated: 0 };
  const timestamp = now();
  let jobsCreated = 0;
  let snapshotsCreated = 0;
  let sourcesCreated = 0;
  const existingJobs = await db.select().from(jobs).where(and(eq(jobs.ownerId, ownerId), eq(jobs.companyId, companyId)));
  const returnedKeys = new Set(result.jobs.map((job) => `${job.title.trim().toLowerCase()}|${canonicalUrl(job.url)}`));

  for (const discovered of result.jobs) {
    const url = canonicalUrl(discovered.url);
    const [existingSource] = await db.select().from(sources).where(and(eq(sources.ownerId, ownerId), eq(sources.normalizedUrl, url))).limit(1);
    let sourceId = existingSource?.id;
    if (!sourceId) {
      sourceId = `source_${crypto.randomUUID()}`;
      await db.insert(sources).values({
        id: sourceId,
        ownerId,
        companyId,
        url,
        normalizedUrl: url,
        title: discovered.title,
        snippet: discovered.description,
        provider: "official-careers",
        sourceType: "official-careers",
        retrievedAt: result.checkedAt,
        checkedAt: result.checkedAt,
        status: "ok",
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      sourcesCreated += 1;
    }

    const [existingJob] = await db.select().from(jobs).where(and(
      eq(jobs.ownerId, ownerId),
      eq(jobs.companyId, companyId),
      eq(jobs.title, discovered.title),
      eq(jobs.url, url),
    )).limit(1);
    const jobId = existingJob?.id ?? `job_${crypto.randomUUID()}`;
    if (!existingJob) {
      await db.insert(jobs).values({
        id: jobId,
        ownerId,
        companyId,
        title: discovered.title,
        url,
        location: discovered.location,
        employmentType: discovered.employmentType,
        salary: discovered.salary,
        postedAt: discovered.postedAt,
        status: "open",
        sourceId,
        confidence: discovered.verified ? "high" : "low",
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      jobsCreated += 1;
    } else {
      await db.update(jobs).set({ status: "open", sourceId, location: discovered.location, employmentType: discovered.employmentType, salary: discovered.salary, postedAt: discovered.postedAt, confidence: discovered.verified ? "high" : "low", updatedAt: timestamp }).where(and(eq(jobs.ownerId, ownerId), eq(jobs.id, jobId)));
    }

    const hash = await contentHash(discovered);
    const [snapshot] = await db.select().from(jobSnapshots).where(and(eq(jobSnapshots.ownerId, ownerId), eq(jobSnapshots.jobId, jobId), eq(jobSnapshots.contentHash, hash))).limit(1);
    if (snapshot) {
      await db.update(jobSnapshots).set({ lastSeenAt: result.checkedAt, state: "current", updatedAt: timestamp }).where(and(eq(jobSnapshots.ownerId, ownerId), eq(jobSnapshots.id, snapshot.id)));
    } else {
      await db.insert(jobSnapshots).values({
        id: `snapshot_${crypto.randomUUID()}`,
        ownerId,
        jobId,
        contentHash: hash,
        description: discovered.description,
        payRange: discovered.salary,
        currency: null,
        requirementsJson: "[]",
        function: null,
        seniority: null,
        location: discovered.location,
        workModel: discovered.workModel,
        postedAt: discovered.postedAt,
        firstSeenAt: discovered.firstSeenAt || result.checkedAt,
        lastSeenAt: discovered.lastConfirmedAt || result.checkedAt,
        sourceId,
        state: discovered.verified ? "current" : "discovered",
        diffJson: "{}",
        extractionConfidence: discovered.verified ? "high" : "low",
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      snapshotsCreated += 1;
    }
  }

  // Only a successful, supported feed can contribute evidence that a previously
  // observed role is absent. One miss records an unverified state; a second
  // comparable miss closes it. Provider errors, blocks, empty pages and partial
  // anchor discovery preserve the last open record.
  if (result.status === "supported") {
    for (const existingJob of existingJobs) {
      const key = `${existingJob.title.trim().toLowerCase()}|${existingJob.url ? canonicalUrl(existingJob.url) : ""}`;
      if (returnedKeys.has(key)) continue;
      const [latest] = await db.select().from(jobSnapshots).where(and(eq(jobSnapshots.ownerId, ownerId), eq(jobSnapshots.jobId, existingJob.id))).orderBy(desc(jobSnapshots.lastSeenAt)).limit(1);
      if (!latest) continue;
      let diff: Record<string, unknown> = {};
      try {
        const parsed = JSON.parse(latest.diffJson) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) diff = parsed as Record<string, unknown>;
      } catch {
        diff = {};
      }
      const missingChecks = typeof diff.missingChecks === "number" && Number.isFinite(diff.missingChecks) ? diff.missingChecks + 1 : 1;
      const state = missingChecks >= 2 ? "removed" : "unverified";
      await db.update(jobSnapshots).set({ state, diffJson: JSON.stringify({ ...diff, missingChecks, lastMissingAt: result.checkedAt }), updatedAt: timestamp }).where(and(eq(jobSnapshots.ownerId, ownerId), eq(jobSnapshots.id, latest.id)));
      if (missingChecks >= 2) await db.update(jobs).set({ status: "closed", updatedAt: timestamp }).where(and(eq(jobs.ownerId, ownerId), eq(jobs.id, existingJob.id)));
    }
  }
  return { found: true, jobsCreated, snapshotsCreated, sourcesCreated };
}
