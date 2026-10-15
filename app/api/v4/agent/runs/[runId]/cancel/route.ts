import { userFromRequest, unauthorizedResponse } from "../../../../../../../lib/auth/require-user";
import { cancelAgentRun } from "../../../../../../../lib/v4/agent-runner";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ runId: string }> }) {
  const user = userFromRequest(request);
  if (!user) return unauthorizedResponse();
  const { runId } = await context.params;
  const run = await cancelAgentRun(user.userId, runId);
  return run ? Response.json(run) : Response.json({ error: { code: "NOT_FOUND", message: "Agent run not found." } }, { status: 404 });
}
