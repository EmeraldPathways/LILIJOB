import { env } from "cloudflare:workers";
import { userFromRequest, unauthorizedResponse } from "../../../../../../../lib/auth/require-user";
import { buildDocxExport, buildPdfExport } from "../../../../../../../lib/v4/documents";
import { createCandidateDocument } from "../../../../../../../lib/v4/repository";
import { approveCvProposal, getCvProposal } from "../../../../../../../lib/v5/cv";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ proposalId: string }> }) {
  const user = userFromRequest(request);
  if (!user) return unauthorizedResponse();
  if (!env.BUCKET) return Response.json({ error: { code: "STORAGE_UNAVAILABLE", message: "Private document storage is not configured." } }, { status: 503 });
  const { proposalId } = await context.params;
  const proposal = await getCvProposal(user.userId, proposalId);
  if (!proposal) return Response.json({ error: { code: "NOT_FOUND", message: "Tailored CV proposal not found." } }, { status: 404 });
  if (proposal.payload.atsChecks.unsupportedNumericClaims.length) return Response.json({ error: { code: "CV_REVIEW_REQUIRED", message: "Resolve unsupported numeric claims before approval." } }, { status: 409 });
  const body = await request.json().catch(() => null) as { format?: unknown } | null;
  const format = body?.format === "docx" ? "docx" : "pdf";
  const bytes = format === "docx" ? new Uint8Array(await (await buildDocxExport({ title: `${proposal.payload.roleTitle} CV`, subtitle: proposal.payload.companyName, sections: proposal.payload.sections })).arrayBuffer()) : await buildPdfExport({ title: `${proposal.payload.roleTitle} CV`, subtitle: proposal.payload.companyName, sections: proposal.payload.sections });
  const extension = format === "docx" ? "docx" : "pdf";
  const objectKey = `private/${user.userId}/candidate-documents/tailored-${proposal.id}.${extension}`;
  await env.BUCKET.put(objectKey, bytes, { httpMetadata: { contentType: format === "docx" ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : "application/pdf" } });
  const document = await createCandidateDocument(user.userId, { profileId: proposal.profileId, type: "tailored-cv", originalFilename: `${proposal.payload.roleTitle.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-cv.${extension}`, objectKey, parsedText: `${proposal.payload.summary}\n\n${proposal.payload.sections.flatMap((section) => [...(section.paragraphs ?? []), ...(section.items ?? [])]).join("\n")}`, derived: { proposalId: proposal.id, generationVersion: proposal.payload.generationVersion, sourceUrl: proposal.payload.sourceUrl, evidenceReferences: proposal.payload.evidenceReferences }, consentStatus: "approved" });
  if (!document) return Response.json({ error: { code: "DOCUMENT_SAVE_FAILED", message: "The approved CV artifact could not be recorded." } }, { status: 500 });
  const approved = await approveCvProposal(user.userId, proposal.id, document.id);
  return Response.json({ proposal: approved, document }, { status: 200 });
}
