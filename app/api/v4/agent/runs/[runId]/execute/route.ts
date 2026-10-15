import { userFromRequest, unauthorizedResponse } from "../../../../../../../lib/auth/require-user";
import { AgentExecutionLimitError, executeAgentRun } from "../../../../../../../lib/v4/agent-runner";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ runId: string }> }) {
  void request;
  const user = userFromRequest(request);
  if (!user) return unauthorizedResponse();
  const { runId } = await context.params;
  try {
    const run = await executeAgentRun(user.userId, runId);
    return run ? Response.json(run) : Response.json({ error: { code: "NOT_FOUND", message: "Agent run not found." } }, { status: 404 });
  } catch (error) {
    if (error instanceof AgentExecutionLimitError) return Response.json({ error: { code: "AGENT_RATE_LIMITED", message: error.message } }, { status: error.status });
    return Response.json({ error: { code: "AGENT_EXECUTION_FAILED", message: "The agent run could not execute." } }, { status: 500 });
  }
}
