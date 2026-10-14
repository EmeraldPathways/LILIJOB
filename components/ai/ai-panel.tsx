"use client";

import { useState } from "react";
import { ArrowUp, Loader2, Sparkles, X } from "lucide-react";
import type { AgentCitation } from "../../lib/ai/types";
import { SourceCitation } from "./source-citation";

export function AiPanel({ companyId, fullScreen = false, onClose }: { companyId?: string | null; fullScreen?: boolean; onClose?: () => void }) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [citations, setCitations] = useState<AgentCitation[]>([]);
  const [busy, setBusy] = useState(false);

  async function ask(event: React.FormEvent) {
    event.preventDefault();
    if (!question.trim() || busy) return;
    setBusy(true);
    setAnswer(null);
    setCitations([]);
    try {
      const response = await fetch("/api/ai/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question, companyId }) });
      const body = await response.json() as { answer?: string; citations?: AgentCitation[]; error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "The assistant could not complete the request.");
      setAnswer(body.answer ?? "No answer returned.");
      setCitations(body.citations ?? []);
    } catch (error) {
      setAnswer(error instanceof Error ? error.message : "The assistant could not reach the research service.");
    } finally {
      setBusy(false);
    }
  }

  return <section className={`ai-panel ${fullScreen ? "ai-panel-fullscreen" : ""}`} aria-label="AI helper"><div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2"><div className="ai-mark"><Sparkles size={15} /></div><div><p className="text-sm font-semibold text-slate-900">Research assistant</p><p className="text-[11px] text-slate-400">GPT-5.6 Luna · saved data first</p></div></div>{onClose && <button type="button" className="icon-button" onClick={onClose} aria-label="Close AI helper"><X size={16} /></button>}</div><div className="ai-answer mt-4" aria-live="polite">{answer ?? "Ask about companies, roles, permit evidence, or current Dublin hiring."}</div><form className="ai-input mt-3" onSubmit={ask}><input value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Ask your research…" aria-label="Ask research assistant" /><button type="submit" disabled={busy || !question.trim()} aria-label="Send question">{busy ? <Loader2 size={15} className="animate-spin" /> : <ArrowUp size={15} />}</button></form>{citations.length > 0 && <div className="mt-4 space-y-2"><p className="eyebrow">Sources</p>{citations.map((citation) => <SourceCitation key={citation.url} citation={citation} />)}</div>}</section>;
}
