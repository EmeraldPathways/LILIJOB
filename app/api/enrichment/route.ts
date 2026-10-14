import { userFromRequest, unauthorizedResponse } from "../../../lib/auth/require-user";
import { createRun, enrichCompany } from "../../../lib/research/enrichment-service";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = userFromRequest(request);
  if (!user) return unauthorizedResponse();
  const body = (await request.json()) as { companyId?: string; runId?: string };
  if (!body.companyId) return Response.json({ error: { code: "COMPANY_REQUIRED", message: "companyId is required." } }, { status: 400 });
  try {
    const runId = body.runId ?? (await createRun(user.userId, "enrichment", body.companyId));
    const summary = await enrichCompany(user.userId, body.companyId, runId);
    return Response.json({ summary }, { status: summary.status === "failed" ? 502 : 200 });
  } catch (error) {
    return Response.json({ error: { code: "ENRICHMENT_FAILED", message: error instanceof Error ? error.message : "Enrichment failed." } }, { status: 502 });
  }
}
