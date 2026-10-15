import { and, asc, desc, eq, gte, like, isNotNull } from "drizzle-orm";
import { getDb } from "../../db";
import { companies, jobs, sources } from "../../db/schema";
import { jobDiscoveryRuns, jobSnapshots } from "../../db/schema-v4";
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

export type JobListFilters = { title?: string; location?: string; status?: string; salaryPresent?: boolean; newDays?: number };

export async function listV4Jobs(ownerId: string, filters: JobListFilters = {}) {
  const clauses = [eq(jobs.ownerId, ownerId)];
  if (filters.title?.trim()) clauses.push(like(jobs.title, `%${filters.title.trim().replaceAll("%", "\\%")}%`));
  if (filters.location?.trim()) clauses.push(like(jobs.location, `%${filters.location.trim().replaceAll("%", "\\%")}%`));
  if (filters.status?.trim()) clauses.push(eq(jobs.status, filters.status.trim()));
  if (filters.salaryPresent === true) clauses.push(isNotNull(jobs.salary));
  if (filters.newDays && Number.isFinite(filters.newDays) && filters.newDays > 0) clauses.push(gte(jobs.createdAt, new Date(Date.now() - filters.newDays * 86_400_000).toISOString()));
  return getDb().select({
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
  }).from(jobs).where(and(...clauses)).orderBy(desc(jobs.updatedAt), asc(jobs.title));
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
