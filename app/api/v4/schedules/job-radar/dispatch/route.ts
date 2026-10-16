import { env } from "cloudflare:workers";
import { dispatchDueJobRadarSchedules } from "../../../../../../lib/v4/schedule/job-radar-schedule";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const token = env.V4_JOB_RADAR_SCHEDULE_TOKEN;
  if (!token) return new Response(null, { status: 404 });
  if (request.headers.get("authorization") !== `Bearer ${token}`) return new Response(null, { status: 401 });
  try {
    const result = await dispatchDueJobRadarSchedules({ maxSchedules: 3, companiesPerSchedule: 2 });
    return Response.json(result);
  } catch (error) {
    return Response.json({ error: { code: "SCHEDULE_DISPATCH_FAILED", message: error instanceof Error ? error.message : "Schedule dispatch failed." } }, { status: 500 });
  }
}
