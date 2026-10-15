import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { companies } from "../../../../db/schema";
import { userFromRequest, unauthorizedResponse } from "../../../../lib/auth/require-user";
import { CellUpdateValidationError } from "../../../../lib/sheet-data/cell-update";
import { CompanyCellConflictError, deleteCompany, getCompanyDetail, updateCompanyCells } from "../../../../lib/repositories/company-repository";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ companyId: string }> }) {
  const user = userFromRequest(request);
  if (!user) return unauthorizedResponse();
  const { companyId } = await context.params;
  const company = await getCompanyDetail(user.userId, companyId);
  if (!company) return Response.json({ error: { code: "NOT_FOUND", message: "Company not found." } }, { status: 404 });
  return Response.json({ company });
}

export async function PATCH(request: Request, context: { params: Promise<{ companyId: string }> }) {
  const user = userFromRequest(request);
  if (!user) return unauthorizedResponse();
  const { companyId } = await context.params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: { code: "INVALID_REQUEST", message: "Request body must be valid JSON." } }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ error: { code: "INVALID_REQUEST", message: "Request body must be an object." } }, { status: 400 });
  }

  if (Object.prototype.hasOwnProperty.call(body, "cells")) {
    const cells = (body as { cells?: unknown }).cells;
    if (!cells || typeof cells !== "object" || Array.isArray(cells) || Object.values(cells).some((value) => typeof value !== "string")) {
      return Response.json({ error: { code: "INVALID_CELLS", message: "Cells must be an object whose values are strings." } }, { status: 400 });
    }
    const collection = (body as { collection?: unknown }).collection;
    if (collection !== undefined && (typeof collection !== "string" || collection.length > 100)) return Response.json({error:{message:"Invalid collection."}}, {status:400});
    try {
      const company = await updateCompanyCells(user.userId, companyId, cells as Record<string, string>, collection as string | undefined);
      if (!company) return Response.json({ error: { code: "NOT_FOUND", message: "Company not found." } }, { status: 404 });
      return Response.json({ company });
    } catch (error) {
      if (error instanceof CellUpdateValidationError) {
        return Response.json({ error: { code: "INVALID_CELLS", message: error.message } }, { status: 400 });
      }
      if (error instanceof CompanyCellConflictError || isUniqueConstraintError(error)) {
        return Response.json({ error: { code: "COMPANY_CONFLICT", message: error instanceof Error ? error.message : "A company with that name or domain already exists." } }, { status: 409 });
      }
      return Response.json({ error: { code: "CELL_UPDATE_FAILED", message: error instanceof Error ? error.message : "Unable to update company cells." } }, { status: 500 });
    }
  }

  const legacy = body as { description?: string; enrichmentStatus?: string };
  const db = getDb();
  const changed = await db.update(companies).set({
    ...(legacy.description !== undefined ? { description: legacy.description } : {}),
    ...(legacy.enrichmentStatus !== undefined ? { enrichmentStatus: legacy.enrichmentStatus } : {}),
    updatedAt: new Date().toISOString(),
  }).where(and(eq(companies.ownerId, user.userId), eq(companies.id, companyId))).returning({ id: companies.id });
  if (!changed.length) return Response.json({ error: { code: "NOT_FOUND", message: "Company not found." } }, { status: 404 });
  return Response.json({ ok: true });
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Error && /unique constraint failed: companies\.(owner_id, (normalized_name|domain))/i.test(error.message);
}

export async function DELETE(request: Request, context: { params: Promise<{ companyId: string }> }) {
  const user = userFromRequest(request);
  if (!user) return unauthorizedResponse();
  const { companyId } = await context.params;
  const deleted = await deleteCompany(user.userId, companyId);
  if (!deleted) return Response.json({ error: { code: "NOT_FOUND", message: "Company not found." } }, { status: 404 });
  return Response.json({ ok: true });
}
