import { Search } from "lucide-react";
import type { CompanyListItem } from "../../lib/repositories/company-repository";
import type { CompanyCategory } from "../../lib/domain/types";
import { CompanyCard } from "./company-card";
import { FilterSheet, type CompanyListFilterState } from "./filter-sheet";

export function CompanyList({ companies, selectedId, onSelect, query, onQueryChange, category, filters, onFiltersChange }: {
  companies: CompanyListItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  query: string;
  onQueryChange: (value: string) => void;
  category: CompanyCategory;
  filters?: CompanyListFilterState;
  onFiltersChange?: (filters: CompanyListFilterState) => void;
}) {
  const activeFilters = filters ?? { locality: "all", status: "all" };
  return (
    <section className="flex min-h-0 flex-col border-r border-slate-200 bg-[#f7f9fb]">
      <div className="border-b border-slate-200 px-5 pb-4 pt-6">
        <p className="eyebrow">{category === "work-permit" ? "Permit lens" : "Research queue"}</p>
        <div className="mt-2 flex items-end justify-between gap-2">
          <h2 className="text-xl font-semibold tracking-[-0.04em] text-slate-900">{companies.length} companies</h2>
          <span className="text-xs text-slate-500">County Dublin</span>
        </div>
        <label className="search-field mt-4">
          <Search size={16} className="text-slate-400" />
          <input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="Search companies" aria-label="Search companies" />
        </label>
        {onFiltersChange && <div className="mt-3"><FilterSheet filters={activeFilters} onApply={onFiltersChange} /></div>}
      </div>
      <div className="scrollbar-thin min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {companies.length ? companies.map((company) => <CompanyCard key={company.id} company={company} selected={company.id === selectedId} onSelect={() => onSelect(company.id)} />) : (
          <div className="empty-state m-2"><div className="empty-dot" /><p className="font-medium text-slate-700">No companies here yet</p><p className="mt-1 text-xs leading-5 text-slate-500">Import a spreadsheet or run discovery to start building your private research set.</p></div>
        )}
      </div>
    </section>
  );
}
