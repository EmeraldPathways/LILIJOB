import { userFromRequest, unauthorizedResponse } from "../../../../../../../lib/auth/require-user";
import { createDocumentExportResponse, parseDocumentExportFormat } from "../../../../../../../lib/v4/documents";
import { getCvProposal, tailoredCvExportDocument } from "../../../../../../../lib/v5/cv";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ proposalId: string }> }) {
  const user = userFromRequest(request);
  if (!user) return unauthorizedResponse();
  const { proposalId } = await context.params;
  const proposal = await getCvProposal(user.userId, proposalId);
  if (!proposal) return Response.json({ error: { code: "NOT_FOUND", message: "Tailored CV proposal not found." } }, { status: 404 });
  const format = parseDocumentExportFormat(new URL(request.url).searchParams.get("format"));
  if (!format) return Response.json({ error: { code: "INVALID_FORMAT", message: "Use html, pdf or docx." } }, { status: 400 });
  return createDocumentExportResponse(tailoredCvExportDocument(proposal.payload), `tailored-cv-${proposalId}`, format);
}
