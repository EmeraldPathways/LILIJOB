import { useState } from "react";
import { SlidersHorizontal, X } from "lucide-react";
import { DUBLIN_LOCALITIES } from "../../lib/domain/types";
import type { DublinLocality } from "../../lib/domain/types";

export type CompanyListFilterState = {
  locality: DublinLocality | "all";
  status: "all" | "queued" | "running" | "completed" | "partial" | "failed";
  permitSignal: "all" | "confirmed" | "potential" | "unknown";
  freshness: "all" | "fresh" | "stale" | "unknown";
  confidence: "all" | "high" | "medium" | "low";
  openRoles: "all" | "yes" | "no";
};

export function FilterSheet({ filters, onApply }: { filters: CompanyListFilterState; onApply: (filters: CompanyListFilterState) => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(filters);

  function openSheet() {
    setDraft(filters);
    setOpen(true);
  }

  function apply() {
    onApply(draft);
    setOpen(false);
  }

  return <>
    <button type="button" className="filter-button" onClick={openSheet} aria-label="Filter companies"><SlidersHorizontal size={14} />Filter companies<span className="sr-only"> Permit evidence, freshness, confidence, and Open roles</span></button>
    {open && <div className="sheet-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
      <section className="filter-sheet" role="dialog" aria-modal="true" aria-label="Filter companies">
        <div className="flex items-start justify-between gap-4"><div><p className="eyebrow">Narrow the list</p><h2 className="mt-1 text-lg font-semibold text-slate-900">Company filters</h2></div><button type="button" className="icon-button" onClick={() => setOpen(false)} aria-label="Close filters"><X size={16} /></button></div>
        <label className="filter-field"><span>Locality</span><select value={draft.locality} onChange={(event) => setDraft({ ...draft, locality: event.target.value as CompanyListFilterState["locality"] })}><option value="all">All County Dublin</option>{DUBLIN_LOCALITIES.map((locality) => <option value={locality} key={locality}>{locality}</option>)}</select></label>
        <label className="filter-field"><span>Research status</span><select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as CompanyListFilterState["status"] })}><option value="all">Any status</option><option value="queued">Queued</option><option value="running">Researching</option><option value="completed">Fresh</option><option value="partial">Partial</option><option value="failed">Needs review</option></select></label>
        <label className="filter-field"><span>Permit evidence</span><select value={draft.permitSignal} onChange={(event) => setDraft({ ...draft, permitSignal: event.target.value as CompanyListFilterState["permitSignal"] })}><option value="all">Any permit signal</option><option value="confirmed">Confirmed sponsorship</option><option value="potential">Potentially qualifying role</option><option value="unknown">No confirmed signal</option></select></label>
        <label className="filter-field"><span>Freshness</span><select value={draft.freshness} onChange={(event) => setDraft({ ...draft, freshness: event.target.value as CompanyListFilterState["freshness"] })}><option value="all">Any freshness</option><option value="fresh">Checked in 30 days</option><option value="stale">Needs refresh</option><option value="unknown">Not enriched</option></select></label>
        <label className="filter-field"><span>Confidence</span><select value={draft.confidence} onChange={(event) => setDraft({ ...draft, confidence: event.target.value as CompanyListFilterState["confidence"] })}><option value="all">Any confidence</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></label>
        <label className="filter-field"><span>Open roles</span><select value={draft.openRoles} onChange={(event) => setDraft({ ...draft, openRoles: event.target.value as CompanyListFilterState["openRoles"] })}><option value="all">Any role status</option><option value="yes">Has open roles</option><option value="no">No open roles captured</option></select></label>
        <div className="mt-5 flex justify-end gap-2"><button type="button" className="secondary-button" onClick={() => { const reset: CompanyListFilterState = { locality: "all", status: "all", permitSignal: "all", freshness: "all", confidence: "all", openRoles: "all" }; setDraft(reset); onApply(reset); setOpen(false); }}>Clear</button><button type="button" className="primary-button" onClick={apply}>Apply filters</button></div>
      </section>
    </div>}
  </>;
}
