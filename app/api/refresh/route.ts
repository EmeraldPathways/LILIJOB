import { userFromRequest, unauthorizedResponse } from "../../../lib/auth/require-user";
import { refreshExisting } from "../../../lib/research/run-worker";
import type { CompanyCategory } from "../../../lib/domain/types";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = userFromRequest(request);
  if (!user) return unauthorizedResponse();
  const body = (await request.json().catch(() => ({}))) as { companyId?: string; category?: CompanyCategory | "all"; runId?: string; companyIds?: unknown };
  if (body.companyIds !== undefined && (!Array.isArray(body.companyIds) || !body.companyIds.every((value) => typeof value === "string"))) {
    return Response.json({ error: { code: "COMPANY_QUEUE_INVALID", message: "companyIds must be an array of company ids." } }, { status: 400 });
  }
  try {
    const summary = await refreshExisting(user.userId, { companyId: body.companyId, category: body.category ?? "all", runId: body.runId, companyIds: body.companyIds as string[] | undefined });
    return Response.json({ summary }, { status: 202 });
  } catch (error) {
    return Response.json({ error: { code: "REFRESH_FAILED", message: error instanceof Error ? error.message : "Refresh failed." } }, { status: 502 });
  }
}
