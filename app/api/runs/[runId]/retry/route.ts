import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { imports, refreshRuns } from "../../../../../db/schema";
import { userFromRequest, unauthorizedResponse } from "../../../../../lib/auth/require-user";
import { IMPORT_ENRICHMENT_BATCH_SIZE, IMPORT_ENRICHMENT_CONCURRENCY, startImportEnrichment } from "../../../../../lib/import/auto-enrich";
import { recoverImportCompanyIds } from "../../../../../lib/import/import-service";
import { refreshExisting, runStatusForBatch, uniqueDiscoveryCompanyIds } from "../../../../../lib/research/run-worker";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ runId: string }> }) {
  const user = userFromRequest(request);
  if (!user) return unauthorizedResponse();
  const { runId } = await context.params;
  const db = getDb();
  const [run] = await db.select().from(refreshRuns).where(and(eq(refreshRuns.ownerId, user.userId), eq(refreshRuns.id, runId))).limit(1);
  if (!run) return Response.json({ error: { code: "RUN_NOT_FOUND", message: "Run not found." } }, { status: 404 });
  const cursor = parseCursor(run.cursor);

  try {
    let remaining = uniqueDiscoveryCompanyIds([...cursor.remainingCompanyIds, ...cursor.retryableCompanyIds]);
    if (!remaining.length && run.kind === "import-enrichment") {
      const [importRow] = await db.select({ id: imports.id, fileKey: imports.fileKey, fileName: imports.fileName }).from(imports).where(and(eq(imports.ownerId, user.userId), eq(imports.runId, runId))).limit(1);
      if (importRow) {
        remaining = await recoverImportCompanyIds(importRow.fileKey, importRow.fileName, user.userId);
        if (remaining.length) {
          await db.update(refreshRuns).set({ total: remaining.length, cursor: JSON.stringify({ remainingCompanyIds: remaining, retryableCompanyIds: [] }), updatedAt: new Date().toISOString() }).where(and(eq(refreshRuns.ownerId, user.userId), eq(refreshRuns.id, runId)));
        }
      }
    }
    if (!remaining.length) return Response.json({ error: { code: "RUN_NOT_RETRYABLE", message: "This run has no remaining queued items." } }, { status: 409 });

    if (run.kind === "refresh") {
      const summary = await refreshExisting(user.userId, { runId, companyIds: remaining, category: (run.category as "all" | undefined) ?? "all" });
      return Response.json({ summary }, { status: 202 });
    }

    const summary = await startImportEnrichment(user.userId, runId, remaining, undefined, { maxCompanies: IMPORT_ENRICHMENT_BATCH_SIZE, concurrency: IMPORT_ENRICHMENT_CONCURRENCY });
    const nextCompanyIds = remaining.slice(summary.processed);
    const done = nextCompanyIds.length === 0;
    const attemptedCompanyIds = remaining.slice(0, summary.processed);
    const retryableCompanyIds = uniqueDiscoveryCompanyIds([
      ...cursor.retryableCompanyIds.filter((companyId) => !attemptedCompanyIds.includes(companyId)),
      ...summary.retryableCompanyIds,
    ]);
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
    if (run.kind === "import-enrichment") {
      const [importRow] = await db.select({ id: imports.id }).from(imports).where(and(eq(imports.ownerId, user.userId), eq(imports.runId, runId))).limit(1);
      if (importRow) await db.update(imports).set({ status, updatedAt: now }).where(and(eq(imports.ownerId, user.userId), eq(imports.id, importRow.id)));
    }
    return Response.json({ summary: { ...summary, nextCompanyIds, retryableCompanyIds, done } }, { status: 202 });
  } catch (error) {
    return Response.json({ error: { code: "RUN_RETRY_FAILED", message: error instanceof Error ? error.message : "Run retry failed." } }, { status: 502 });
  }
}

function parseCursor(cursor: string | null): { remainingCompanyIds: string[]; retryableCompanyIds: string[] } {
  if (!cursor) return { remainingCompanyIds: [], retryableCompanyIds: [] };
  try {
    const value = JSON.parse(cursor) as { remainingCompanyIds?: unknown; retryableCompanyIds?: unknown };
    const read = (input: unknown) => Array.isArray(input) ? input.filter((id): id is string => typeof id === "string" && Boolean(id.trim())) : [];
    return { remainingCompanyIds: read(value.remainingCompanyIds), retryableCompanyIds: read(value.retryableCompanyIds) };
  } catch {
    return { remainingCompanyIds: [], retryableCompanyIds: [] };
  }
}
