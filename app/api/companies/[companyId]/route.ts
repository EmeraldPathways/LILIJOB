import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { companies } from "../../../../db/schema";
import { userFromRequest, unauthorizedResponse } from "../../../../lib/auth/require-user";
import { deleteCompany, getCompanyDetail } from "../../../../lib/repositories/company-repository";

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
  const body = (await request.json()) as { description?: string; enrichmentStatus?: string };
  const db = getDb();
  const changed = await db.update(companies).set({
    ...(body.description !== undefined ? { description: body.description } : {}),
    ...(body.enrichmentStatus !== undefined ? { enrichmentStatus: body.enrichmentStatus } : {}),
    updatedAt: new Date().toISOString(),
  }).where(and(eq(companies.ownerId, user.userId), eq(companies.id, companyId))).returning({ id: companies.id });
  if (!changed.length) return Response.json({ error: { code: "NOT_FOUND", message: "Company not found." } }, { status: 404 });
  return Response.json({ ok: true });
}

export async function DELETE(request: Request, context: { params: Promise<{ companyId: string }> }) {
  const user = userFromRequest(request);
  if (!user) return unauthorizedResponse();
  const { companyId } = await context.params;
  const deleted = await deleteCompany(user.userId, companyId);
  if (!deleted) return Response.json({ error: { code: "NOT_FOUND", message: "Company not found." } }, { status: 404 });
  return Response.json({ ok: true });
}
