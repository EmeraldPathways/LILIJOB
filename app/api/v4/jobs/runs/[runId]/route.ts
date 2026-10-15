import { userFromRequest, unauthorizedResponse } from "../../../../../../lib/auth/require-user";
import { cancelJobDiscoveryRun, getJobDiscoveryRun } from "../../../../../../lib/v4/job-repository";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ runId: string }> }) {
  const user = userFromRequest(request);
  if (!user) return unauthorizedResponse();
  const { runId } = await context.params;
  const run = await getJobDiscoveryRun(user.userId, runId);
  return run ? Response.json({ run }) : Response.json({ error: { code: "NOT_FOUND", message: "Discovery run not found." } }, { status: 404 });
}

export async function POST(request: Request, context: { params: Promise<{ runId: string }> }) {
  const user = userFromRequest(request);
  if (!user) return unauthorizedResponse();
  const { runId } = await context.params;
  if (!await cancelJobDiscoveryRun(user.userId, runId)) return Response.json({ error: { code: "RUN_NOT_CANCELLABLE", message: "Discovery run is missing or no longer active." } }, { status: 409 });
  return Response.json({ cancelled: true });
}
