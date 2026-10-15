import { userFromRequest, unauthorizedResponse } from "../../../../../../../lib/auth/require-user";
import { retryAgentRun } from "../../../../../../../lib/v4/agent-runner";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ runId: string }> }) {
  const user = userFromRequest(request);
  if (!user) return unauthorizedResponse();
  const { runId } = await context.params;
  const run = await retryAgentRun(user.userId, runId);
  return run ? Response.json(run) : Response.json({ error: { code: "NOT_FOUND", message: "Agent run not found." } }, { status: 404 });
}
