import { useState } from "react";
import { SlidersHorizontal, X } from "lucide-react";
import { DUBLIN_LOCALITIES } from "../../lib/domain/types";
import type { DublinLocality } from "../../lib/domain/types";

export type CompanyListFilterState = {
  locality: DublinLocality | "all";
  status: "all" | "queued" | "running" | "completed" | "partial" | "failed";
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
    <button type="button" className="filter-button" onClick={openSheet} aria-label="Filter companies"><SlidersHorizontal size={14} />Filter companies</button>
    {open && <div className="sheet-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
      <section className="filter-sheet" role="dialog" aria-modal="true" aria-label="Filter companies">
        <div className="flex items-start justify-between gap-4"><div><p className="eyebrow">Narrow the list</p><h2 className="mt-1 text-lg font-semibold text-slate-900">Company filters</h2></div><button type="button" className="icon-button" onClick={() => setOpen(false)} aria-label="Close filters"><X size={16} /></button></div>
        <label className="filter-field"><span>Locality</span><select value={draft.locality} onChange={(event) => setDraft({ ...draft, locality: event.target.value as CompanyListFilterState["locality"] })}><option value="all">All County Dublin</option>{DUBLIN_LOCALITIES.map((locality) => <option value={locality} key={locality}>{locality}</option>)}</select></label>
        <label className="filter-field"><span>Research status</span><select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as CompanyListFilterState["status"] })}><option value="all">Any status</option><option value="queued">Queued</option><option value="running">Researching</option><option value="completed">Fresh</option><option value="partial">Partial</option><option value="failed">Needs review</option></select></label>
        <div className="mt-5 flex justify-end gap-2"><button type="button" className="secondary-button" onClick={() => { const reset: CompanyListFilterState = { locality: "all", status: "all" }; setDraft(reset); onApply(reset); setOpen(false); }}>Clear</button><button type="button" className="primary-button" onClick={apply}>Apply filters</button></div>
      </section>
    </div>}
  </>;
}
