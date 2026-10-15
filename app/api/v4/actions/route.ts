import { userFromRequest, unauthorizedResponse } from "../../../../lib/auth/require-user";
import { listActionItems, upsertActionItem } from "../../../../lib/v4/dashboard";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = userFromRequest(request);
  if (!user) return unauthorizedResponse();
  return Response.json({ actions: await listActionItems(user.userId) });
}

export async function POST(request: Request) {
  const user = userFromRequest(request);
  if (!user) return unauthorizedResponse();
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body.type !== "string" || typeof body.reason !== "string" || typeof body.dedupKey !== "string") return Response.json({ error: { code: "INVALID_ACTION", message: "Type, reason and deduplication key are required." } }, { status: 400 });
  try {
    const action = await upsertActionItem(user.userId, { type: body.type, reason: body.reason, dedupKey: body.dedupKey, priority: typeof body.priority === "number" ? body.priority : undefined, companyId: typeof body.companyId === "string" ? body.companyId : undefined, jobId: typeof body.jobId === "string" ? body.jobId : undefined, applicationId: typeof body.applicationId === "string" ? body.applicationId : undefined, interviewId: typeof body.interviewId === "string" ? body.interviewId : undefined, dueAt: typeof body.dueAt === "string" ? body.dueAt : undefined });
    return Response.json({ action }, { status: 201 });
  } catch (error) {
    return Response.json({ error: { code: "INVALID_ACTION", message: error instanceof Error ? error.message : "Unable to create action item." } }, { status: 400 });
  }
}
