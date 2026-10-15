import { userFromRequest, unauthorizedResponse } from "../../../../lib/auth/require-user";
import { listV4Jobs } from "../../../../lib/v4/job-repository";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = userFromRequest(request);
  if (!user) return unauthorizedResponse();
  try {
    const params = new URL(request.url).searchParams;
    const newDays = Number(params.get("newDays"));
    return Response.json({ jobs: await listV4Jobs(user.userId, { title: params.get("title") ?? undefined, location: params.get("location") ?? undefined, status: params.get("status") ?? undefined, salaryPresent: params.get("salaryPresent") === "true", newDays: Number.isFinite(newDays) ? newDays : undefined }) });
  } catch (error) {
    return Response.json({ error: { code: "JOB_LIST_FAILED", message: error instanceof Error ? error.message : "Unable to load jobs." } }, { status: 500 });
  }
}
