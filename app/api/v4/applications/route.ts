import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { candidateDocuments } from "../../../../db/schema-v4";
import { companies, jobs } from "../../../../db/schema";
import { userFromRequest, unauthorizedResponse } from "../../../../lib/auth/require-user";
import { createApplication, listApplications } from "../../../../lib/v4/repository";
import { isApplicationStage } from "../../../../lib/v4/crm";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = userFromRequest(request);
  if (!user) return unauthorizedResponse();
  return Response.json({ applications: await listApplications(user.userId) });
}

export async function POST(request: Request) {
  const user = userFromRequest(request);
  if (!user) return unauthorizedResponse();
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body.companyId !== "string" || typeof body.title !== "string" || typeof body.dedupKey !== "string") {
    return Response.json({ error: { code: "INVALID_APPLICATION", message: "Company, title and deduplication key are required." } }, { status: 400 });
  }
  const [company] = await getDb().select({ id: companies.id }).from(companies).where(and(eq(companies.ownerId, user.userId), eq(companies.id, body.companyId))).limit(1);
  if (!company) return Response.json({ error: { code: "COMPANY_NOT_FOUND", message: "Company not found." } }, { status: 404 });
  if (body.stage !== undefined && (typeof body.stage !== "string" || !isApplicationStage(body.stage))) return Response.json({ error: { code: "INVALID_APPLICATION_STAGE", message: "Use a canonical application stage." } }, { status: 400 });
  if (body.jobId !== undefined) {
    if (typeof body.jobId !== "string") return Response.json({ error: { code: "INVALID_JOB", message: "Job reference must be an ID." } }, { status: 400 });
    const [job] = await getDb().select({ id: jobs.id }).from(jobs).where(and(eq(jobs.ownerId, user.userId), eq(jobs.id, body.jobId), eq(jobs.companyId, body.companyId))).limit(1);
    if (!job) return Response.json({ error: { code: "JOB_NOT_FOUND", message: "Job not found for this company and owner." } }, { status: 404 });
  }
  if (body.cvDocumentId !== undefined) {
    if (typeof body.cvDocumentId !== "string") return Response.json({ error: { code: "INVALID_DOCUMENT", message: "CV document reference must be an ID." } }, { status: 400 });
    const [document] = await getDb().select({ id: candidateDocuments.id }).from(candidateDocuments).where(and(eq(candidateDocuments.ownerId, user.userId), eq(candidateDocuments.id, body.cvDocumentId))).limit(1);
    if (!document) return Response.json({ error: { code: "DOCUMENT_NOT_FOUND", message: "CV document not found for this owner." } }, { status: 404 });
  }
  try {
    const result = await createApplication(user.userId, {
      companyId: body.companyId,
      title: body.title,
      dedupKey: body.dedupKey,
      jobId: typeof body.jobId === "string" ? body.jobId : undefined,
      manualUrl: typeof body.manualUrl === "string" ? body.manualUrl : undefined,
      cvDocumentId: typeof body.cvDocumentId === "string" ? body.cvDocumentId : undefined,
      stage: typeof body.stage === "string" ? body.stage : undefined,
      channel: typeof body.channel === "string" ? body.channel : undefined,
      appliedAt: typeof body.appliedAt === "string" ? body.appliedAt : undefined,
      followupDueAt: typeof body.followupDueAt === "string" ? body.followupDueAt : undefined,
      nextAction: typeof body.nextAction === "string" ? body.nextAction : undefined,
      notes: typeof body.notes === "string" ? body.notes : undefined,
    });
    return Response.json(result, { status: result.created ? 201 : 200 });
  } catch (error) {
    return Response.json({ error: { code: "APPLICATION_CREATE_FAILED", message: error instanceof Error ? error.message : "Unable to create application." } }, { status: 400 });
  }
}
