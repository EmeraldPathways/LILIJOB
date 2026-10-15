"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { RefreshCw } from "lucide-react";
import type { CompanyDetail as CompanyDetailRecord } from "../../lib/repositories/company-repository";
import { CompanyDetail } from "./company-detail";
import type { CompanyTab } from "./company-tabs";

export function CompanyProfileClient({ companyId }: { companyId: string }) {
  const [company, setCompany] = useState<CompanyDetailRecord | null>(null);
  const [tab, setTab] = useState<CompanyTab>("overview");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/companies/${encodeURIComponent(companyId)}`, { cache: "no-store" });
      const body = await response.json() as { company?: CompanyDetailRecord; error?: { message?: string } };
      if (!response.ok || !body.company) throw new Error(body.error?.message ?? "Company profile could not be loaded.");
      setCompany(body.company);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Company profile could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);

  async function enrich() {
    setMessage("Enriching this company with fresh sourced evidence…");
    try {
      const response = await fetch("/api/enrichment", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ companyId }) });
      const body = await response.json() as { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "Enrichment could not start.");
      await load();
      setMessage("Company enrichment completed.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Enrichment could not start.");
    }
  }

  return <main className="standalone-page"><div className="standalone-header"><Link className="text-xs font-semibold text-blue-600 hover:underline" href="/">← Back to workspace</Link><p className="eyebrow mt-6">Full company profile</p><h1 className="workspace-title">Research record</h1><p className="workspace-description">Inspect the same sourced profile in a focused view that works well on a phone.</p></div>{message && <div className="status-banner" role="status"><span>{message}</span></div>}{loading && !company ? <div className="standalone-card" role="status"><RefreshCw size={16} className="animate-spin" /> Loading company profile…</div> : company ? <div className="standalone-card profile-route-card"><CompanyDetail company={company} activeTab={tab} onTabChange={setTab} onEnrich={() => void enrich()} /></div> : <div className="standalone-card empty-state"><p className="font-medium text-slate-800">Company not found</p><p className="mt-1 text-sm text-slate-500">This private record may have been removed or belongs to another account.</p></div>}</main>;
}
