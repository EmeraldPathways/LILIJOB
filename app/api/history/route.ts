import { userFromRequest, unauthorizedResponse } from "../../../lib/auth/require-user";
import { listRuns } from "../../../lib/repositories/run-repository";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = userFromRequest(request);
  if (!user) return unauthorizedResponse();
  try {
    return Response.json({ runs: await listRuns(user.userId) });
  } catch (error) {
    return Response.json({ error: { code: "HISTORY_READ_FAILED", message: error instanceof Error ? error.message : "Unable to load refresh history." } }, { status: 500 });
  }
}
