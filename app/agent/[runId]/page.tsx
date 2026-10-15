import { notFound } from "next/navigation";
import Link from "next/link";
import { requireChatGPTUser } from "../../chatgpt-auth";
import { getAgentRun } from "../../../lib/v4/dashboard";

export const dynamic = "force-dynamic";

function evidenceCount(value: string): number {
  try { const parsed = JSON.parse(value || "[]"); return Array.isArray(parsed) ? parsed.length : 0; } catch { return 0; }
}

export default async function AgentRunPage({ params }: { params: Promise<{ runId: string }> }) {
  const user = await requireChatGPTUser("/agent");
  const { runId } = await params;
  const result = await getAgentRun(user.userId, runId);
  if (!result) notFound();
  return <section className="workspace-frame__page"><div className="standalone-header"><Link className="text-xs font-semibold text-blue-600 hover:underline" href="/agent">← Back to Agent Runs</Link><p className="eyebrow mt-6">Agent run</p><h1 className="workspace-title">{result.run.request}</h1><p className="workspace-description">Status: {result.run.status}. External actions remain approval-gated.</p></div><section className="standalone-card"><p className="eyebrow">Steps and evidence</p>{result.steps.length ? <div className="mt-4 space-y-3">{result.steps.map((step) => <article className="rounded-xl border border-slate-200 p-3" key={step.id}><div className="flex flex-wrap justify-between gap-3"><strong className="text-sm text-slate-800">{step.stepIndex}. {step.tool}</strong><span className="badge badge-muted">{step.status}</span></div><p className="mt-2 text-xs text-slate-500">Cost: {step.costCents} cents · evidence: {evidenceCount(step.evidenceJson)}</p></article>)}</div> : <p className="empty-state mt-4">No steps recorded yet.</p>}</section></section>;
}
