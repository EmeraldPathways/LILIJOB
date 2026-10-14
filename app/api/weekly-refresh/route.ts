import { userFromRequest, unauthorizedResponse } from "../../../lib/auth/require-user";
import { getRunConfig, listConfiguredOwners, recordRunUsage } from "../../../lib/jobs/run-config";
import { runWeeklyRefresh } from "../../../lib/jobs/weekly-refresh";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = userFromRequest(request);
  const serviceAccess = Boolean(request.headers.get("OAI-Sites-Authorization"));
  if (!user && !serviceAccess) return unauthorizedResponse();

  try {
    const owners = user ? [user.userId] : await listConfiguredOwners();
    const summaries = [];
    for (const ownerId of owners) {
      const config = await getRunConfig(ownerId);
      const summary = await runWeeklyRefresh(ownerId, config);
      if (summary.status === "completed") await recordRunUsage(ownerId, config.existingCompaniesPerRefresh, 0);
      summaries.push({ ownerId: user ? ownerId : undefined, status: summary.status, errors: summary.errors, discoveries: summary.discoveries.length });
    }
    return Response.json({ summaries });
  } catch (error) {
    return Response.json({ error: { code: "WEEKLY_REFRESH_FAILED", message: error instanceof Error ? error.message : "Weekly refresh failed." } }, { status: 500 });
  }
}
