import { userFromRequest, unauthorizedResponse } from "../../../../../../../lib/auth/require-user";
import { retryJobDiscoveryRun } from "../../../../../../../lib/v4/job-repository";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ runId: string }> }) {
  const user = userFromRequest(request);
  if (!user) return unauthorizedResponse();
  const { runId } = await context.params;
  const retryRunId = await retryJobDiscoveryRun(user.userId, runId);
  if (!retryRunId) return Response.json({ error: { code: "RUN_NOT_RETRYABLE", message: "Discovery run is missing or has no retryable result." } }, { status: 409 });
  return Response.json({ runId: retryRunId }, { status: 201 });
}
