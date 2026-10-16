import { notFound } from "next/navigation";
import Link from "next/link";
import { requireChatGPTUser } from "../../chatgpt-auth";
import { getAgentRun } from "../../../lib/v4/dashboard";

export const dynamic = "force-dynamic";

function evidenceCount(value: string): number {
  try { const parsed = JSON.parse(value || "[]"); return Array.isArray(parsed) ? parsed.length : 0; } catch { return 0; }
}

function downloadableExports(value: string): Array<{ id: string; kind: string; format: string; url: string }> {
  try {
    const output = JSON.parse(value || "{}") as Record<string, unknown>;
    if (output.status !== "download_ready" || !Array.isArray(output.exports)) return [];
    return output.exports.flatMap((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return [];
      const record = item as Record<string, unknown>;
      if (typeof record.id !== "string" || !["application_pack", "interview_pack"].includes(String(record.kind)) || !["html", "pdf", "docx"].includes(String(record.format)) || typeof record.url !== "string") return [];
      const safePath = record.kind === "application_pack" ? /^\/api\/v4\/packs\/[^/]+\/export\?format=(html|pdf|docx)$/.test(record.url) : /^\/api\/v4\/interviews\/[^/]+\/export\?format=(html|pdf|docx)$/.test(record.url);
      return safePath ? [{ id: record.id, kind: String(record.kind), format: String(record.format), url: record.url }] : [];
    });
  } catch {
    return [];
  }
}

export default async function AgentRunPage({ params }: { params: Promise<{ runId: string }> }) {
  const user = await requireChatGPTUser("/agent");
  const { runId } = await params;
  const result = await getAgentRun(user.userId, runId);
  if (!result) notFound();
  return <section className="workspace-frame__page"><div className="standalone-header"><Link className="text-xs font-semibold text-blue-600 hover:underline" href="/agent">← Back to Agent Runs</Link><p className="eyebrow mt-6">Agent run</p><h1 className="workspace-title">{result.run.request}</h1><p className="workspace-description">Status: {result.run.status}. External actions remain approval-gated.</p></div><section className="standalone-card"><p className="eyebrow">Steps and evidence</p>{result.steps.length ? <div className="mt-4 space-y-3">{result.steps.map((step) => <article className="rounded-xl border border-slate-200 p-3" key={step.id}><div className="flex flex-wrap justify-between gap-3"><strong className="text-sm text-slate-800">{step.stepIndex}. {step.tool}</strong><span className="badge badge-muted">{step.status}</span></div><p className="mt-2 text-xs text-slate-500">Estimated cost: {step.estimatedCostCents ?? step.costCents}¢ · actual cost: {typeof step.actualCostCents === "number" ? `${step.actualCostCents}¢` : "not measured"} · evidence: {evidenceCount(step.evidenceJson)}</p>{downloadableExports(step.outputJson).length > 0 && <div className="mt-3 flex flex-wrap gap-2">{downloadableExports(step.outputJson).map((item) => <a className="secondary-button" href={item.url} key={`${item.kind}:${item.id}`}>Download {item.format.toUpperCase()} {item.kind === "application_pack" ? "application pack" : "interview pack"}</a>)}</div>}</article>)}</div> : <p className="empty-state mt-4">No steps recorded yet.</p>}</section></section>;
}
