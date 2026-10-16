import { userFromRequest, unauthorizedResponse } from "../../../../../../lib/auth/require-user";
import { runOwnerJobRadarScheduleNow } from "../../../../../../lib/v4/schedule/job-radar-schedule";

export const dynamic = "force-dynamic";

/** Runs one bounded slice of only the signed-in user's enabled schedule. */
export async function POST(request: Request) {
  const user = userFromRequest(request);
  if (!user) return unauthorizedResponse();
  try {
    const result = await runOwnerJobRadarScheduleNow(user.userId);
    return Response.json({ result });
  } catch {
    return Response.json({ error: { code: "SCHEDULE_RUN_FAILED", message: "The saved Job Radar schedule could not be run." } }, { status: 500 });
  }
}
