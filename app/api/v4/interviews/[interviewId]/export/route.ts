import { userFromRequest, unauthorizedResponse } from "../../../../../../lib/auth/require-user";
import { createDocumentExportResponse, parseDocumentExportFormat, type ExportDocument } from "../../../../../../lib/v4/documents";
import { getInterview } from "../../../../../../lib/v4/interview-repository";

export const dynamic = "force-dynamic";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asText(value: unknown, fallback = "Not recorded."): string {
  return (typeof value === "string" && value.trim()) || typeof value === "number" ? String(value) : fallback;
}

function asList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function itemText(value: unknown): string {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  const record = asRecord(value);
  if (Object.keys(record).length) {
    return Object.entries(record).map(([key, item]) => `${key}: ${item && typeof item === "object" ? JSON.stringify(item) : String(item ?? "Not recorded")}`).join(" · ");
  }
  try { return JSON.stringify(value); } catch { return ""; }
}

function followUp(interview: Record<string, unknown>): { state: string; text: string } {
  const draft = asRecord(interview.followUpDraft);
  const text = typeof draft.text === "string" ? draft.text : typeof interview.nextSteps === "string" ? interview.nextSteps : "";
  const state = typeof draft.status === "string" ? draft.status : text ? "draft" : "not drafted";
  return { state, text: text || "None recorded." };
}

function buildInterviewDocument(interview: Record<string, unknown>, latest: Record<string, unknown>): ExportDocument {
  let sections: Record<string, unknown> = {};
  try { sections = asRecord(JSON.parse(typeof latest.sectionsJson === "string" ? latest.sectionsJson : "{}")); } catch { /* preserve a truthful, minimal export */ }
  const round = asText(interview.round, "Interview");
  const timezone = asText(interview.timezone, "Europe/Dublin");
  const outcome = asText(interview.outcome, "Not recorded");
  const notes = asText(interview.notes, "Not recorded.");
  const draft = followUp(interview);
  const items = (key: string): string[] => asList(sections[key]).map(itemText).filter(Boolean);
  const itemSection = (heading: string, values: string[]) => ({ heading, items: values.length ? values : ["Not recorded."] });
  const practiceQaItems = items("practiceQas");
  const document: ExportDocument = {
    title: "Interview preparation pack",
    subtitle: `Round ${round} · ${timezone} · Version ${asText(latest.version, "1")}`,
    sections: [
      { heading: "Interview outcome and notes", paragraphs: [`Outcome: ${outcome}`, `Notes: ${notes}`] },
      { heading: "Follow-up draft", paragraphs: [`${draft.state} · ${draft.text}`] },
      { heading: "Company and role brief", paragraphs: [asText(sections.brief)] },
      itemSection("Sources and checked dates", items("sourceMeta")),
      itemSection("Predicted topic areas", items("predictions")),
      itemSection("Approved STAR evidence", items("starStories")),
      itemSection("Recruiter screen answers", items("recruiterScreenAnswers")),
      itemSection("Practice questions", items("practiceQuestions")),
      itemSection("Practice Q&A and self-evaluation", practiceQaItems),
      itemSection("Questions to ask", items("questionsToAsk")),
      itemSection("24-hour checklist", items("checklist24h")),
      itemSection("Gaps to confirm", items("gaps")),
    ],
    footer: "Predictions and missing source details require human review. Follow-up drafts remain editable and require explicit owner approval.",
  };
  return document;
}

export async function GET(request: Request, context: { params: Promise<{ interviewId: string }> }) {
  const user = userFromRequest(request);
  if (!user) return unauthorizedResponse();
  const format = parseDocumentExportFormat(new URL(request.url).searchParams.get("format"));
  if (!format) return Response.json({ error: { code: "UNSUPPORTED_EXPORT_FORMAT", message: "Use html, pdf or docx for document exports." } }, { status: 400 });
  const { interviewId } = await context.params;
  const result = await getInterview(user.userId, interviewId);
  if (!result) return Response.json({ error: { code: "NOT_FOUND", message: "Interview not found." } }, { status: 404 });
  const latest = result.packs[0];
  if (!latest) return Response.json({ error: { code: "NOT_FOUND", message: "Interview pack has not been generated." } }, { status: 404 });
  return createDocumentExportResponse(buildInterviewDocument(asRecord(result.interview), asRecord(latest)), `interview-${interviewId}`, format);
}
