import { userFromRequest, unauthorizedResponse } from "../../../../../lib/auth/require-user";
import { getJobRadarSchedule, saveJobRadarSchedule } from "../../../../../lib/v4/schedule/job-radar-schedule";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = userFromRequest(request);
  if (!user) return unauthorizedResponse();
  const schedule = await getJobRadarSchedule(user.userId);
  return Response.json({ schedule });
}

export async function PUT(request: Request) {
  const user = userFromRequest(request);
  if (!user) return unauthorizedResponse();
  const body = await request.json().catch(() => null) as { companyIds?: unknown; cadence?: unknown; enabled?: unknown } | null;
  if (!body || !Array.isArray(body.companyIds) || body.companyIds.length > 100 || !body.companyIds.every((id) => typeof id === "string" && id.trim().length > 0 && id.trim().length <= 128)) {
    return Response.json({ error: { code: "INVALID_SCHEDULE_SCOPE", message: "Select up to 100 saved companies for this schedule." } }, { status: 400 });
  }
  if (body.cadence !== "daily" && body.cadence !== "weekly") {
    return Response.json({ error: { code: "INVALID_SCHEDULE_CADENCE", message: "Choose a daily or weekly cadence." } }, { status: 400 });
  }
  if (typeof body.enabled !== "boolean") {
    return Response.json({ error: { code: "INVALID_SCHEDULE_STATE", message: "Choose whether the schedule is enabled." } }, { status: 400 });
  }
  const companyIds = [...new Set((body.companyIds as string[]).map((id) => id.trim()))];
  if (body.enabled && !companyIds.length) {
    return Response.json({ error: { code: "INVALID_SCHEDULE_SCOPE", message: "Choose at least one saved company before enabling the schedule." } }, { status: 400 });
  }
  try {
    const schedule = await saveJobRadarSchedule(user.userId, { companyIds, cadence: body.cadence, enabled: body.enabled });
    return Response.json({ schedule });
  } catch {
    return Response.json({ error: { code: "INVALID_SCHEDULE_SCOPE", message: "One or more selected companies are unavailable to this account." } }, { status: 400 });
  }
}
