import { userFromRequest, unauthorizedResponse } from "../../../../../../lib/auth/require-user";
import { getCvProposal, updateCvProposal } from "../../../../../../lib/v5/cv";
import type { TailoredCvPayload } from "../../../../../../lib/v5/cv";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ proposalId: string }> }) {
  const user = userFromRequest(request);
  if (!user) return unauthorizedResponse();
  const { proposalId } = await context.params;
  const proposal = await getCvProposal(user.userId, proposalId);
  return proposal ? Response.json({ proposal }) : Response.json({ error: { code: "NOT_FOUND", message: "Tailored CV proposal not found." } }, { status: 404 });
}

export async function PATCH(request: Request, context: { params: Promise<{ proposalId: string }> }) {
  const user = userFromRequest(request);
  if (!user) return unauthorizedResponse();
  const { proposalId } = await context.params;
  const current = await getCvProposal(user.userId, proposalId);
  if (!current) return Response.json({ error: { code: "NOT_FOUND", message: "Tailored CV proposal not found." } }, { status: 404 });
  const body = await request.json().catch(() => null) as { payload?: unknown; status?: unknown } | null;
  if (!body?.payload || typeof body.payload !== "object" || Array.isArray(body.payload)) return Response.json({ error: { code: "INVALID_CV_PROPOSAL", message: "An edited CV payload is required." } }, { status: 400 });
  try {
    const proposal = await updateCvProposal(user.userId, proposalId, body.payload as TailoredCvPayload, body.status === "draft" ? "draft" : "review");
    return proposal ? Response.json({ proposal }) : Response.json({ error: { code: "NOT_FOUND", message: "Tailored CV proposal not found." } }, { status: 404 });
  } catch (error) {
    return Response.json({ error: { code: "INVALID_CV_PROPOSAL", message: error instanceof Error ? error.message : "The CV edit could not be saved." } }, { status: 400 });
  }
}
