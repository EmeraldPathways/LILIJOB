import { userFromRequest, unauthorizedResponse } from "../../../../../../lib/auth/require-user";
import { approveOutreachDraft } from "../../../../../../lib/v4/outreach-repository";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ draftId: string }> }) {
  const user = userFromRequest(request);
  if (!user) return unauthorizedResponse();
  const { draftId } = await context.params;
  const draft = await approveOutreachDraft(user.userId, draftId);
  return draft ? Response.json({ draft }) : Response.json({ error: { code: "NOT_FOUND", message: "Outreach draft not found." } }, { status: 404 });
}
