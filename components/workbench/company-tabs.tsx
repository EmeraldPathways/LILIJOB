import type { ReactNode } from "react";

export type CompanyTab = "overview" | "roles" | "permit" | "sources";

export function CompanyTabs({ active, onChange, children }: { active: CompanyTab; onChange: (tab: CompanyTab) => void; children: ReactNode }) {
  const tabs: Array<[CompanyTab, string]> = [["overview", "Overview"], ["roles", "Open roles"], ["permit", "Permit evidence"], ["sources", "Sources & history"]];
  return <div className="flex min-h-0 flex-1 flex-col"><div className="border-b border-slate-200 px-6"><div className="flex gap-5 overflow-x-auto">{tabs.map(([value, label]) => <button type="button" key={value} onClick={() => onChange(value)} className={`detail-tab ${active === value ? "detail-tab-active" : ""}`}>{label}</button>)}</div></div><div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">{children}</div></div>;
}
