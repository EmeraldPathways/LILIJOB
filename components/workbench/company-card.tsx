import { ArrowUpRight, MapPin } from "lucide-react";
import type { CompanyListItem } from "../../lib/repositories/company-repository";
import { EnrichmentBadge, PermitBadge } from "./status-badges";

export function CompanyCard({ company, selected, onSelect }: { company: CompanyListItem; selected: boolean; onSelect: () => void }) {
  return (
    <button type="button" onClick={onSelect} className={`company-card ${selected ? "company-card-selected" : ""}`} aria-pressed={selected}>
      <div className="flex items-start justify-between gap-3">
        <div className="company-monogram">{company.name.slice(0, 1).toUpperCase()}</div>
        <ArrowUpRight size={16} className="mt-1 text-slate-400" />
      </div>
      <div className="mt-4 text-left">
        <h3 className="font-semibold tracking-[-0.02em] text-slate-900">{company.name}</h3>
        <p className="mt-1 flex items-center gap-1 text-xs text-slate-500"><MapPin size={12} />{company.locality ?? "County Dublin · locality pending"}</p>
      </div>
      <div className="mt-4 flex flex-wrap gap-1.5 text-left">
        <EnrichmentBadge status={company.enrichmentStatus} />
        <PermitBadge signal={company.permitSignal} />
      </div>
      {company.categories.length > 0 && <p className="mt-3 text-left text-[11px] font-medium uppercase tracking-[0.08em] text-slate-400">{company.categories.join(" · ")}</p>}
    </button>
  );
}
