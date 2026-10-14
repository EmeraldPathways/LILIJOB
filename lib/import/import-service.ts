import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { getDb } from "../../db";
import {
  companyCategories,
  companies,
  imports,
  refreshRuns,
} from "../../db/schema";
import { normalizeCompanyIdentity, normalizeDublinLocality } from "../domain/normalize";
import type { CompanyCategory } from "../domain/types";
import { buildImportPlan, parseWorkbook } from "./parse-workbook";
import type { ImportPlan } from "./types";
import { startImportEnrichment } from "./auto-enrich";

export type ImportSummary = {
  importId: string;
  runId: string;
  fileName: string;
  rowCount: number;
  accepted: number;
  duplicates: number;
  errors: ImportPlan["errors"];
  queuedCompanyIds: string[];
};

function id(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

export async function importWorkbook(
  file: ArrayBuffer,
  fileName: string,
  ownerId: string,
): Promise<ImportSummary> {
  const workbook = await parseWorkbook(file, fileName);
  const plan = buildImportPlan(workbook);
  const importId = id("imp");
  const runId = id("run");
  const now = new Date().toISOString();
  const key = `${ownerId}/imports/${importId}/${fileName.replace(/[^a-zA-Z0-9._-]/g, "_")}`;

  if (!env.BUCKET || !env.DB) {
    throw new Error("Site storage is not configured. Add DB and BUCKET bindings before importing.");
  }
  await env.BUCKET.put(key, file, {
    httpMetadata: { contentType: "application/octet-stream" },
    customMetadata: { ownerId, importId },
  });

  const db = getDb();
  await db.insert(imports).values({
    id: importId,
    ownerId,
    fileKey: key,
    fileName,
    fileType: fileName.toLowerCase().endsWith(".xlsx") ? "xlsx" : "csv",
    status: "running",
    rowCount: workbook.rows.length,
    acceptedCount: plan.accepted,
    duplicateCount: plan.duplicates,
    errorCount: plan.errors.length,
    errorsJson: JSON.stringify(plan.errors),
    runId,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(refreshRuns).values({
    id: runId,
    ownerId,
    kind: "import-enrichment",
    status: "queued",
    requestedBy: "user",
    total: plan.accepted,
    createdAt: now,
    updatedAt: now,
  });

  const queuedCompanyIds: string[] = [];
  for (const row of plan.rows) {
    const identity = normalizeCompanyIdentity({
      companyName: row.companyName,
      website: row.website,
      aliases: row.aliases,
      location: row.location,
    });
    const companyId = id("co");
    const locality = normalizeDublinLocality(row.location);
    await db
      .insert(companies)
      .values({
        id: companyId,
        ownerId,
        name: identity.name,
        normalizedName: identity.normalizedName,
        domain: identity.domain,
        website: row.website,
        aliasesJson: JSON.stringify(identity.aliases),
        description: row.description,
        locality,
        locationText: row.location,
        employeeBand: row.employeeBand,
        foundedYear: row.foundedYear,
        metadataJson: JSON.stringify({ ...row.metadata, original: row.original }),
        enrichmentStatus: "queued",
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [companies.ownerId, companies.normalizedName],
        set: {
          website: row.website,
          locationText: row.location,
          locality,
          updatedAt: now,
        },
      });

    const [existing] = await db
      .select({ id: companies.id })
      .from(companies)
      .where(and(eq(companies.ownerId, ownerId), eq(companies.normalizedName, identity.normalizedName)))
      .limit(1);
    if (!existing) continue;
    queuedCompanyIds.push(existing.id);

    if (row.category) {
      await db
        .insert(companyCategories)
        .values({
          id: id("cat"),
          ownerId,
          companyId: existing.id,
          category: row.category as CompanyCategory,
          confidence: "medium",
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing();
    }
  }

  const enrichment = await startImportEnrichment(ownerId, runId, queuedCompanyIds);
  const importStatus = enrichment.failed === queuedCompanyIds.length && queuedCompanyIds.length > 0
    ? "failed"
    : enrichment.failed > 0 || enrichment.partial > 0
      ? "partial"
      : "completed";

  await db
    .update(imports)
    .set({ status: importStatus, updatedAt: new Date().toISOString() })
    .where(and(eq(imports.ownerId, ownerId), eq(imports.id, importId)));

  return {
    importId,
    runId,
    fileName,
    rowCount: workbook.rows.length,
    accepted: plan.accepted,
    duplicates: plan.duplicates,
    errors: plan.errors,
    queuedCompanyIds,
  };
}
