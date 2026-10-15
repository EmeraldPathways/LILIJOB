import { userFromRequest, unauthorizedResponse } from "../../../../../lib/auth/require-user";
import { listJobDiscoveryRuns } from "../../../../../lib/v4/job-repository";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = userFromRequest(request);
  if (!user) return unauthorizedResponse();
  const value = Number(new URL(request.url).searchParams.get("limit"));
  const limit = Number.isFinite(value) && value > 0 ? value : 25;
  return Response.json({ runs: await listJobDiscoveryRuns(user.userId, limit) });
}
