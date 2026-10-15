import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../../../db";
import { companies, refreshRuns } from "../../../db/schema";
import { userFromRequest, unauthorizedResponse } from "../../../lib/auth/require-user";
import { startImportEnrichment } from "../../../lib/import/auto-enrich";
import { D1_COMPANY_ID_BATCH_SIZE } from "../../../lib/import/enrichment-queue";
import { runStatusForBatch, uniqueDiscoveryCompanyIds } from "../../../lib/research/run-worker";
import { createRun, enrichCompany } from "../../../lib/research/enrichment-service";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = userFromRequest(request);
  if (!user) return unauthorizedResponse();
  const body = (await request.json()) as { companyId?: string; companyIds?: unknown; runId?: string };
  if (Array.isArray(body.companyIds)) {
    if (!body.companyIds.every((value) => typeof value === "string")) return Response.json({ error: { code: "COMPANY_QUEUE_INVALID", message: "companyIds must contain strings." } }, { status: 400 });
    try {
      const requestedIds = uniqueDiscoveryCompanyIds(body.companyIds);
      const runId = body.runId ?? await createRun(user.userId, "enrichment");
      const db = getDb();
      const validRows: Array<{ id: string }> = [];
      for (let index = 0; index < requestedIds.length; index += D1_COMPANY_ID_BATCH_SIZE) {
        const batch = requestedIds.slice(index, index + D1_COMPANY_ID_BATCH_SIZE);
        if (!batch.length) continue;
        validRows.push(...await db.select({ id: companies.id }).from(companies).where(and(eq(companies.ownerId, user.userId), inArray(companies.id, batch))));
      }
      const validSet = new Set(validRows.map((row) => row.id));
      const companyIds = requestedIds.filter((companyId) => validSet.has(companyId));
      const [run] = await db.select().from(refreshRuns).where(and(eq(refreshRuns.ownerId, user.userId), eq(refreshRuns.id, runId))).limit(1);
      if (!run) return Response.json({ error: { code: "RUN_NOT_FOUND", message: "Enrichment run not found." } }, { status: 404 });
      if (!companyIds.length) return Response.json({ summary: { runId, processed: 0, succeeded: 0, partial: 0, failed: 0, nextCompanyIds: [], done: true }, status: 202 });
      const summary = await startImportEnrichment(user.userId, runId, companyIds, undefined, { maxCompanies: 1, concurrency: 1 });
      const nextCompanyIds = companyIds.slice(summary.processed);
      const done = nextCompanyIds.length === 0;
      const previousRetryable = cursorIds(run.cursor, "retryableCompanyIds").filter((companyId) => !companyIds.slice(0, summary.processed).includes(companyId));
      const retryableCompanyIds = uniqueDiscoveryCompanyIds([...previousRetryable, ...summary.retryableCompanyIds]);
      const status = runStatusForBatch({
        done,
        previousProcessed: run.processed ?? 0,
        previousSucceeded: run.succeeded ?? 0,
        previousFailed: run.failed ?? 0,
        batchProcessed: summary.processed,
        batchSucceeded: summary.completed,
        batchPartial: summary.partial,
        batchFailed: summary.failed,
      });
      const now = new Date().toISOString();
      await db.update(refreshRuns).set({ status, total: run.total || summary.total, processed: (run.processed ?? 0) + summary.processed, succeeded: (run.succeeded ?? 0) + summary.completed, failed: (run.failed ?? 0) + summary.failed, cursor: JSON.stringify({ remainingCompanyIds: nextCompanyIds, retryableCompanyIds }), finishedAt: done ? now : null, updatedAt: now }).where(and(eq(refreshRuns.ownerId, user.userId), eq(refreshRuns.id, runId)));
      return Response.json({ summary: { ...summary, runId, nextCompanyIds, retryableCompanyIds, done }, status: 202 });
    } catch (error) {
      return Response.json({ error: { code: "ENRICHMENT_FAILED", message: error instanceof Error ? error.message : "Enrichment failed." } }, { status: 502 });
    }
  }
  if (!body.companyId) return Response.json({ error: { code: "COMPANY_REQUIRED", message: "companyId is required." } }, { status: 400 });
  let runId: string | undefined;
  try {
    runId = body.runId ?? await createRun(user.userId, "enrichment", body.companyId);
    const db = getDb();
    const [run] = await db.select().from(refreshRuns).where(and(eq(refreshRuns.ownerId, user.userId), eq(refreshRuns.id, runId))).limit(1);
    if (!run) return Response.json({ error: { code: "RUN_NOT_FOUND", message: "Enrichment run not found." } }, { status: 404 });
    const startedAt = new Date().toISOString();
    await db.update(refreshRuns).set({ status: "running", total: 1, startedAt: run.startedAt ?? startedAt, updatedAt: startedAt, error: null }).where(and(eq(refreshRuns.ownerId, user.userId), eq(refreshRuns.id, runId)));

    const summary = await enrichCompany(user.userId, body.companyId, runId);
    const finishedAt = new Date().toISOString();
    await db.update(refreshRuns).set({
      status: summary.status,
      total: 1,
      processed: 1,
      succeeded: summary.status === "completed" ? 1 : 0,
      failed: summary.status === "failed" ? 1 : 0,
      error: summary.error ?? null,
      finishedAt,
      updatedAt: finishedAt,
    }).where(and(eq(refreshRuns.ownerId, user.userId), eq(refreshRuns.id, runId)));
    return Response.json({ summary }, { status: summary.status === "failed" ? 502 : 200 });
  } catch (error) {
    if (runId) {
      try {
        const now = new Date().toISOString();
        await getDb().update(refreshRuns).set({ status: "failed", total: 1, processed: 1, succeeded: 0, failed: 1, error: error instanceof Error ? error.message : "Enrichment failed.", finishedAt: now, updatedAt: now }).where(and(eq(refreshRuns.ownerId, user.userId), eq(refreshRuns.id, runId)));
      } catch {
        // Return the enrichment failure even if run finalization also fails.
      }
    }
    return Response.json({ error: { code: "ENRICHMENT_FAILED", message: error instanceof Error ? error.message : "Enrichment failed." } }, { status: 502 });
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
