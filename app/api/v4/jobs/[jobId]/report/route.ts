import { getDb } from "../../../../../../db";
import { userActivityAudit } from "../../../../../../db/schema-v4";
import { userFromRequest, unauthorizedResponse } from "../../../../../../lib/auth/require-user";
import { getV4Job } from "../../../../../../lib/v4/job-repository";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ jobId: string }> }) {
  const user = userFromRequest(request);
  if (!user) return unauthorizedResponse();
  const { jobId } = await context.params;
  const job = await getV4Job(user.userId, jobId);
  if (!job) return Response.json({ error: { code: "NOT_FOUND", message: "Job not found." } }, { status: 404 });
  const body = await request.json().catch(() => null) as { reason?: unknown } | null;
  if (!body || typeof body.reason !== "string" || !body.reason.trim() || body.reason.length > 1000) return Response.json({ error: { code: "INVALID_REPORT", message: "A short reason is required." } }, { status: 400 });
  const timestamp = new Date().toISOString();
  const id = `audit_${crypto.randomUUID()}`;
  await getDb().insert(userActivityAudit).values({ id, ownerId: user.userId, actor: user.userId, action: "job-invalid-reported", entityType: "job", entityId: jobId, detailsJson: JSON.stringify({ reason: body.reason.trim(), sourceUrl: job.job.url, reportedAt: timestamp }), redactedAt: null, createdAt: timestamp, updatedAt: timestamp });
  return Response.json({ reported: true, auditId: id }, { status: 201 });
}
