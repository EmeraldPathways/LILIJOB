import { userFromRequest, unauthorizedResponse } from "../../../../lib/auth/require-user";
import { getRun } from "../../../../lib/repositories/run-repository";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ runId: string }> }) {
  const user = userFromRequest(request);
  if (!user) return unauthorizedResponse();
  const { runId } = await context.params;
  const run = await getRun(user.userId, runId);
  if (!run) return Response.json({ error: { code: "NOT_FOUND", message: "Run not found." } }, { status: 404 });
  return Response.json({ run });
}
