import { userFromRequest, unauthorizedResponse } from "../../../../../../../lib/auth/require-user";
import { approveInterviewFollowUp } from "../../../../../../../lib/v4/interview-repository";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ interviewId: string }> }) {
  const user = userFromRequest(request);
  if (!user) return unauthorizedResponse();
  const { interviewId } = await context.params;
  try {
    const result = await approveInterviewFollowUp(user.userId, interviewId);
    return result ? Response.json(result) : Response.json({ error: { code: "NOT_FOUND", message: "Interview not found." } }, { status: 404 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Save a follow-up draft before approving it.";
    return Response.json({ error: { code: "FOLLOW_UP_DRAFT_REQUIRED", message } }, { status: 409 });
  }
}
