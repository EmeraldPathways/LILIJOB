"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BarChart3, ChevronDown, Download, LogOut, Menu, Plus, RefreshCw, ShieldCheck, Sparkles, X } from "lucide-react";
import type { CompanyCategory } from "../../lib/domain/types";
import type { CompanyDetail, CompanyListItem } from "../../lib/repositories/company-repository";
import { WORKBENCH_NAV } from "./navigation";
import { CompanyList } from "./company-list";
import { CompanyDetail as CompanyDetailView } from "./company-detail";
import { ImportDialog } from "./import-dialog";
import { AiHelper } from "./ai-helper";
import type { CompanyListFilterState } from "./filter-sheet";

export type AppShellUser = { displayName: string; email: string };

export function AppShell({ user, initialCompanies }: { user: AppShellUser; initialCompanies: CompanyListItem[] }) {
  const initialCategory = WORKBENCH_NAV.find((item) => initialCompanies.some((company) => company.categories.includes(item.category)))?.category ?? "work-permit";
  const [category, setCategory] = useState<CompanyCategory>(initialCategory);
  const [companies, setCompanies] = useState<CompanyListItem[]>(initialCompanies);
  const [selectedId, setSelectedId] = useState<string | null>(initialCompanies[0]?.id ?? null);
  const [detail, setDetail] = useState<CompanyDetail | null>(null);
  const [activeTab, setActiveTab] = useState<"overview" | "roles" | "permit" | "sources">("overview");
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<CompanyListFilterState>({ locality: "all", status: "all", permitSignal: "all", freshness: "all", confidence: "all", openRoles: "all" });
  const [busy, setBusy] = useState(false);
  const [enrichingId, setEnrichingId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [mobileNav, setMobileNav] = useState(false);

  const currentNav = useMemo(() => WORKBENCH_NAV.find((item) => item.category === category) ?? WORKBENCH_NAV[0], [category]);

  async function loadCompanies(nextCategory = category, nextQuery = query) {
    try {
      const params = new URLSearchParams({ category: nextCategory, locality: filters.locality, status: filters.status, permitSignal: filters.permitSignal, freshness: filters.freshness, confidence: filters.confidence, openRoles: filters.openRoles });
      if (nextQuery.trim()) params.set("q", nextQuery.trim());
      const response = await fetch(`/api/companies?${params.toString()}`, { cache: "no-store" });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: { message?: string } };
        setStatus(body.error?.message ?? "Could not load the company list.");
        return;
      }
      const body = await response.json() as { companies: CompanyListItem[] };
      setCompanies(body.companies);
      setSelectedId((current) => body.companies.some((item) => item.id === current) ? current : body.companies[0]?.id ?? null);
    } catch { setStatus("Could not refresh the company list."); }
  }

  // Category changes intentionally re-query the private API.
  // eslint-disable-next-line react-hooks/exhaustive-deps, react-hooks/set-state-in-effect
  useEffect(() => { void loadCompanies(); }, [category, filters]);
  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    fetch(`/api/companies/${selectedId}`, { cache: "no-store" }).then(async (response) => {
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: { message?: string } };
        throw new Error(body.error?.message ?? "Company profile could not be loaded.");
      }
      const body = await response.json() as { company: CompanyDetail };
      return body.company;
    }).then((value) => { if (!cancelled) setDetail(value); }).catch((error) => { if (!cancelled) { setDetail(null); setStatus(error instanceof Error ? error.message : "Company profile could not be loaded."); } });
    return () => { cancelled = true; };
  }, [selectedId]);

  async function refresh(scope: "all" | "company" = "all") {
    setBusy(true); setStatus(scope === "company" ? "Refreshing company evidence…" : "Refreshing your Dublin research set…");
    try {
      async function requestBatch(body: Record<string, unknown>) {
        const response = await fetch("/api/refresh", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
        const payload = await response.json() as { summary?: { runId: string; nextCompanyIds?: string[]; done?: boolean }; error?: { message?: string } };
        if (!response.ok) throw new Error(payload.error?.message ?? "Refresh could not start");
        if (!payload.summary) throw new Error("Refresh returned no run summary.");
        return payload.summary;
      }
      async function continueRefresh(runId: string, nextCompanyIds: string[]) {
        let pending = nextCompanyIds;
        while (pending.length) {
          setStatus(`Refresh is progressing in bounded batches · ${pending.length} companies remaining.`);
          const summary = await requestBatch({ runId, companyIds: pending });
          pending = summary.nextCompanyIds ?? [];
          await loadCompanies();
        }
        setStatus("Refresh completed. New evidence is available in the workspace.");
      }
      const summary = await requestBatch(scope === "company" && selectedId ? { companyId: selectedId } : {});
      if (summary.nextCompanyIds?.length && !summary.done) {
        setStatus(`Refresh started in bounded batches · ${summary.nextCompanyIds.length} companies queued.`);
        void continueRefresh(summary.runId, summary.nextCompanyIds).catch((error) => setStatus(error instanceof Error ? error.message : "Refresh stopped; retry from history."));
      } else {
        setStatus("Refresh queued. New evidence will appear as each source is checked.");
      }
      await loadCompanies();
      if (selectedId) {
        const detailResponse = await fetch(`/api/companies/${selectedId}`, { cache: "no-store" });
        if (detailResponse.ok) setDetail((await detailResponse.json() as { company: CompanyDetail }).company);
      }
    } catch (error) { setStatus(error instanceof Error ? error.message : "Refresh could not start."); }
    finally { setBusy(false); }
  }

  async function enrichCompany(companyId: string) {
    setEnrichingId(companyId);
    setStatus("Enriching this company with fresh sourced evidence…");
    try {
      const response = await fetch("/api/enrichment", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ companyId }) });
      const body = await response.json() as { summary?: { status?: string }; error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "Enrichment could not start.");
      await loadCompanies();
      const detailResponse = await fetch(`/api/companies/${encodeURIComponent(companyId)}`, { cache: "no-store" });
      if (detailResponse.ok && companyId === selectedId) setDetail((await detailResponse.json() as { company: CompanyDetail }).company);
      setStatus(body.summary?.status === "failed" ? "Enrichment finished without reliable new sources." : "Company enrichment completed.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Enrichment could not start.");
    } finally {
      setEnrichingId(null);
    }
  }

  async function discover() {
    setBusy(true); setStatus(`Searching for additional ${currentNav.shortLabel.toLowerCase()} in County Dublin…`);
    try {
      const response = await fetch("/api/discovery", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ category }) });
      const body = await response.json() as { summary?: { runId?: string; nextCompanyIds?: string[]; done?: boolean }; error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "Discovery could not start");
      let pending = body.summary?.nextCompanyIds ?? [];
      const runId = body.summary?.runId;
      while (pending.length && runId) {
        setStatus(`Discovery is enriching new companies · ${pending.length} remaining.`);
        const enrichmentResponse = await fetch("/api/enrichment", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ runId, companyIds: pending }) });
        const enrichmentBody = await enrichmentResponse.json() as { summary?: { nextCompanyIds?: string[]; done?: boolean }; error?: { message?: string } };
        if (!enrichmentResponse.ok) throw new Error(enrichmentBody.error?.message ?? "Discovery enrichment could not start");
        const next = enrichmentBody.summary?.nextCompanyIds ?? [];
        if (next.length >= pending.length) throw new Error("Discovery enrichment did not advance its queue");
        pending = next;
      }
      setStatus("Discovery completed. New companies and sourced evidence are available.");
      await loadCompanies();
    } catch (error) { setStatus(error instanceof Error ? error.message : "Discovery could not start."); }
    finally { setBusy(false); }
  }

  return <main className="app-shell">
    <aside className={`app-sidebar ${mobileNav ? "app-sidebar-open" : ""}`} aria-label="Primary navigation"><div className="sidebar-brand"><div className="brand-mark"><BarChart3 size={17} /></div><div><p className="brand-name">Dublin Tech</p><p className="brand-subtitle">Compass</p><span className="sr-only">Dublin Tech Compass</span></div><button className="mobile-close icon-button" type="button" onClick={() => setMobileNav(false)}><X size={17} /></button></div><div className="sidebar-section"><p className="eyebrow px-3">Workspace</p><nav className="mt-3 space-y-1"><Link href="/" className="nav-item nav-item-active"><span className="nav-dot nav-dot-blue" /><span className="flex-1 text-left">Dashboard</span></Link><a href="/imports" className="nav-item"><span className="nav-dot nav-dot-muted" /><span className="flex-1 text-left">Imports</span></a><a href="/history" className="nav-item"><span className="nav-dot nav-dot-muted" /><span className="flex-1 text-left">Refresh history</span></a><a href="/ai" className="nav-item"><span className="nav-dot nav-dot-purple" /><span className="flex-1 text-left">AI helper</span></a></nav></div><div className="sidebar-section"><p className="eyebrow px-3">Research lenses</p><nav className="mt-3 space-y-1">{WORKBENCH_NAV.map((item) => <button type="button" key={item.category} onClick={() => { setCategory(item.category); setMobileNav(false); }} className={`nav-item ${category === item.category ? "nav-item-active" : ""}`}><span className={`nav-dot nav-dot-${item.category}`} /><span className="flex-1 text-left">{item.label}</span><ChevronDown size={14} className="rotate-[-90deg] opacity-40" /></button>)}</nav></div><div className="sidebar-section mt-auto"><div className="privacy-card"><ShieldCheck size={16} className="text-emerald-600" /><div><p className="text-xs font-semibold text-slate-800">Private workspace</p><p className="mt-1 text-[11px] leading-4 text-slate-500">Your files and research stay scoped to your account.</p></div></div><a href="/signout-with-chatgpt?return_to=%2F" target="_top" className="account-row"><span className="avatar">{user.displayName.slice(0, 1).toUpperCase()}</span><span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold text-slate-700">{user.displayName}</span><span className="block truncate text-[11px] text-slate-400">{user.email}</span></span><LogOut size={14} className="text-slate-400" /></a></div></aside>
    <div className="app-main"><header className="topbar"><button type="button" className="mobile-menu icon-button" onClick={() => setMobileNav(true)} aria-label="Open navigation"><Menu size={18} /></button><div className="mobile-select-wrap"><select value={category} onChange={(event) => setCategory(event.target.value as CompanyCategory)} aria-label="Research lens">{WORKBENCH_NAV.map((item) => <option key={item.category} value={item.category}>{item.label}</option>)}</select><ChevronDown size={15} /></div><div className="topbar-spacer" /><a href="/settings" target="_top" className="topbar-settings" aria-label="Open settings">Settings</a><a href="/api/exports" className="topbar-export"><Download size={15} />Export CSV</a><span className="topbar-private"><ShieldCheck size={14} />Private</span></header><section className="workspace-header"><div><p className="eyebrow">County Dublin · {currentNav.shortLabel}</p><h1 className="workspace-title">Find your next tech team.</h1><p className="workspace-description">{currentNav.description} Fresh sources, permit signals, and role context in one place.</p></div><div className="workspace-actions"><ImportDialog onImported={async (summary) => { const importedCategory = summary.categories.length === 1 ? summary.categories[0] : category; if (summary.categories.length === 1 && importedCategory !== category) setCategory(importedCategory); await loadCompanies(importedCategory); }} /><button type="button" className="secondary-button" onClick={() => void discover()} disabled={busy}><Plus size={16} />Find companies</button><button type="button" className="primary-button" onClick={() => void refresh()} disabled={busy}><RefreshCw size={16} className={busy ? "animate-spin" : ""} />Refresh now</button></div></section>{status && <div className="status-banner" role="status"><Sparkles size={15} /><span>{status}</span><button type="button" onClick={() => setStatus(null)} aria-label="Dismiss status"><X size={14} /></button></div>}<section className="workspace-grid" aria-label="Company workspace"><CompanyList companies={companies} selectedId={selectedId} onSelect={(id) => { setSelectedId(id); setActiveTab("overview"); }} query={query} onQueryChange={(value) => { setQuery(value); void loadCompanies(category, value); }} category={category} filters={filters} onFiltersChange={setFilters} /><div className="detail-column"><div className="profile-region" role="region" aria-label="Company profile"><CompanyDetailView company={selectedId ? detail : null} activeTab={activeTab} onTabChange={setActiveTab} onEnrich={() => { if (selectedId) void enrichCompany(selectedId); }} enriching={Boolean(selectedId && enrichingId === selectedId)} /></div><AiHelper companyId={selectedId} /></div></section><footer className="app-footer"><span><span className="live-dot" />Manual enrichment · Enrich companies one at a time</span><span>Sources are checked with timestamps and confidence</span></footer></div>
  </main>;
}
