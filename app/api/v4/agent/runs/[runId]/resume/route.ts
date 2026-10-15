import { userFromRequest, unauthorizedResponse } from "../../../../../../../lib/auth/require-user";
import { resumeAgentRun } from "../../../../../../../lib/v4/agent-runner";
import { normalizeAgentBudget } from "../../../../../../../lib/v4/agent";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ runId: string }> }) {
  const user = userFromRequest(request);
  if (!user) return unauthorizedResponse();
  const { runId } = await context.params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  let budget: ReturnType<typeof normalizeAgentBudget> | undefined;
  if (body && Object.hasOwn(body, "budget")) {
    try { budget = normalizeAgentBudget(body.budget); } catch (error) {
      return Response.json({ error: { code: "INVALID_AGENT_BUDGET", message: error instanceof Error ? error.message : "The agent budget is invalid." } }, { status: 400 });
    }
  }
  const run = await resumeAgentRun(user.userId, runId, budget);
  return run ? Response.json(run) : Response.json({ error: { code: "NOT_FOUND", message: "Agent run not found." } }, { status: 404 });
}
