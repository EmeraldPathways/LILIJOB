import type { AgentCitation } from "../../lib/ai/types";

export function SourceCitation({ citation }: { citation: AgentCitation }) {
  return <a className="source-row" href={citation.url} target="_blank" rel="noreferrer"><span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold text-slate-700">{citation.title}</span><span className="mt-1 block truncate text-[11px] text-slate-400">{citation.sourceType} · {citation.checkedAt ? new Date(citation.checkedAt).toLocaleDateString("en-IE") : "date unavailable"} · {citation.confidence} confidence</span></span></a>;
}
