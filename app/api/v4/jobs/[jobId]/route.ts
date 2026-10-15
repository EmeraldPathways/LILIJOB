import { userFromRequest, unauthorizedResponse } from "../../../../../lib/auth/require-user";
import { getV4Job } from "../../../../../lib/v4/job-repository";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ jobId: string }> }) {
  const user = userFromRequest(request);
  if (!user) return unauthorizedResponse();
  const { jobId } = await context.params;
  const result = await getV4Job(user.userId, jobId);
  return result ? Response.json(result) : Response.json({ error: { code: "NOT_FOUND", message: "Job not found." } }, { status: 404 });
}
