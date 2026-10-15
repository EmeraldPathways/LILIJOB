import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { companies, imports, refreshRuns } from "../../../../../db/schema";
import { userFromRequest, unauthorizedResponse } from "../../../../../lib/auth/require-user";
import { IMPORT_ENRICHMENT_BATCH_SIZE, IMPORT_ENRICHMENT_CONCURRENCY, startImportEnrichment } from "../../../../../lib/import/auto-enrich";
import { buildImportEnrichmentJobs, chunkImportEnrichmentJobs, D1_COMPANY_ID_BATCH_SIZE } from "../../../../../lib/import/enrichment-queue";
import { runStatusForBatch, uniqueDiscoveryCompanyIds } from "../../../../../lib/research/run-worker";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ importId: string }> }) {
  const user = userFromRequest(request);
  if (!user) return unauthorizedResponse();

  const { importId } = await context.params;
  const body = (await request.json().catch(() => ({}))) as { runId?: string; companyIds?: unknown };
  if (typeof body.runId !== "string" || !Array.isArray(body.companyIds) || !body.companyIds.every((value) => typeof value === "string")) {
    return Response.json({ error: { code: "ENRICHMENT_QUEUE_INVALID", message: "runId and companyIds are required." } }, { status: 400 });
  }

  let db: ReturnType<typeof getDb> | undefined;
  try {
    const jobs = buildImportEnrichmentJobs(body.runId, body.companyIds);
    db = getDb();
    const [importRow] = await db.select().from(imports).where(and(eq(imports.ownerId, user.userId), eq(imports.id, importId))).limit(1);
    if (!importRow) return Response.json({ error: { code: "NOT_FOUND", message: "Import not found." } }, { status: 404 });
    if (importRow.runId !== body.runId) return Response.json({ error: { code: "RUN_MISMATCH", message: "Import run does not match." } }, { status: 409 });

    const batches = chunkImportEnrichmentJobs(jobs, D1_COMPANY_ID_BATCH_SIZE);
    const rows: Array<{ id: string }> = [];
    for (const batch of batches) {
      const batchRows = await db
        .select({ id: companies.id })
        .from(companies)
        .where(and(eq(companies.ownerId, user.userId), inArray(companies.id, batch.map((job) => job.companyId))));
      rows.push(...batchRows);
    }
    const validCompanyIds = new Set(rows.map((row) => row.id));
    const companyIds = jobs.map((job) => job.companyId).filter((companyId) => validCompanyIds.has(companyId));
    if (!companyIds.length) {
      const now = new Date().toISOString();
      await db.update(imports).set({ status: "completed", updatedAt: now }).where(and(eq(imports.ownerId, user.userId), eq(imports.id, importId)));
      await db.update(refreshRuns).set({ status: "completed", processed: 0, finishedAt: now, updatedAt: now }).where(and(eq(refreshRuns.ownerId, user.userId), eq(refreshRuns.id, body.runId)));
      return Response.json({ summary: { completed: 0, partial: 0, failed: 0, processed: 0, total: 0, remaining: 0 }, nextCompanyIds: [], done: true }, { status: 202 });
    }

    await db.update(imports).set({ status: "running", updatedAt: new Date().toISOString() }).where(and(eq(imports.ownerId, user.userId), eq(imports.id, importId)));
    const summary = await startImportEnrichment(user.userId, body.runId, companyIds, undefined, {
      maxCompanies: IMPORT_ENRICHMENT_BATCH_SIZE,
      concurrency: IMPORT_ENRICHMENT_CONCURRENCY,
    });
    const nextCompanyIds = companyIds.slice(summary.processed);
    const done = nextCompanyIds.length === 0;
    const [run] = await db.select().from(refreshRuns).where(and(eq(refreshRuns.ownerId, user.userId), eq(refreshRuns.id, body.runId))).limit(1);
    const attemptedCompanyIds = companyIds.slice(0, summary.processed);
    const previousRetryable = cursorIds(run?.cursor ?? null, "retryableCompanyIds").filter((companyId) => !attemptedCompanyIds.includes(companyId));
    const retryableCompanyIds = uniqueDiscoveryCompanyIds([...previousRetryable, ...summary.retryableCompanyIds]);
    const status = runStatusForBatch({
      done,
      previousProcessed: run?.processed ?? 0,
      previousSucceeded: run?.succeeded ?? 0,
      previousFailed: run?.failed ?? 0,
      batchProcessed: summary.processed,
      batchSucceeded: summary.completed,
      batchPartial: summary.partial,
      batchFailed: summary.failed,
    });
    const now = new Date().toISOString();
    await db.update(refreshRuns).set({
      status: done ? status : "running",
      total: run?.total ?? summary.total,
      processed: (run?.processed ?? 0) + summary.processed,
      succeeded: (run?.succeeded ?? 0) + summary.completed,
      failed: (run?.failed ?? 0) + summary.failed,
      cursor: JSON.stringify({ remainingCompanyIds: nextCompanyIds, retryableCompanyIds }),
      startedAt: run?.startedAt ?? now,
      finishedAt: done ? now : null,
      updatedAt: now,
    }).where(and(eq(refreshRuns.ownerId, user.userId), eq(refreshRuns.id, body.runId)));
    await db.update(imports).set({ status: done ? status : "running", updatedAt: now }).where(and(eq(imports.ownerId, user.userId), eq(imports.id, importId)));
    return Response.json({ summary: { ...summary, retryableCompanyIds }, nextCompanyIds, retryableCompanyIds, done }, { status: 202 });
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : "Background enrichment failed.";
    const message = /expected pattern|bound parameter|too many sql variables/i.test(rawMessage)
      ? "Background research could not start. Your file is saved; retry from Imports."
      : rawMessage;
    if (db) {
      const now = new Date().toISOString();
      await db.update(imports).set({ status: "failed", updatedAt: now }).where(and(eq(imports.ownerId, user.userId), eq(imports.id, importId))).catch(() => undefined);
      await db.update(refreshRuns).set({
        status: "failed",
        error: message,
        total: body.companyIds.length,
        cursor: JSON.stringify({ remainingCompanyIds: uniqueDiscoveryCompanyIds(body.companyIds), retryableCompanyIds: [] }),
        updatedAt: now,
      }).where(and(eq(refreshRuns.ownerId, user.userId), eq(refreshRuns.id, body.runId))).catch(() => undefined);
    }
    return Response.json({ error: { code: "ENRICHMENT_FAILED", message } }, { status: 502 });
  }
}

function cursorIds(cursor: string | null, field: "remainingCompanyIds" | "retryableCompanyIds"): string[] {
  if (!cursor) return [];
  try {
    const parsed = JSON.parse(cursor) as Record<string, unknown>;
    const value = parsed[field];
    return Array.isArray(value) ? uniqueDiscoveryCompanyIds(value.filter((item): item is string => typeof item === "string")) : [];
  } catch {
    return [];
  }
}
