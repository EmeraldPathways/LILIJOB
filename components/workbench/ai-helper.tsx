import { useState } from "react";
import { ArrowUp, Bot, Loader2, Sparkles } from "lucide-react";
import type { AgentCitation } from "../../lib/ai/types";
import { SourceCitation } from "../ai/source-citation";

export function AiHelper({ companyId }: { companyId?: string | null }) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [citations, setCitations] = useState<AgentCitation[]>([]);
  const [busy, setBusy] = useState(false);
  async function ask(event: React.FormEvent) {
    event.preventDefault();
    if (!question.trim() || busy) return;
    setBusy(true); setAnswer(null); setCitations([]);
    try {
      const response = await fetch("/api/ai/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question, companyId }) });
      const body = await response.json() as { answer?: string; citations?: AgentCitation[]; error?: { message: string } };
      setAnswer(response.ok ? body.answer ?? "No answer returned." : body.error?.message ?? "The assistant is not configured yet.");
      if (response.ok) setCitations(body.citations ?? []);
    } catch { setAnswer("The assistant could not reach the research service."); }
    finally { setBusy(false); }
  }
  return <aside className="ai-panel"><div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2"><div className="ai-mark"><Sparkles size={15} /></div><div><p className="text-sm font-semibold text-slate-900">Research assistant</p><p className="text-[11px] text-slate-400">GPT-5.6 Luna · cited answers</p></div></div><Bot size={16} className="text-slate-300" /></div><div className="mt-4 min-h-[74px] rounded-xl bg-slate-50 p-3 text-xs leading-5 text-slate-500">{answer ?? (companyId ? "Ask about this company, its permit evidence, or the best next research step." : "Ask me to compare companies, explain a category, or find a pattern in your data.")}</div><form className="ai-input mt-3" onSubmit={ask}><input value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Ask your data…" aria-label="Ask research assistant" /><button type="submit" disabled={busy || !question.trim()} aria-label="Send question">{busy ? <Loader2 size={15} className="animate-spin" /> : <ArrowUp size={15} />}</button></form>{citations.length > 0 && <div className="mt-3 space-y-2"><p className="eyebrow">Sources checked</p>{citations.slice(0, 3).map((citation) => <SourceCitation key={citation.url} citation={citation} />)}</div>}</aside>;
}
