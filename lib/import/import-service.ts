import { env } from "cloudflare:workers";
import { and, eq, or } from "drizzle-orm";
import { getDb } from "../../db";
import {
  companyCategories,
  companies,
  imports,
} from "../../db/schema";
import { normalizeCompanyIdentity, normalizeDublinLocality } from "../domain/normalize";
import type { CompanyCategory } from "../domain/types";
import { buildImportPlan, parseWorkbook } from "./parse-workbook";
import type { ImportPlan } from "./types";

export type ImportSummary = {
  importId: string;
  runId: string | null;
  fileName: string;
  rowCount: number;
  accepted: number;
  duplicates: number;
  errors: ImportPlan["errors"];
  queuedCompanyIds: string[];
  categories: CompanyCategory[];
};

export async function recoverImportCompanyIds(fileKey: string | null, fileName: string, ownerId: string): Promise<string[]> {
  if (!fileKey || !env.BUCKET) return [];
  const object = await env.BUCKET.get(fileKey);
  if (!object) return [];
  const workbook = await parseWorkbook(await object.arrayBuffer(), fileName);
  const plan = buildImportPlan(workbook);
  const db = getDb();
  const companyIds = new Set<string>();
  for (const row of plan.rows) {
    const identity = normalizeCompanyIdentity({
      companyName: row.companyName,
      website: row.website,
      aliases: row.aliases,
      location: row.location,
    });
    const identityMatch = identity.domain
      ? or(eq(companies.normalizedName, identity.normalizedName), eq(companies.domain, identity.domain))
      : eq(companies.normalizedName, identity.normalizedName);
    const [matched] = await db
      .select({ id: companies.id })
      .from(companies)
      .where(and(eq(companies.ownerId, ownerId), identityMatch))
      .limit(1);
    if (matched) companyIds.add(matched.id);
  }
  return [...companyIds];
}

export async function reprocessStoredImport(importId: string, ownerId: string): Promise<ImportSummary> {
  if (!env.BUCKET || !env.DB) throw new Error("Site storage is not configured.");
  const db = getDb();
  const [stored] = await db
    .select({ id: imports.id, fileKey: imports.fileKey, fileName: imports.fileName })
    .from(imports)
    .where(and(eq(imports.ownerId, ownerId), eq(imports.id, importId)))
    .limit(1);
  if (!stored) throw new Error("Import not found.");
  if (!stored.fileKey) throw new Error("The original upload is no longer available.");
  const object = await env.BUCKET.get(stored.fileKey);
  if (!object) throw new Error("The original upload is no longer available.");

  const summary = await importWorkbook(await object.arrayBuffer(), stored.fileName, ownerId);
  await db.update(imports).set({ status: "reprocessed", updatedAt: new Date().toISOString() }).where(and(eq(imports.ownerId, ownerId), eq(imports.id, importId)));
  return summary;
}

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
  const runId = null;
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
  let importRowCreated = false;
  try {
    await db.insert(imports).values({
      id: importId,
      ownerId,
      fileKey: key,
      fileName,
      fileType: fileName.toLowerCase().endsWith(".xlsx") ? "xlsx" : "csv",
      status: "stored",
      rowCount: workbook.rows.length,
      acceptedCount: plan.accepted,
      duplicateCount: plan.duplicates,
      errorCount: plan.errors.length,
      errorsJson: JSON.stringify(plan.errors),
      runId,
      createdAt: now,
      updatedAt: now,
    });
    importRowCreated = true;

    const storedCompanyIds = new Set<string>();
    const categories = new Set<CompanyCategory>();
    for (const row of plan.rows) {
      const identity = normalizeCompanyIdentity({
        companyName: row.companyName,
        website: row.website,
        aliases: row.aliases,
        location: row.location,
      });
      const locality = normalizeDublinLocality(row.location);
      const identityMatch = identity.domain
        ? or(eq(companies.normalizedName, identity.normalizedName), eq(companies.domain, identity.domain))
        : eq(companies.normalizedName, identity.normalizedName);
      const [matched] = await db
        .select()
        .from(companies)
        .where(and(eq(companies.ownerId, ownerId), identityMatch))
        .limit(1);

      if (matched) {
        const existingMetadata = parseMetadata(matched.metadataJson);
        const existingOriginal = existingMetadata.original && typeof existingMetadata.original === "object" ? existingMetadata.original as Record<string, unknown> : {};
        await db.update(companies).set({
          website: row.website ?? matched.website,
          aliasesJson: row.aliases.length ? JSON.stringify(row.aliases) : matched.aliasesJson,
          description: row.description ?? matched.description,
          locationText: row.location ?? matched.locationText,
          locality: row.location ? locality : matched.locality,
          employeeBand: row.employeeBand ?? matched.employeeBand,
          foundedYear: row.foundedYear ?? matched.foundedYear,
          enrichmentStatus: matched.lastEnrichedAt || matched.enrichmentStatus !== "queued" ? matched.enrichmentStatus : "not-enriched",
          metadataJson: JSON.stringify({ ...existingMetadata, ...row.metadata, ...(row.careersUrl ? { careersUrl: row.careersUrl } : {}), original: { ...existingOriginal, ...row.original } }),
          updatedAt: now,
        }).where(and(eq(companies.ownerId, ownerId), eq(companies.id, matched.id)));
      } else {
        await db
          .insert(companies)
          .values({
            id: id("co"),
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
            metadataJson: JSON.stringify({ ...row.metadata, ...(row.careersUrl ? { careersUrl: row.careersUrl } : {}), original: row.original }),
            enrichmentStatus: "not-enriched",
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoNothing();
      }

      const [existing] = await db
        .select({ id: companies.id })
        .from(companies)
        .where(and(eq(companies.ownerId, ownerId), identityMatch))
        .limit(1);
      if (!existing) continue;
      storedCompanyIds.add(existing.id);

      if (row.category) {
        categories.add(row.category);
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

    return {
      importId,
      runId,
      fileName,
      rowCount: workbook.rows.length,
      accepted: plan.accepted,
      duplicates: plan.duplicates,
      errors: plan.errors,
      queuedCompanyIds: [...storedCompanyIds],
      categories: [...categories],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to persist import.";
    if (importRowCreated) {
      try {
        await db.update(imports).set({ status: "failed", errorsJson: JSON.stringify([{ message }]), updatedAt: new Date().toISOString() }).where(and(eq(imports.ownerId, ownerId), eq(imports.id, importId)));
      } catch {
        // The original exception is more useful to the caller than a best-effort status update failure.
      }
    } else {
      try {
        await env.BUCKET.delete(key);
      } catch {
        // The upload is private and the caller still receives the persistence error.
      }
    }
    throw error;
  }
}

function parseMetadata(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}
