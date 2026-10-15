import { userFromRequest, unauthorizedResponse } from "../../../../../lib/auth/require-user";
import { listApplications } from "../../../../../lib/v4/repository";
import { safeCsvCell } from "../../../../../lib/v4/crm";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = userFromRequest(request);
  if (!user) return unauthorizedResponse();
  const rows = await listApplications(user.userId);
  const header = ["id", "company_id", "job_id", "title", "stage", "manual_url", "channel", "applied_at", "followup_due_at", "next_action", "notes", "created_at", "updated_at"];
  const lines = [header.map(safeCsvCell).join(","), ...rows.map((row) => [row.id, row.companyId, row.jobId, row.title, row.stage, row.manualUrl, row.channel, row.appliedAt, row.followupDueAt, row.nextAction, row.notes, row.createdAt, row.updatedAt].map(safeCsvCell).join(","))];
  return new Response(`\uFEFF${lines.join("\n")}\n`, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": "attachment; filename=applications.csv", "cache-control": "no-store" } });
}
