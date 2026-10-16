import { userFromRequest, unauthorizedResponse } from "../../../../../../lib/auth/require-user";
import { createDocumentExportResponse, parseDocumentExportFormat, type ExportDocument } from "../../../../../../lib/v4/documents";
import { getApplicationPack } from "../../../../../../lib/v4/repository";

export const dynamic = "force-dynamic";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown, fallback = "Not recorded."): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function list(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    if (typeof item === "string" || typeof item === "number" || typeof item === "boolean") return String(item);
    try { return JSON.stringify(item); } catch { return ""; }
  }).filter(Boolean);
}

function recommendedEdit(value: unknown): string {
  const edit = asRecord(value);
  const requirement = typeof edit.requirement === "string" ? edit.requirement : "Requirement";
  const proposal = typeof edit.proposal === "string" ? edit.proposal : "Review this item manually.";
  const evidenceId = typeof edit.evidenceId === "string" ? ` · evidence ${edit.evidenceId}` : " · no approved evidence attached";
  return `${requirement}: ${proposal}${evidenceId}${edit.needsConfirmation || !edit.evidenceId ? " · confirmation required" : ""}`;
}

function buildPackDocument(pack: { version: number; sourceUrl: string; payloadJson: string }): ExportDocument {
  let payload: Record<string, unknown> = {};
  try { payload = asRecord(JSON.parse(pack.payloadJson)); } catch { /* export the safe, empty defaults below */ }
  const jobTitle = text(payload.jobTitle, "Application pack");
  const companyName = text(payload.companyName, "Company");
  const section = (heading: string, value: unknown) => ({ heading, paragraphs: [text(value)] });
  const itemSection = (heading: string, value: unknown) => {
    const items = list(value);
    return { heading, items: items.length ? items : ["Not recorded."] };
  };
  const document: ExportDocument = {
    title: `${jobTitle} · ${companyName}`,
    subtitle: `Version ${pack.version} · Source: ${pack.sourceUrl}`,
    sections: [
      section("Tailored summary", payload.tailoredSummary),
      section("Cover note", payload.coverNote),
      section("Recruiter email", payload.recruiterEmail),
      section("LinkedIn message", payload.linkedinMessage),
      itemSection("Role requirements", payload.requirements),
      { heading: "Recommended edits", items: Array.isArray(payload.recommendedEdits) && payload.recommendedEdits.length ? payload.recommendedEdits.map(recommendedEdit) : ["Not recorded."] },
      itemSection("Gaps to confirm", payload.requirementGaps),
      itemSection("Talking points", payload.talkingPoints),
      itemSection("Approved evidence references", payload.evidenceReferences),
    ],
    footer: "Review all claims and confirm details against approved evidence before use.",
  };
  return document;
}

export async function GET(request: Request, context: { params: Promise<{ packId: string }> }) {
  const user = userFromRequest(request);
  if (!user) return unauthorizedResponse();
  const format = parseDocumentExportFormat(new URL(request.url).searchParams.get("format"));
  if (!format) return Response.json({ error: { code: "UNSUPPORTED_EXPORT_FORMAT", message: "Use html, pdf or docx for document exports." } }, { status: 400 });
  const { packId } = await context.params;
  const pack = await getApplicationPack(user.userId, packId);
  if (!pack) return Response.json({ error: { code: "NOT_FOUND", message: "Application pack not found." } }, { status: 404 });
  return createDocumentExportResponse(buildPackDocument(pack), `application-pack-${pack.version}`, format);
}
