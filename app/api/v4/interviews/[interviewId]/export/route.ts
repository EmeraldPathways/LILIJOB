import { userFromRequest, unauthorizedResponse } from "../../../../../../lib/auth/require-user";
import { getInterview } from "../../../../../../lib/v4/interview-repository";

export const dynamic = "force-dynamic";

function escapeHtml(value: unknown): string {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function list(items: unknown): string {
  return Array.isArray(items) && items.length ? `<ul>${items.map((item) => `<li>${escapeHtml(typeof item === "object" && item !== null ? JSON.stringify(item) : item)}</li>`).join("")}</ul>` : "<p>None recorded.</p>";
}

export async function GET(request: Request, context: { params: Promise<{ interviewId: string }> }) {
  const user = userFromRequest(request);
  if (!user) return unauthorizedResponse();
  const { interviewId } = await context.params;
  const result = await getInterview(user.userId, interviewId);
  if (!result) return new Response("Interview not found", { status: 404 });
  const latest = result.packs[0];
  if (!latest) return new Response("Interview pack has not been generated", { status: 404 });
  let sections: Record<string, unknown> = {};
  try { const parsed = JSON.parse(latest.sectionsJson); if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) sections = parsed as Record<string, unknown>; } catch { /* keep a truthful empty export */ }
  const followUpDraft = result.interview.followUpDraft;
  const followUpText = followUpDraft && typeof followUpDraft === "object" && "text" in followUpDraft ? String(followUpDraft.text ?? "") : result.interview.nextSteps ?? "";
  const followUpState = followUpDraft && typeof followUpDraft === "object" && "status" in followUpDraft ? String(followUpDraft.status ?? "draft") : followUpText ? "draft" : "not drafted";
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Interview preparation pack</title><style>body{font-family:Arial,sans-serif;max-width:820px;margin:40px auto;padding:0 24px;color:#172033;line-height:1.5}h1{font-size:30px}h2{margin-top:28px;font-size:19px;border-bottom:1px solid #dbe3ef;padding-bottom:6px}li{margin:6px 0}.meta{color:#52627a;font-size:13px}@media print{body{margin:0;max-width:none}.no-print{display:none}}</style></head><body><p class="meta">Dublin Tech Compass · Interview ${escapeHtml(result.interview.round)} · ${escapeHtml(result.interview.timezone)}</p><h1>Interview preparation pack</h1><p class="meta">Generated ${escapeHtml(latest.generatedAt)} · Version ${escapeHtml(latest.version)}</p><h2>Interview outcome</h2><p>${escapeHtml(result.interview.outcome ?? "Not recorded")}</p><h2>Follow-up draft</h2><p>${escapeHtml(followUpState)} · ${escapeHtml(followUpText || "None recorded.")}</p><h2>Company and role brief</h2><p>${escapeHtml(sections.brief)}</p><h2>Sources and checked dates</h2>${list(sections.sourceMeta)}<h2>Predicted topic areas</h2>${list(sections.predictions)}<h2>Approved STAR evidence</h2>${list(sections.starStories)}<h2>Recruiter screen answers</h2>${list(sections.recruiterScreenAnswers)}<h2>Practice questions</h2>${list(sections.practiceQuestions)}<h2>Practice Q&amp;A and self-evaluation</h2>${list(sections.practiceQas)}<h2>Questions to ask</h2>${list(sections.questionsToAsk)}<h2>24-hour checklist</h2>${list(sections.checklist24h)}<h2>Gaps to confirm</h2>${list(sections.gaps)}<p class="meta">Predictions and missing source details require human review. Follow-up drafts remain editable and require explicit owner approval. This export contains only the owner-scoped interview record.</p></body></html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "content-disposition": `inline; filename="interview-${interviewId}.html"`, "cache-control": "no-store" } });
}
