import { userFromRequest, unauthorizedResponse } from "../../../../../../lib/auth/require-user";
import { getApplicationPack } from "../../../../../../lib/v4/repository";

export const dynamic = "force-dynamic";

function escapeHtml(value: unknown): string {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

export async function GET(request: Request, context: { params: Promise<{ packId: string }> }) {
  const user = userFromRequest(request);
  if (!user) return unauthorizedResponse();
  const { packId } = await context.params;
  const pack = await getApplicationPack(user.userId, packId);
  if (!pack) return Response.json({ error: { code: "NOT_FOUND", message: "Application pack not found." } }, { status: 404 });
  let payload: Record<string, unknown> = {};
  try { const parsed = JSON.parse(pack.payloadJson) as unknown; if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) payload = parsed as Record<string, unknown>; } catch { /* keep an empty safe export */ }
  const sections = ["tailoredSummary", "coverNote", "recruiterEmail", "linkedinMessage"].map((key) => `<h2>${escapeHtml(key)}</h2><p>${escapeHtml(payload[key])}</p>`).join("");
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Application pack</title><style>body{font-family:system-ui;max-width:760px;margin:40px auto;line-height:1.6;color:#172033}h1{font-size:28px}h2{font-size:16px;margin-top:28px}p{white-space:pre-wrap}</style></head><body><h1>${escapeHtml(payload.jobTitle ?? "Application pack")} · ${escapeHtml(payload.companyName ?? "Company")}</h1><p>Version ${pack.version} · Source: <a href="${escapeHtml(pack.sourceUrl)}">${escapeHtml(pack.sourceUrl)}</a></p>${sections}</body></html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "content-disposition": `attachment; filename="application-pack-${pack.version}.html"`, "cache-control": "private, no-store" } });
}
