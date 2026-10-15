import { userFromRequest, unauthorizedResponse } from "../../../../../lib/auth/require-user";
import {
  AgentExecutionLimiter,
  createDefaultAgentPlan,
  estimateAgentTokens,
  normalizeAgentBudget,
  validateAgentPlan,
  validateAgentToolAllowlist,
} from "../../../../../lib/v4/agent";
import { createAgentRun, listAgentRuns, updateAgentRun } from "../../../../../lib/v4/dashboard";

export const dynamic = "force-dynamic";

const MAX_AGENT_REQUEST_LENGTH = 4_000;
const createRunLimiter = new AgentExecutionLimiter({ maxConcurrentPerOwner: 100, maxStartsPerMinute: 10 });

function errorResponse(status: number, code: string, message: string) {
  return Response.json({ error: { code, message } }, { status });
}

export async function GET(request: Request) {
  const user = userFromRequest(request);
  if (!user) return unauthorizedResponse();
  return Response.json({ runs: await listAgentRuns(user.userId) });
}

export async function POST(request: Request) {
  const user = userFromRequest(request);
  if (!user) return unauthorizedResponse();
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body.request !== "string" || !body.request.trim()) return errorResponse(400, "INVALID_AGENT_RUN", "A job-hunt request is required.");
  const runRequest = body.request.trim();
  if (runRequest.length > MAX_AGENT_REQUEST_LENGTH) return errorResponse(400, "INVALID_AGENT_RUN", `The request must be ${MAX_AGENT_REQUEST_LENGTH} characters or fewer.`);

  const rawPlan = body.plan === undefined ? createDefaultAgentPlan(runRequest) : body.plan;
  const planResult = validateAgentPlan(rawPlan);
  if (planResult.error) return errorResponse(400, "INVALID_AGENT_PLAN", planResult.error);

  const authorized = body.authorisedTools === undefined
    ? { tools: [...new Set(planResult.steps.map((step) => step.tool))], error: null }
    : validateAgentToolAllowlist(body.authorisedTools);
  if (authorized.error) return errorResponse(400, "INVALID_AGENT_TOOLS", authorized.error);
  if (planResult.steps.some((step) => !authorized.tools.includes(step.tool))) return errorResponse(400, "UNAUTHORIZED_AGENT_TOOL", "Every planned tool must appear in the authorized tool list.");

  let budget;
  try { budget = normalizeAgentBudget(body.budget); } catch (error) {
    return errorResponse(400, "INVALID_AGENT_BUDGET", error instanceof Error ? error.message : "The agent budget is invalid.");
  }
  const initialTokens = estimateAgentTokens({ request: runRequest, plan: planResult.steps });
  if (initialTokens > budget.maxTokens) return errorResponse(400, "INVALID_AGENT_BUDGET", "The request and plan exceed the configured token budget.");

  const creationId = `create:${crypto.randomUUID()}`;
  const creationSlot = createRunLimiter.acquire(user.userId, creationId);
  if (!creationSlot.allowed) return errorResponse(429, "AGENT_RATE_LIMITED", "Too many agent runs were created recently. Try again shortly.");
  try {
    const created = await createAgentRun(user.userId, {
      request: runRequest,
      scope: body.scope,
      authorisedTools: authorized.tools,
      budget,
    });
    if (!created || typeof created.run.id !== "string") return errorResponse(500, "AGENT_RUN_CREATE_FAILED", "The agent run could not be saved.");
    const runId = created.run.id;
    const checkpoint = { version: 1, plan: planResult.steps, nextPlanIndex: 0, attempts: {} };
    const cost = { inputTokens: initialTokens, outputTokens: 0, totalTokens: initialTokens, searches: 0, costCents: 0 };
    const initialized = await updateAgentRun(user.userId, runId, { status: "queued", checkpoint, cost });
    return Response.json({ run: initialized?.run ?? created.run, steps: initialized?.steps ?? created.steps }, { status: 201 });
  } finally {
    createRunLimiter.release(user.userId, creationId);
  }
}
