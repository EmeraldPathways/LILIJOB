import { userFromRequest, unauthorizedResponse } from "../../../../lib/auth/require-user";
import { listV4JobsPage } from "../../../../lib/v4/job-repository";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = userFromRequest(request);
  if (!user) return unauthorizedResponse();
  try {
    const params = new URL(request.url).searchParams;
    const newDays = Number(params.get("newDays"));
    const fitMin = Number(params.get("fitMin"));
    const salaryMin = Number(params.get("salaryMin"));
    const salaryMax = Number(params.get("salaryMax"));
    const limit = Number(params.get("limit"));
    return Response.json(await listV4JobsPage(user.userId, {
      title: params.get("title") ?? undefined,
      titleFamily: params.get("titleFamily") ?? undefined,
      location: params.get("location") ?? undefined,
      locality: params.get("locality") ?? undefined,
      workModel: params.get("workModel") ?? undefined,
      sector: params.get("sector") ?? undefined,
      status: params.get("status") ?? undefined,
      salaryPresent: params.get("salaryPresent") === "true",
      newDays: Number.isFinite(newDays) ? newDays : undefined,
      fitMin: Number.isFinite(fitMin) ? fitMin : undefined,
      salaryMin: Number.isFinite(salaryMin) ? salaryMin : undefined,
      salaryMax: Number.isFinite(salaryMax) ? salaryMax : undefined,
      profileId: params.get("profileId") ?? undefined,
      limit: Number.isFinite(limit) ? limit : undefined,
      cursor: params.get("cursor") ?? undefined,
    }));
  } catch (error) {
    return Response.json({ error: { code: "JOB_LIST_FAILED", message: error instanceof Error ? error.message : "Unable to load jobs." } }, { status: 500 });
  }
}
